import { GoogleGenAI, Type } from '@google/genai';
import { differenceInMinutes, parseISO, startOfDay } from 'date-fns';
import { CalendarEvent, Task, Dependency, WorkWindow, ScheduledTask } from '../src/lib/solver.js';
import type { ChatIntentRoute, ChatMessageType, SearchSource } from '../src/lib/plannerState.js';
import { classifyIntentRoute } from './intentRouter.js';
import { mergeCalendarEvents, mergeDependencies, mergeTasks } from './scheduleMutationPolicy.js';
import type { ChatAttachmentContext } from '../src/lib/chatAttachments.js';
import { buildSourcesContext, searchExternalInfo } from './webSearchService.js';

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

type GooglePart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type IntentClassificationDraft = {
  intentRoute: ChatIntentRoute;
  confidence: 'high' | 'medium' | 'low';
  rationale?: string;
};

type ProviderName = 'google' | 'openrouter' | 'tavily';

type ChatResponse = {
  text: string;
  voiceText?: string;
  newTasks?: Task[];
  newCalendarEvents?: CalendarEvent[];
  newDependencies?: Dependency[];
  messageType?: ChatMessageType;
  sources?: SearchSource[];
  performedWebSearch?: boolean;
  plannerMutation?: boolean;
  uiHints?: {
    tone: 'warm';
    strategy: string;
  };
  usage: {
    provider: ProviderName;
    model: string;
    inputTokens: number;
    outputTokens: number;
  };
};

type ChatProgressCallbacks = {
  onRoutingStart?: (payload: { message: string }) => void;
  onThinkingStart?: (payload: { message: string; sources?: SearchSource[] }) => void;
  onSearchingStart?: (payload: { message: string }) => void;
  onSearchingResults?: (payload: { message: string; sources: SearchSource[] }) => void;
  onPlanningStart?: (payload: { message: string }) => void;
  onSavingStart?: (payload: { message: string }) => void;
};

type DocumentRetrievalContextPayload = {
  hits: Array<{
    documentId: string;
    documentName: string;
    pageLabel?: string | null;
    chunkIndex: number;
    text: string;
    score: number;
  }>;
  sources: SearchSource[];
  contextText: string;
};

type ModelConfig = {
  primaryProvider: string;
  primaryModel: string;
  fallbackProvider?: string;
  fallbackModel?: string;
  modelTier?: 'fast' | 'heavy';
};

type ExternalAnswerStatus = 'confirmed' | 'unconfirmed' | 'contradictory' | 'no_evidence';
type ExternalAnswerMode = 'direct_answer' | 'critical_context' | 'ambiguous' | 'no_evidence';
type ExternalAnswerConfidence = 'high' | 'medium' | 'low';
type ExternalUserIntent =
  | 'discover_options'
  | 'check_availability'
  | 'deadline_or_requirement'
  | 'decision_support'
  | 'plain_fact_lookup';

type ExternalIntent = 'external_lookup' | 'hybrid';

type ExternalAnswerDraft = {
  status: ExternalAnswerStatus;
  mode: ExternalAnswerMode;
  keyFact: string;
  directAnswer: string | null;
  criticalContext: string | null;
  alternativeSuggestion: string | null;
  geographyFollowup: string | null;
  confidence: ExternalAnswerConfidence;
};

type AssistantResponseKind = 'planner_read' | 'planner_mutation' | 'external_info' | 'hybrid' | 'conversation';
type AssistantAnswerStatus =
  | 'confirmed'
  | 'unconfirmed'
  | 'contradictory'
  | 'no_evidence'
  | 'action_applied'
  | 'action_rejected';
type AssistantEditorialStrategy =
  | 'inform_with_context'
  | 'inform_with_alternative'
  | 'clarify_ambiguity'
  | 'report_no_evidence'
  | 'confirm_action'
  | 'reject_action_with_reason';
type AssistantUserNeed =
  | 'understand_schedule'
  | 'find_options'
  | 'check_availability'
  | 'meet_deadline'
  | 'make_decision'
  | 'modify_plan'
  | 'general_fact';

type AssistantResponseDraft = {
  responseKind: AssistantResponseKind;
  answerStatus: AssistantAnswerStatus;
  userNeed: AssistantUserNeed;
  editorialStrategy: AssistantEditorialStrategy;
  directAnswer: string;
  criticalContext?: string | null;
  importantDetails: string[];
  nextBestHelp?: string | null;
  followupQuestion?: string | null;
  shouldMentionSources: boolean;
  plannerMutation: boolean;
};

type AssistantEditorialOutput = {
  finalText: string;
  voiceText: string;
  uiHints: {
    tone: 'warm';
    strategy: AssistantEditorialStrategy;
  };
};

type OpenRouterToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenRouterToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

type OpenRouterStructuredPayload = {
  assistantMessage: string;
  tasks: any[];
  dependencies: Dependency[];
  calendarEvents: any[];
  removedTaskIds?: string[];
  removedCalendarEventIds?: string[];
};

type OpenRouterContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';

const normalizeLooseText = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bq\b/g, 'que')
    .replace(/\bxq\b/g, 'por que')
    .replace(/\s+/g, ' ')
    .trim();

const READ_ONLY_PLANNER_PATTERNS = [
  /\bque\s+tengo\s+(hoy|manana|mañana)\b/i,
  /\bque\s+hay\s+(hoy|manana|mañana)\b/i,
  /\bque\s+sigue\b/i,
  /\bcomo\s+va\s+mi\s+agenda\b/i,
  /\bmu(e|é)strame?\s+mi\s+agenda\b/i,
  /\brevisa\s+mi\s+agenda\b/i,
  /\bresume\s+mi\s+dia\b/i,
  /\bresume\s+mi\s+agenda\b/i,
  /\bque\s+tengo\s+para\s+hoy\b/i,
  /\bque\s+tengo\s+esta\s+semana\b/i,
  /\bque\s+tareas?\s+tengo\s+esta\s+semana\b/i,
  /\bque\s+tareas?\s+tengo\b/i,
  /\bque\s+hay\s+esta\s+semana\b/i,
  /\bresume\s+mi\s+semana\b/i,
  /\bagenda\s+de\s+esta\s+semana\b/i,
];

const isReadOnlyPlannerQuestion = (message: string): boolean =>
  classifyIntentRoute(message) === 'planner_read';

const EXPLICIT_REMOVAL_PATTERNS = [
  /\b(quita|quitame|quita\s+lo|elimina|eliminar|borra|borrar|remueve|remover)\b/i,
  /\b(saca|sacame|saca\s+lo)\b/i,
];

const isExplicitRemovalRequest = (message: string): boolean => {
  const normalized = normalizeLooseText(message);
  return EXPLICIT_REMOVAL_PATTERNS.some((pattern) => pattern.test(normalized));
};

const formatClock = (minute: number): string => {
  const totalMinutes = ((minute % 1440) + 1440) % 1440;
  const hours24 = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, '0')} ${meridiem}`;
};

const formatRelativeDateLabel = (clientDayStart: Date, dayOffset: number): string => {
  const targetDate = new Date(clientDayStart);
  targetDate.setDate(targetDate.getDate() + dayOffset);

  const weekday = targetDate.toLocaleDateString('es-CO', { weekday: 'long' });
  const day = targetDate.getDate();
  const month = targetDate.toLocaleDateString('es-CO', { month: 'long' });

  if (dayOffset === 0) return `Hoy (${weekday} ${day} de ${month})`;
  if (dayOffset === 1) return `Mañana (${weekday} ${day} de ${month})`;
  return `${weekday} ${day} de ${month}`;
};

const summarizeScheduleForRelativeDay = (
  userMessage: string,
  currentSchedule: ScheduledTask[] | undefined,
  scheduleBaseDateIso?: string,
  clientDayStartIso?: string,
): string | null => {
  const normalized = normalizeLooseText(userMessage);
  const scheduleEntries = (currentSchedule ?? []).slice().sort((a, b) => a.start - b.start);
  const baseDate = scheduleBaseDateIso ? parseISO(scheduleBaseDateIso) : new Date();
  const clientDayStart = clientDayStartIso ? parseISO(clientDayStartIso) : startOfDay(new Date());

  const relativeEntries = scheduleEntries.map((item) => {
    const entryInstant = new Date(baseDate.getTime() + item.start * 60_000);
    const dayOffset = Math.floor((entryInstant.getTime() - clientDayStart.getTime()) / 86_400_000);
    return {
      ...item,
      relativeDayOffset: dayOffset,
    };
  });

  if (relativeEntries.length === 0) {
    if (/\besta\s+semana\b/i.test(normalized)) return 'Esta semana no tienes nada programado en tu agenda.';
    if (/\b(manana|mañana)\b/i.test(normalized)) {
      return `${formatRelativeDateLabel(clientDayStart, 1)} no tienes nada programado en tu agenda.`;
    }
    if (/\b(hoy|que sigue)\b/i.test(normalized)) {
      return `${formatRelativeDateLabel(clientDayStart, 0)} no tienes nada programado en tu agenda.`;
    }
    return null;
  }

  if (/\besta\s+semana\b/i.test(normalized)) {
    const bullets = relativeEntries
      .filter((item) => item.relativeDayOffset >= 0 && item.relativeDayOffset <= 6)
      .map((item) => {
        const dayOffset = item.relativeDayOffset;
        const dayLabel =
          dayOffset === 0
            ? formatRelativeDateLabel(clientDayStart, 0)
            : dayOffset === 1
              ? formatRelativeDateLabel(clientDayStart, 1)
              : `El ${formatRelativeDateLabel(clientDayStart, dayOffset)}`;
        return `- **${item.name}** (${dayLabel}) de ${formatClock(item.start)} a ${formatClock(item.end)}.`;
      })
      .join('\n');
    if (!bullets) return 'Esta semana no tienes nada programado en tu agenda.';
    return `Esta semana tienes programado:\n${bullets}`;
  }

  let targetDay = 0;
  if (/\b(manana|mañana)\b/i.test(normalized)) targetDay = 1;
  if (!/\b(hoy|manana|mañana)\b/i.test(normalized) && !/\bque sigue\b/i.test(normalized)) {
    return null;
  }

  const entries = relativeEntries.filter((item) => item.relativeDayOffset === targetDay);

  if (entries.length === 0) {
    return targetDay === 0
      ? `${formatRelativeDateLabel(clientDayStart, 0)} no tienes nada programado en tu agenda.`
      : `${formatRelativeDateLabel(clientDayStart, 1)} no tienes nada programado en tu agenda.`;
  }

  const lead =
    targetDay === 0
      ? `${formatRelativeDateLabel(clientDayStart, 0)} tienes programado:`
      : `${formatRelativeDateLabel(clientDayStart, 1)} tienes programado:`;
  const bullets = entries
    .map((item) => `- **${item.name}** de ${formatClock(item.start)} a ${formatClock(item.end)}.`)
    .join('\n');

  return `${lead}\n${bullets}`;
};

export const __plannerReadModel = {
  normalizeLooseText,
  isReadOnlyPlannerQuestion,
  summarizeScheduleForRelativeDay,
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

const buildLocalIso = (date: Date, hours: number, minutes: number): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(hours)}:${pad2(minutes)}:00`;

