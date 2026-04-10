import type { PlannerState } from '../src/lib/plannerState.js';
import { HttpError } from './httpErrors.js';
import { getSupabaseAdmin } from './supabase.js';

type ChatReplayStatus = 'pending' | 'completed';

type ChatReplayRow = {
  user_id: string;
  request_id: string;
  status: ChatReplayStatus;
  response_state: PlannerState | null;
  response_reply: string | null;
};

export type CompletedChatReplay = {
  state: PlannerState;
  reply: string;
};

const isUniqueViolation = (error: unknown) =>
  Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505');

const isReplayResultComplete = (
  row: ChatReplayRow | null,
): row is ChatReplayRow & { status: 'completed'; response_state: PlannerState; response_reply: string } =>
  Boolean(row && row.status === 'completed' && row.response_state && row.response_reply);

const fetchReplayRow = async (userId: string, requestId: string): Promise<ChatReplayRow | null> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('chat_request_replays')
    .select('user_id, request_id, status, response_state, response_reply')
    .eq('user_id', userId)
    .eq('request_id', requestId)
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return (result.data as ChatReplayRow | null) ?? null;
};

export const findCompletedReplay = async (
  userId: string,
  requestId: string,
): Promise<CompletedChatReplay | null> => {
  const row = await fetchReplayRow(userId, requestId);
  if (!isReplayResultComplete(row)) {
    return null;
  }

  return {
    state: row.response_state,
    reply: row.response_reply,
  };
};

export const reserveChatReplay = async (
  userId: string,
  requestId: string,
): Promise<'acquired' | 'completed_elsewhere' | 'pending_elsewhere'> => {
  const supabase = getSupabaseAdmin();
  const insert = await supabase.from('chat_request_replays').insert({
    user_id: userId,
    request_id: requestId,
    status: 'pending',
    response_state: null,
    response_reply: null,
  });

  if (!insert.error) {
    return 'acquired';
  }

  if (!isUniqueViolation(insert.error)) {
    throw insert.error;
  }

  const existing = await fetchReplayRow(userId, requestId);
  if (isReplayResultComplete(existing)) {
    return 'completed_elsewhere';
  }

  return 'pending_elsewhere';
};

export const completeChatReplay = async (params: {
  userId: string;
  requestId: string;
  state: PlannerState;
  reply: string;
}): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const update = await supabase
    .from('chat_request_replays')
    .update({
      status: 'completed',
      response_state: params.state,
      response_reply: params.reply,
    })
    .eq('user_id', params.userId)
    .eq('request_id', params.requestId);

  if (update.error) {
    throw update.error;
  }
};

export const releasePendingChatReplay = async (userId: string, requestId: string): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('chat_request_replays')
    .delete()
    .eq('user_id', userId)
    .eq('request_id', requestId)
    .eq('status', 'pending');

  if (result.error) {
    throw result.error;
  }
};

export const assertReplayRequestId = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length < 8) {
    throw new HttpError(400, 'missing_request_id', 'La solicitud de chat no tiene un identificador valido.');
  }

  return value.trim();
};
