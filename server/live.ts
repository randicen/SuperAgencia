import { GoogleGenAI, Modality, Type, type LiveServerMessage } from '@google/genai';
import { differenceInMinutes, parseISO, startOfDay, format, addDays } from 'date-fns';
import type { Server as HttpServer } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { chatWithSolverBackend } from './ai.js';
import { loadPlannerState, recordScheduleRun, savePlannerState } from './state.js';
import { DEFAULT_PLANNER_STATE, type PlannerState, type SearchSource } from '../src/lib/plannerState.js';
import {
  DEFAULT_INTELLIGENT_CONFIG,
  solveSchedule,
  type CalendarEvent,
  type Dependency,
  type ScheduledTask,
  type Task,
  type WorkWindow,
} from '../src/lib/solver.js';
import { mergeCalendarEvents, mergeDependencies, mergeTasks } from './scheduleMutationPolicy.js';
import { assertChannelAccess, getGovernanceContext, recordUsageEvent } from './governance.js';
import { verifyAccessToken } from './auth.js';

const updateScheduleTool = {
  name: 'updateSchedule',
  description:
    "Updates the list of tasks and dependencies based on the user's request. Use this tool whenever the user adds, modifies, or removes a task or constraint.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      tasks: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            name: { type: Type.STRING },
            duration: { type: Type.NUMBER, description: 'Duration in minutes' },
            fixedStartDateTime: { type: Type.STRING, description: "ISO date-time string (e.g. '2026-04-06T15:00:00'). Optional." },
            minStartDateTime: { type: Type.STRING, description: 'ISO date-time string. Optional.' },
            deadlineDateTime: { type: Type.STRING, description: 'ISO date-time string. Optional.' },
            priority: { type: Type.STRING, enum: ['ASAP', 'high', 'medium', 'low'], description: 'Task priority. Optional.' },
            elastic: { type: Type.BOOLEAN, description: 'If true, the task can be split into smaller chunks. Optional.' },
            minChunkSize: { type: Type.NUMBER, description: 'Minimum chunk size in minutes if elastic is true. Optional.' },
            progress: { type: Type.NUMBER, description: 'Progress percentage 0-100. Optional.' },
            deadlineType: { type: Type.STRING, enum: ['Hard Deadline', 'Soft Deadline'], description: 'Type of deadline. Optional.' },
          },
          required: ['id', 'name', 'duration'],
        },
      },
      dependencies: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            fromId: { type: Type.STRING },
            toId: { type: Type.STRING },
          },
          required: ['fromId', 'toId'],
        },
      },
      calendarEvents: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            title: { type: Type.STRING },
            startDateTime: { type: Type.STRING, description: 'ISO date-time string for the event start.' },
            endDateTime: { type: Type.STRING, description: 'ISO date-time string for the event end.' },
            kind: { type: Type.STRING, enum: ['meeting', 'personal', 'focus', 'blocked'], description: 'Type of calendar event. Optional.' },
          },
          required: ['id', 'title', 'startDateTime', 'endDateTime'],
        },
      },
      removedTaskIds: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Task ids that must be removed explicitly from the planner state.',
      },
      removedCalendarEventIds: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Calendar event ids that must be removed explicitly from the planner state.',
      },
    },
    required: ['tasks', 'dependencies', 'calendarEvents'],
  },
};

const searchExternalInfoTool = {
  name: 'searchExternalInfo',
  description:
    'Busca información actualizada del mundo externo cuando el usuario pregunte por conciertos, festivos, calendarios tributarios, noticias, precios, fechas o eventos reales.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'Consulta exacta que debe buscarse en la web.',
      },
    },
    required: ['query'],
  },
};

type LiveContext = {
  messages: PlannerState['messages'];
  tasks: Task[];
  calendarEvents: CalendarEvent[];
  dependencies: Dependency[];
  workWindow: WorkWindow;
  strategy: PlannerState['strategy'];
  currentSchedule?: ScheduledTask[] | null;
};

type ClientEnvelope =
  | {
      type: 'auth';
      payload: {
        accessToken: string;
        context: LiveContext;
      };
    }
  | {
      type: 'context';
      payload: LiveContext;
    }
  | {
      type: 'audio';
      payload: {
        data: string;
        mimeType: string;
      };
    }
  | {
      type: 'disconnect';
    };

