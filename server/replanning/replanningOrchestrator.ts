import { differenceInMinutes, parseISO, startOfDay } from 'date-fns';
import type { PlannerState, ReplanningImpactSummary } from '../../src/lib/plannerState.js';
import type { CalendarEvent, ScheduledTask, Task } from '../../src/lib/solver.js';
import { DEFAULT_INTELLIGENT_CONFIG, solveSchedule } from '../../src/lib/solver.js';
import type { AuthenticatedUser } from '../auth.js';
import { sendReplanningEmail } from '../notifications/email.js';
import { loadPlannerState, recordScheduleRun, runPlannerWriteExclusive, savePlannerState } from '../state.js';
import { detectCalendarReplanningTrigger, detectInternalReplanningTriggers } from './changeDetection.js';
import { syncCalendarConnection } from './calendarConnectors.js';
import { evaluateReplanningGuardrails } from './guardrails.js';
import { evaluateReplanningPolicy } from './policyEngine.js';
import {
  createReplanningEvent,
  getReplanningEventById,
  getCalendarConnectionsForUser,
  listRecentEventHashes,
  loadReplanningBundleForUser,
  updateReplanningEvent,
} from './store.js';
import type {
  CalendarProvider,
  OrchestratorUser,
  ReplanningExecutionResult,
  ReplanningProfileSettings,
  ReplanningTrigger,
} from './types.js';

const toSyntheticUser = (user: OrchestratorUser): AuthenticatedUser => ({
  id: user.id,
  externalAuthId: user.id,
  email: user.email,
  user_metadata: {
    full_name: user.fullName,
    name: user.fullName,
    avatar_url: user.avatarUrl ?? undefined,
  },
});

const getNowMinutes = (state: PlannerState, now: Date): number =>
  differenceInMinutes(now, startOfDay(parseISO(state.scheduleBaseDate)));

const freezeStartedTasks = (
  tasks: Task[],
  schedule: ScheduledTask[] | null,
  nowMinutes: number,
): Task[] => {
  const scheduled = new Map((schedule ?? []).map((entry) => [entry.id, entry]));
  return tasks.map((task) => {
    const current = scheduled.get(task.id);
    if (!current) return task;
    if (current.start <= nowMinutes && current.end > nowMinutes) {
      return {
        ...task,
        fixedStart: current.start,
        minStart: current.start,
      };
    }
    return task;
  });
};

const computeImpactSummary = (
  previousSchedule: ScheduledTask[] | null,
  nextSchedule: ScheduledTask[] | null,
  nowMinutes: number,
): ReplanningImpactSummary => {
  const previousMap = new Map((previousSchedule ?? []).map((entry) => [entry.id, entry]));
  const nextMap = new Map((nextSchedule ?? []).map((entry) => [entry.id, entry]));
  let movedTaskCount = 0;
  let totalDisplacedMinutes = 0;
  let touchesFixedStart = false;
  let touchesCritical = false;
  let pushedOutsideCurrentDay = false;

  for (const [id, previous] of previousMap.entries()) {
    const next = nextMap.get(id);
    if (!next) continue;
    const displacement = Math.abs(next.start - previous.start);
    if (displacement > 0) {
      movedTaskCount += 1;
      totalDisplacedMinutes += displacement;
      if (previous.fixedStart !== undefined) touchesFixedStart = true;
      if (previous.priority === 'ASAP' || previous.priority === 'high') touchesCritical = true;
      if (previous.start < 1440 && next.start >= 1440) pushedOutsideCurrentDay = true;
    }
  }

  const createdNewRisk = (nextSchedule ?? []).some(
    (entry) => entry.deadline !== undefined && entry.end > entry.deadline,
  );

  return {
    movedTaskCount,
    totalDisplacedMinutes,
    touchesFixedStart,
    touchesCritical,
    pushedOutsideCurrentDay,
    createdNewRisk: createdNewRisk || nowMinutes > 0 && (nextSchedule ?? []).length === 0,
  };
};

const mergeProviderCalendarEvents = (
  calendarEvents: CalendarEvent[],
  provider: CalendarProvider,
  snapshot: CalendarEvent[],
): CalendarEvent[] => [
  ...calendarEvents.filter((event) => event.sourceProvider !== provider),
  ...snapshot,
];

const notifyOutcome = async (
  user: OrchestratorUser,
  settings: ReplanningProfileSettings,
  trigger: ReplanningTrigger,
  result: ReplanningExecutionResult,
): Promise<string | null> => {
  if (!settings.emailNotificationsEnabled) return null;

  const emailType =
    result.decision === 'applied'
      ? 'replanning_applied'
      : result.decision === 'suggested'
        ? 'replanning_suggested'
        : result.decision === 'failed'
          ? 'replanning_failed'
          : 'replanning_ignored_due_to_guardrails';

  const delivery = await sendReplanningEmail({
    to: user.email,
    fullName: user.fullName,
    emailType,
    trigger,
    reason: result.reason,
    impactSummary: result.impactSummary,
  });

  return delivery.id;
};

