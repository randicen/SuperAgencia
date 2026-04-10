import { describe, expect, it } from 'vitest';
import { mergeCalendarEvents, mergeDependencies, mergeTasks } from './scheduleMutationPolicy.js';

describe('mergeTasks', () => {
  it('removes explicitly deleted task ids while preserving unrelated tasks', () => {
    const currentTasks = [
      { id: 'gym_task_001', name: 'Gym', duration: 60 },
      { id: 'docs_task_001', name: 'Organizar documentos', duration: 120 },
    ];

    const result = mergeTasks(currentTasks, [{ id: 'gym_task_001', name: 'Gym', duration: 60 }], ['docs_task_001']);

    expect(result).toEqual([{ id: 'gym_task_001', name: 'Gym', duration: 60 }]);
  });
});

describe('mergeCalendarEvents', () => {
  it('removes explicitly deleted calendar events', () => {
    const currentEvents = [
      { id: 'event_1', title: 'Reunion', start: 60, end: 120, kind: 'meeting' as const },
      { id: 'event_2', title: 'Bloqueo', start: 180, end: 240, kind: 'blocked' as const },
    ];

    const result = mergeCalendarEvents(currentEvents, [], ['event_2']);

    expect(result).toEqual([{ id: 'event_1', title: 'Reunion', start: 60, end: 120, kind: 'meeting' }]);
  });
});

describe('mergeDependencies', () => {
  it('prunes dependencies that reference removed tasks', () => {
    const tasks = [{ id: 'gym_task_001', name: 'Gym', duration: 60 }];
    const result = mergeDependencies(
      [{ fromId: 'gym_task_001', toId: 'docs_task_001' }],
      [],
      tasks,
    );

    expect(result).toEqual([]);
  });
});
