import type { ReplanningFeedEvent, ReplanningSettings } from '../../src/lib/plannerState.js';
import { getSupabaseAdmin } from '../supabase.js';
import type {
  CalendarConnectionRecord,
  CalendarProvider,
  OrchestratorUser,
  ReplanningBundle,
  ReplanningEventRecord,
  ReplanningProfileSettings,
  ReplanningRecentEvent,
} from './types.js';

type ProfileSettingsRow = {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  replanning_mode: ReplanningSettings['mode'];
  google_calendar_enabled: boolean;
  outlook_calendar_enabled: boolean;
  internal_risk_detection_enabled: boolean;
  email_notifications_enabled: boolean;
};

type CalendarConnectionRow = {
  user_id: string;
  provider: CalendarProvider;
  status: 'disconnected' | 'connected' | 'error';
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
  external_email: string | null;
  external_calendar_id: string;
  sync_cursor: string | null;
  sync_window_start: string | null;
  sync_window_end: string | null;
  last_synced_at: string | null;
  last_error: string | null;
};

type ReplanningEventRow = {
  id: string;
  user_id: string;
  trigger_type: string;
  trigger_source: string;
  trigger_hash: string;
  decision: ReplanningEventRecord['decision'];
  status: ReplanningEventRecord['status'];
  outcome_reason: string | null;
  impact_summary: ReplanningEventRecord['impactSummary'];
  trigger_payload: Record<string, unknown>;
  suggested_snapshot: ReplanningEventRecord['suggestedSnapshot'];
  before_revision_id: string | null;
  after_revision_id: string | null;
  notification_delivery_id: string | null;
  notified_at: string | null;
  created_at: string;
};

const mapConnection = (row: CalendarConnectionRow): CalendarConnectionRecord => ({
  userId: row.user_id,
  provider: row.provider,
  connected: row.status === 'connected',
  status: row.status,
  accessToken: row.access_token,
  refreshToken: row.refresh_token,
  expiresAt: row.expires_at,
  scope: row.scope,
  externalEmail: row.external_email ?? undefined,
  externalCalendarId: row.external_calendar_id,
  syncCursor: row.sync_cursor,
  syncWindowStart: row.sync_window_start,
  syncWindowEnd: row.sync_window_end,
  lastSyncedAt: row.last_synced_at,
  lastError: row.last_error,
});

const mapFeedEvent = (row: ReplanningEventRow): ReplanningFeedEvent => ({
  id: row.id,
  triggerType: row.trigger_type,
  triggerSource: row.trigger_source,
  decision: row.decision,
  status: row.status,
  outcomeReason: row.outcome_reason,
  impactSummary: row.impact_summary ?? null,
  createdAt: row.created_at,
});

const mapEventRecord = (row: ReplanningEventRow): ReplanningEventRecord => ({
  id: row.id,
  userId: row.user_id,
  triggerType: row.trigger_type as ReplanningEventRecord['triggerType'],
  triggerSource: row.trigger_source as ReplanningEventRecord['triggerSource'],
  triggerHash: row.trigger_hash,
  decision: row.decision,
  status: row.status,
  outcomeReason: row.outcome_reason,
  impactSummary: row.impact_summary ?? null,
  triggerPayload: row.trigger_payload ?? {},
  suggestedSnapshot: row.suggested_snapshot ?? null,
  beforeRevisionId: row.before_revision_id,
  afterRevisionId: row.after_revision_id,
  notificationDeliveryId: row.notification_delivery_id,
  notifiedAt: row.notified_at,
  createdAt: row.created_at,
});

