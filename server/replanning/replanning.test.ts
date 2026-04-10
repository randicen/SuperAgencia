import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANNER_STATE } from '../../src/lib/plannerState.js';
import { detectCalendarReplanningTrigger, detectInternalReplanningTriggers } from './changeDetection.js';
import { evaluateReplanningGuardrails } from './guardrails.js';
import { evaluateReplanningPolicy } from './policyEngine.js';

describe('detectInternalReplanningTriggers', () => {
  it('detects overdue tasks and deadline risk', () => {
    const state = {
      ...DEFAULT_PLANNER_STATE,
      scheduleBaseDate: '2026-04-08T00:00:00-05:00',
      tasks: [
        { id: 'risk', name: 'Riesgo', duration: 60, deadline: 630, progress: 0 },
        { id: 'missed', name: 'Vencida', duration: 60, deadline: 540, progress: 0 },
      ],
    };

    const triggers = detectInternalReplanningTriggers(state, new Date('2026-04-08T09:30:00-05:00'));
    expect(triggers.map((trigger) => trigger.type)).toContain('task_deadline_risk');
    expect(triggers.map((trigger) => trigger.type)).toContain('task_missed');
  });
});

describe('detectCalendarReplanningTrigger', () => {
  it('aggregates external calendar deltas into one trigger', () => {
    const trigger = detectCalendarReplanningTrigger(
      'google',
      [
        {
          provider: 'google',
          action: 'created',
          externalEventId: 'abc',
          title: 'Reunión',
          start: '2026-04-08T14:00:00.000Z',
          end: '2026-04-08T15:00:00.000Z',
        },
      ],
      new Date('2026-04-08T10:00:00.000Z'),
    );

    expect(trigger?.source).toBe('google_calendar');
    expect(trigger?.type).toBe('calendar_event_created');
  });
});

describe('evaluateReplanningPolicy', () => {
  const impact = {
    movedTaskCount: 1,
    totalDisplacedMinutes: 45,
    touchesFixedStart: false,
    touchesCritical: false,
    pushedOutsideCurrentDay: false,
    createdNewRisk: false,
  };

  it('auto-applies low impact changes in semi-automatic mode', () => {
    const decision = evaluateReplanningPolicy(
      DEFAULT_PLANNER_STATE,
      {
        type: 'calendar_event_updated',
        source: 'google_calendar',
        hash: 'x',
        summary: 'Cambio',
        detectedAt: new Date().toISOString(),
      },
      {
        mode: 'semi_automatic',
        googleCalendarEnabled: true,
        outlookCalendarEnabled: false,
        internalRiskDetectionEnabled: true,
        emailNotificationsEnabled: true,
      },
      impact,
    );

    expect(decision.kind).toBe('apply_and_notify');
  });

  it('suggests changes in suggest-only mode', () => {
    const decision = evaluateReplanningPolicy(
      DEFAULT_PLANNER_STATE,
      {
        type: 'calendar_event_updated',
        source: 'google_calendar',
        hash: 'x',
        summary: 'Cambio',
        detectedAt: new Date().toISOString(),
      },
      {
        mode: 'suggest_only',
        googleCalendarEnabled: true,
        outlookCalendarEnabled: false,
        internalRiskDetectionEnabled: true,
        emailNotificationsEnabled: true,
      },
      impact,
    );

    expect(decision.kind).toBe('suggest');
  });
});

describe('evaluateReplanningGuardrails', () => {
  it('blocks duplicate trigger hashes in a short window', () => {
    const result = evaluateReplanningGuardrails(
      {
        type: 'task_missed',
        source: 'internal',
        hash: 'same',
        summary: 'test',
        detectedAt: new Date('2026-04-08T10:10:00.000Z').toISOString(),
      },
      [
        {
          id: '1',
          triggerHash: 'same',
          decision: 'applied',
          status: 'applied',
          createdAt: '2026-04-08T10:00:00.000Z',
        },
      ],
      {
        movedTaskCount: 2,
        totalDisplacedMinutes: 60,
        touchesFixedStart: false,
        touchesCritical: false,
        pushedOutsideCurrentDay: false,
        createdNewRisk: false,
      },
      new Date('2026-04-08T10:10:00.000Z'),
    );

    expect(result.allow).toBe(false);
  });
});
