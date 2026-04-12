import { describe, expect, it } from 'vitest';

import { __openRouterMutationModel } from './ai.js';

describe('OpenRouter mutation normalization', () => {
  it('inherits temporal context from the recent user turn when confirmation omits the date', () => {
    const now = new Date('2026-04-12T09:00:00');
    const fallbackDate = __openRouterMutationModel.inferConversationDateAnchor(
      'si agrega',
      [
        { role: 'user', text: 'cardio hoy 3pm' },
        { role: 'model', text: 'Si deseas agregar cardio a las 3:00 PM, confirma tu intención.' },
      ],
      now,
    );

    expect(fallbackDate?.toISOString().slice(0, 10)).toBe('2026-04-12');

    const normalized = __openRouterMutationModel.normalizeOpenRouterPayload(
      {
        assistantMessage: 'Agregado cardio a las 3:00 PM.',
        tasks: [],
        dependencies: [],
        calendarEvents: [
          {
            id: 'cardio_3pm',
            startTime: '15:00',
            endTime: '16:00',
            title: 'Cardio',
          },
        ],
        removedTaskIds: [],
        removedCalendarEventIds: [],
      },
      now,
      fallbackDate,
    );

    expect(normalized.calendarEvents[0]?.startDateTime).toBe('2026-04-12T15:00:00');
    expect(normalized.calendarEvents[0]?.endDateTime).toBe('2026-04-12T16:00:00');

    const parsed = __openRouterMutationModel.parseModelMutations(
      'si agrega',
      normalized.tasks,
      normalized.calendarEvents,
      normalized.dependencies,
      [],
      [],
      [],
      [],
      [],
      now,
    );

    expect(parsed.newCalendarEvents).toHaveLength(1);
    expect(parsed.newCalendarEvents[0]?.start).toBe(900);
    expect(parsed.newCalendarEvents[0]?.end).toBe(960);
  });

  it('normalizes calendar events returned with fixedStartDateTime and duration', () => {
    const now = new Date('2026-04-12T09:00:00');

    const normalized = __openRouterMutationModel.normalizeOpenRouterPayload(
      {
        assistantMessage: 'He agregado cardio para hoy a las 3:00 PM.',
        tasks: [],
        dependencies: [],
        calendarEvents: [
          {
            id: 'cardio_20260412_1500',
            name: 'cardio',
            fixedStartDateTime: '2026-04-12T15:00:00',
            duration: '01:00:00',
            priority: 'Normal',
            deadlineType: 'None',
            progress: '0.0',
          },
        ],
        removedTaskIds: [],
        removedCalendarEventIds: [],
      },
      now,
      now,
    );

    expect(normalized.calendarEvents[0]).toMatchObject({
      title: 'cardio',
      startDateTime: '2026-04-12T15:00:00',
      endDateTime: '2026-04-12T16:00:00',
    });

    const parsed = __openRouterMutationModel.parseModelMutations(
      'agregalo yaaa',
      normalized.tasks,
      normalized.calendarEvents,
      normalized.dependencies,
      [],
      [],
      [],
      [],
      [],
      now,
    );

    expect(parsed.newCalendarEvents).toHaveLength(1);
    expect(parsed.newCalendarEvents[0]).toMatchObject({
      title: 'cardio',
      start: 900,
      end: 960,
    });
  });
});