type ServerEnvelope =
  | { type: 'status'; payload: { status: 'disconnected' | 'connecting' | 'connected' } }
  | { type: 'audio'; payload: { data: string } }
  | { type: 'state'; payload: { state: PlannerState } }
  | { type: 'search_progress'; payload: { message: string; sources: SearchSource[] } }
  | { type: 'error'; payload: { message: string } };

const hasLivePlannerData = (context: LiveContext): boolean =>
  context.messages.length > 0 ||
  context.tasks.length > 0 ||
  context.calendarEvents.length > 0 ||
  context.dependencies.length > 0 ||
  (context.currentSchedule?.length ?? 0) > 0;

const toLiveContext = (state: PlannerState): LiveContext => ({
  messages: state.messages,
  tasks: state.tasks,
  calendarEvents: state.calendarEvents,
  dependencies: state.dependencies,
  workWindow: state.workWindow,
  strategy: state.strategy,
  currentSchedule: state.schedule,
});

const sendEnvelope = (socket: WebSocket, envelope: ServerEnvelope) => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(envelope));
  }
};

const extractInlineAudioBase64 = (message: LiveServerMessage): string[] => {
  const parts = message.serverContent?.modelTurn?.parts ?? [];
  return parts
    .map((part) => part.inlineData?.data ?? null)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
};

const extractFinishedTranscription = (message: LiveServerMessage): string | null => {
  const transcription = message.serverContent?.inputTranscription;
  if (!transcription?.finished || typeof transcription.text !== 'string') {
    return null;
  }

  const text = transcription.text.trim();
  return text.length > 0 ? text : null;
};

const buildSystemInstruction = (context: LiveContext) => {
  const now = new Date();
  const currentDateStr = now.toLocaleDateString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const currentTimeStr = now.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const todayStr = format(now, 'yyyy-MM-dd');
  const tomorrowStr = format(addDays(now, 1), 'yyyy-MM-dd');

  return `Eres un asistente de planificación inteligente por voz. Tu trabajo es entender las peticiones del usuario y traducirlas a una estructura de datos estricta para un motor matemático.

CONCEPTO CRÍTICO DE TIEMPO:
- El motor necesita fechas y horas exactas en formato ISO 8601 local.
- Usa los campos 'fixedStartDateTime', 'minStartDateTime' y 'deadlineDateTime'.
- EJEMPLOS:
  * Hoy a las 9:00 AM = "${todayStr}T09:00:00"
  * Hoy a las 2:30 PM = "${todayStr}T14:30:00"
  * Mañana a las 9:00 AM = "${tomorrowStr}T09:00:00"
  * Mañana a las 5:00 PM = "${tomorrowStr}T17:00:00"
- Comunícate siempre usando formatos naturales, nunca expliques ISO.

CONTEXTO:
- La fecha de hoy es: ${currentDateStr}
- La hora actual es: ${currentTimeStr}
- Horario de trabajo: ${context.workWindow.startHour}:00 a ${context.workWindow.endHour}:00. Días: ${context.workWindow.workDays.join(', ')}
- Estrategia actual: ${context.strategy}
- Tareas actuales: ${JSON.stringify(context.tasks)}
- Eventos actuales: ${JSON.stringify(context.calendarEvents)}
- Dependencias actuales: ${JSON.stringify(context.dependencies)}
- Resultado visible actual: ${JSON.stringify(context.currentSchedule ?? [])}

REGLAS:
1. No resuelves tú la agenda: propones cambios y llamas a updateSchedule.
2. No elimines tareas existentes a menos que el usuario lo pida explícitamente.
2b. Si el usuario pide eliminar o quitar una tarea/evento, incluye sus ids en removedTaskIds o removedCalendarEventIds.
3. Si el usuario pide una hora específica, usa fixedStartDateTime.
4. Si algo no cabe, no inventes: deja que el motor lo rechace y luego explícalo con naturalidad.
5. Responde siempre en español. Sé directo y útil.`;
};

