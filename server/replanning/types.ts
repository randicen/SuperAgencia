import type {
  CalendarConnectionSummary,
  ReplanningFeedEvent,
  ReplanningImpactSummary,
  ReplanningMode,
  PlannerState,
  ReplanningSettings,
} from '../../src/lib/plannerState.js';
import type { CalendarEvent, ScheduledTask } from '../../src/lib/solver.js';

export type ExternalCalendarDeltaAction = 'created' | 'updated' | 'deleted';
export type ReplanningTriggerType =
  | 'calendar_event_created'
  | 'calendar_event_updated'
  | 'calendar_event_deleted'
  | 'calendar_event_conflict_detected'
  | 'task_deadline_risk'
  | 'task_missed'
  | 'schedule_margin_breach'
  | 'planned_block_expired';
export type ReplanningTriggerSource = 'google_calendar' | 'outlook_calendar' | 'internal';
export type ReplanningDecisionKind = 'ignore' | 'suggest' | 'apply_and_notify';

export type CalendarProvider = 'google' | 'outlook';

export interface ExternalCalendarDelta {
  provider: CalendarProvider;
  action: ExternalCalendarDeltaAction;
  externalEventId: string;
  title: string;
  start?: string;
  end?: string;
  kind?: CalendarEvent['kind'];
  raw?: unknown;
}

export interface ReplanningTrigger {
  type: ReplanningTriggerType;
  source: ReplanningTriggerSource;
  hash: string;
  summary: string;
  detectedAt: string;
  deltas?: ExternalCalendarDelta[];
  payload?: Record<string, unknown>;
}

export interface ReplanningDecision {
  kind: ReplanningDecisionKind;
  reason: string;
}

export interface ReplanningRecentEvent {
  id: string;
  triggerHash: string;
  decision: ReplanningFeedEvent['decision'];
  status: ReplanningFeedEvent['status'];
  createdAt: string;
}

export interface ReplanningEventRecord {
  id: string;
  userId: string;
  triggerType: ReplanningTriggerType;
  triggerSource: ReplanningTriggerSource;
  triggerHash: string;
  decision: ReplanningFeedEvent['decision'];
  status: ReplanningFeedEvent['status'];
  outcomeReason: string | null;
  impactSummary: ReplanningImpactSummary | null;
  triggerPayload: Record<string, unknown>;
  suggestedSnapshot: PlannerState | null;
  beforeRevisionId: string | null;
  afterRevisionId: string | null;
  notificationDeliveryId: string | null;
  notifiedAt: string | null;
  createdAt: string;
}

export interface CalendarConnectionRecord extends CalendarConnectionSummary {
  userId: string;
  status: 'disconnected' | 'connected' | 'error';
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string | null;
  externalCalendarId: string;
  syncCursor: string | null;
  syncWindowStart: string | null;
  syncWindowEnd: string | null;
}

export interface ReplanningBundle {
  settings: ReplanningSettings;
  feed: ReplanningFeedEvent[];
}

export interface OrchestratorUser {
  id: string;
  email: string;
  fullName?: string;
  avatarUrl?: string | null;
}

export interface SolverPreview {
  schedule: ScheduledTask[] | null;
  diagnostics: unknown;
}

export interface ReplanningExecutionResult {
  decision: ReplanningEventRecord['decision'];
  status: ReplanningEventRecord['status'];
  reason: string;
  impactSummary: ReplanningImpactSummary | null;
  state?: PlannerState;
}

export interface ReplanningProfileSettings {
  mode: ReplanningMode;
  googleCalendarEnabled: boolean;
  outlookCalendarEnabled: boolean;
  internalRiskDetectionEnabled: boolean;
  emailNotificationsEnabled: boolean;
}
