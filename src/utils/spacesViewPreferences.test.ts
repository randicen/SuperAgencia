import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LISTA_COLUMN_ORDER,
  DEFAULT_LISTA_VISIBLE_COLUMNS,
  normalizeStoredColumnOrder,
  normalizeStoredVisibleColumns,
} from './spacesViewPreferences.ts';

test('normalizeStoredColumnOrder drops invalid ids and appends missing defaults', () => {
  const result = normalizeStoredColumnOrder(['dueDate', 'bogus', 'nombre', 'dueDate']);

  assert.deepEqual(result, [
    'dueDate',
    'nombre',
    ...DEFAULT_LISTA_COLUMN_ORDER.filter((id) => !['dueDate', 'nombre'].includes(id)),
  ]);
});

test('normalizeStoredColumnOrder falls back to defaults for non-arrays', () => {
  assert.deepEqual(normalizeStoredColumnOrder({ broken: true }), [...DEFAULT_LISTA_COLUMN_ORDER]);
});

test('normalizeStoredVisibleColumns keeps nombre even if storage removed it', () => {
  assert.deepEqual(normalizeStoredVisibleColumns(['priority', 'bogus']), ['nombre', 'priority']);
});

test('normalizeStoredVisibleColumns falls back to defaults for non-arrays', () => {
  assert.deepEqual(normalizeStoredVisibleColumns('broken'), [...DEFAULT_LISTA_VISIBLE_COLUMNS]);
});
