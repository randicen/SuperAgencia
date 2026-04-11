import {
  DEFAULT_PLANNER_STATE,
  type AccountStatus,
  type UsageAccessSummary,
  type UserTier,
  type ViewerProfile,
} from '../src/lib/plannerState.js';
import type { AuthenticatedUser } from './auth.js';
import { HttpError } from './httpErrors.js';
import { getSupabaseAdmin } from './supabase.js';

export type AiChannel = 'text' | 'voice';
export type UsageChannel = AiChannel | 'web_search';

type ProfileRow = {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  timezone: string;
  locale: string;
  tier: UserTier;
  account_status: AccountStatus;
};

type PlannerStateRow = {
  user_id: string;
};

type PlanDefinitionRow = {
  code: UserTier;
  text_ai_enabled: boolean;
  voice_ai_enabled: boolean;
  web_search_enabled: boolean;
  lifetime_text_limit: number | null;
  period_text_limit: number | null;
  period_voice_minutes_limit: number | null;
  manual_planning_enabled: boolean;
};

type UserEntitlementRow = {
  user_id: string;
  plan_code: UserTier;
  status: 'active' | 'inactive';
  granted_by: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  auto_renew: boolean;
};

type ModelRouteRow = {
  channel: AiChannel;
  plan_code: UserTier;
  primary_provider: string;
  primary_model: string;
  fallback_provider: string | null;
  fallback_model: string | null;
  enabled: boolean;
};

type UsageCountersRow = {
  user_id: string;
  period_start: string | null;
  period_end: string | null;
  text_requests_used_period: number;
  voice_seconds_used_period: number;
  text_requests_used_lifetime: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
};

export type ModelRoute = {
  provider: string;
  model: string;
  fallbackProvider?: string;
  fallbackModel?: string;
  modelTier: 'fast' | 'heavy';
};

export type GovernanceContext = {
  viewer: ViewerProfile;
  access: UsageAccessSummary;
  effectivePlan: PlanDefinitionRow;
  route: ModelRoute;
};

const DEFAULT_TIMEZONE = 'America/Bogota';
const DEFAULT_LOCALE = 'es-CO';

const ensureProfile = async (user: AuthenticatedUser): Promise<ProfileRow> => {
  const supabase = getSupabaseAdmin();
  const existing = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  const fullName =
    (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) ||
    (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()) ||
    user.email?.split('@')[0] ||
    'Tandeba User';
  const avatarUrl =
    (typeof user.user_metadata?.avatar_url === 'string' && user.user_metadata.avatar_url) || null;
  const email = user.email ?? '';

  if (existing.error) throw existing.error;

  if (existing.data) {
    const profile = existing.data as ProfileRow;
    if (
      profile.email !== email ||
      profile.full_name !== fullName ||
      profile.avatar_url !== avatarUrl
    ) {
      const update = await supabase
        .from('profiles')
        .update({
          email,
          full_name: fullName,
          avatar_url: avatarUrl,
        })
        .eq('id', user.id)
        .select('*')
        .single();

      if (update.error || !update.data) throw update.error ?? new Error('No fue posible actualizar el perfil.');
      return update.data as ProfileRow;
    }

    return profile;
  }

  const insert = await supabase
    .from('profiles')
    .insert({
      id: user.id,
      email,
      full_name: fullName,
      avatar_url: avatarUrl,
      timezone: DEFAULT_TIMEZONE,
      locale: DEFAULT_LOCALE,
      tier: 'free',
      account_status: 'active',
    })
    .select('*')
    .single();

  if (insert.error || !insert.data) {
    throw insert.error ?? new Error('No fue posible crear el perfil del usuario.');
  }

  return insert.data as ProfileRow;
};

const ensurePlannerState = async (userId: string): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const existing = await supabase
    .from('planner_states')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data) return;

  const insert = await supabase.from('planner_states').insert({
    user_id: userId,
    work_window: DEFAULT_PLANNER_STATE.workWindow,
    strategy: DEFAULT_PLANNER_STATE.strategy,
    schedule_base_date: new Date().toISOString(),
    diagnostics: null,
    current_revision_id: null,
  });

  if (insert.error) throw insert.error;
};

const ensureEntitlement = async (userId: string): Promise<UserEntitlementRow> => {
  const supabase = getSupabaseAdmin();
  const existing = await supabase
    .from('user_entitlements')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as UserEntitlementRow;

  const insert = await supabase
    .from('user_entitlements')
    .insert({
      user_id: userId,
      plan_code: 'free',
      status: 'active',
      granted_by: 'system',
      current_period_start: null,
      current_period_end: null,
      auto_renew: false,
    })
    .select('*')
    .single();

  if (insert.error || !insert.data) {
    throw insert.error ?? new Error('No fue posible crear el entitlement inicial.');
  }

  return insert.data as UserEntitlementRow;
};