const resolveRelativeDate = (rawValue: unknown, now: Date): Date | null => {
  if (typeof rawValue !== 'string' || !rawValue.trim()) return null;
  const value = rawValue.trim().toLowerCase();
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);

  if (value === 'today' || value === 'hoy') return base;
  if (value === 'tomorrow' || value === 'mañana' || value === 'manana') {
    const tomorrow = new Date(base);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }

  const isoDateMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    return new Date(`${isoDateMatch[1]}-${isoDateMatch[2]}-${isoDateMatch[3]}T00:00:00`);
  }

  return null;
};

const parseClockTime = (rawValue: unknown): { hours: number; minutes: number } | null => {
  if (typeof rawValue !== 'string' || !rawValue.trim()) return null;
  const value = rawValue.trim().toLowerCase().replace(/\./g, '');
  const match = value.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m)?$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');
  const meridiem = (match[3] ?? '').replace(/\s+/g, '');

  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes < 0 || minutes > 59) {
    return null;
  }

  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (hours < 0 || hours > 23) return null;

  return { hours, minutes };
};

const coercePriority = (rawValue: unknown): Task['priority'] | undefined => {
  if (typeof rawValue !== 'string') return undefined;
  const value = rawValue.trim().toLowerCase();
  if (value === 'asap') return 'ASAP';
  if (value === 'high' || value === 'alta' || value === 'alto') return 'high';
  if (value === 'medium' || value === 'media' || value === 'medio') return 'medium';
  if (value === 'low' || value === 'baja' || value === 'bajo') return 'low';
  return undefined;
};

const normalizeOpenRouterEvent = (event: any, now: Date) => {
  const title =
    event?.title ||
    event?.eventTitle ||
    event?.name ||
    event?.taskName ||
    'Evento';
  const eventDate = resolveRelativeDate(event?.date || event?.day, now);
  const startTime = parseClockTime(event?.startDateTime || event?.startTime);
  const endTime = parseClockTime(event?.endDateTime || event?.endTime);

  const normalizedEvent: any = {
    id:
      event?.id ||
      `${slugify(String(title))}-${eventDate ? buildLocalIso(eventDate, startTime?.hours ?? 0, startTime?.minutes ?? 0) : 'event'}`,
    title,
    kind: event?.kind ?? 'personal',
  };

  if (typeof event?.startDateTime === 'string') {
    normalizedEvent.startDateTime = event.startDateTime;
  } else if (eventDate && startTime) {
    normalizedEvent.startDateTime = buildLocalIso(eventDate, startTime.hours, startTime.minutes);
  }

  if (typeof event?.endDateTime === 'string') {
    normalizedEvent.endDateTime = event.endDateTime;
  } else if (eventDate && endTime) {
    normalizedEvent.endDateTime = buildLocalIso(eventDate, endTime.hours, endTime.minutes);
  }

  return normalizedEvent;
};

const normalizeOpenRouterTask = (task: any, normalizedEvents: any[], now: Date) => {
  const name = task?.name || task?.taskName || task?.title || 'Tarea';
  const matchingEvent = normalizedEvents.find(
    (event) =>
      typeof event?.title === 'string' &&
      event.title.trim().toLowerCase() === String(name).trim().toLowerCase(),
  );

  const normalizedTask: any = {
    id: task?.id || `${slugify(String(name))}-task`,
    name,
    priority: coercePriority(task?.priority),
    elastic: typeof task?.elastic === 'boolean' ? task.elastic : undefined,
    minChunkSize: typeof task?.minChunkSize === 'number' ? task.minChunkSize : undefined,
    progress: typeof task?.progress === 'number' ? task.progress : undefined,
    deadlineType: task?.deadlineType,
  };

  if (typeof task?.fixedStartDateTime === 'string') {
    normalizedTask.fixedStartDateTime = task.fixedStartDateTime;
  } else if (matchingEvent?.startDateTime) {
    normalizedTask.fixedStartDateTime = matchingEvent.startDateTime;
  } else {
    const relativeDate = resolveRelativeDate(task?.date || task?.dueDate, now);
    const clockTime = parseClockTime(task?.time || task?.dueTime);
    if (relativeDate && clockTime) {
      normalizedTask.fixedStartDateTime = buildLocalIso(relativeDate, clockTime.hours, clockTime.minutes);
    }
  }

  if (typeof task?.minStartDateTime === 'string') {
    normalizedTask.minStartDateTime = task.minStartDateTime;
  }

  if (typeof task?.deadlineDateTime === 'string') {
    normalizedTask.deadlineDateTime = task.deadlineDateTime;
  } else {
    const relativeDate = resolveRelativeDate(task?.dueDate, now);
    const clockTime = parseClockTime(task?.dueTime);
    if (relativeDate && clockTime && !normalizedTask.fixedStartDateTime) {
      normalizedTask.deadlineDateTime = buildLocalIso(relativeDate, clockTime.hours, clockTime.minutes);
    }
  }

  if (typeof task?.duration === 'number' && task.duration > 0) {
    normalizedTask.duration = task.duration;
  } else if (
    matchingEvent?.startDateTime &&
    matchingEvent?.endDateTime
  ) {
    normalizedTask.duration = differenceInMinutes(
      parseISO(matchingEvent.endDateTime),
      parseISO(matchingEvent.startDateTime),
    );
  } else if (typeof task?.estimatedMinutes === 'number' && task.estimatedMinutes > 0) {
    normalizedTask.duration = task.estimatedMinutes;
  } else {
    normalizedTask.duration = 60;
  }

  return normalizedTask;
};

const normalizeOpenRouterPayload = (payload: OpenRouterStructuredPayload, now: Date): OpenRouterStructuredPayload => {
  const normalizedEvents = (payload.calendarEvents || []).map((event) => normalizeOpenRouterEvent(event, now));
  const normalizedTasks = (payload.tasks || []).map((task) =>
    normalizeOpenRouterTask(task, normalizedEvents, now),
  );

  return {
    assistantMessage: payload.assistantMessage,
    tasks: normalizedTasks,
    dependencies: payload.dependencies || [],
    calendarEvents: normalizedEvents,
  };
};

const omitUndefined = <T extends Record<string, unknown>>(value: T): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([, candidate]) => candidate !== undefined && candidate !== null));

const serializePromptTasks = (tasks: Task[]) =>
  tasks.map((task) =>
    omitUndefined({
      id: task.id,
      name: task.name,
      duration: task.duration,
      fixedStart: task.fixedStart,
      minStart: task.minStart,
      deadline: task.deadline,
      priority: task.priority,
      elastic: task.elastic,
      minChunkSize: task.minChunkSize,
      progress: task.progress,
      deadlineType: task.deadlineType,
    }),
  );

const serializePromptEvents = (calendarEvents: CalendarEvent[]) =>
  calendarEvents.map((event) =>
    omitUndefined({
      id: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      kind: event.kind,
    }),
  );

const serializePromptDependencies = (dependencies: Dependency[]) =>
  dependencies.map((dependency) => `${dependency.fromId}->${dependency.toId}`);