export const executeReplanningTrigger = async (
  user: OrchestratorUser,
  trigger: ReplanningTrigger,
  candidateState?: PlannerState,
): Promise<ReplanningExecutionResult> => {
  return runPlannerWriteExclusive(user.id, async () => {
    const settings = (await loadReplanningBundleForUser(user.id)).settings;
    const liveState = await loadPlannerState(toSyntheticUser(user));
    let currentState = candidateState ?? liveState;
    const now = new Date();
    const calendarStateChanged =
      JSON.stringify(currentState.calendarEvents) !== JSON.stringify(liveState.calendarEvents);

    if (candidateState && calendarStateChanged) {
      currentState = await savePlannerState(toSyntheticUser(user), {
        ...liveState,
        calendarEvents: currentState.calendarEvents,
        schedule: liveState.schedule,
        diagnostics: liveState.diagnostics,
        scheduleBaseDate: liveState.scheduleBaseDate,
      });
    }

    const nowMinutes = getNowMinutes(currentState, now);
    const recentEvents = await listRecentEventHashes(user.id);

    const protectedTasks = freezeStartedTasks(currentState.tasks, currentState.schedule, nowMinutes);
    const preview = solveSchedule(
      protectedTasks,
      currentState.dependencies,
      currentState.calendarEvents,
      currentState.workWindow,
      currentState.strategy,
      nowMinutes,
      7,
      15,
      currentState.schedule ?? undefined,
      DEFAULT_INTELLIGENT_CONFIG,
      now.getDay(),
    );

    const impact = computeImpactSummary(currentState.schedule, preview.schedule, nowMinutes);
    const guardrail = evaluateReplanningGuardrails(trigger, recentEvents, impact, now);
    const beforeRevisionId = currentState.history?.currentRevisionId ?? null;

    if (!guardrail.allow) {
      const reason = (guardrail as { allow: false; reason: string }).reason;
      const event = await createReplanningEvent({
        userId: user.id,
        triggerType: trigger.type,
        triggerSource: trigger.source,
        triggerHash: trigger.hash,
        decision: 'ignored',
        status: 'ignored',
        outcomeReason: reason,
        impactSummary: impact,
        triggerPayload: trigger.payload ?? {},
        suggestedSnapshot: null,
        beforeRevisionId,
        afterRevisionId: null,
      });
      const deliveryId = await notifyOutcome(user, settings, trigger, {
        decision: 'ignored',
        status: 'ignored',
        reason,
        impactSummary: impact,
      });
      if (deliveryId) {
        await updateReplanningEvent(event.id, {
          notificationDeliveryId: deliveryId,
          notifiedAt: new Date().toISOString(),
        });
      }
      return {
        decision: 'ignored',
        status: 'ignored',
        reason,
        impactSummary: impact,
      };
    }

    const decision = evaluateReplanningPolicy(currentState, trigger, settings, impact);
    if (decision.kind === 'ignore') {
      const event = await createReplanningEvent({
        userId: user.id,
        triggerType: trigger.type,
        triggerSource: trigger.source,
        triggerHash: trigger.hash,
        decision: 'ignored',
        status: 'ignored',
        outcomeReason: decision.reason,
        impactSummary: impact,
        triggerPayload: trigger.payload ?? {},
        suggestedSnapshot: null,
        beforeRevisionId,
        afterRevisionId: null,
      });
      const deliveryId = await notifyOutcome(user, settings, trigger, {
        decision: 'ignored',
        status: 'ignored',
        reason: decision.reason,
        impactSummary: impact,
      });
      if (deliveryId) {
        await updateReplanningEvent(event.id, {
          notificationDeliveryId: deliveryId,
          notifiedAt: new Date().toISOString(),
        });
      }
      return { decision: 'ignored', status: 'ignored', reason: decision.reason, impactSummary: impact };
    }

    if (decision.kind === 'suggest') {
      const suggestedSnapshot: PlannerState = {
        ...currentState,
        tasks: protectedTasks,
        schedule: preview.schedule,
        diagnostics: preview.diagnostics ?? null,
      };
      const event = await createReplanningEvent({
        userId: user.id,
        triggerType: trigger.type,
        triggerSource: trigger.source,
        triggerHash: trigger.hash,
        decision: 'suggested',
        status: 'open',
        outcomeReason: decision.reason,
        impactSummary: impact,
        triggerPayload: trigger.payload ?? {},
        suggestedSnapshot,
        beforeRevisionId,
        afterRevisionId: null,
      });
      const deliveryId = await notifyOutcome(user, settings, trigger, {
        decision: 'suggested',
        status: 'open',
        reason: decision.reason,
        impactSummary: impact,
      });
      if (deliveryId) {
        await updateReplanningEvent(event.id, {
          notificationDeliveryId: deliveryId,
          notifiedAt: new Date().toISOString(),
        });
      }
      return { decision: 'suggested', status: 'open', reason: decision.reason, impactSummary: impact };
    }

    const saved = await savePlannerState(toSyntheticUser(user), {
      ...currentState,
      tasks: protectedTasks,
      schedule: preview.schedule,
      diagnostics: preview.diagnostics ?? null,
      scheduleBaseDate: currentState.scheduleBaseDate,
    });

    await recordScheduleRun(toSyntheticUser(user), {
      strategy: saved.strategy,
      taskCount: saved.tasks.length,
      score: impact.totalDisplacedMinutes === 0 ? 0 : Math.max(1, 1000 - impact.totalDisplacedMinutes),
      status:
        (preview.diagnostics as { status?: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'TIMEOUT' | 'INVALID_INPUT' } | null)
          ?.status ?? 'FEASIBLE',
      diagnostics: preview.diagnostics ?? null,
      schedule: saved.schedule ?? [],
      configUsed: DEFAULT_INTELLIGENT_CONFIG,
    });

    const event = await createReplanningEvent({
      userId: user.id,
      triggerType: trigger.type,
      triggerSource: trigger.source,
      triggerHash: trigger.hash,
      decision: 'applied',
      status: 'applied',
      outcomeReason: decision.reason,
      impactSummary: impact,
      triggerPayload: trigger.payload ?? {},
      suggestedSnapshot: null,
      beforeRevisionId,
      afterRevisionId: saved.history?.currentRevisionId ?? null,
    });
    const deliveryId = await notifyOutcome(user, settings, trigger, {
      decision: 'applied',
      status: 'applied',
      reason: decision.reason,
      impactSummary: impact,
      state: saved,
    });
    if (deliveryId) {
      await updateReplanningEvent(event.id, {
        notificationDeliveryId: deliveryId,
        notifiedAt: new Date().toISOString(),
      });
    }

    return {
      decision: 'applied',
      status: 'applied',
      reason: decision.reason,
      impactSummary: impact,
      state: saved,
    };
  });
};

