import { createHmac, randomUUID } from 'node:crypto';
import { addDays, subDays } from 'date-fns';
import type { CalendarEvent } from '../../src/lib/solver.js';
import { getSupabaseServiceRoleKey } from '../supabase.js';
import { getCalendarConnectionForUser, upsertCalendarConnectionForUser } from './store.js';
import type { CalendarConnectionRecord, CalendarProvider, ExternalCalendarDelta, OrchestratorUser } from './types.js';

type OAuthResult = {
  provider: CalendarProvider;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string | null;
  externalEmail?: string | null;
};

type SyncResult = {
  provider: CalendarProvider;
  deltas: ExternalCalendarDelta[];
  snapshot: CalendarEvent[];
};

type GoogleEventItem = {
  id: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

type GoogleEventsResponse = {
  items?: GoogleEventItem[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

type OutlookEventItem = {
  id: string;
  subject?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  '@removed'?: Record<string, unknown>;
};

type OutlookDeltaResponse = {
  value?: OutlookEventItem[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
};

const GOOGLE_SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events.readonly';
const OUTLOOK_SCOPES = 'offline_access User.Read Calendars.Read';

const getEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const getPublicAppUrl = () => getEnv('PUBLIC_APP_URL').replace(/\/$/, '');

const getRedirectUri = (provider: CalendarProvider): string => {
  if (provider === 'google') {
    return process.env.GOOGLE_REDIRECT_URI?.trim() || `${getPublicAppUrl()}/api/calendar/google/callback`;
  }
  return process.env.MICROSOFT_REDIRECT_URI?.trim() || `${getPublicAppUrl()}/api/calendar/outlook/callback`;
};

const signState = (payload: { userId: string; provider: CalendarProvider; nonce: string }) => {
  const serialized = JSON.stringify(payload);
  const encoded = Buffer.from(serialized, 'utf8').toString('base64url');
  const signature = createHmac('sha256', getSupabaseServiceRoleKey()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
};

export const verifyOAuthState = (rawState: string): { userId: string; provider: CalendarProvider } => {
  const [encoded, signature] = rawState.split('.');
  if (!encoded || !signature) {
    throw new Error('OAuth state inválido.');
  }
  const expected = createHmac('sha256', getSupabaseServiceRoleKey()).update(encoded).digest('base64url');
  if (expected !== signature) {
    throw new Error('OAuth state inválido.');
  }
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
    userId: string;
    provider: CalendarProvider;
  };
  return payload;
};

export const buildCalendarConnectUrl = (userId: string, provider: CalendarProvider): string => {
  const state = signState({ userId, provider, nonce: randomUUID() });
  if (provider === 'google') {
    const params = new URLSearchParams({
      client_id: getEnv('GOOGLE_CLIENT_ID'),
      redirect_uri: getRedirectUri('google'),
      response_type: 'code',
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      scope: GOOGLE_SCOPES,
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  const params = new URLSearchParams({
    client_id: getEnv('MICROSOFT_CLIENT_ID'),
    redirect_uri: getRedirectUri('outlook'),
    response_type: 'code',
    response_mode: 'query',
    scope: OUTLOOK_SCOPES,
    state,
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
};

const exchangeGoogleCode = async (code: string): Promise<OAuthResult> => {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: getEnv('GOOGLE_CLIENT_ID'),
      client_secret: getEnv('GOOGLE_CLIENT_SECRET'),
      redirect_uri: getRedirectUri('google'),
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed with ${response.status}.`);
  const payload = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    id_token?: string;
  };
  return {
    provider: 'google',
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null,
    scope: payload.scope ?? null,
  };
};

const exchangeOutlookCode = async (code: string): Promise<OAuthResult> => {
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getEnv('MICROSOFT_CLIENT_ID'),
      client_secret: getEnv('MICROSOFT_CLIENT_SECRET'),
      redirect_uri: getRedirectUri('outlook'),
      grant_type: 'authorization_code',
      code,
      scope: OUTLOOK_SCOPES,
    }),
  });
  if (!response.ok) throw new Error(`Microsoft token exchange failed with ${response.status}.`);
  const payload = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    provider: 'outlook',
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null,
    scope: payload.scope ?? null,
  };
};

const refreshGoogleToken = async (connection: CalendarConnectionRecord): Promise<OAuthResult> => {
  if (!connection.refreshToken) throw new Error('Google Calendar requiere refresh token para renovarse.');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getEnv('GOOGLE_CLIENT_ID'),
      client_secret: getEnv('GOOGLE_CLIENT_SECRET'),
      refresh_token: connection.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) throw new Error(`Google token refresh failed with ${response.status}.`);
  const payload = (await response.json()) as { access_token: string; expires_in?: number; scope?: string };
  return {
    provider: 'google',
    accessToken: payload.access_token,
    refreshToken: connection.refreshToken,
    expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null,
    scope: payload.scope ?? connection.scope ?? null,
    externalEmail: connection.externalEmail ?? null,
  };
};

const refreshOutlookToken = async (connection: CalendarConnectionRecord): Promise<OAuthResult> => {
  if (!connection.refreshToken) throw new Error('Outlook requiere refresh token para renovarse.');
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getEnv('MICROSOFT_CLIENT_ID'),
      client_secret: getEnv('MICROSOFT_CLIENT_SECRET'),
      refresh_token: connection.refreshToken,
      grant_type: 'refresh_token',
      scope: OUTLOOK_SCOPES,
    }),
  });
  if (!response.ok) throw new Error(`Microsoft token refresh failed with ${response.status}.`);
  const payload = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    provider: 'outlook',
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? connection.refreshToken,
    expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null,
    scope: payload.scope ?? connection.scope ?? null,
    externalEmail: connection.externalEmail ?? null,
  };
};

const ensureFreshConnection = async (connection: CalendarConnectionRecord): Promise<CalendarConnectionRecord> => {
  const expiresAt = connection.expiresAt ? Date.parse(connection.expiresAt) : null;
  const expiresSoon = expiresAt !== null && expiresAt - Date.now() <= 60_000;
  if (connection.accessToken && !expiresSoon) return connection;

  const refreshed =
    connection.provider === 'google'
      ? await refreshGoogleToken(connection)
      : await refreshOutlookToken(connection);

  return upsertCalendarConnectionForUser(connection.userId, connection.provider, {
    status: 'connected',
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? connection.refreshToken,
    expiresAt: refreshed.expiresAt,
    scope: refreshed.scope,
    externalEmail: refreshed.externalEmail ?? connection.externalEmail,
    externalCalendarId: connection.externalCalendarId,
    syncCursor: connection.syncCursor,
    syncWindowStart: connection.syncWindowStart,
    syncWindowEnd: connection.syncWindowEnd,
    lastSyncedAt: connection.lastSyncedAt,
    lastError: null,
  });
};

const toCalendarEvent = (
  provider: CalendarProvider,
  item: { id: string; title: string; start: string; end: string; kind?: CalendarEvent['kind'] },
): CalendarEvent => ({
  id: `${provider}:${item.id}`,
  title: item.title,
  start: 0,
  end: 0,
  kind: item.kind ?? 'meeting',
  sourceProvider: provider,
  externalEventId: item.id,
});

export const finalizeCalendarOAuth = async (
  userId: string,
  provider: CalendarProvider,
  code: string,
): Promise<CalendarConnectionRecord> => {
  const oauth =
    provider === 'google' ? await exchangeGoogleCode(code) : await exchangeOutlookCode(code);

  return upsertCalendarConnectionForUser(userId, provider, {
    status: 'connected',
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken,
    expiresAt: oauth.expiresAt,
    scope: oauth.scope,
    externalEmail: oauth.externalEmail ?? null,
    externalCalendarId: 'primary',
    syncCursor: null,
    syncWindowStart: subDays(new Date(), 30).toISOString(),
    syncWindowEnd: addDays(new Date(), 180).toISOString(),
    lastSyncedAt: null,
    lastError: null,
  });
};

const toAbsoluteMinutes = (baseDateIso: string, iso: string) => {
  const base = new Date(baseDateIso);
  return Math.round((Date.parse(iso) - Date.parse(baseDateIso)) / 60000 + base.getTimezoneOffset() - new Date(iso).getTimezoneOffset());
};

const applyGoogleDelta = (existing: Map<string, CalendarEvent>, item: GoogleEventItem) => {
  if (!item.id) return;
  if (item.status === 'cancelled') {
    existing.delete(item.id);
    return;
  }
  const start = item.start?.dateTime ?? item.start?.date;
  const end = item.end?.dateTime ?? item.end?.date;
  if (!start || !end) return;
  existing.set(item.id, {
    id: `google:${item.id}`,
    title: item.summary || 'Evento de Google Calendar',
    start: 0,
    end: 0,
    kind: 'meeting',
    sourceProvider: 'google',
    externalEventId: item.id,
  });
};

const applyOutlookDelta = (existing: Map<string, CalendarEvent>, item: OutlookEventItem) => {
  if (!item.id) return;
  if (item['@removed']) {
    existing.delete(item.id);
    return;
  }
  const start = item.start?.dateTime;
  const end = item.end?.dateTime;
  if (!start || !end) return;
  existing.set(item.id, {
    id: `outlook:${item.id}`,
    title: item.subject || 'Evento de Outlook',
    start: 0,
    end: 0,
    kind: 'meeting',
    sourceProvider: 'outlook',
    externalEventId: item.id,
  });
};

export const syncCalendarConnection = async (
  user: OrchestratorUser,
  provider: CalendarProvider,
  baseDateIso: string,
  currentProviderEvents: CalendarEvent[],
): Promise<SyncResult | null> => {
  const initial = await getCalendarConnectionForUser(user.id, provider);
  if (!initial || initial.status !== 'connected') return null;

  const connection = await ensureFreshConnection(initial);
  const existing = new Map(
    currentProviderEvents
      .filter((event) => event.externalEventId)
      .map((event) => [event.externalEventId as string, event]),
  );

  if (provider === 'google') {
    const deltas: ExternalCalendarDelta[] = [];
    let nextPageToken: string | undefined;
    let nextCursor = connection.syncCursor;
    const timeMin = connection.syncWindowStart ?? subDays(new Date(), 30).toISOString();
    const timeMax = connection.syncWindowEnd ?? addDays(new Date(), 180).toISOString();

    do {
      const params = new URLSearchParams({
        singleEvents: 'true',
        showDeleted: 'true',
        maxResults: '250',
      });
      if (connection.syncCursor) {
        params.set('syncToken', connection.syncCursor);
      } else {
        params.set('timeMin', timeMin);
        params.set('timeMax', timeMax);
        params.set('orderBy', 'startTime');
      }
      if (nextPageToken) params.set('pageToken', nextPageToken);

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${connection.accessToken}`,
          },
        },
      );

      if (response.status === 410 && connection.syncCursor) {
        await upsertCalendarConnectionForUser(user.id, 'google', {
          status: 'connected',
          accessToken: connection.accessToken,
          refreshToken: connection.refreshToken,
          expiresAt: connection.expiresAt,
          scope: connection.scope,
          externalEmail: connection.externalEmail,
          externalCalendarId: connection.externalCalendarId,
          syncCursor: null,
          syncWindowStart: timeMin,
          syncWindowEnd: timeMax,
          lastError: null,
          lastSyncedAt: connection.lastSyncedAt,
        });
        return syncCalendarConnection(user, provider, baseDateIso, currentProviderEvents);
      }
      if (!response.ok) throw new Error(`Google Calendar sync failed with ${response.status}.`);

      const payload = (await response.json()) as GoogleEventsResponse;
      nextPageToken = payload.nextPageToken;
      nextCursor = payload.nextSyncToken ?? nextCursor;

      for (const item of payload.items ?? []) {
        const start = item.start?.dateTime ?? item.start?.date;
        const end = item.end?.dateTime ?? item.end?.date;
        deltas.push({
          provider: 'google',
          action: item.status === 'cancelled' ? 'deleted' : existing.has(item.id) ? 'updated' : 'created',
          externalEventId: item.id,
          title: item.summary || 'Evento de Google Calendar',
          start,
          end,
          kind: 'meeting',
          raw: item,
        });
        applyGoogleDelta(existing, item);
      }
    } while (nextPageToken);

    const snapshot = Array.from(existing.values()).map((event) => {
      const matching = deltas.find((delta) => delta.externalEventId === event.externalEventId && delta.action !== 'deleted');
      return {
        ...event,
        start: matching?.start ? toAbsoluteMinutes(baseDateIso, matching.start) : event.start,
        end: matching?.end ? toAbsoluteMinutes(baseDateIso, matching.end) : event.end,
      };
    });

    await upsertCalendarConnectionForUser(user.id, 'google', {
      status: 'connected',
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      expiresAt: connection.expiresAt,
      scope: connection.scope,
      externalEmail: connection.externalEmail,
      externalCalendarId: connection.externalCalendarId,
      syncCursor: nextCursor,
      syncWindowStart: timeMin,
      syncWindowEnd: timeMax,
      lastSyncedAt: new Date().toISOString(),
      lastError: null,
    });

    return { provider: 'google', deltas, snapshot };
  }

  const deltas: ExternalCalendarDelta[] = [];
  let nextLink: string | undefined;
  let deltaLink = connection.syncCursor ?? '';
  const timeMin = connection.syncWindowStart ?? subDays(new Date(), 30).toISOString();
  const timeMax = connection.syncWindowEnd ?? addDays(new Date(), 180).toISOString();

  do {
    const url =
      nextLink ||
      deltaLink ||
      `https://graph.microsoft.com/v1.0/me/calendarView/delta?startDateTime=${encodeURIComponent(timeMin)}&endDateTime=${encodeURIComponent(timeMax)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        Prefer: 'odata.maxpagesize=100',
      },
    });
    if (!response.ok) throw new Error(`Outlook Calendar sync failed with ${response.status}.`);

    const payload = (await response.json()) as OutlookDeltaResponse;
    nextLink = payload['@odata.nextLink'];
    deltaLink = payload['@odata.deltaLink'] ?? deltaLink;

    for (const item of payload.value ?? []) {
      deltas.push({
        provider: 'outlook',
        action: item['@removed'] ? 'deleted' : existing.has(item.id) ? 'updated' : 'created',
        externalEventId: item.id,
        title: item.subject || 'Evento de Outlook',
        start: item.start?.dateTime,
        end: item.end?.dateTime,
        kind: 'meeting',
        raw: item,
      });
      applyOutlookDelta(existing, item);
    }
  } while (nextLink);

  const snapshot = Array.from(existing.values()).map((event) => {
    const matching = deltas.find((delta) => delta.externalEventId === event.externalEventId && delta.action !== 'deleted');
    return {
      ...event,
      start: matching?.start ? toAbsoluteMinutes(baseDateIso, matching.start) : event.start,
      end: matching?.end ? toAbsoluteMinutes(baseDateIso, matching.end) : event.end,
    };
  });

  await upsertCalendarConnectionForUser(user.id, 'outlook', {
    status: 'connected',
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    expiresAt: connection.expiresAt,
    scope: connection.scope,
    externalEmail: connection.externalEmail,
    externalCalendarId: connection.externalCalendarId,
    syncCursor: deltaLink,
    syncWindowStart: timeMin,
    syncWindowEnd: timeMax,
    lastSyncedAt: new Date().toISOString(),
    lastError: null,
  });

  return { provider: 'outlook', deltas, snapshot };
};