const serializePromptSchedule = (schedule: ScheduledTask[] | undefined) =>
  (schedule ?? []).map((entry) =>
    omitUndefined({
      id: entry.id,
      name: entry.name,
      start: entry.start,
      end: entry.end,
    }),
  );

const buildSystemInstruction = (
  currentTasks: Task[],
  currentCalendarEvents: CalendarEvent[],
  currentDependencies: Dependency[],
  workWindow: WorkWindow,
  strategy: 'balanced' | 'survival' | 'intelligent',
  currentSchedule: ScheduledTask[] | undefined,
): string => {
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
  const todayStr = now.toISOString().split('T')[0];
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  return `You are an AI scheduling assistant connected to a deterministic constraint solver engine.
Your job is to understand the user's scheduling needs, update the tasks and dependencies, and explain the results.
The user will provide tasks, durations, time windows, and dependencies.
You MUST use the 'updateSchedule' tool to reflect any changes to the schedule.

CRITICAL CONTEXT:
- Today's date is: ${currentDateStr}
- The current time is: ${currentTimeStr}
- User's Work Window: ${workWindow.startHour}:00 to ${workWindow.endHour}:00.
- Strategy in use: ${
    strategy === 'survival'
      ? 'SuperAgencia Survival (Strict Priority Queue)'
      : strategy === 'intelligent'
        ? 'Protección Inteligente (Critical Shield + Weighted Packing)'
        : 'Balanced COP (Global Optimization)'
  }

TIME REPRESENTATION:
- The engine requires exact dates and times in local ISO 8601 format (e.g., "YYYY-MM-DDTHH:mm:00").
- Use the fields 'fixedStartDateTime', 'minStartDateTime', and 'deadlineDateTime'.
- EXAMPLES:
  * Today 9:00 AM = "${todayStr}T09:00:00"
  * Today 2:30 PM = "${todayStr}T14:30:00"
  * Tomorrow 9:00 AM = "${tomorrowStr}T09:00:00"
  * Tomorrow 5:00 PM = "${tomorrowStr}T17:00:00"
- GOLDEN RULE: NEVER mention the ISO format or explain this internal logic to the user. ALWAYS communicate using natural time formats (e.g., "3:00 PM").

PRIORITY & SURVIVAL STRATEGY:
- If the user asks to prioritize based on survival, deadlines, or ASAP, you can set 'priority' to 'ASAP', 'deadlineType' to 'Hard Deadline', and 'progress' to the current completion percentage.

Current Tasks: ${JSON.stringify(serializePromptTasks(currentTasks))}
Current Calendar Events: ${JSON.stringify(serializePromptEvents(currentCalendarEvents))}
Current Dependencies: ${JSON.stringify(serializePromptDependencies(currentDependencies))}
Current Schedule Blocks: ${JSON.stringify(serializePromptSchedule(currentSchedule))}

When the user adds, modifies, or removes a task, call 'updateSchedule' with the FULL updated list of tasks and dependencies.
If the user explicitly asks to remove or delete a task/event, include its id in 'removedTaskIds' or 'removedCalendarEventIds'.
Always respond in Spanish as requested by the user. Be concise and helpful. Explain if a constraint might be too tight.`;
};

const parseModelMutations = (
  userMessage: string,
  rawTasks: any[],
  rawEvents: any[],
  proposedDependencies: Dependency[],
  removedTaskIds: string[] = [],
  removedCalendarEventIds: string[] = [],
  currentTasks: Task[],
  currentCalendarEvents: CalendarEvent[],
  currentDependencies: Dependency[],
  now: Date,
) => {
  const baseDate = startOfDay(now);

  const parsedTasks = rawTasks.map((task) => {
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
    } satisfies Task;
  });

  const explicitRemovedTaskIds = removedTaskIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  const inferredRemovedTaskIds =
    explicitRemovedTaskIds.length === 0 &&
    isExplicitRemovalRequest(userMessage) &&
    parsedTasks.length < currentTasks.length
      ? currentTasks
          .filter((task) => !parsedTasks.some((candidate) => candidate.id === task.id))
          .map((task) => task.id)
          .filter(Boolean)
      : [];

  const finalRemovedTaskIds = [...new Set([...explicitRemovedTaskIds, ...inferredRemovedTaskIds])];

  const newTasks = mergeTasks(currentTasks, parsedTasks, finalRemovedTaskIds);
  const newCalendarEvents = mergeCalendarEvents(
    currentCalendarEvents,
    rawEvents.map((event) => ({
      id: event.id,
      title: event.title,
      start: differenceInMinutes(parseISO(event.startDateTime), baseDate),
      end: differenceInMinutes(parseISO(event.endDateTime), baseDate),
      kind: event.kind,
    })) as CalendarEvent[],
    removedCalendarEventIds,
  );
  const newDependencies = mergeDependencies(currentDependencies, proposedDependencies, newTasks);

  return {
    newTasks,
    newCalendarEvents,
    newDependencies,
  };
};

const buildAttachmentTextContext = (attachments: ChatAttachmentContext[]): string => {
  if (attachments.length === 0) return '';

  const blocks = attachments
    .filter((attachment) => attachment.extractedText)
    .map(
      (attachment) =>
        `[ARCHIVO ADJUNTO: ${attachment.name} | tipo=${attachment.mimeType}]\n${attachment.extractedText}`,
    );

  const imageNames = attachments.filter((attachment) => attachment.kind === 'image').map((attachment) => attachment.name);
  const pdfNames = attachments.filter((attachment) => attachment.kind === 'pdf').map((attachment) => attachment.name);

  const notes: string[] = [];
  if (imageNames.length > 0) {
    notes.push(`Imágenes adjuntas disponibles para análisis visual: ${imageNames.join(', ')}.`);
  }
  if (pdfNames.length > 0) {
    notes.push(`PDF adjuntos disponibles: ${pdfNames.join(', ')}.`);
  }

  const sections = [...notes, ...blocks];
  if (sections.length === 0) return '';

  return `\n\nCONTEXTO DE ARCHIVOS ADJUNTOS:\n${sections.join('\n\n')}`;
};

const buildGoogleAttachmentParts = (attachments: ChatAttachmentContext[]): GooglePart[] =>
  attachments
    .filter((attachment) => attachment.kind === 'image' || attachment.kind === 'pdf')
    .map((attachment) => ({
      inlineData: {
        mimeType: attachment.mimeType,
        data: attachment.base64Data,
      },
    }));

const buildOpenRouterAttachmentParts = (attachments: ChatAttachmentContext[]): OpenRouterContentPart[] =>
  attachments.reduce<OpenRouterContentPart[]>((parts, attachment) => {
    if (attachment.kind === 'image') {
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${attachment.mimeType};base64,${attachment.base64Data}`,
        },
      });
      return parts;
    }

    if (attachment.kind === 'pdf') {
      parts.push({
        type: 'file',
        file: {
          filename: attachment.name,
          file_data: `data:${attachment.mimeType};base64,${attachment.base64Data}`,
        },
      });
      return parts;
    }

    return parts;
  }, []);

const extractJsonObject = (content: string): OpenRouterStructuredPayload => {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  return JSON.parse(candidate) as OpenRouterStructuredPayload;
};

const callGoogleTextModel = async (
  model: string,
  prompt: string,
): Promise<{ text: string; usage: ChatResponse['usage'] }> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is missing.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature: 0.2,
    },
  });

  const usageMetadata = (response as any).usageMetadata ?? {};
  return {
    text: response.text || '',
    usage: {
      provider: 'google',
      model,
      inputTokens: usageMetadata.promptTokenCount ?? 0,
      outputTokens: usageMetadata.candidatesTokenCount ?? 0,
    },
  };
};

const callOpenRouterTextModel = async (
  model: string,
  prompt: string,
): Promise<{ text: string; usage: ChatResponse['usage'] }> => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is missing.');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.PUBLIC_APP_URL || 'https://web-production-0c202.up.railway.app',
      'X-OpenRouter-Title': 'Tandeba',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  });

  const payload = (await response.json()) as OpenRouterResponse & { error?: { message?: string; code?: number | string } };
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenRouter request failed with status ${response.status}`);
  }

  return {
    text: payload.choices?.[0]?.message?.content?.trim() || '',
    usage: {
      provider: 'openrouter',
      model,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
    },
  };
};

const callPlainTextModel = async (
  provider: string,
  model: string,
  prompt: string,
): Promise<{ text: string; usage: ChatResponse['usage'] }> => {
  if (provider === 'google') {
    return callGoogleTextModel(model, prompt);
  }

  if (provider === 'openrouter') {
    return callOpenRouterTextModel(model, prompt);
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
};

const normalizeSentence = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
};

const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);

