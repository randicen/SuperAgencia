import type { IncomingMessage, Server as HttpServer } from 'http';
import { URL } from 'url';
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from '@google/genai';
import { WebSocketServer, type WebSocket } from 'ws';
import { runAgent } from './ai.js';
import { verifyAccessToken, type AuthenticatedUser } from './auth.js';
import { appendChatMessage, loadPlannerState, savePlannerState } from './state.js';
import { DEFAULT_INTELLIGENT_CONFIG, solveSchedule } from '../src/lib/solver.js';
import type { PlannerState } from '../src/lib/plannerState.js';
import type { CalendarEvent, Dependency, ScheduledTask, Task, WorkWindow } from '../src/lib/solver.js';

type LiveStatus = 'disconnected' | 'connecting' | 'connected';

type ClientEnvelope =
  | {
      type: 'auth';
      payload: {
        accessToken: string;
        context: LiveClientContext;
      };
    }
  | {
      type: 'context';
      payload: LiveClientContext;
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

type LiveClientContext = {
  messages: PlannerState['messages'];
  tasks: Task[];
  calendarEvents: CalendarEvent[];
  dependencies: Dependency[];
  workWindow: WorkWindow;
  strategy: 'balanced' | 'survival' | 'intelligent';
  currentSchedule?: ScheduledTask[] | null;
};

type ServerEnvelope =
  | { type: 'status'; payload: { status: LiveStatus } }
  | { type: 'audio'; payload: { data: string } }
  | { type: 'state'; payload: { state: PlannerState } }
  | { type: 'search_progress'; payload: { message: string; sources: [] } }
  | { type: 'error'; payload: { message: string } };

const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-live-2.5-flash-preview';

const getEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
};

const buildLiveSystemInstruction = (state: PlannerState | null, context: LiveClientContext | null) => {
  const tasks = state?.tasks ?? context?.tasks ?? [];
  const events = state?.calendarEvents ?? context?.calendarEvents ?? [];
  const dependencies = state?.dependencies ?? context?.dependencies ?? [];
  const workWindow = state?.workWindow ?? context?.workWindow;
  const strategy = state?.strategy ?? context?.strategy ?? 'intelligent';

  return [
    'Eres Tandeba, un asistente de planificación por voz.',
    'Responde siempre en español con tono breve, claro y accionable.',
    'Si el usuario pregunta por su agenda, usa el estado actual.',
    'Si el usuario pide cambios en tareas o eventos, puedes hablar con naturalidad, pero el backend aplicará la mutación por separado después de transcribir la intención.',
    `Tareas actuales: ${JSON.stringify(tasks)}`,
    `Eventos actuales: ${JSON.stringify(events)}`,
    `Dependencias actuales: ${JSON.stringify(dependencies)}`,
    workWindow
      ? `Ventana laboral: ${workWindow.startHour}:00-${workWindow.endHour}:00 / días ${workWindow.workDays.join(',')}`
      : 'Ventana laboral: desconocida',
    `Estrategia actual: ${strategy}`,
  ].join('\n');
};

const sendEnvelope = (socket: WebSocket, envelope: ServerEnvelope) => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(envelope));
  }
};

const extractInlineAudioBase64 = (message: LiveServerMessage): string[] => {
  const parts = message.serverContent?.modelTurn?.parts ?? [];
  return parts
    .map((part) => part.inlineData)
    .filter((blob): blob is NonNullable<typeof blob> => Boolean(blob?.data))
    .map((blob) => blob.data as string);
};

const extractFinishedTranscription = (message: LiveServerMessage): string | null => {
  const transcription = message.serverContent?.inputTranscription;
  if (!transcription?.finished || !transcription.text?.trim()) {
    return null;
  }

  return transcription.text.trim();
};

class LiveVoiceBridge {
  private readonly ai: GoogleGenAI;
  private authUser: AuthenticatedUser | null = null;
  private clientContext: LiveClientContext | null = null;
  private liveSession: Session | null = null;
  private lastFinishedTranscript: string | null = null;
  private lastProcessedTranscript: string | null = null;
  private applyingTranscript = false;
  private disconnected = false;

  constructor(private readonly socket: WebSocket) {
    this.ai = new GoogleGenAI({ apiKey: getEnv('GEMINI_API_KEY') });
  }

  async handleEnvelope(envelope: ClientEnvelope) {
    if (envelope.type === 'auth') {
      await this.handleAuth(envelope.payload.accessToken, envelope.payload.context);
      return;
    }

    if (!this.liveSession || !this.authUser) {
      sendEnvelope(this.socket, {
        type: 'error',
        payload: { message: 'La sesión de voz aún no está autenticada.' },
      });
      return;
    }

    if (envelope.type === 'context') {
      this.clientContext = envelope.payload;
      return;
    }

    if (envelope.type === 'audio') {
      this.liveSession.sendRealtimeInput({
        audio: {
          data: envelope.payload.data,
          mimeType: envelope.payload.mimeType,
        },
      });
      return;
    }

    if (envelope.type === 'disconnect') {
      this.liveSession.sendRealtimeInput({ audioStreamEnd: true });
      this.close();
    }
  }

