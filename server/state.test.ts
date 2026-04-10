import { describe, expect, it } from 'vitest';
import {
  hasPlannerContent,
  isSuspiciousEmptyOverwrite,
  normalizePlannerStateForPersistence,
  runPlannerWriteExclusive,
} from './state.js';
import { DEFAULT_PLANNER_STATE } from '../src/lib/plannerState.js';

describe('normalizePlannerStateForPersistence', () => {
  it('keeps only the last task for duplicate ids and prunes invalid dependencies', () => {
    const normalized = normalizePlannerStateForPersistence({
      ...DEFAULT_PLANNER_STATE,
      tasks: [
        { id: 'gym_task_001', name: 'Gym viejo', duration: 60 },
        { id: 'paper_task_001', name: 'Paper', duration: 90 },
        { id: 'gym_task_001', name: 'Gym actualizado', duration: 120 },
      ],
      dependencies: [
        { fromId: 'gym_task_001', toId: 'paper_task_001' },
        { fromId: 'gym_task_001', toId: 'paper_task_001' },
        { fromId: 'paper_task_001', toId: 'missing_task' },
        { fromId: 'gym_task_001', toId: 'gym_task_001' },
      ],
      schedule: [
        { id: 'gym_task_001', name: 'Gym viejo', duration: 60, start: 60, end: 120 },
        { id: 'gym_task_001', name: 'Gym actualizado', duration: 120, start: 180, end: 300 },
      ],
    });

    expect(normalized.tasks).toEqual([
      { id: 'paper_task_001', name: 'Paper', duration: 90 },
      { id: 'gym_task_001', name: 'Gym actualizado', duration: 120 },
    ]);
    expect(normalized.dependencies).toEqual([{ fromId: 'gym_task_001', toId: 'paper_task_001' }]);
    expect(normalized.schedule).toHaveLength(2);
  });
});

describe('runPlannerWriteExclusive', () => {
  it('serializes planner writes for the same user', async () => {
    const order: string[] = [];

    const first = runPlannerWriteExclusive('user-1', async () => {
      order.push('first:start');
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push('first:end');
      return 'first';
    });

    const second = runPlannerWriteExclusive('user-1', async () => {
      order.push('second:start');
      order.push('second:end');
      return 'second';
    });

    const results = await Promise.all([first, second]);

    expect(results).toEqual(['first', 'second']);
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('allows different users to write independently', async () => {
    const order: string[] = [];

    await Promise.all([
      runPlannerWriteExclusive('user-a', async () => {
        order.push('a:start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('a:end');
      }),
      runPlannerWriteExclusive('user-b', async () => {
        order.push('b:start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('b:end');
      }),
    ]);

    expect(order).toContain('a:start');
    expect(order).toContain('a:end');
    expect(order).toContain('b:start');
    expect(order).toContain('b:end');
  });
});

describe('isSuspiciousEmptyOverwrite', () => {
  it('does not treat diagnostics-only state as meaningful planner content', () => {
    const current = {
      ...DEFAULT_PLANNER_STATE,
      diagnostics: { status: 'OPTIMAL', conflicts: {}, error: '' },
    };

    expect(hasPlannerContent(current)).toBe(false);
  });

  it('flags an empty overwrite when current state has planner data', () => {
    const current = {
      ...DEFAULT_PLANNER_STATE,
      tasks: [{ id: 'gym', name: 'Gym', duration: 60 }],
      messages: [{ role: 'user' as const, text: 'hola' }],
    };
    const next = {
      ...DEFAULT_PLANNER_STATE,
      tasks: [],
      messages: [],
    };

    expect(isSuspiciousEmptyOverwrite(current, next)).toBe(true);
  });

  it('allows an empty overwrite only when explicitly permitted', () => {
    const current = {
      ...DEFAULT_PLANNER_STATE,
      tasks: [{ id: 'gym', name: 'Gym', duration: 60 }],
    };
    const next = {
      ...DEFAULT_PLANNER_STATE,
      tasks: [],
    };

    expect(isSuspiciousEmptyOverwrite(current, next, true)).toBe(false);
  });
});