const extractJsonSlice = (value: string): string | null => {
  const fenced = value.match(/```json\s*([\s\S]*?)```/i)?.[1] ?? value.match(/```\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? value;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
};

const buildIntentClassificationPrompt = (
  userMessage: string,
  history: { role: 'user' | 'model'; text: string }[],
): string => {
  const recentHistory = history
    .slice(-6)
    .map((message) => `${message.role === 'model' ? 'asistente' : 'usuario'}: ${message.text}`)
    .join('\n');

  return [
    'Clasifica la intencion del ultimo mensaje del usuario para Tandeba.',
    'Devuelve solo JSON valido.',
    'Rutas permitidas: conversation, planner_read, planner_mutation, external_lookup, hybrid.',
    'Usa planner_mutation cuando el usuario quiere crear, mover, editar, eliminar o reprogramar algo en su agenda, aunque no use palabras exactas del sistema.',
    'Usa planner_read cuando solo quiere consultar, resumir o entender su agenda actual sin cambiarla.',
    'Usa external_lookup cuando la solicitud depende de informacion del mundo externo y no cambia la agenda.',
    'Usa hybrid cuando necesita informacion externa y ademas aplicar ese resultado a la agenda.',
    'Usa conversation para saludos, small talk, explicaciones del producto o mensajes que no implican agenda ni busqueda externa.',
    'Prioriza la intencion real del usuario, no coincidencias literales.',
    'Si el mensaje pide programar algo para una fecha u hora, eso es planner_mutation.',
    '',
    'Devuelve exactamente este JSON:',
    '{"intentRoute":"conversation|planner_read|planner_mutation|external_lookup|hybrid","confidence":"high|medium|low","rationale":"frase breve"}',
    '',
    `Historial reciente:\n${recentHistory || 'sin historial relevante'}`,
    '',
    `Ultimo mensaje del usuario:\n${userMessage}`,
  ].join('\n');
};

const parseIntentClassificationDraft = (raw: string): IntentClassificationDraft => {
  const extracted = extractJsonSlice(raw);
  if (!extracted) {
    throw new Error('Intent classifier returned no JSON object.');
  }

  const parsed = JSON.parse(extracted) as Partial<IntentClassificationDraft>;
  const intentRoute =
    parsed.intentRoute === 'conversation' ||
    parsed.intentRoute === 'planner_read' ||
    parsed.intentRoute === 'planner_mutation' ||
    parsed.intentRoute === 'external_lookup' ||
    parsed.intentRoute === 'hybrid'
      ? parsed.intentRoute
      : null;

  if (!intentRoute) {
    throw new Error('Intent classifier returned an invalid route.');
  }

  return {
    intentRoute,
    confidence:
      parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
        ? parsed.confidence
        : 'medium',
    rationale: parsed.rationale?.trim(),
  };
};

export const classifyIntentRouteWithModel = async (
  userMessage: string,
  history: { role: 'user' | 'model'; text: string }[],
): Promise<ChatIntentRoute> => {
  const response = await callOpenRouterTextModel(
    'google/gemma-3-12b-it',
    buildIntentClassificationPrompt(userMessage, history),
  );
  const parsed = parseIntentClassificationDraft(response.text);
  return parsed.intentRoute;
};

const parseExternalAnswerDraft = (
  raw: string,
  userMessage: string,
  geographyIsAmbiguous: boolean,
): ExternalAnswerDraft => {
  const extracted = extractJsonSlice(raw);
  if (!extracted) {
    throw new Error('External answer resolver returned no JSON object.');
  }

  const parsed = JSON.parse(extracted) as Partial<ExternalAnswerDraft>;
  return {
    status:
      parsed.status === 'confirmed' ||
      parsed.status === 'unconfirmed' ||
      parsed.status === 'contradictory' ||
      parsed.status === 'no_evidence'
        ? parsed.status
        : 'unconfirmed',
    mode:
      parsed.mode === 'direct_answer' ||
      parsed.mode === 'critical_context' ||
      parsed.mode === 'ambiguous' ||
      parsed.mode === 'no_evidence'
        ? parsed.mode
        : 'direct_answer',
    keyFact: parsed.keyFact?.trim() || `No encontre una respuesta plenamente confirmada para "${userMessage}."`,
    directAnswer: normalizeSentence(parsed.directAnswer),
    criticalContext: normalizeSentence(parsed.criticalContext),
    alternativeSuggestion: normalizeSentence(parsed.alternativeSuggestion),
    geographyFollowup:
      normalizeSentence(parsed.geographyFollowup) ??
      (geographyIsAmbiguous
        ? 'Si me dices la ciudad o el pais exactos, puedo afinar mejor la respuesta.'
        : null),
    confidence:
      parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
        ? parsed.confidence
        : 'medium',
  };
};

const buildExternalResolutionPrompt = (
  userMessage: string,
  sources: SearchSource[],
  geographyIsAmbiguous: boolean,
): string => {
  const todayIso = new Date().toISOString().slice(0, 10);

  return `${buildSourcesContext(sources, geographyIsAmbiguous)}

INSTRUCCIONES:
- Hoy es ${todayIso}.
- Resuelve la consulta en dos capas: primero decide que hecho domina la respuesta; luego devuelve un JSON breve.
- No redactes una respuesta final al usuario. No escribas prosa conversacional. Devuelve solo JSON valido.
- Trata cualquier fecha detectada como pasado, hoy o futuro respecto a ${todayIso}.
- Si la consulta pregunta por lo proximo, siguiente, vigente o por una fecha futura, una fecha anterior a ${todayIso} no puede describirse como proxima.
- Si las fuentes solo muestran una fecha pasada para el evento consultado, debes decir explicitamente que esa fecha ya paso.
- Si el usuario menciona un ano que ya quedo atras para ese evento, no lo presentes como futuro solo por coincidir con el texto de la consulta.
- Ignora detalles secundarios que rebajen claridad.
- Si hay un contexto decisivo que cambia por completo la respuesta, usalo como criticalContext.
- Si una fuente habla de eventos pasados pero el hecho dominante invalida esperar eventos futuros, no dejes que esos eventos pasados dominen la respuesta.
- Si no hay evidencia suficiente para afirmar el proximo evento, usa status="unconfirmed" o status="no_evidence".
- Si las fuentes se contradicen de forma importante, usa status="contradictory" y mode="ambiguous".
- Si la consulta depende del lugar y falta esa precision, geographyFollowup debe pedirla de forma breve.
- alternativeSuggestion debe ser util y concreta, no generica.
- directAnswer debe ser la mejor respuesta directa y segura.
- keyFact debe capturar el hallazgo dominante en una frase.
- Evita formulas frias o burocraticas como "segun la informacion disponible".
- Si hay un dato humano decisivo, directAnswer debe abrir por ahi.
- No mezcles hechos secundarios que resten claridad.

DEVUELVE SOLO ESTE JSON:
{
  "status": "confirmed | unconfirmed | contradictory | no_evidence",
  "mode": "direct_answer | critical_context | ambiguous | no_evidence",
  "keyFact": "hecho principal en una frase",
  "directAnswer": "respuesta directa principal o null",
  "criticalContext": "contexto decisivo si existe o null",
  "alternativeSuggestion": "alternativa util y pertinente o null",
  "geographyFollowup": "aclaracion geografica breve o null",
  "confidence": "high | medium | low"
}

CONSULTA:
${userMessage}`;
};

const inferExternalUserIntent = (userMessage: string): ExternalUserIntent => {
  const normalized = normalizeLooseText(userMessage);

  if (/\b(mejor|conviene|compar|diferencia|vs\b|versus|elegir|recomiendas?)\b/i.test(normalized)) {
    return 'decision_support';
  }

  if (
    /\b(vence|vencimiento|plazo|fecha limite|hasta cuando|requisit|debo|tengo que|como hago|declaracion|impuestos?|dian|tributari)\b/i.test(
      normalized,
    )
  ) {
    return 'deadline_or_requirement';
  }

  if (
    /\b(busco|quiero ir|quiero ver|quiero encontrar|opciones|alternativas|cercan[oa]|parecid[oa]|disponibles?)\b/i.test(
      normalized,
    )
  ) {
    return 'discover_options';
  }

  if (/\b(hay|existe|disponible|confirmad[oa]|proxim[oa]|cercan[oa])\b/i.test(normalized)) {
    return 'check_availability';
  }

  return 'plain_fact_lookup';
};

const inferAssistantUserNeed = (
  userMessage: string,
  responseKind: AssistantResponseKind,
): AssistantUserNeed => {
  if (responseKind === 'planner_read') return 'understand_schedule';
  if (responseKind === 'planner_mutation') return 'modify_plan';
  if (responseKind === 'conversation') return 'general_fact';

  const externalIntent = inferExternalUserIntent(userMessage);
  switch (externalIntent) {
    case 'discover_options':
      return 'find_options';
    case 'check_availability':
      return 'check_availability';
    case 'deadline_or_requirement':
      return 'meet_deadline';
    case 'decision_support':
      return 'make_decision';
    default:
      return 'general_fact';
  }
};

const inferEditorialStrategy = (
  responseKind: AssistantResponseKind,
  answerStatus: AssistantAnswerStatus,
  criticalContext?: string | null,
  nextBestHelp?: string | null,
): AssistantEditorialStrategy => {
  if (responseKind === 'planner_mutation') {
    return answerStatus === 'action_rejected' ? 'reject_action_with_reason' : 'confirm_action';
  }
  if (responseKind === 'conversation') return 'inform_with_context';
  if (answerStatus === 'contradictory') return 'clarify_ambiguity';
  if (answerStatus === 'no_evidence') return 'report_no_evidence';
  if (criticalContext) return 'inform_with_context';
  if (nextBestHelp) return 'inform_with_alternative';
  return 'inform_with_context';
};

const buildAssistantDraftFromConversation = (userMessage: string): AssistantResponseDraft => {
  const normalized = userMessage
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  let directAnswer = 'Aqui estoy. Dime que necesitas y lo resolvemos paso a paso.';
  let nextBestHelp: string | null =
    'Puedo ayudarte a organizar tu agenda, mover tareas, crear recordatorios o responder dudas concretas sobre lo que ya tienes planeado.';

  if (/^(hola+|holi+|buenas+|buenos dias|buenas tardes|buenas noches)$/.test(normalized)) {
    directAnswer = 'Hola. Estoy listo para ayudarte con tu agenda y tus siguientes pasos.';
  } else if (/^(gracias|muchas gracias|ok gracias|vale gracias)$/.test(normalized)) {
    directAnswer = 'De nada. Si quieres, seguimos con lo siguiente.';
    nextBestHelp = null;
  } else if (/^(como estas|como vas|que tal|todo bien)$/.test(normalized)) {
    directAnswer = 'Bien. Estoy listo para ayudarte con lo que siga.';
  } else if (/^(quien eres|que eres)$/.test(normalized)) {
    directAnswer =
      'Soy Tandeba. Te ayudo a organizar agenda, tareas, recordatorios y cambios de plan sin perder el contexto.';
  } else if (/^(que puedes hacer|en que me puedes ayudar)$/.test(normalized)) {
    directAnswer =
      'Puedo ordenar tu agenda, crear o mover tareas, ayudarte a revisar lo que tienes programado y responder consultas sobre tus documentos seleccionados.';
  }

  return {
    responseKind: 'conversation',
    answerStatus: 'confirmed',
    userNeed: inferAssistantUserNeed(userMessage, 'conversation'),
    editorialStrategy: inferEditorialStrategy('conversation', 'confirmed', null, nextBestHelp),
    directAnswer,
    criticalContext: null,
    importantDetails: [],
    nextBestHelp,
    followupQuestion: null,
    shouldMentionSources: false,
    plannerMutation: false,
  };
};

const buildAssistantDraftFromExternal = (
  userMessage: string,
  responseKind: Extract<AssistantResponseKind, 'external_info' | 'hybrid'>,
  draft: ExternalAnswerDraft,
): AssistantResponseDraft => {
  const answerStatus: AssistantAnswerStatus =
    draft.status === 'confirmed'
      ? 'confirmed'
      : draft.status === 'unconfirmed'
        ? 'unconfirmed'
        : draft.status === 'contradictory'
          ? 'contradictory'
          : 'no_evidence';

  const userNeed = inferAssistantUserNeed(userMessage, responseKind);
  const intentDrivenHelp =
    userNeed === 'find_options'
      ? 'Si quieres, doy el siguiente paso y te busco opciones parecidas, alternativas cercanas o una forma mas practica de llegar a algo similar.'
      : userNeed === 'check_availability'
        ? 'Si quieres, tambien puedo mirar si hay una alternativa vigente, una fecha cercana o una opcion parecida que si este activa ahora.'
        : userNeed === 'meet_deadline'
          ? 'Si quieres, te lo convierto en un siguiente paso claro o en un recordatorio para que no se te pase.'
          : userNeed === 'make_decision'
            ? 'Si quieres, lo siguiente es que te diga que opcion parece mas sensata segun lo que priorices.'
            : draft.status === 'no_evidence' || draft.status === 'contradictory'
              ? 'Si quieres, reformulo la busqueda o la contrasto por otro angulo para intentar dejarte una respuesta mas firme.'
              : null;
  const nextBestHelp =
    draft.alternativeSuggestion ?? intentDrivenHelp;

  return {
    responseKind,
    answerStatus,
    userNeed,
    editorialStrategy: inferEditorialStrategy(responseKind, answerStatus, draft.criticalContext, nextBestHelp),
    directAnswer: draft.directAnswer ?? draft.keyFact,
    criticalContext: draft.criticalContext,
    importantDetails: [],
    nextBestHelp,
    followupQuestion: draft.geographyFollowup,
    shouldMentionSources: true,
    plannerMutation: false,
  };
};

const buildAssistantDraftFromPlannerRead = (
  userMessage: string,
  summary: string,
): AssistantResponseDraft => {
  const isEmpty = /no tienes nada programado/i.test(summary);
  const importantDetails = summary
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.replace(/^- /, '').trim());

  return {
    responseKind: 'planner_read',
    answerStatus: isEmpty ? 'no_evidence' : 'confirmed',
    userNeed: inferAssistantUserNeed(userMessage, 'planner_read'),
    editorialStrategy: isEmpty ? 'report_no_evidence' : 'inform_with_context',
    directAnswer: summary.split('\n')[0]?.trim() || summary,
    criticalContext: null,
    importantDetails,
    nextBestHelp: isEmpty ? 'Si quieres, revisamos mañana, esta semana o armamos algo importante para hoy.' : null,
    followupQuestion: null,
    shouldMentionSources: false,
    plannerMutation: false,
  };
};

const buildAssistantDraftFromMutation = (
  userMessage: string,
  rawText: string,
  responseKind: Extract<AssistantResponseKind, 'planner_mutation' | 'hybrid'>,
  plannerMutation: boolean,
  performedWebSearch: boolean,
): AssistantResponseDraft => {
  const answerStatus: AssistantAnswerStatus = plannerMutation ? 'action_applied' : 'action_rejected';
  const nextBestHelp =
    answerStatus === 'action_applied'
      ? performedWebSearch
        ? 'Si quieres, tambien puedo dejar esto convertido en un recordatorio o ajustar la agenda con base en lo que encontré.'
        : 'Si quieres, ajustamos horario, prioridad o duración para dejarlo como te convenga.'
      : 'Si quieres, reformulamos la instrucción o revisamos qué restricción está bloqueando el cambio.';

  return {
    responseKind,
    answerStatus,
    userNeed: inferAssistantUserNeed(userMessage, responseKind),
    editorialStrategy: inferEditorialStrategy(responseKind, answerStatus, null, nextBestHelp),
    directAnswer: rawText,
    criticalContext: null,
    importantDetails: [],
    nextBestHelp,
    followupQuestion: null,
    shouldMentionSources: performedWebSearch,
    plannerMutation,
  };
};

const buildEditorialPrompt = (
  draft: AssistantResponseDraft,
): string => `Eres el editor conversacional de Tandeba. Tu trabajo no es decidir hechos: los hechos ya vienen resueltos en el draft.

VOZ DEL PRODUCTO:
- Hablas como una persona lista, calida y segura, no como un reporte.
- Suenas cercano, con tacto y personalidad, pero sin exagerar ni actuar como influencer.
- Tu prioridad es que el usuario sienta que entendiste lo que realmente buscaba, no solo que le devolviste datos.

OBJETIVO:
- Redacta una respuesta humana, fluida, clara y memorable.
- No inventes datos. No agregues hechos fuera del draft.
- Abre con lo mas importante para la persona, no con una formula burocratica.
- Reconoce la intencion practica del usuario y, cuando tenga sentido, ofrece una salida util.
- Si nextBestHelp aporta valor, integralo de manera natural y con iniciativa.
- Si followupQuestion existe, usala solo si realmente desbloquea la siguiente ayuda.
- No uses citas inline ni lenguaje burocratico.
- finalText puede ser un poco mas rico; voiceText debe ser mas breve, oral y natural.

ANTI-PATRONES A EVITAR:
- "Actualmente, no hay evidencia..."
- "Segun la informacion disponible..."
- "Entiendo tu interes en..."
- "No encontre un evento confirmado..." como primera frase si hay un contexto humano mas importante
- cierres secos tipo "No hay mas informacion"
- respuestas que suenen a reporte, manual o bot de soporte

ESTILO ESPERADO:
- Si el hallazgo es sensible o cambia por completo la respuesta, dilo con tacto desde el comienzo.
- Si la respuesta es negativa, no la cierres en seco: ofrece una alternativa o el siguiente mejor paso.
- Si hay contexto relevante pero secundario, no lo dejes contaminar la idea principal.
- Es mejor sonar como alguien que acompana y orienta, no como alguien que enumera.

EJEMPLO MALO:
Usuario: "proximo concierto de michael jackson"
Respuesta mala: "Actualmente, no hay evidencia de un concierto confirmado de Michael Jackson."

EJEMPLO BUENO:
Usuario: "proximo concierto de michael jackson"
Respuesta buena: "Aqui hay algo clave: Michael Jackson fallecio, asi que no vas a encontrar conciertos nuevos de el. Si lo que quieres es vivir algo parecido, si puedo ayudarte a encontrar tributos o shows inspirados en su musica."

EJEMPLO MALO:
Usuario: "cuando vence la declaracion de renta"
Respuesta mala: "Segun la informacion disponible, la fecha limite depende del calendario tributario."

EJEMPLO BUENO:
Usuario: "cuando vence la declaracion de renta"
Respuesta buena: "Lo importante aqui es la fecha que te toca a ti. Eso depende del calendario oficial y, en algunos casos, del ultimo digito correspondiente. Si quieres, te ayudo a ubicar la fecha exacta y te la dejo lista en claro."

Devuelve solo JSON valido:
{
  "finalText": "respuesta final para chat",
  "voiceText": "version breve para voz"
}

DRAFT:
${JSON.stringify(draft)}`;

const parseEditorialOutput = (
  raw: string,
  draft: AssistantResponseDraft,
): AssistantEditorialOutput => {
  const extracted = extractJsonSlice(raw);
  if (!extracted) {
    throw new Error('Editorial model returned no JSON object.');
  }

  const parsed = JSON.parse(extracted) as Partial<{ finalText: string; voiceText: string }>;
  const finalText = normalizeSentence(parsed.finalText) ?? deterministicComposeAssistantDraft(draft).finalText;
  const voiceText = normalizeSentence(parsed.voiceText) ?? deterministicComposeAssistantDraft(draft).voiceText;

  return {
    finalText,
    voiceText,
    uiHints: {
      tone: 'warm',
      strategy: draft.editorialStrategy,
    },
  };
};

const deterministicComposeAssistantDraft = (
  draft: AssistantResponseDraft,
): AssistantEditorialOutput => {
  const sections: string[] = [];
  const primary = normalizeSentence(draft.directAnswer) ?? draft.directAnswer;
  const detailBlock =
    draft.importantDetails.length > 0
      ? draft.importantDetails.map((detail) => `- ${detail}`).join('\n')
      : null;

  const warmLead = (() => {
    switch (draft.editorialStrategy) {
      case 'confirm_action':
        return primary;
      case 'reject_action_with_reason':
        return `No te lo quiero pintar raro: ${lowerFirst(primary)}`;
      case 'clarify_ambiguity':
        return `Aqui hay un matiz importante: ${lowerFirst(primary)}`;
      case 'report_no_evidence':
        return draft.criticalContext
          ? `Mira, lo importante aqui es esto: ${lowerFirst(draft.criticalContext)}`
          : primary;
      case 'inform_with_alternative':
      case 'inform_with_context':
      default:
        return draft.criticalContext
          ? `Mira, aqui hay algo importante: ${lowerFirst(draft.criticalContext)}`
          : primary;
    }
  })();

  const shouldRepeatPrimary =
    primary &&
    primary !== warmLead &&
    !warmLead.toLowerCase().includes(primary.toLowerCase()) &&
    !primary.toLowerCase().includes(warmLead.toLowerCase());

  sections.push(warmLead);
  if (shouldRepeatPrimary) {
    sections.push(primary);
  }

  if (detailBlock) {
    sections.push(detailBlock);
  }

  if (draft.nextBestHelp) {
    sections.push(`Si quieres, podemos ir un paso mas alla: ${lowerFirst(draft.nextBestHelp)}`);
  }

  if (draft.followupQuestion) {
    sections.push(draft.followupQuestion);
  }

  const finalText = sections
    .map((section) => normalizeSentence(section) ?? section)
    .filter(Boolean)
    .join('\n\n');

  const voiceLead = draft.criticalContext
    ? `Mira, aqui hay algo importante: ${lowerFirst(draft.criticalContext)}`
    : primary;
  const voiceTail = draft.nextBestHelp ? `Si quieres, tambien puedo ayudarte con esto: ${lowerFirst(draft.nextBestHelp)}` : null;
  const voiceText = [voiceLead, voiceTail]
    .map((part) => normalizeSentence(part ?? '') ?? '')
    .filter(Boolean)
    .join(' ');

  return {
    finalText,
    voiceText: voiceText || finalText,
    uiHints: {
      tone: 'warm',
      strategy: draft.editorialStrategy,
    },
  };
};

const mergeUsage = (
  base: ChatResponse['usage'],
  extra?: ChatResponse['usage'],
): ChatResponse['usage'] => ({
  provider: base.provider,
  model: base.model,
  inputTokens: base.inputTokens + (extra?.inputTokens ?? 0),
  outputTokens: base.outputTokens + (extra?.outputTokens ?? 0),
});

const shouldUseDeterministicEditorial = (draft: AssistantResponseDraft): boolean =>
  draft.responseKind === 'conversation' ||
  draft.responseKind === 'planner_read' ||
  draft.plannerMutation === false;

const renderAssistantReplyDraft = async (
  provider: string,
  model: string,
  draft: AssistantResponseDraft,
): Promise<{ output: AssistantEditorialOutput; usage?: ChatResponse['usage'] }> => {
  if (shouldUseDeterministicEditorial(draft)) {
    return {
      output: deterministicComposeAssistantDraft(draft),
      usage: undefined,
    };
  }

  try {
    const response = await callPlainTextModel(provider, model, buildEditorialPrompt(draft));
    return {
      output: parseEditorialOutput(response.text, draft),
      usage: response.usage,
    };
  } catch {
    return {
      output: deterministicComposeAssistantDraft(draft),
      usage: undefined,
    };
  }
};

const buildDeterministicExternalAnswer = (
  userMessage: string,
  sources: SearchSource[],
  geographyIsAmbiguous: boolean,
): AssistantEditorialOutput => {
  const draft = buildAssistantDraftFromExternal(
    userMessage,
    'external_info',
    {
      status: sources.length === 0 ? 'no_evidence' : 'unconfirmed',
      mode: sources.length === 0 ? 'no_evidence' : 'direct_answer',
      keyFact:
        sources.length === 0
          ? 'No encontre informacion fiable suficiente para responder eso con seguridad ahora mismo.'
          : 'No quiero inventarte una respuesta mas precisa de lo que realmente sostienen las fuentes.',
      directAnswer:
        sources.length === 0
          ? 'No encontre informacion fiable suficiente para responder eso con seguridad ahora mismo.'
          : 'No quiero inventarte una respuesta mas precisa de lo que realmente sostienen las fuentes.',
      criticalContext: null,
      alternativeSuggestion: null,
      geographyFollowup: geographyIsAmbiguous
        ? 'Si me dices la ciudad o el pais exactos, puedo afinar mejor la respuesta.'
        : null,
      confidence: 'low',
    },
  );

  return deterministicComposeAssistantDraft({
    ...draft,
    importantDetails: sources.slice(0, 2).map((source) => `${source.title}. ${source.snippet ?? ''}`.trim()),
  });
};

const runExternalInfoFlow = async (
  userMessage: string,
  modelConfig: ModelConfig,
  mode: ExternalIntent,
  progress?: ChatProgressCallbacks,
): Promise<ChatResponse> => {
  progress?.onSearchingStart?.({
    message: 'Analizando que necesito buscar...',
  });
  const searchResult = await searchExternalInfo(userMessage, mode, (payload) => {
    progress?.onSearchingResults?.(payload);
  });
  const candidates = [
    {
      provider: modelConfig.primaryProvider,
      model: modelConfig.primaryModel,
    },
    modelConfig.fallbackModel
      ? {
          provider: modelConfig.fallbackProvider || modelConfig.primaryProvider,
          model: modelConfig.fallbackModel,
        }
      : null,
  ].filter(Boolean) as Array<{ provider: string; model: string }>;

  const resolutionPrompt = buildExternalResolutionPrompt(
    userMessage,
    searchResult.sources,
    searchResult.shouldAskGeography,
  );
  progress?.onThinkingStart?.({
    message: 'Sintetizando la informacion encontrada...',
  });

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const resolution = await callPlainTextModel(candidate.provider, candidate.model, resolutionPrompt);
      const draft = parseExternalAnswerDraft(
        resolution.text,
        userMessage,
        searchResult.shouldAskGeography,
      );
      const assistantDraft = buildAssistantDraftFromExternal(
        userMessage,
        mode === 'external_lookup' ? 'external_info' : 'hybrid',
        draft,
      );
      return {
        text: assistantDraft.directAnswer,
        voiceText: assistantDraft.directAnswer,
        messageType: mode === 'external_lookup' ? 'external_info' : 'hybrid',
        sources: searchResult.sources,
        performedWebSearch: true,
        plannerMutation: false,
        uiHints: {
          tone: 'warm',
          strategy: assistantDraft.editorialStrategy,
        },
        usage: resolution.usage,
      };
    } catch (error) {
      lastError = error;
    }
  }

  const fallbackOutput = buildDeterministicExternalAnswer(
    userMessage,
    searchResult.sources,
    searchResult.shouldAskGeography,
  );
  return {
    text: fallbackOutput.finalText,
    voiceText: fallbackOutput.voiceText,
    messageType: mode === 'external_lookup' ? 'external_info' : 'hybrid',
    sources: searchResult.sources,
    performedWebSearch: true,
    plannerMutation: false,
    uiHints: fallbackOutput.uiHints,
    usage: {
      provider: 'tavily',
      model: 'search-basic-or-advanced',
      inputTokens: 0,
      outputTokens: 0,
    },
  };
};

export const __externalAnswerModel = {
  parseExternalAnswerDraft,
  buildAssistantDraftFromExternal,
  buildAssistantDraftFromPlannerRead,
  buildAssistantDraftFromMutation,
  deterministicComposeAssistantDraft,
  buildDeterministicExternalAnswer,
  inferExternalUserIntent,
  inferAssistantUserNeed,
  shouldUseDeterministicEditorial,
};

const callGoogleModel = async (
  model: string,
  userMessage: string,
  history: { role: 'user' | 'model'; text: string }[],
  systemInstruction: string,
  currentTasks: Task[],
  currentCalendarEvents: CalendarEvent[],
  currentDependencies: Dependency[],
  attachments: ChatAttachmentContext[],
): Promise<ChatResponse> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is missing.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const now = new Date();
  const attachmentContext = buildAttachmentTextContext(attachments);
  const currentPrompt = `${userMessage}${attachmentContext}`;
  const contents: any[] = history.map((msg) => ({
    role: msg.role,
    parts: [{ text: msg.text }],
  }));
  contents.push({
    role: 'user',
    parts: [{ text: currentPrompt }, ...buildGoogleAttachmentParts(attachments)],
  });

  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction,
      tools: [{ functionDeclarations: [updateScheduleTool] }],
      temperature: 0.2,
    },
  });

  let textResponse = response.text || '';
  let newTasks: Task[] | undefined;
  let newCalendarEvents: CalendarEvent[] | undefined;
  let newDependencies: Dependency[] | undefined;

  if (response.functionCalls && response.functionCalls.length > 0) {
    const call = response.functionCalls[0];
    if (call.name === 'updateSchedule') {
      const args = call.args as any;
      const parsed = parseModelMutations(
        userMessage,
        args.tasks || [],
        args.calendarEvents || [],
        (args.dependencies || []) as Dependency[],
        (args.removedTaskIds || []) as string[],
        (args.removedCalendarEventIds || []) as string[],
        currentTasks,
        currentCalendarEvents,
        currentDependencies,
        now,
      );
      newTasks = parsed.newTasks;
      newCalendarEvents = parsed.newCalendarEvents;
      newDependencies = parsed.newDependencies;

      const toolResponse = await ai.models.generateContent({
        model,
        contents: [
          ...contents,
          response.candidates?.[0]?.content,
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'updateSchedule',
                  response: { success: true },
                },
              },
            ],
          },
        ],
        config: {
          systemInstruction,
          temperature: 0.2,
        },
      });

      textResponse = toolResponse.text || textResponse;
    }
  }

  if (!textResponse) {
    textResponse = 'He actualizado la agenda según tus instrucciones.';
  }

  const usageMetadata = (response as any).usageMetadata ?? {};
  return {
    text: textResponse,
    newTasks,
    newCalendarEvents,
    newDependencies,
    messageType: 'planner',
    usage: {
      provider: 'google',
      model,
      inputTokens: usageMetadata.promptTokenCount ?? 0,
      outputTokens: usageMetadata.candidatesTokenCount ?? 0,
    },
  };
};

const callOpenRouterModel = async (
  model: string,
  userMessage: string,
  history: { role: 'user' | 'model'; text: string }[],
  systemInstruction: string,
  currentTasks: Task[],
  currentCalendarEvents: CalendarEvent[],
  currentDependencies: Dependency[],
  attachments: ChatAttachmentContext[],
): Promise<ChatResponse> => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is missing.');
  }

  const now = new Date();
  const structuredInstruction = `${systemInstruction}

OpenRouter structured-output mode:
- Do NOT use tool calls.
- Return ONLY valid JSON.
- Your JSON must follow this exact shape:
{
  "assistantMessage": "respuesta breve en español para el usuario",
  "tasks": [],
  "dependencies": [],
  "calendarEvents": [],
  "removedTaskIds": [],
  "removedCalendarEventIds": []
}
- "tasks", "dependencies" and "calendarEvents" must contain the FULL updated lists after applying the user's request.
- If the user explicitly asks to remove or delete a task/event, include its ids in "removedTaskIds" or "removedCalendarEventIds".
- If nothing changes, return the current lists unchanged.
- Do not wrap the response in prose outside the JSON object.`;

  const attachmentContext = buildAttachmentTextContext(attachments);
  const messages = [
    ...history.map((msg) => ({
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.text,
    })),
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `[INSTRUCCIONES INTERNAS]\n${structuredInstruction}\n\n[SOLICITUD DEL USUARIO]\n${userMessage}${attachmentContext}`,
        },
        ...buildOpenRouterAttachmentParts(attachments),
      ],
    },
  ];

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.PUBLIC_APP_URL || 'https://web-production-0c202.up.railway.app',
      'X-OpenRouter-Title': 'Tandeba',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });

  const payload = (await response.json()) as OpenRouterResponse & { error?: { message?: string; code?: number | string } };
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenRouter request failed with status ${response.status}`);
  }

  const firstChoice = payload.choices?.[0]?.message;
  const content = firstChoice?.content || '';
  let newTasks: Task[] | undefined;
  let newCalendarEvents: CalendarEvent[] | undefined;
  let newDependencies: Dependency[] | undefined;
  let textResponse = 'He actualizado la agenda según tus instrucciones.';

  try {
    const structured = normalizeOpenRouterPayload(extractJsonObject(content), now);
    const parsed = parseModelMutations(
      userMessage,
      structured.tasks || [],
      structured.calendarEvents || [],
      (structured.dependencies || []) as Dependency[],
      structured.removedTaskIds || [],
      structured.removedCalendarEventIds || [],
      currentTasks,
      currentCalendarEvents,
      currentDependencies,
      now,
    );
    newTasks = parsed.newTasks;
    newCalendarEvents = parsed.newCalendarEvents;
    newDependencies = parsed.newDependencies;
    textResponse = structured.assistantMessage || textResponse;
  } catch (error) {
    throw new Error(
      `OpenRouter devolvió una respuesta no estructurada para Agena: ${
        error instanceof Error ? error.message : 'JSON inválido'
      }`,
    );
  }

  return {
    text: textResponse,
    newTasks,
    newCalendarEvents,
    newDependencies,
    messageType: 'planner',
    usage: {
      provider: 'openrouter',
      model,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
    },
  };
};

