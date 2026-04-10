import type {
  CalendarEvent,
  Dependency,
  IntelligentStrategyConfig,
  ScheduledTask,
  Task,
  WorkWindow,
} from './solver';

export interface SearchSource {
  title: string;
  url: string;
  domain?: string;
  snippet?: string;
  kind?: 'web' | 'document';
  documentId?: string;
  pageLabel?: string;
  mimeType?: string;
}

export type ChatMessageType = 'planner' | 'external_info' | 'hybrid' | 'conversation';
export type ChatIntentRoute =
  | 'conversation'
  | 'planner_read'
  | 'planner_mutation'
  | 'external_lookup'
  | 'hybrid';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  metadata?: {
    messageType?: ChatMessageType;
    sources?: SearchSource[];
    requestId?: string;
  };
}

export interface PlannerHistory {
  currentRevisionId?: string;
  canUndo: boolean;
  canRedo: boolean;
  revisionCount: number;
}

export type UserTier = 'free' | 'premium';
export type AccountStatus = 'active' | 'suspended';

export interface ViewerProfile {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  tier: UserTier;
  accountStatus: AccountStatus;
}

export type ReplanningMode = 'suggest_only' | 'semi_automatic' | 'automatic';
export type CalendarProvider = 'google' | 'outlook';
export type ReplanningDecisionKind = 'ignored' | 'suggested' | 'applied' | 'failed';
export type ReplanningEventStatus = 'open' | 'accepted' | 'rejected' | 'applied' | 'ignored' | 'failed';

export interface CalendarConnectionSummary {
  provider: CalendarProvider;
  connected: boolean;
  externalEmail?: string;
  lastSyncedAt?: string | null;
  lastError?: string | null;
}

export interface ReplanningSettings {
  mode: ReplanningMode;
  googleCalendarEnabled: boolean;
  outlookCalendarEnabled: boolean;
  internalRiskDetectionEnabled: boolean;
  emailNotificationsEnabled: boolean;
  connections: CalendarConnectionSummary[];
}

export interface ReplanningImpactSummary {
  movedTaskCount: number;
  totalDisplacedMinutes: number;
  touchesFixedStart: boolean;
  touchesCritical: boolean;
  pushedOutsideCurrentDay: boolean;
  createdNewRisk: boolean;
}

export interface ReplanningFeedEvent {
  id: string;
  triggerType: string;
  triggerSource: string;
  decision: ReplanningDecisionKind;
  status: ReplanningEventStatus;
  outcomeReason: string | null;
  impactSummary: ReplanningImpactSummary | null;
  createdAt: string;
}

export interface UsageAccessSummary {
  planCode: UserTier;
  textAllowed: boolean;
  voiceAllowed: boolean;
  webSearchAllowed?: boolean;
  remainingTextLifetime: number | null;
  remainingTextPeriod: number | null;
  remainingVoiceSeconds: number | null;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
}

export interface PlannerState {
  id: string;
  messages: ChatMessage[];
  tasks: Task[];
  calendarEvents: CalendarEvent[];
  dependencies: Dependency[];
  workWindow: WorkWindow;
  strategy: 'balanced' | 'survival' | 'intelligent';
  schedule: ScheduledTask[] | null;
  diagnostics: unknown;
  scheduleBaseDate: string;
  profileId?: string;
  timezone?: string;
  locale?: string;
  history?: PlannerHistory;
  viewer?: ViewerProfile | null;
  access?: UsageAccessSummary | null;
  replanning?: {
    settings: ReplanningSettings;
    feed: ReplanningFeedEvent[];
  };
}

export interface PlannerStateSyncPayload {
  messages: ChatMessage[];
  tasks: Task[];
  calendarEvents: CalendarEvent[];
  dependencies: Dependency[];
  workWindow: WorkWindow;
  strategy: 'balanced' | 'survival' | 'intelligent';
  schedule: ScheduledTask[] | null;
  diagnostics: unknown;
  scheduleBaseDate: string;
  clientDayStartIso?: string;
  clientNowMinutes?: number;
  clientWeekday?: number;
  allowEmptyReset?: boolean;
}

export interface ScheduleRunRecord {
  strategy: 'balanced' | 'survival' | 'intelligent';
  taskCount: number;
  score: number;
  status: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'TIMEOUT' | 'INVALID_INPUT';
  diagnostics: unknown;
  schedule: ScheduledTask[] | null;
  configUsed: IntelligentStrategyConfig | Record<string, never>;
}

export const DEFAULT_WORK_WINDOW: WorkWindow = {
  startHour: 8,
  endHour: 18,
  workDays: [1, 2, 3, 4, 5],
};

export const DEFAULT_PLANNER_STATE: PlannerState = {
  id: 'default',
  messages: [],
  tasks: [],
  calendarEvents: [],
  dependencies: [],
  workWindow: DEFAULT_WORK_WINDOW,
  strategy: 'intelligent',
  schedule: [],
  diagnostics: null,
  scheduleBaseDate: new Date().toISOString(),
  history: {
    canUndo: false,
    canRedo: false,
    revisionCount: 0,
  },
  viewer: null,
  access: null,
  replanning: {
    settings: {
      mode: 'semi_automatic',
      googleCalendarEnabled: false,
      outlookCalendarEnabled: false,
      internalRiskDetectionEnabled: true,
      emailNotificationsEnabled: true,
      connections: [],
    },
    feed: [],
  },
};