export const loadReplanningBundleForUser = async (userId: string): Promise<ReplanningBundle> => {
  const supabase = getSupabaseAdmin();
  const [profileResult, connectionsResult, feedResult] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, email, full_name, avatar_url, replanning_mode, google_calendar_enabled, outlook_calendar_enabled, internal_risk_detection_enabled, email_notifications_enabled',
      )
      .eq('id', userId)
      .single(),
    supabase
      .from('calendar_connections')
      .select(
        'user_id, provider, status, access_token, refresh_token, expires_at, scope, external_email, external_calendar_id, sync_cursor, sync_window_start, sync_window_end, last_synced_at, last_error',
      )
      .eq('user_id', userId),
    supabase
      .from('replanning_events')
      .select(
        'id, user_id, trigger_type, trigger_source, trigger_hash, decision, status, outcome_reason, impact_summary, trigger_payload, suggested_snapshot, before_revision_id, after_revision_id, notification_delivery_id, notified_at, created_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  if (profileResult.error || !profileResult.data) {
    throw profileResult.error ?? new Error('No fue posible cargar la configuración de replanificación.');
  }
  if (connectionsResult.error) throw connectionsResult.error;
  if (feedResult.error) throw feedResult.error;

  const profile = profileResult.data as ProfileSettingsRow;
  const connections = ((connectionsResult.data as CalendarConnectionRow[] | null) ?? []).map(mapConnection);
  const settings: ReplanningSettings = {
    mode: profile.replanning_mode,
    googleCalendarEnabled: profile.google_calendar_enabled,
    outlookCalendarEnabled: profile.outlook_calendar_enabled,
    internalRiskDetectionEnabled: profile.internal_risk_detection_enabled,
    emailNotificationsEnabled: profile.email_notifications_enabled,
    connections,
  };

  return {
    settings,
    feed: ((feedResult.data as ReplanningEventRow[] | null) ?? []).map(mapFeedEvent),
  };
};

export const updateReplanningSettingsForUser = async (
  userId: string,
  patch: Partial<ReplanningProfileSettings>,
): Promise<ReplanningSettings> => {
  const supabase = getSupabaseAdmin();
  const updatePayload: Record<string, unknown> = {};

  if (patch.mode) updatePayload.replanning_mode = patch.mode;
  if (typeof patch.googleCalendarEnabled === 'boolean') {
    updatePayload.google_calendar_enabled = patch.googleCalendarEnabled;
  }
  if (typeof patch.outlookCalendarEnabled === 'boolean') {
    updatePayload.outlook_calendar_enabled = patch.outlookCalendarEnabled;
  }
  if (typeof patch.internalRiskDetectionEnabled === 'boolean') {
    updatePayload.internal_risk_detection_enabled = patch.internalRiskDetectionEnabled;
  }
  if (typeof patch.emailNotificationsEnabled === 'boolean') {
    updatePayload.email_notifications_enabled = patch.emailNotificationsEnabled;
  }

  const result = await supabase
    .from('profiles')
    .update(updatePayload)
    .eq('id', userId)
    .select(
      'replanning_mode, google_calendar_enabled, outlook_calendar_enabled, internal_risk_detection_enabled, email_notifications_enabled',
    )
    .single();

  if (result.error || !result.data) {
    throw result.error ?? new Error('No fue posible actualizar la configuración de replanificación.');
  }

  const connections = await getCalendarConnectionsForUser(userId);
  return {
    mode: result.data.replanning_mode as ReplanningSettings['mode'],
    googleCalendarEnabled: Boolean(result.data.google_calendar_enabled),
    outlookCalendarEnabled: Boolean(result.data.outlook_calendar_enabled),
    internalRiskDetectionEnabled: Boolean(result.data.internal_risk_detection_enabled),
    emailNotificationsEnabled: Boolean(result.data.email_notifications_enabled),
    connections,
  };
};

export const getCalendarConnectionsForUser = async (userId: string): Promise<CalendarConnectionRecord[]> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('calendar_connections')
    .select(
      'user_id, provider, status, access_token, refresh_token, expires_at, scope, external_email, external_calendar_id, sync_cursor, sync_window_start, sync_window_end, last_synced_at, last_error',
    )
    .eq('user_id', userId);

  if (result.error) throw result.error;
  return ((result.data as CalendarConnectionRow[] | null) ?? []).map(mapConnection);
};