const callModelByProvider = async (
  provider: string,
  model: string,
  userMessage: string,
  history: { role: 'user' | 'model'; text: string }[],
  systemInstruction: string,
  currentTasks: Task[],
  currentCalendarEvents: CalendarEvent[],
  currentDependencies: Dependency[],
  attachments: ChatAttachmentContext[],
): Promise<ChatResponse> => {
  if (provider === 'google') {
    return callGoogleModel(
      model,
      userMessage,
      history,
      systemInstruction,
      currentTasks,
      currentCalendarEvents,
      currentDependencies,
      attachments,
    );
  }

  if (provider === 'openrouter') {
    return callOpenRouterModel(
      model,
      userMessage,
      history,
      systemInstruction,
      currentTasks,
      currentCalendarEvents,
      currentDependencies,
      attachments,
    );
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
};

const buildContextSummary = (params: {
  currentTasks: Task[];
  currentCalendarEvents: CalendarEvent[];
  currentDependencies: Dependency[];
  workWindow: WorkWindow;
  strategy: 'balanced' | 'survival' | 'intelligent';
  currentSchedule: ScheduledTask[] | undefined;
  temporalContext: { scheduleBaseDate?: string; clientDayStartIso?: string } | undefined;
}): string => {
  const scheduleSummary = summarizeScheduleForRelativeDay(
    'que tengo hoy',
    params.currentSchedule,
    params.temporalContext?.scheduleBaseDate,
    params.temporalContext?.clientDayStartIso,
  );

  return [
    `Ventana laboral: ${params.workWindow.startHour}:00 - ${params.workWindow.endHour}:00.`,
    `Estrategia activa: ${params.strategy}.`,
    `Tareas activas: ${params.currentTasks.length}.`,
    `Eventos de calendario: ${params.currentCalendarEvents.length}.`,
    `Dependencias: ${params.currentDependencies.length}.`,
    scheduleSummary ? `Resumen de agenda:\n${scheduleSummary}` : 'Resumen de agenda: sin datos relevantes.',
  ].join('\n');
};

const formatRecentHistory = (
  history: { role: 'user' | 'model'; text: string }[],
  maxMessages = 6,
): string => {
  const recent = history.slice(-maxMessages);
  if (recent.length === 0) return 'Sin historial previo relevante.';

  return recent
    .map((message) => `${message.role === 'user' ? 'Usuario' : 'Asistente'}: ${message.text}`)
    .join('\n');
};

const buildConversationPrompt = (userMessage: string, attachments: ChatAttachmentContext[]): string => {
  const attachmentContext = buildAttachmentTextContext(attachments);
  return [
    'Responde en espanol neutro, breve y natural.',
    'No menciones agenda, guardado, planificacion ni rutas internas.',
    'Si saludan, responde de forma directa y corta.',
    '',
    `Mensaje del usuario: ${userMessage}${attachmentContext}`,
  ].join('\n');
};

const buildPlannerReadPrompt = (
  userMessage: string,
  summary: string,
  documentRetrieval: DocumentRetrievalContextPayload,
): string => {
  const documentContext = documentRetrieval.contextText
    ? `\n\nContexto documental:\n${documentRetrieval.contextText}`
    : '';
  return [
    'Responde en espanol neutro y claro.',
    'Debes resumir la agenda o explicar el estado actual sin proponer cambios.',
    'No digas que estas guardando cambios ni que estas reorganizando nada.',
    'Nunca afirmes que registraste, anotaste, creaste, moviste o actualizaste tareas o eventos.',
    'Si la solicitud del usuario suena a cambio de agenda pero no hubo mutacion real, dilo con claridad y pide que la reformule o confirma que no se aplicaron cambios.',
    'Si faltan datos, dilo con precision.',
    '',
    `Consulta del usuario: ${userMessage}`,
    '',
    `Estado actual:\n${summary}${documentContext}`,
  ].join('\n');
};

const buildExternalLookupPrompt = (
  userMessage: string,
  sources: SearchSource[],
  documentRetrieval: DocumentRetrievalContextPayload,
): string => {
  const sourcesContext = buildSourcesContext(sources, false);
  const documentContext = documentRetrieval.contextText
    ? `\n\nContexto documental:\n${documentRetrieval.contextText}`
    : '';
  return [
    'Responde en espanol neutro y riguroso.',
    'Usa solo la evidencia proporcionada y no inventes hechos.',
    'Si hay incertidumbre, explicitala y ofrece el siguiente paso mas util.',
    '',
    `Pregunta: ${userMessage}`,
    '',
    `Evidencia externa:\n${sourcesContext}${documentContext}`,
  ].join('\n');
};

const buildPlannerMutationPrompt = (
  userMessage: string,
  systemInstruction: string,
  documentRetrieval: DocumentRetrievalContextPayload,
  sources: SearchSource[],
): string => {
  const sourcesContext = sources.length > 0 ? `\n\nFuentes externas:\n${buildSourcesContext(sources, false)}` : '';
  const documentContext = documentRetrieval.contextText
    ? `\n\nContexto documental:\n${documentRetrieval.contextText}`
    : '';
  return [
    'Responde en espanol neutro y claro.',
    'Si la solicitud implica cambios, ejecútalos con precisión y entrega una sola respuesta final.',
    'No redactes una respuesta editorial separada. Devuelve el texto final al usuario junto con la accion.',
    '',
    `Instrucciones del sistema:\n${systemInstruction}`,
    '',
    `Solicitud:\n${userMessage}${sourcesContext}${documentContext}`,
  ].join('\n');
};

export async function chatWithSolverBackend(
  userMessage: string,
  history: { role: 'user' | 'model'; text: string }[],
  currentTasks: Task[],
  currentCalendarEvents: CalendarEvent[],
  currentDependencies: Dependency[],
  workWindow: WorkWindow,
  strategy: 'balanced' | 'survival' | 'intelligent',
  currentSchedule: ScheduledTask[] | undefined,
  temporalContext: {
    scheduleBaseDate?: string;
    clientDayStartIso?: string;
  } | undefined,
  modelConfig: ModelConfig,
  attachments: ChatAttachmentContext[] = [],
  documentRetrieval: DocumentRetrievalContextPayload = { hits: [], sources: [], contextText: '' },
  progress?: ChatProgressCallbacks,
  intentRoute: ChatIntentRoute = classifyIntentRoute(userMessage, history as any),
): Promise<ChatResponse> {
  const candidates = [
    {
      provider: modelConfig.primaryProvider,
      model: modelConfig.primaryModel,
    },
    modelConfig.fallbackModel
      ? {
          provider: modelConfig.fallbackProvider || modelConfig.primaryProvider,
          model: modelConfig.fallbackModel,
        }
      : null,
  ].filter(Boolean) as Array<{ provider: string; model: string }>;

  const resolvePlainTextRoute = async (
    prompt: string,
    responseKind: ChatMessageType,
  ): Promise<ChatResponse> => {
    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        const response = await callPlainTextModel(candidate.provider, candidate.model, prompt);
        return {
          text: response.text.trim(),
          voiceText: response.text.trim(),
          messageType: responseKind,
          performedWebSearch: false,
          plannerMutation: false,
          uiHints: {
            tone: 'warm',
            strategy: responseKind === 'conversation' ? 'inform_with_context' : 'inform_with_context',
          },
          usage: response.usage,
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error('No se pudo generar respuesta del modelo.');
  };

  progress?.onRoutingStart?.({
    message: 'Clasificando tu solicitud...',
  });

  if (intentRoute === 'conversation') {
    progress?.onThinkingStart?.({
      message: 'Redactando una respuesta breve...',
    });
    const prompt = [
      buildConversationPrompt(userMessage, attachments),
      `Historial reciente:\n${formatRecentHistory(history)}`,
    ].join('\n\n');
    return resolvePlainTextRoute(prompt, 'conversation');
  }

  if (intentRoute === 'planner_read') {
    progress?.onThinkingStart?.({
      message: 'Resumiendo tu agenda...',
    });
    const summary =
      summarizeScheduleForRelativeDay(
        userMessage,
        currentSchedule,
        temporalContext?.scheduleBaseDate,
        temporalContext?.clientDayStartIso,
      ) ?? buildContextSummary({
        currentTasks,
        currentCalendarEvents,
        currentDependencies,
        workWindow,
        strategy,
        currentSchedule,
        temporalContext,
      });
    const prompt = buildPlannerReadPrompt(userMessage, summary, documentRetrieval);
    return resolvePlainTextRoute(prompt, 'planner');
  }

  if (intentRoute === 'external_lookup' || intentRoute === 'hybrid') {
    progress?.onSearchingStart?.({
      message: 'Buscando información relevante...',
    });
    const searchMode = intentRoute === 'hybrid' ? 'hybrid' : 'external_lookup';
    const searchResult = await searchExternalInfo(userMessage, searchMode as any, (payload) => {
      progress?.onSearchingResults?.(payload);
    });

    const contextSources = [...searchResult.sources, ...documentRetrieval.sources];

    if (intentRoute === 'external_lookup') {
      progress?.onThinkingStart?.({
        message: 'Sintetizando la evidencia encontrada...',
      });
      const prompt = buildExternalLookupPrompt(userMessage, contextSources, documentRetrieval);
      let lastError: unknown = null;
      for (const candidate of candidates) {
        try {
          const response = await callPlainTextModel(candidate.provider, candidate.model, prompt);
          return {
            text: response.text.trim(),
            voiceText: response.text.trim(),
            messageType: 'external_info',
            sources: contextSources,
            performedWebSearch: true,
            plannerMutation: false,
            uiHints: {
              tone: 'warm',
              strategy: 'inform_with_context',
            },
            usage: response.usage,
          };
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError ?? new Error('No se pudo generar respuesta del modelo.');
    }

    progress?.onPlanningStart?.({
      message: 'Aplicando la información encontrada a tu agenda...',
    });
    const systemInstruction = buildSystemInstruction(
      currentTasks,
      currentCalendarEvents,
      currentDependencies,
      workWindow,
      strategy,
      currentSchedule,
    );
    const effectiveUserMessage = `${userMessage}

${buildSourcesContext(contextSources, searchResult.shouldAskGeography)}
${documentRetrieval.contextText ? `\n[CONTEXTO DOCUMENTAL SELECCIONADO]\n${documentRetrieval.contextText}` : ''}`;

    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        const response = await callModelByProvider(
          candidate.provider,
          candidate.model,
          effectiveUserMessage,
          history,
          systemInstruction,
          currentTasks,
          currentCalendarEvents,
          currentDependencies,
          attachments,
        );

        return {
          ...response,
          text: response.text.trim(),
          voiceText: response.voiceText?.trim() ?? response.text.trim(),
          messageType: 'hybrid',
          sources: contextSources,
          performedWebSearch: true,
          plannerMutation: response.plannerMutation ?? true,
          uiHints: {
            tone: 'warm',
            strategy: 'confirm_action',
          },
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error('No se pudo generar respuesta del modelo.');
  }

  progress?.onPlanningStart?.({
    message: 'Preparando el cambio de agenda...',
  });
  const systemInstruction = buildSystemInstruction(
    currentTasks,
    currentCalendarEvents,
    currentDependencies,
    workWindow,
    strategy,
    currentSchedule,
  );

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const response = await callModelByProvider(
        candidate.provider,
        candidate.model,
        userMessage,
        history,
        systemInstruction,
        currentTasks,
        currentCalendarEvents,
        currentDependencies,
        attachments,
      );

      return {
        ...response,
        text: response.text.trim(),
        voiceText: response.voiceText?.trim() ?? response.text.trim(),
        messageType: 'planner',
        performedWebSearch: response.performedWebSearch ?? false,
        plannerMutation: response.plannerMutation ?? true,
        uiHints: {
          tone: 'warm',
          strategy: 'confirm_action',
        },
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('No se pudo generar respuesta del modelo.');
}