export const processCalendarSyncForProvider = async (
  user: OrchestratorUser,
  provider: CalendarProvider,
): Promise<ReplanningExecutionResult | null> => {
  const currentState = await loadPlannerState(toSyntheticUser(user));
  const currentProviderEvents = currentState.calendarEvents.filter((event) => event.sourceProvider === provider);
  const syncResult = await syncCalendarConnection(user, provider, currentState.scheduleBaseDate, currentProviderEvents);
  if (!syncResult || syncResult.deltas.length === 0) return null;

  const mergedState: PlannerState = {
    ...currentState,
    calendarEvents: mergeProviderCalendarEvents(currentState.calendarEvents, provider, syncResult.snapshot),
  };

  const trigger = detectCalendarReplanningTrigger(provider, syncResult.deltas, new Date());
  if (!trigger) return null;
  return executeReplanningTrigger(user, trigger, mergedState);
};

export const processInternalReplanning = async (
  user: OrchestratorUser,
): Promise<ReplanningExecutionResult[]> => {
  const currentState = await loadPlannerState(toSyntheticUser(user));
  const triggers = detectInternalReplanningTriggers(currentState, new Date());
  const results: ReplanningExecutionResult[] = [];

  for (const trigger of triggers) {
    results.push(await executeReplanningTrigger(user, trigger, currentState));
  }

  return results;
};

export const acceptReplanningSuggestion = async (
  user: OrchestratorUser,
  eventId: string,
): Promise<PlannerState> => {
  const event = await getReplanningEventById(user.id, eventId);
  if (!event || !event.suggestedSnapshot) {
    throw new Error('No existe una sugerencia pendiente para aceptar.');
  }
  const saved = await savePlannerState(toSyntheticUser(user), event.suggestedSnapshot);
  await updateReplanningEvent(eventId, {
    status: 'accepted',
    decision: 'applied',
    afterRevisionId: saved.history?.currentRevisionId ?? null,
    suggestedSnapshot: null,
  });
  return saved;
};

export const rejectReplanningSuggestion = async (
  userId: string,
  eventId: string,
): Promise<void> => {
  const event = await getReplanningEventById(userId, eventId);
  if (!event) throw new Error('No existe esa sugerencia.');
  await updateReplanningEvent(eventId, {
    status: 'rejected',
  });
};

export const processAutonomousReplanningForUser = async (user: OrchestratorUser): Promise<void> => {
  const connections = await getCalendarConnectionsForUser(user.id);
  for (const connection of connections) {
    if (connection.connected) {
      await processCalendarSyncForProvider(user, connection.provider);
    }
  }
  await processInternalReplanning(user);
};
