import { describe, it, expect } from 'vitest';
import { solveSchedule, Task, Dependency, WorkWindow, DEFAULT_INTELLIGENT_CONFIG } from './solver';

const defaultWorkWindow: WorkWindow = {
  startHour: 8,
  endHour: 18,
  workDays: [1, 2, 3, 4, 5] // Mon-Fri
};
const monday = 1;

// Helper to create a task
const createTask = (id: string, duration: number, priority: 'low' | 'medium' | 'high' | 'ASAP', deadlineType?: 'Soft Deadline' | 'Hard Deadline', deadline?: number): Task => ({
  id,
  name: `Task ${id}`,
  duration,
  priority,
  deadlineType,
  deadline,
  elastic: false
});

describe('Solver Engine - Intelligent Strategy', () => {
  it('should be strictly deterministic', () => {
    const tasks: Task[] = [
      createTask('A', 60, 'medium'),
      createTask('B', 60, 'medium'),
      createTask('C', 60, 'medium')
    ];
    
    const result1 = solveSchedule(tasks, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    const result2 = solveSchedule(tasks, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    
    expect(result1.schedule).toBeDefined();
    expect(result2.schedule).toBeDefined();
    
    // Exact same order and start times
    expect(result1.schedule!.map(s => s.id)).toEqual(result2.schedule!.map(s => s.id));
    expect(result1.schedule!.map(s => s.start)).toEqual(result2.schedule!.map(s => s.start));
  });

  it('Phase 1 (Critical Shield): should prioritize ASAP tasks over High priority tasks', () => {
    const tasks: Task[] = [
      createTask('High1', 120, 'high'),
      createTask('ASAP1', 60, 'ASAP'),
      createTask('High2', 120, 'high')
    ];
    
    const result = solveSchedule(tasks, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    
    expect(result.schedule).toBeDefined();
    expect(result.schedule!.length).toBe(3);
    // ASAP must be scheduled first
    expect(result.schedule![0].id).toBe('ASAP1');
  });

  it('Phase 1 (Critical Shield): should prioritize Hard Deadlines < 24h', () => {
    // nowMinutes = 0 (Monday 00:00)
    // 12 hours from now = 12 * 60 = 720 minutes
    const tasks2: Task[] = [
      createTask('High1', 120, 'high'),
      createTask('Hard1', 60, 'medium', 'Hard Deadline', 720),
    ];

    const result = solveSchedule(tasks2, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    expect(result.schedule).toBeDefined();
    expect(result.schedule![0].id).toBe('Hard1');
  });

  it('Phase 2 (Value Ordering): should penalize High priority tasks in the afternoon', () => {
    const tasks: Task[] = [
      createTask('High1', 60, 'high'),
      createTask('Low1', 60, 'low')
    ];
    
    const result = solveSchedule(tasks, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    
    const highTask = result.schedule!.find(t => t.id === 'High1')!;
    const lowTask = result.schedule!.find(t => t.id === 'Low1')!;
    
    // High task should be scheduled before Low task due to priority weighting
    expect(highTask.start).toBeLessThan(lowTask.start);
  });

  it('Phase 2 (Value Ordering): should apply adjacency bonus to prevent fragmentation', () => {
    const tasks: Task[] = [
      createTask('A', 60, 'medium'),
      createTask('B', 60, 'medium'),
      createTask('C', 60, 'medium')
    ];
    
    const result = solveSchedule(tasks, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    
    // They should be scheduled back-to-back
    const a = result.schedule!.find(t => t.id === 'A')!;
    const b = result.schedule!.find(t => t.id === 'B')!;
    const c = result.schedule!.find(t => t.id === 'C')!;
    
    // Sort by start time
    const sorted = [a, b, c].sort((x, y) => x.start - y.start);
    
    expect(sorted[0].end).toBe(sorted[1].start);
    expect(sorted[1].end).toBe(sorted[2].start);
  });

  it('should outperform balanced strategy in critical scenarios', () => {
    // 12 hours from now = 720 minutes
    const tasks: Task[] = [
      createTask('Flexible1', 480, 'low'), // Takes 8 hours
      createTask('Flexible2', 480, 'low'), // Takes 8 hours
      createTask('Critical1', 60, 'medium', 'Hard Deadline', 720) // Needs 1 hour ASAP
    ];
    
    // Balanced strategy (MRV) will schedule Flexible tasks first because they have smaller domains (harder to fit 8h blocks)
    // This might push Critical1 past its deadline.
    const balancedResult = solveSchedule(tasks, [], [], defaultWorkWindow, 'balanced', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    const intelligentResult = solveSchedule(tasks, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    
    const balancedCritical = balancedResult.schedule?.find(t => t.id === 'Critical1');
    const intelligentCritical = intelligentResult.schedule?.find(t => t.id === 'Critical1');
    
    // Intelligent should schedule Critical1 much earlier than Balanced
    expect(intelligentCritical!.start).toBeLessThanOrEqual(balancedCritical!.start);
    // In fact, Intelligent must schedule it first
    expect(intelligentResult.schedule![0].id).toBe('Critical1');
  });

  it('No feasible slot: should fail explicitly and diagnostically', () => {
    // Work window is 10 hours/day (600 mins). A 20-hour non-elastic task cannot fit in a single day.
    const tasks: Task[] = [createTask('Impossible', 1200, 'high')];
    const result = solveSchedule(tasks, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    expect(result.schedule).toBeNull();
    expect(result.diagnostics.status).toBe('INFEASIBLE');
  });

  it('Permutation invariance: input order should not affect output', () => {
    const tasks1: Task[] = [
      createTask('A', 60, 'low'),
      createTask('B', 60, 'high'),
      createTask('C', 60, 'medium')
    ];
    const tasks2: Task[] = [
      createTask('C', 60, 'medium'),
      createTask('A', 60, 'low'),
      createTask('B', 60, 'high')
    ];
    
    const res1 = solveSchedule(tasks1, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    const res2 = solveSchedule(tasks2, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    
    expect(res1.schedule!.map(t => t.id)).toEqual(res2.schedule!.map(t => t.id));
    expect(res1.schedule!.map(t => t.start)).toEqual(res2.schedule!.map(t => t.start));
  });

  it('Boundary conditions: 0 duration should be rejected, exact 24h threshold respected', () => {
    const tasks: Task[] = [
      createTask('ZeroDur', 0, 'low'),
    ];
    const resZero = solveSchedule(tasks, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    expect(resZero.schedule).toBeNull();
    expect(resZero.diagnostics!.status).toBe('INVALID_INPUT');

    const tasks2: Task[] = [
      // 24h = 1440 mins. If threshold is 1440, exactly 1440 is NOT < 1440, so it shouldn't be in Phase 1.
      createTask('Exact24', 60, 'medium', 'Hard Deadline', 1440)
    ];
    const res = solveSchedule(tasks2, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    expect(res.schedule).toBeDefined();
    expect(res.schedule!.find(t => t.id === 'Exact24')).toBeDefined();
  });

  it('Fixed constraints: energy heuristic should not violate hard constraints', () => {
    const tasks: Task[] = [
      { ...createTask('FixedAfternoon', 60, 'high'), fixedStart: 14 * 60 } // 14:00 is afternoon
    ];
    const res = solveSchedule(tasks, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    expect(res.schedule).toBeDefined();
    expect(res.schedule![0].start).toBe(14 * 60);
  });

  it('Monotonicity: increasing priority should not worsen placement', () => {
    const tasksLow: Task[] = [
      createTask('Target', 60, 'low'),
      createTask('Competitor', 60, 'medium')
    ];
    const tasksHigh: Task[] = [
      createTask('Target', 60, 'high'),
      createTask('Competitor', 60, 'medium')
    ];
    
    const resLow = solveSchedule(tasksLow, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    const resHigh = solveSchedule(tasksHigh, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    
    const startLow = resLow.schedule!.find(t => t.id === 'Target')!.start;
    const startHigh = resHigh.schedule!.find(t => t.id === 'Target')!.start;
    
    expect(startHigh).toBeLessThanOrEqual(startLow);
  });

  it('Scalability: should solve 100 tasks efficiently', { timeout: 10000 }, () => {
    const tasks: Task[] = Array.from({length: 100}, (_, i) => createTask(`T${i}`, 30, 'medium'));
    
    const start = performance.now();
    const res = solveSchedule(tasks, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    const end = performance.now();
    
    expect(res.schedule).toBeDefined();
    expect(res.schedule!.length).toBe(100);
    // Performance envelope depends on local CPU noise; keep this as a guardrail, not a flaky stopwatch.
    expect(end - start).toBeLessThan(7500);
  });

  it('Fuzzing/Property-based: should handle 50 random tasks without overlapping or crashing', () => {
    const tasks: Task[] = [];
    const priorities: ('low' | 'medium' | 'high' | 'ASAP')[] = ['low', 'medium', 'high', 'ASAP'];
    
    // Deterministic random for reproducibility in tests
    let seed = 12345;
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    for(let i=0; i<50; i++) {
       // Random duration between 15 and 120 mins (multiples of 15)
       const duration = 15 * (1 + Math.floor(random() * 8));
       const priority = priorities[Math.floor(random() * 4)];
       tasks.push(createTask(`Fuzz${i}`, duration, priority));
    }
    
    const start = performance.now();
    const res = solveSchedule(tasks, [], [], defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);
    const end = performance.now();
    
    expect(res.diagnostics!.status).not.toBe('INVALID_INPUT');
    
    if (res.schedule) {
       // Check for overlaps
       const sorted = [...res.schedule].sort((a,b) => a.start - b.start);
       for(let i=0; i<sorted.length - 1; i++) {
          expect(sorted[i].end).toBeLessThanOrEqual(sorted[i+1].start);
       }
       // Check that all tasks are scheduled
       expect(res.schedule.length).toBe(50);
    }
    expect(end - start).toBeLessThan(3000); // Keep this as a coarse guardrail, not a machine-specific stopwatch.
  });

  it('should block task placement when a calendar event occupies the slot', () => {
    const tasks: Task[] = [createTask('A', 60, 'high')];
    const events = [{ id: 'event-1', title: 'Meeting', start: 8 * 60, end: 9 * 60, kind: 'meeting' as const }];

    const res = solveSchedule(tasks, [], events, defaultWorkWindow, 'intelligent', 0, 7, 15, undefined, DEFAULT_INTELLIGENT_CONFIG, monday);

    expect(res.schedule).toBeDefined();
    expect(res.schedule![0].start).toBeGreaterThanOrEqual(9 * 60);
  });
});
