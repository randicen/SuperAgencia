import { differenceInMinutes, parseISO } from 'date-fns';
import type { ReplanningImpactSummary } from '../../src/lib/plannerState.js';
import type { ReplanningRecentEvent, ReplanningTrigger } from './types.js';

type GuardrailResult =
  | { allow: true }
  | { allow: false; reason: string };

const DUPLICATE_MINUTES = 15;
const COOLDOWN_MINUTES = 5;

export const evaluateReplanningGuardrails = (
  trigger: ReplanningTrigger,
  recentEvents: ReplanningRecentEvent[],
  impact: ReplanningImpactSummary,
  now: Date,
): GuardrailResult => {
  const duplicate = recentEvents.find(
    (event) =>
      event.triggerHash === trigger.hash &&
      differenceInMinutes(now, parseISO(event.createdAt)) <= DUPLICATE_MINUTES,
  );
  if (duplicate) {
    return {
      allow: false,
      reason: 'Se ignoro un trigger duplicado reciente para evitar cascadas.',
    };
  }

  const cooldown = recentEvents.find(
    (event) =>
      (event.decision === 'applied' || event.decision === 'suggested') &&
      differenceInMinutes(now, parseISO(event.createdAt)) <= COOLDOWN_MINUTES,
  );
  if (cooldown) {
    return {
      allow: false,
      reason: 'Tandeba entro en cooldown para evitar replanificaciones demasiado seguidas.',
    };
  }

  if (
    impact.movedTaskCount === 0 &&
    impact.totalDisplacedMinutes === 0 &&
    !impact.createdNewRisk
  ) {
    return {
      allow: false,
      reason: 'El cambio detectado fue trivial y no amerita replanificacion.',
    };
  }

  return { allow: true };
};
