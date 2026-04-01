import assert from 'node:assert/strict';
import test from 'node:test';
import { compareTaskUrgency, formatTaskCountdown, formatTaskDueDateTime, getTaskUrgencyMeta } from './taskUrgency.ts';

const task = (overrides: Record<string, any>) => ({
  nombre: 'Tarea',
  priority: 'Medium',
  dueDate: '2026-03-31T12:00:00-05:00',
  ...overrides,
});

test('compareTaskUrgency prioritizes overdue ASAP tasks first', () => {
  const now = new Date('2026-03-31T09:00:00-05:00');
  const overdueAsap = task({ nombre: 'Urgente', priority: 'ASAP', dueDate: '2026-03-31T08:00:00-05:00' });
  const futureHigh = task({ nombre: 'Futura', priority: 'High', dueDate: '2026-04-02T12:00:00-05:00' });

  assert.ok(compareTaskUrgency(overdueAsap, futureHigh, now) < 0);
  assert.ok(compareTaskUrgency(futureHigh, overdueAsap, now) > 0);
});

test('compareTaskUrgency tolerates missing task names', () => {
  const now = new Date('2026-03-31T09:00:00-05:00');
  const unnamed = task({ nombre: undefined as any, dueDate: '2026-04-01T12:00:00-05:00' });
  const named = task({ nombre: 'Con nombre', dueDate: '2026-04-01T12:00:00-05:00' });

  assert.doesNotThrow(() => compareTaskUrgency(unnamed, named, now));
  assert.ok(compareTaskUrgency(unnamed, named, now) < 0);
});

test('getTaskUrgencyMeta does not overwrite string dueDate when spreading task data', () => {
  const now = new Date('2026-03-31T09:00:00-05:00');
  const source = task({ dueDate: '2026-03-31' });
  const enriched = { ...source, ...getTaskUrgencyMeta(source, now) };

  assert.equal(typeof enriched.dueDate, 'string');
  assert.equal(enriched.dueDate, '2026-03-31');
  assert.equal(enriched.resolvedDueDate?.getTime(), new Date(2026, 2, 31, 23, 59, 59, 999).getTime());
  assert.doesNotThrow(() => formatTaskCountdown(enriched.dueDate, now));
});

test('formatTaskDueDateTime preserves local date and hour', () => {
  const formatted = formatTaskDueDateTime('2026-03-31T13:13:00-05:00');
  assert.match(formatted, /31/);
  assert.match(formatted, /1:13/);
});

test('formatTaskCountdown shows hours for same-day deadlines', () => {
  const now = new Date('2026-03-31T09:00:00-05:00');
  assert.match(formatTaskCountdown('2026-03-31T13:13:00-05:00', now), /^4h\s+13m$/);
});