const buildVoiceSystemInstruction = (context: LiveContext) => {
  const now = new Date();
  const currentDateStr = now.toLocaleDateString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const currentTimeStr = now.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const todayStr = format(now, 'yyyy-MM-dd');
  const tomorrowStr = format(addDays(now, 1), 'yyyy-MM-dd');

  return `Eres un asistente de planificaci?n inteligente por voz. Tu trabajo es entender las peticiones del usuario y traducirlas a una estructura de datos estricta para un motor matem?tico.

CONCEPTO CR?TICO DE TIEMPO:
- El motor necesita fechas y horas exactas en formato ISO 8601 local.
- Usa los campos 'fixedStartDateTime', 'minStartDateTime' y 'deadlineDateTime'.
- EJEMPLOS:
  * Hoy a las 9:00 AM = "${todayStr}T09:00:00"
  * Hoy a las 2:30 PM = "${todayStr}T14:30:00"
  * Ma?ana a las 9:00 AM = "${tomorrowStr}T09:00:00"
  * Ma?ana a las 5:00 PM = "${tomorrowStr}T17:00:00"
- Comun?cate siempre usando formatos naturales, nunca expliques ISO.

CONTEXTO:
- La fecha de hoy es: ${currentDateStr}
- La hora actual es: ${currentTimeStr}
- Horario de trabajo: ${context.workWindow.startHour}:00 a ${context.workWindow.endHour}:00. D?as: ${context.workWindow.workDays.join(', ')}
- Estrategia actual: ${context.strategy}
- Tareas actuales: ${JSON.stringify(context.tasks)}
- Eventos actuales: ${JSON.stringify(context.calendarEvents)}
- Dependencias actuales: ${JSON.stringify(context.dependencies)}
- Resultado visible actual: ${JSON.stringify(context.currentSchedule ?? [])}

REGLAS:
1. No resuelves t? la agenda: propones cambios y llamas a updateSchedule.
2. No elimines tareas existentes a menos que el usuario lo pida expl?citamente.
2b. Si el usuario pide eliminar o quitar una tarea/evento, incluye sus ids en removedTaskIds o removedCalendarEventIds.
3. Si el usuario pide una hora espec?fica, usa fixedStartDateTime.
4. Si algo no cabe, no inventes: deja que el motor lo rechace y luego expl?calo con naturalidad.
5. Si el usuario pide informaci?n del mundo externo (festivos, conciertos, calendarios tributarios, noticias, precios o fechas reales), llama a searchExternalInfo.
5b. Para cualquier consulta factual del mundo externo, DEBES llamar a searchExternalInfo antes de responder. No improvises ni digas que tu funci?n es solo gestionar agenda.
5c. Si searchExternalInfo no devuelve datos suficientes, di expl?citamente que no encontraste informaci?n fiable sobre eso en la b?squeda web. No digas que no puedes ayudar por ser un asistente de agenda.
6. No asumas pa?s o ciudad si el usuario no los especifica.
7. Si una tool response incluye "voiceText", úsala como base principal de tu respuesta hablada. Conserva esa idea, ese tacto y ese tono.
8. Si una tool response incluye "summary" y "voiceText", prioriza "voiceText" para hablar.
9. Responde siempre en español. Sé directo y útil.`;
};

const mapRawTasks = (rawTasks: any[], now: Date): Task[] => {
  const baseDate = startOfDay(now);
  return rawTasks.map((task) => {
    let fixedStart: number | undefined;
    let minStart: number | undefined;
    let deadline: number | undefined;

    if (task.fixedStartDateTime) fixedStart = differenceInMinutes(parseISO(task.fixedStartDateTime), baseDate);
    if (task.minStartDateTime) minStart = differenceInMinutes(parseISO(task.minStartDateTime), baseDate);
    if (task.deadlineDateTime) deadline = differenceInMinutes(parseISO(task.deadlineDateTime), baseDate);

    return {
      id: task.id,
      name: task.name,
      duration: task.duration,
      fixedStart,
      minStart,
      deadline,
      priority: task.priority,
      elastic: task.elastic,
      minChunkSize: task.minChunkSize,
      progress: task.progress,
      deadlineType: task.deadlineType,
    };
  });
};

