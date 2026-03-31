import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLocalDateOnly, parseLocalDate } from './dateTime.ts';

test('parseLocalDate keeps YYYY-MM-DD on the local day', () => {
  const parsed = parseLocalDate('2026-03-31');

  assert.ok(parsed);
  assert.equal(parsed?.getFullYear(), 2026);
  assert.equal(parsed?.getMonth(), 2);
  assert.equal(parsed?.getDate(), 31);
  assert.equal(parsed?.getHours(), 0);
  assert.equal(parsed?.getMinutes(), 0);
});

test('parseLocalDate supports local end-of-day for YYYY-MM-DD', () => {
  const parsed = parseLocalDate('2026-03-31', true);

  assert.ok(parsed);
  assert.equal(parsed?.getFullYear(), 2026);
  assert.equal(parsed?.getMonth(), 2);
  assert.equal(parsed?.getDate(), 31);
  assert.equal(parsed?.getHours(), 23);
  assert.equal(parsed?.getMinutes(), 59);
});

test('parseLocalDate accepts Date instances without throwing', () => {
  const source = new Date('2026-03-31T13:13:00-05:00');
  const parsed = parseLocalDate(source, true);

  assert.ok(parsed);
  assert.notEqual(parsed, source);
  assert.equal(parsed?.getTime(), source.getTime());
});

test('formatLocalDateOnly keeps the local calendar day', () => {
  assert.equal(formatLocalDateOnly(new Date(2026, 2, 31)), '2026-03-31');
});