  private async handleAuth(accessToken: string, context: LiveClientContext) {
    this.clientContext = context;
    this.authUser = await verifyAccessToken(accessToken);

    let currentState: PlannerState | null = null;
    try {
      currentState = await loadPlannerState(this.authUser);
    } catch {
      currentState = null;
    }

    this.liveSession = await this.ai.live.connect({
      model: LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: buildLiveSystemInstruction(currentState, context),
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => {
          sendEnvelope(this.socket, { type: 'status', payload: { status: 'connecting' } });
        },
        onmessage: (message) => {
          void this.handleLiveMessage(message);
        },
        onerror: (event) => {
          const message =
            event.error instanceof Error ? event.error.message : 'Se interrumpió la sesión de voz.';
          sendEnvelope(this.socket, { type: 'error', payload: { message } });
        },
        onclose: () => {
          if (!this.disconnected) {
            sendEnvelope(this.socket, { type: 'status', payload: { status: 'disconnected' } });
            try {
              this.socket.close(1011, 'gemini_live_closed');
            } catch {
              // ignore
            }
          }
        },
      },
    });
  }

  private async handleLiveMessage(message: LiveServerMessage) {
    if (message.setupComplete?.sessionId) {
      sendEnvelope(this.socket, { type: 'status', payload: { status: 'connected' } });
    }

    for (const audioBase64 of extractInlineAudioBase64(message)) {
      sendEnvelope(this.socket, { type: 'audio', payload: { data: audioBase64 } });
    }

    const finishedTranscript = extractFinishedTranscription(message);
    if (finishedTranscript) {
      this.lastFinishedTranscript = finishedTranscript;
      sendEnvelope(this.socket, {
        type: 'search_progress',
        payload: {
          message: `Escuché: "${finishedTranscript}"`,
          sources: [],
        },
      });
    }

    if (message.serverContent?.turnComplete) {
      await this.applyLatestTranscript();
    }
  }

  private async applyLatestTranscript() {
    if (!this.authUser || this.applyingTranscript) return;

    const transcript = this.lastFinishedTranscript?.trim();
    if (!transcript || transcript === this.lastProcessedTranscript) {
      return;
    }

    this.applyingTranscript = true;
    try {
      const currentState = await loadPlannerState(this.authUser);
      const history = (currentState.messages || []).slice(-6).map((message) => ({
        role: (message.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: message.text,
      }));

      const agentResponse = await runAgent({
        userMessage: transcript,
        history,
        tasks: currentState.tasks,
        calendarEvents: currentState.calendarEvents,
        dependencies: currentState.dependencies,
        schedule: currentState.schedule ?? undefined,
        workWindow: currentState.workWindow,
        strategy: currentState.strategy,
      });

      const hasChanges =
        JSON.stringify(currentState.tasks) !== JSON.stringify(agentResponse.tasks) ||
        JSON.stringify(currentState.calendarEvents) !== JSON.stringify(agentResponse.calendarEvents) ||
        JSON.stringify(currentState.dependencies) !== JSON.stringify(agentResponse.dependencies);

      const nextState = hasChanges
        ? await this.saveAgentMutation(currentState, transcript, agentResponse)
        : await appendChatMessage(this.authUser, transcript, agentResponse.text);

      this.lastProcessedTranscript = transcript;
      sendEnvelope(this.socket, { type: 'state', payload: { state: nextState } });
    } catch (error) {
      sendEnvelope(this.socket, {
        type: 'error',
        payload: {
          message:
            error instanceof Error
              ? error.message
              : 'No pude aplicar la instrucción de voz a tu planner.',
        },
      });
    } finally {
      this.applyingTranscript = false;
    }
  }

  private async saveAgentMutation(
    currentState: PlannerState,
    transcript: string,
    agentResponse: Awaited<ReturnType<typeof runAgent>>,
  ) {
    if (!this.authUser) {
      throw new Error('Missing authenticated user for live save.');
    }

    const now = new Date();
    const solved = solveSchedule(
      agentResponse.tasks,
      agentResponse.dependencies,
      agentResponse.calendarEvents,
      currentState.workWindow,
      currentState.strategy,
      now.getHours() * 60 + now.getMinutes(),
      7,
      15,
      currentState.schedule ?? undefined,
      DEFAULT_INTELLIGENT_CONFIG,
      now.getDay(),
    );

    return savePlannerState(this.authUser, {
      ...currentState,
      tasks: agentResponse.tasks,
      calendarEvents: agentResponse.calendarEvents,
      dependencies: agentResponse.dependencies,
      schedule: solved.schedule,
      messages: [
        ...currentState.messages,
        { role: 'user', text: transcript },
        { role: 'model', text: agentResponse.text },
      ],
    });
  }

  close() {
    this.disconnected = true;
    try {
      this.liveSession?.close();
    } catch {
      // ignore
    }
    this.liveSession = null;
  }
}

const parseEnvelope = (raw: WebSocket.RawData): ClientEnvelope => {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  return JSON.parse(text) as ClientEnvelope;
};

const bindSocket = (socket: WebSocket, _request: IncomingMessage) => {
  const bridge = new LiveVoiceBridge(socket);
  sendEnvelope(socket, { type: 'status', payload: { status: 'connecting' } });

  socket.on('message', (raw) => {
    void bridge.handleEnvelope(parseEnvelope(raw)).catch((error) => {
      sendEnvelope(socket, {
        type: 'error',
        payload: {
          message:
            error instanceof Error ? error.message : 'No pude procesar la sesión de voz.',
        },
      });
      try {
        socket.close(1011, 'live_bridge_failure');
      } catch {
        // ignore
      }
    });
  });

  socket.on('close', () => {
    bridge.close();
  });

  socket.on('error', () => {
    bridge.close();
  });
};

export const registerLiveVoiceProxy = (server: HttpServer): void => {
  const websocketServer = new WebSocketServer({ noServer: true });

  websocketServer.on('connection', bindSocket);

  server.on('upgrade', (request, socket, head) => {
    const requestUrl = request.url ? new URL(request.url, 'http://localhost') : null;
    if (requestUrl?.pathname !== '/ws/live') {
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (client) => {
      websocketServer.emit('connection', client, request);
    });
  });
};

export const __private__ = {
  extractFinishedTranscription,
  extractInlineAudioBase64,
};
