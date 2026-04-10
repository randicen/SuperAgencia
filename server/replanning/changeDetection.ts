import { createHash } from 'node:crypto';
import { differenceInMinutes, parseISO, startOfDay } from 'date-fns';
import type { PlannerState } from '../../src/lib/plannerState.js';
import type {
  CalendarProvider,
  ExternalCalendarDelta,
  ReplanningTrigger,
  ReplanningTriggerType,
} from './types.js';

const hashPayload = (value: string) => createHash('sha256').update(value).digest('hex');

const toNowMinutes = (state: PlannerState, now: Date): number =>
  differenceInMinutes(now, startOfDay(parseISO(state.scheduleBaseDate)));

const remainingWorkMinutes = (duration: number, progress = 0) =>
  Math.max(0, Math.round(duration * ((100 - Math.min(100, Math.max(0, progress))) / 100)));

export const detectInternalReplanningTriggers = (
  state: PlannerState,
  now: Date,
): ReplanningTrigger[] => {
  const triggers: ReplanningTrigger[] = [];
  const nowMinutes = toNowMinutes(state, now);
  const ongoingTaskIds = new Set(
    (state.schedule ?? [])
      .filter((entry) => entry.start <= nowMinutes && entry.end > nowMinutes)
      .map((entry) => entry.id),
  );

  const atRiskTasks = state.tasks.filter((task) => {
    if (task.deadline === undefined || (task.progress ?? 0) >= 100) return false;
    const remaining = remainingWorkMinutes(task.duration, task.progress);
    const slack = task.deadline - nowMinutes - remaining;
    return slack >= 0 && slack <= 120;
  });

  const missedTasks = state.tasks.filter(
    (task) =>
      task.deadline !== undefined &&
      task.deadline <= nowMinutes &&
      (task.progress ?? 0) < 100,
  );

  const expiredBlocks = (state.schedule ?? []).filter(
    (entry) => entry.end < nowMinutes && (entry.progress ?? 0) < 100 && !ongoingTaskIds.has(entry.id),
  );

  if (atRiskTasks.length > 0) {
    const summary = atRiskTasks.map((task) => task.id).sort().join(',');
    triggers.push({
      type: 'task_deadline_risk',
      source: 'internal',
      hash: hashPayload(`risk:${summary}:${Math.floor(nowMinutes / 30)}`),
      summary: `Tandeba detecto riesgo de incumplimiento en ${atRiskTasks.length} tarea(s).`,
      detectedAt: now.toISOString(),
      payload: {
        taskIds: atRiskTasks.map((task) => task.id),
      },
    });
  }

  if (missedTasks.length > 0) {
    const summary = missedTasks.map((task) => task.id).sort().join(',');
    triggers.push({
      type: 'task_missed',
      source: 'internal',
      hash: hashPayload(`missed:${summary}:${Math.floor(nowMinutes / 30)}`),
      summary: `Tandeba detecto ${missedTasks.length} tarea(s) vencidas sin completar.`,
      detectedAt: now.toISOString(),
      payload: {
        taskIds: missedTasks.map((task) => task.id),
      },
    });
  }

  if (expiredBlocks.length > 0) {
    const summary = expiredBlocks.map((entry) => entry.id).sort().join(',');
    triggers.push({
      type: 'planned_block_expired',
      source: 'internal',
      hash: hashPayload(`expired:${summary}:${Math.floor(nowMinutes / 60)}`),
      summary: `Tandeba detecto bloques planificados que ya quedaron atras.`,
      detectedAt: now.toISOString(),
      payload: {
        taskIds: expiredBlocks.map((entry) => entry.id),
      },
    });
  }

  if (atRiskTasks.length > 0 || missedTasks.length > 0) {
    triggers.push({
      type: 'schedule_margin_breach',
      source: 'internal',
      hash: hashPayload(
        `margin:${[...atRiskTasks.map((task) => task.id), ...missedTasks.map((task) => task.id)].sort().join(',')}:${Math.floor(nowMinutes / 30)}`,
      ),
      summary: 'Tandeba detecto que el margen actual del dia ya no es suficiente.',
      detectedAt: now.toISOString(),
      payload: {
        atRiskTaskIds: atRiskTasks.map((task) => task.id),
        missedTaskIds: missedTasks.map((task) => task.id),
      },
    });
  }

  return triggers;
};

const mapProviderToSource = (provider: CalendarProvider): ReplanningTrigger['source'] =>
  provider === 'google' ? 'google_calendar' : 'outlook_calendar';

const mapDeltasToType = (deltas: ExternalCalendarDelta[]): ReplanningTriggerType => {
  if (deltas.some((delta) => delta.action === 'deleted')) return 'calendar_event_deleted';
  if (deltas.some((delta) => delta.action === 'created')) return 'calendar_event_created';
  return 'calendar_event_updated';
};

export const detectCalendarReplanningTrigger = (
  provider: CalendarProvider,
  deltas: ExternalCalendarDelta[],
  now: Date,
): ReplanningTrigger | null => {
  if (deltas.length === 0) return null;
  const ids = deltas
    .map((delta) => `${delta.action}:${delta.externalEventId}:${delta.start ?? ''}:${delta.end ?? ''}`)
    .sort()
    .join('|');

  return {
    type: mapDeltasToType(deltas),
    source: mapProviderToSource(provider),
    hash: hashPayload(`${provider}:${ids}`),
    summary: `Se detectaron ${deltas.length} cambio(s) en ${provider === 'google' ? 'Google Calendar' : 'Outlook'}.`,
    detectedAt: now.toISOString(),
    deltas,
    payload: {
      provider,
      count: deltas.length,
    },
  };
};