const ensureUsageCounters = async (
  userId: string,
  effectivePlanCode: UserTier,
  entitlement: UserEntitlementRow,
): Promise<UsageCountersRow> => {
  const supabase = getSupabaseAdmin();
  const existing = await supabase
    .from('usage_counters')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing.error) throw existing.error;

  const targetPeriodStart = effectivePlanCode === 'premium' ? entitlement.current_period_start : null;
  const targetPeriodEnd = effectivePlanCode === 'premium' ? entitlement.current_period_end : null;

  if (!existing.data) {
    const insert = await supabase
      .from('usage_counters')
      .insert({
        user_id: userId,
        period_start: targetPeriodStart,
        period_end: targetPeriodEnd,
        text_requests_used_period: 0,
        voice_seconds_used_period: 0,
        text_requests_used_lifetime: 0,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
      })
      .select('*')
      .single();

    if (insert.error || !insert.data) {
      throw insert.error ?? new Error('No fue posible crear el contador de uso.');
    }

    return insert.data as UsageCountersRow;
  }

  const counters = existing.data as UsageCountersRow;
  if (
    counters.period_start !== targetPeriodStart ||
    counters.period_end !== targetPeriodEnd
  ) {
    const reset = await supabase
      .from('usage_counters')
      .update({
        period_start: targetPeriodStart,
        period_end: targetPeriodEnd,
        text_requests_used_period: 0,
        voice_seconds_used_period: 0,
      })
      .eq('user_id', userId)
      .select('*')
      .single();

    if (reset.error || !reset.data) {
      throw reset.error ?? new Error('No fue posible reiniciar el contador del periodo.');
    }

    return reset.data as UsageCountersRow;
  }

  return counters;
};

const loadPlanDefinition = async (planCode: UserTier): Promise<PlanDefinitionRow> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('plan_definitions')
    .select('*')
    .eq('code', planCode)
    .single();

  if (result.error || !result.data) {
    throw new Error(`No se encontró la definición del plan '${planCode}'.`);
  }

  return result.data as PlanDefinitionRow;
};

const loadRoute = async (planCode: UserTier, channel: AiChannel): Promise<ModelRoute | null> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('model_routes')
    .select('*')
    .eq('plan_code', planCode)
    .eq('channel', channel)
    .maybeSingle();

  if (result.error) throw result.error;
  if (!result.data) return null;

  const route = result.data as ModelRouteRow;
  if (!route.enabled) return null;

  return {
    provider: route.primary_provider,
    model: route.primary_model,
    fallbackProvider: route.fallback_provider ?? undefined,
    fallbackModel: route.fallback_model ?? undefined,
    modelTier: route.fallback_model ? 'fast' : 'heavy',
  };
};

export const resolveEffectivePlanCode = (
  entitlement: Pick<UserEntitlementRow, 'plan_code' | 'status' | 'current_period_end'>,
  now: Date,
): UserTier => {
  if (entitlement.status !== 'active') return 'free';
  if (entitlement.plan_code !== 'premium') return 'free';
  if (!entitlement.current_period_end) return 'free';
  return new Date(entitlement.current_period_end) > now ? 'premium' : 'free';
};

export const computeAccessSummary = (
  profileStatus: AccountStatus,
  plan: PlanDefinitionRow,
  usage: Pick<
    UsageCountersRow,
    'text_requests_used_lifetime' | 'text_requests_used_period' | 'voice_seconds_used_period' | 'period_start' | 'period_end'
  >,
): UsageAccessSummary => {
  const remainingTextLifetime =
    plan.lifetime_text_limit === null
      ? null
      : Math.max(plan.lifetime_text_limit - usage.text_requests_used_lifetime, 0);
  const remainingTextPeriod =
    plan.period_text_limit === null
      ? null
      : Math.max(plan.period_text_limit - usage.text_requests_used_period, 0);
  const remainingVoiceSeconds =
    plan.period_voice_minutes_limit === null
      ? null
      : Math.max(plan.period_voice_minutes_limit * 60 - usage.voice_seconds_used_period, 0);

  const textAllowed =
    profileStatus === 'active' &&
    plan.text_ai_enabled &&
    (remainingTextLifetime === null || remainingTextLifetime > 0) &&
    (remainingTextPeriod === null || remainingTextPeriod > 0);
  const voiceAllowed =
    profileStatus === 'active' &&
    plan.voice_ai_enabled &&
    (remainingVoiceSeconds === null || remainingVoiceSeconds > 0);

  return {
    planCode: plan.code,
    textAllowed,
    voiceAllowed,
    webSearchAllowed: profileStatus === 'active' && plan.web_search_enabled && textAllowed,
    remainingTextLifetime,
    remainingTextPeriod,
    remainingVoiceSeconds,
    currentPeriodStart: usage.period_start ?? undefined,
    currentPeriodEnd: usage.period_end ?? undefined,
  };
};

const syncTierIfNeeded = async (profile: ProfileRow, effectivePlanCode: UserTier): Promise<ProfileRow> => {
  if (profile.tier === effectivePlanCode) return profile;
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('profiles')
    .update({ tier: effectivePlanCode })
    .eq('id', profile.id)
    .select('*')
    .single();

  if (result.error || !result.data) {
    throw result.error ?? new Error('No fue posible sincronizar el tier del perfil.');
  }

  return result.data as ProfileRow;
};