const mapRawCalendarEvents = (rawEvents: any[], now: Date): CalendarEvent[] => {
  const baseDate = startOfDay(now);
  return rawEvents.map((event) => ({
    id: event.id,
    title: event.title,
    start: differenceInMinutes(parseISO(event.startDateTime), baseDate),
    end: differenceInMinutes(parseISO(event.endDateTime), baseDate),
    kind: event.kind,
  }));
};

export function registerLiveVoiceProxy(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: '/ws/live' });

  wss.on('connection', (socket) => {
    sendEnvelope(socket, { type: 'status', payload: { status: 'connecting' } });

    let liveContext: LiveContext = {
      messages: [],
      tasks: [],
      calendarEvents: [],
      dependencies: [],
      workWindow: DEFAULT_PLANNER_STATE.workWindow,
      strategy: DEFAULT_PLANNER_STATE.strategy,
      currentSchedule: [],
    };
    let authUser: Awaited<ReturnType<typeof verifyAccessToken>> | null = null;
    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
      let voiceRoute:
        | {
            provider: string;
            model: string;
            modelTier: 'fast' | 'heavy';
            fallbackProvider?: string;
            fallbackModel?: string;
            fallbackModelTier?: 'fast' | 'heavy';
          }
        | null = null;
    let sessionStartedAt: number | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;

    const closeLiveSession = async () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      try {
        await liveSession?.close();
      } catch {
        // ignore
      }
      liveSession = null;

      if (authUser && voiceRoute && sessionStartedAt) {
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - sessionStartedAt) / 1000));
        try {
          await recordUsageEvent({
            userId: authUser.id,
            channel: 'voice',
            route: voiceRoute,
            success: true,
            voiceSeconds: elapsedSeconds,
          });
        } catch (error) {
          console.error('[live] Failed to record voice usage:', error);
        }
      }

      sessionStartedAt = null;
    };

    const connectLiveSession = async () => {
      if (!authUser || !voiceRoute) {
        throw new Error('Voice session requested without authenticated user or model route.');
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('Missing GEMINI_API_KEY');
      }

      const ai = new GoogleGenAI({ apiKey });
      // USAR SOLO EL MODELO PRINCIPAL SIN FALLBACK
      const model = voiceRoute.model;

      try {
        liveSession = await ai.live.connect({
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
              tools: [{ functionDeclarations: [updateScheduleTool, searchExternalInfoTool] }],
            },
            callbacks: {
              onopen: () => {
                sendEnvelope(socket, { type: 'status', payload: { status: 'connected' } });
              },
              onmessage: async (message: LiveServerMessage) => {
                for (const inlineAudio of extractInlineAudioBase64(message)) {
                  sendEnvelope(socket, { type: 'audio', payload: { data: inlineAudio } });
                }

                const functionCalls = message.toolCall?.functionCalls ?? [];
                if (functionCalls.length === 0 || !liveSession || !authUser) {
                  return;
                }

                const functionResponses = [];
                for (const call of functionCalls) {
                  if (call.name === 'searchExternalInfo') {
                    const query =
                      typeof (call.args as any)?.query === 'string' && (call.args as any).query.trim()
                        ? (call.args as any).query.trim()
                        : '';

                    if (!query) {
                      functionResponses.push({
                        id: call.id,
                        name: call.name,
                        response: {
                          success: false,
                          error: 'La consulta web llegó vacía.',
                        },
                      });
                      continue;
                    }

                    const textGovernance = await assertChannelAccess(authUser, 'text');
                    if (!textGovernance.effectivePlan.web_search_enabled) {
                      functionResponses.push({
                        id: call.id,
                        name: call.name,
                        response: {
                          success: false,
                          error: 'La búsqueda web no está habilitada para este plan.',
                        },
                      });
                      continue;
                    }

                    const externalResult = await chatWithSolverBackend(
                      query,
                      liveContext.messages.map((entry) => ({ role: entry.role, text: entry.text })),
                      liveContext.tasks,
                      liveContext.calendarEvents,
                      liveContext.dependencies,
                      liveContext.workWindow,
                      liveContext.strategy,
                      liveContext.currentSchedule,
                      undefined,
                      {
                        primaryProvider: textGovernance.route.provider,
                        primaryModel: textGovernance.route.model,
                        fallbackProvider: textGovernance.route.fallbackProvider,
                        fallbackModel: textGovernance.route.fallbackModel,
                      },
                      'external_lookup',
                      [],
                      { hits: [], sources: [], contextText: '' },
                      {
                        onSearchingStart: (payload) =>
                          sendEnvelope(socket, {
                            type: 'search_progress',
                            payload: {
                              message: payload.message,
                              sources: [],
                            },
                          }),
                        onSearchingResults: (payload) =>
                          sendEnvelope(socket, {
                            type: 'search_progress',
                            payload: {
                              message: payload.message,
                              sources: payload.sources,
                            },
                          }),
                        onThinkingStart: (payload) =>
                          sendEnvelope(socket, {
                            type: 'search_progress',
                            payload: {
                              message: payload.message,
                              sources: payload.sources ?? [],
                            },
                          }),
                      },
                    );

                    await recordUsageEvent({
                      userId: authUser.id,
                      channel: 'web_search',
                      route: {
                        provider: 'tavily',
                        model: 'search-basic-or-advanced',
                        modelTier: 'heavy',
                      },
                      success: true,
                      countAsTextRequest: false,
                    });

                    await recordUsageEvent({
                      userId: authUser.id,
                      channel: 'text',
                      route: {
                        provider: externalResult.usage.provider,
                        model: externalResult.usage.model,
                        modelTier: 'heavy',
                      },
                      success: true,
                      inputTokens: externalResult.usage.inputTokens,
                      outputTokens: externalResult.usage.outputTokens,
                    });

                    const shouldSyncState = externalResult.plannerMutation === true;
                    if (shouldSyncState) {
                      const refreshedState = await loadPlannerState(authUser);
                      liveContext = {
                        ...liveContext,
                        messages: refreshedState.messages,
                        tasks: refreshedState.tasks,
                        calendarEvents: refreshedState.calendarEvents,
                        dependencies: refreshedState.dependencies,
                        currentSchedule: refreshedState.schedule,
                      };
                      sendEnvelope(socket, { type: 'state', payload: { state: refreshedState } });
                    }

                    functionResponses.push({
                      id: call.id,
                      name: call.name,
                      response: {
                        success: true,
                        summary: externalResult.text,
                        voiceText: externalResult.voiceText ?? externalResult.text,
                        sources: externalResult.sources ?? [],
                      },
                    });
                    continue;
                  }

                  if (call.name !== 'updateSchedule') continue;

                  const args = call.args as any;
                  const now = new Date();
                  const parsedTasks = mapRawTasks(args.tasks || [], now);
                  const parsedCalendarEvents = mapRawCalendarEvents(args.calendarEvents || [], now);
                  const proposedTasks = mergeTasks(
                    liveContext.tasks,
                    parsedTasks,
                    (args.removedTaskIds || []) as string[],
                  );
                  const proposedCalendarEvents = mergeCalendarEvents(
                    liveContext.calendarEvents,
                    parsedCalendarEvents,
                    (args.removedCalendarEventIds || []) as string[],
                  );
                  const proposedDependencies = mergeDependencies(
                    liveContext.dependencies,
                    (args.dependencies || []) as Dependency[],
                    proposedTasks,
                  );
                  const nowMinutes = now.getHours() * 60 + now.getMinutes();

                  const result = solveSchedule(
                    proposedTasks,
                    proposedDependencies,
                    proposedCalendarEvents,
                    liveContext.workWindow,
                    liveContext.strategy,
                    nowMinutes,
                    7,
                    15,
                    liveContext.currentSchedule ?? undefined,
                    DEFAULT_INTELLIGENT_CONFIG,
                    now.getDay(),
                  );

                  if (!result.schedule) {
                    functionResponses.push({
                      id: call.id,
                      name: call.name,
                      response: {
                        success: false,
                        error: 'Schedule is mathematically infeasible.',
                        diagnostics: result.diagnostics,
                      },
                    });
                    continue;
                  }

                  const nextState = await savePlannerState(authUser, {
                    messages: liveContext.messages,
                    tasks: proposedTasks,
                    calendarEvents: proposedCalendarEvents,
                    dependencies: proposedDependencies,
                    workWindow: liveContext.workWindow,
                    strategy: liveContext.strategy,
                    schedule: result.schedule,
                    diagnostics: result.diagnostics ?? null,
                    scheduleBaseDate: now.toISOString(),
                  });

                  await recordScheduleRun(authUser, {
                    strategy: nextState.strategy,
                    taskCount: nextState.tasks.length,
                    score: result.score,
                    status: result.diagnostics?.status ?? 'OPTIMAL',
                    diagnostics: result.diagnostics ?? null,
                    schedule: result.schedule,
                    configUsed:
                      nextState.strategy === 'intelligent' ? DEFAULT_INTELLIGENT_CONFIG : {},
                  });

                  liveContext = {
                    ...liveContext,
                    tasks: nextState.tasks,
                    calendarEvents: nextState.calendarEvents,
                    dependencies: nextState.dependencies,
                    currentSchedule: nextState.schedule,
                  };

                  sendEnvelope(socket, { type: 'state', payload: { state: nextState } });
                  functionResponses.push({
                    id: call.id,
                    name: call.name,
                    response: {
                      success: true,
                      currentTasks: proposedTasks,
                      currentCalendarEvents: proposedCalendarEvents,
                      currentDependencies: proposedDependencies,
                    },
                  });
                }

                if (functionResponses.length > 0) {
                  liveSession.sendToolResponse({ functionResponses });
                }
              },
              onerror: (error) => {
                console.error('[live] Gemini Live error:', error);
                sendEnvelope(socket, { type: 'error', payload: { message: 'La sesión de voz falló en el backend.' } });
              },
              onclose: () => {
                sendEnvelope(socket, { type: 'status', payload: { status: 'disconnected' } });
              },
            },
          });

          return;
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError ?? new Error('No fue posible abrir la sesión de voz.');
    };

    socket.on('message', async (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as ClientEnvelope;

        if (message.type === 'disconnect') {
          await closeLiveSession();
          socket.close();
          return;
        }

        if (message.type === 'auth') {
          authUser = await verifyAccessToken(message.payload.accessToken);
          liveContext = toLiveContext(await loadPlannerState(authUser));

          const access = await assertChannelAccess(authUser, 'voice');
          voiceRoute = access.route;

          if (access.access.remainingVoiceSeconds !== null) {
            timeoutHandle = setTimeout(async () => {
              sendEnvelope(socket, {
                type: 'error',
                payload: { message: 'Se agotó el tiempo de voz disponible en tu plan actual.' },
              });
              await closeLiveSession();
              socket.close();
            }, access.access.remainingVoiceSeconds * 1000);
          }

          await connectLiveSession();
          sessionStartedAt = Date.now();
          return;
        }

        if (message.type === 'context') {
          const nextContext: LiveContext = {
            messages: message.payload.messages ?? [],
            tasks: message.payload.tasks ?? [],
            calendarEvents: message.payload.calendarEvents ?? [],
            dependencies: message.payload.dependencies ?? [],
            workWindow: message.payload.workWindow ?? DEFAULT_PLANNER_STATE.workWindow,
            strategy: message.payload.strategy ?? DEFAULT_PLANNER_STATE.strategy,
            currentSchedule: message.payload.currentSchedule ?? [],
          };

          if (hasLivePlannerData(liveContext) && !hasLivePlannerData(nextContext)) {
            return;
          }

          liveContext = nextContext;
          return;
        }

        if (message.type === 'audio') {
          if (!liveSession) {
            return;
          }

          liveSession.sendRealtimeInput({
            audio: {
              data: message.payload.data,
              mimeType: message.payload.mimeType,
            },
          });
        }
      } catch (error: any) {
        console.error('[live] Failed to handle client message:', error);
        sendEnvelope(socket, {
          type: 'error',
          payload: {
            message: error?.message || 'No pude procesar el mensaje de voz.',
          },
        });
      }
    });

    socket.on('close', async () => {
      await closeLiveSession();
    });
  });
}

export const __private__ = {
  extractInlineAudioBase64,
  extractFinishedTranscription,
};