export const getCalendarConnectionForUser = async (
  userId: string,
  provider: CalendarProvider,
): Promise<CalendarConnectionRecord | null> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('calendar_connections')
    .select(
      'user_id, provider, status, access_token, refresh_token, expires_at, scope, external_email, external_calendar_id, sync_cursor, sync_window_start, sync_window_end, last_synced_at, last_error',
    )
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();

  if (result.error) throw result.error;
  return result.data ? mapConnection(result.data as CalendarConnectionRow) : null;
};

export const upsertCalendarConnectionForUser = async (
  userId: string,
  provider: CalendarProvider,
  patch: Partial<CalendarConnectionRecord> & { status: CalendarConnectionRecord['status'] },
): Promise<CalendarConnectionRecord> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('calendar_connections')
    .upsert(
      {
        user_id: userId,
        provider,
        status: patch.status,
        access_token: patch.accessToken ?? null,
        refresh_token: patch.refreshToken ?? null,
        expires_at: patch.expiresAt ?? null,
        scope: patch.scope ?? null,
        external_email: patch.externalEmail ?? null,
        external_calendar_id: patch.externalCalendarId ?? 'primary',
        sync_cursor: patch.syncCursor ?? null,
        sync_window_start: patch.syncWindowStart ?? null,
        sync_window_end: patch.syncWindowEnd ?? null,
        last_synced_at: patch.lastSyncedAt ?? null,
        last_error: patch.lastError ?? null,
      },
      { onConflict: 'user_id,provider' },
    )
    .select(
      'user_id, provider, status, access_token, refresh_token, expires_at, scope, external_email, external_calendar_id, sync_cursor, sync_window_start, sync_window_end, last_synced_at, last_error',
    )
    .single();

  if (result.error || !result.data) {
    throw result.error ?? new Error('No fue posible guardar la conexión de calendario.');
  }

  return mapConnection(result.data as CalendarConnectionRow);
};

export const disconnectCalendarConnectionForUser = async (
  userId: string,
  provider: CalendarProvider,
): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const [connectionUpdate, profileUpdate] = await Promise.all([
    supabase
      .from('calendar_connections')
      .upsert(
        {
          user_id: userId,
          provider,
          status: 'disconnected',
          access_token: null,
          refresh_token: null,
          expires_at: null,
          scope: null,
          external_email: null,
          external_calendar_id: 'primary',
          sync_cursor: null,
          sync_window_start: null,
          sync_window_end: null,
          last_synced_at: null,
          last_error: null,
        },
        { onConflict: 'user_id,provider' },
      ),
    supabase
      .from('profiles')
      .update(provider === 'google' ? { google_calendar_enabled: false } : { outlook_calendar_enabled: false })
      .eq('id', userId),
  ]);

  if (connectionUpdate.error) throw connectionUpdate.error;
  if (profileUpdate.error) throw profileUpdate.error;
};

export const listRecentReplanningEvents = async (
  userId: string,
  limit = 10,
): Promise<ReplanningEventRecord[]> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('replanning_events')
    .select(
      'id, user_id, trigger_type, trigger_source, trigger_hash, decision, status, outcome_reason, impact_summary, trigger_payload, suggested_snapshot, before_revision_id, after_revision_id, notification_delivery_id, notified_at, created_at',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (result.error) throw result.error;
  return ((result.data as ReplanningEventRow[] | null) ?? []).map(mapEventRecord);
};

export const listRecentEventHashes = async (
  userId: string,
  limit = 20,
): Promise<ReplanningRecentEvent[]> => {
  const events = await listRecentReplanningEvents(userId, limit);
  return events.map((event) => ({
    id: event.id,
    triggerHash: event.triggerHash,
    decision: event.decision,
    status: event.status,
    createdAt: event.createdAt,
  }));
};