export const ensureUserProvisioned = async (user: AuthenticatedUser): Promise<void> => {
  const profile = await ensureProfile(user);
  await Promise.all([ensurePlannerState(profile.id), ensureEntitlement(profile.id)]);
};

export const getGovernanceContext = async (
  user: AuthenticatedUser,
  channel?: AiChannel,
): Promise<GovernanceContext> => {
  await ensureUserProvisioned(user);
  const now = new Date();
  let profile = await ensureProfile(user);
  const entitlement = await ensureEntitlement(user.id);
  const effectivePlanCode = resolveEffectivePlanCode(entitlement, now);
  profile = await syncTierIfNeeded(profile, effectivePlanCode);
  const plan = await loadPlanDefinition(effectivePlanCode);
  const usage = await ensureUsageCounters(user.id, effectivePlanCode, entitlement);
  const access = computeAccessSummary(profile.account_status, plan, usage);
  const viewer: ViewerProfile = {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    avatarUrl: profile.avatar_url ?? undefined,
    tier: effectivePlanCode,
    accountStatus: profile.account_status,
  };

  let route: ModelRoute;
  if (channel) {
    route = await loadRoute(effectivePlanCode, channel);
    if (!route) {
      throw new Error(`No se encontró una ruta de modelo para plan '${effectivePlanCode}' y canal '${channel}'.`);
    }
  } else {
    // Default route for text channel
    const defaultRoute = await loadRoute(effectivePlanCode, 'text');
    if (!defaultRoute) {
      throw new Error(`No se encontró una ruta de modelo por defecto para plan '${effectivePlanCode}'.`);
    }
    route = defaultRoute;
  }

  return {
    viewer,
    access,
    effectivePlan: plan,
    route,
  };
};

export const assertChannelAccess = async (
  user: AuthenticatedUser,
  channel: AiChannel,
): Promise<GovernanceContext & { route: ModelRoute }> => {
  const context = await getGovernanceContext(user, channel);

  if (context.viewer.accountStatus !== 'active') {
    throw new HttpError(403, 'account_suspended', 'Tu cuenta no esta habilitada para usar Tandeba.');
  }

  if (channel === 'text' && !context.access.textAllowed) {
    throw new HttpError(402, 'text_quota_exceeded', 'Ya agotaste el uso de IA disponible en tu plan. Pásate a premium para seguir usando el asistente.');
  }

  if (channel === 'voice' && !context.access.voiceAllowed) {
    throw new HttpError(402, 'voice_not_available', 'La llamada de voz está disponible solo para cuentas premium con saldo vigente.');
  }

  return { ...context, route: context.route };
};

export const recordUsageEvent = async (params: {
  userId: string;
  channel: UsageChannel;
  route: ModelRoute;
  success: boolean;
  inputTokens?: number;
  outputTokens?: number;
  voiceSeconds?: number;
  estimatedCostUsd?: number;
  errorCode?: string | null;
  countAsTextRequest?: boolean;
}): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const inputTokens = params.inputTokens ?? 0;
  const outputTokens = params.outputTokens ?? 0;
  const voiceSeconds = params.voiceSeconds ?? 0;
  const estimatedCostUsd = params.estimatedCostUsd ?? 0;
  const countAsTextRequest =
    params.countAsTextRequest ?? (params.channel === 'text');

  const insertEvent = await supabase.from('usage_events').insert({
    user_id: params.userId,
    channel: params.channel,
    provider: params.route.provider,
    model: params.route.model,
    success: params.success,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    voice_seconds: voiceSeconds,
    estimated_cost_usd: estimatedCostUsd,
    error_code: params.errorCode ?? null,
  });

  if (insertEvent.error) throw insertEvent.error;
  if (!params.success) return;

  const countersResult = await supabase
    .from('usage_counters')
    .select('*')
    .eq('user_id', params.userId)
    .single();

  if (countersResult.error || !countersResult.data) {
    throw countersResult.error ?? new Error('No se encontraron contadores de uso para el usuario.');
  }

  const counters = countersResult.data as UsageCountersRow;
  const update = await supabase
    .from('usage_counters')
    .update({
      text_requests_used_period:
        counters.text_requests_used_period + (countAsTextRequest ? 1 : 0),
      voice_seconds_used_period:
        counters.voice_seconds_used_period + (params.channel === 'voice' ? voiceSeconds : 0),
      text_requests_used_lifetime:
        counters.text_requests_used_lifetime + (countAsTextRequest ? 1 : 0),
      input_tokens: counters.input_tokens + inputTokens,
      output_tokens: counters.output_tokens + outputTokens,
      estimated_cost_usd: Number(counters.estimated_cost_usd) + estimatedCostUsd,
    })
    .eq('user_id', params.userId);

  if (update.error) throw update.error;
};
