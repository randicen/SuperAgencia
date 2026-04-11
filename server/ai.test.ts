import { describe, expect, it } from 'vitest';
import { __plannerReadModel } from './ai.js';

describe('planner read model routing', () => {
  it('summarizes today using the client day anchor instead of server now', () => {
    const summary = __plannerReadModel.summarizeScheduleForRelativeDay(
      'que tengo para hoy',
      [
        {
          id: 'gym',
          name: 'Gym',
          duration: 60,
          start: 8 * 60,
          end: 9 * 60,
        },
        {
          id: 'docs',
          name: 'Organizar documentos',
          duration: 120,
          start: 24 * 60 + 10 * 60,
          end: 24 * 60 + 12 * 60,
        },
      ],
      '2026-04-08T00:00:00',
      '2026-04-08T00:00:00',
    );

    expect(summary).toContain('Hoy');
    expect(summary).toContain('Gym');
    expect(summary).not.toContain('Organizar documentos');
  });

  it('summarizes tomorrow using the client day anchor', () => {
    const summary = __plannerReadModel.summarizeScheduleForRelativeDay(
      'y manana?',
      [
        {
          id: 'gym',
          name: 'Gym',
          duration: 60,
          start: 24 * 60 + 8 * 60,
          end: 24 * 60 + 9 * 60,
        },
        {
          id: 'docs',
          name: 'Organizar documentos',
          duration: 120,
          start: 24 * 60 + 9 * 60,
          end: 24 * 60 + 11 * 60,
        },
      ],
      '2026-04-08T00:00:00',
      '2026-04-08T00:00:00',
    );

    expect(summary).toContain('Mañana');
    expect(summary).toContain('Gym');
    expect(summary).toContain('Organizar documentos');
  });
});