export const createReplanningEvent = async (
  payload: Omit<ReplanningEventRecord, 'id' | 'createdAt' | 'notificationDeliveryId' | 'notifiedAt'>,
): Promise<ReplanningEventRecord> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('replanning_events')
    .insert({
      user_id: payload.userId,
      trigger_type: payload.triggerType,
      trigger_source: payload.triggerSource,
      trigger_hash: payload.triggerHash,
      decision: payload.decision,
      status: payload.status,
      outcome_reason: payload.outcomeReason,
      impact_summary: payload.impactSummary,
      trigger_payload: payload.triggerPayload,
      suggested_snapshot: payload.suggestedSnapshot,
      before_revision_id: payload.beforeRevisionId,
      after_revision_id: payload.afterRevisionId,
    })
    .select(
      'id, user_id, trigger_type, trigger_source, trigger_hash, decision, status, outcome_reason, impact_summary, trigger_payload, suggested_snapshot, before_revision_id, after_revision_id, notification_delivery_id, notified_at, created_at',
    )
    .single();

  if (result.error || !result.data) {
    throw result.error ?? new Error('No fue posible registrar el evento de replanificación.');
  }

  return mapEventRecord(result.data as ReplanningEventRow);
};

export const updateReplanningEvent = async (
  eventId: string,
  patch: Partial<Pick<ReplanningEventRecord, 'status' | 'decision' | 'outcomeReason' | 'impactSummary' | 'afterRevisionId' | 'suggestedSnapshot' | 'notificationDeliveryId' | 'notifiedAt'>>,
): Promise<ReplanningEventRecord> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('replanning_events')
    .update({
      status: patch.status,
      decision: patch.decision,
      outcome_reason: patch.outcomeReason,
      impact_summary: patch.impactSummary,
      after_revision_id: patch.afterRevisionId,
      suggested_snapshot: patch.suggestedSnapshot,
      notification_delivery_id: patch.notificationDeliveryId,
      notified_at: patch.notifiedAt,
    })
    .eq('id', eventId)
    .select(
      'id, user_id, trigger_type, trigger_source, trigger_hash, decision, status, outcome_reason, impact_summary, trigger_payload, suggested_snapshot, before_revision_id, after_revision_id, notification_delivery_id, notified_at, created_at',
    )
    .single();

  if (result.error || !result.data) {
    throw result.error ?? new Error('No fue posible actualizar el evento de replanificación.');
  }

  return mapEventRecord(result.data as ReplanningEventRow);
};

export const getReplanningEventById = async (
  userId: string,
  eventId: string,
): Promise<ReplanningEventRecord | null> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('replanning_events')
    .select(
      'id, user_id, trigger_type, trigger_source, trigger_hash, decision, status, outcome_reason, impact_summary, trigger_payload, suggested_snapshot, before_revision_id, after_revision_id, notification_delivery_id, notified_at, created_at',
    )
    .eq('id', eventId)
    .eq('user_id', userId)
    .maybeSingle();

  if (result.error) throw result.error;
  return result.data ? mapEventRecord(result.data as ReplanningEventRow) : null;
};

export const listUsersForAutonomousReplanning = async (): Promise<
  Array<OrchestratorUser & { settings: ReplanningProfileSettings }>
> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('profiles')
    .select(
      'id, email, full_name, avatar_url, replanning_mode, google_calendar_enabled, outlook_calendar_enabled, internal_risk_detection_enabled, email_notifications_enabled',
    )
    .eq('account_status', 'active');

  if (result.error) throw result.error;

  return ((result.data as ProfileSettingsRow[] | null) ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    settings: {
      mode: row.replanning_mode,
      googleCalendarEnabled: row.google_calendar_enabled,
      outlookCalendarEnabled: row.outlook_calendar_enabled,
      internalRiskDetectionEnabled: row.internal_risk_detection_enabled,
      emailNotificationsEnabled: row.email_notifications_enabled,
    },
  }));
};
