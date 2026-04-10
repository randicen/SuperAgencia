import type { PlannerState } from '../../src/lib/plannerState.js';
import type { ReplanningDecision, ReplanningProfileSettings, ReplanningTrigger } from './types.js';
import type { ReplanningImpactSummary } from '../../src/lib/plannerState.js';

export const evaluateReplanningPolicy = (
  _state: PlannerState,
  trigger: ReplanningTrigger,
  settings: ReplanningProfileSettings,
  impact: ReplanningImpactSummary,
): ReplanningDecision => {
  if (impact.movedTaskCount === 0 && trigger.source === 'internal') {
    return { kind: 'ignore', reason: 'No habia tareas que mover tras evaluar el trigger interno.' };
  }

  if (settings.mode === 'suggest_only') {
    return { kind: 'suggest', reason: 'El usuario configuro Tandeba para solo sugerir cambios.' };
  }

  if (settings.mode === 'automatic') {
    return { kind: 'apply_and_notify', reason: 'El usuario permitio replanificacion totalmente automatica.' };
  }

  const isLowImpact =
    impact.movedTaskCount <= 2 &&
    impact.totalDisplacedMinutes <= 90 &&
    !impact.touchesFixedStart &&
    !impact.touchesCritical &&
    !impact.pushedOutsideCurrentDay &&
    !impact.createdNewRisk;

  if (isLowImpact) {
    return {
      kind: 'apply_and_notify',
      reason: 'El cambio fue de bajo impacto y entra dentro del modo semi-automatico.',
    };
  }

  return {
    kind: 'suggest',
    reason: 'El cambio supera el umbral de autoaplicacion del modo semi-automatico.',
  };
};
