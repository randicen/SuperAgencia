import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEffectiveBaseDataset,
  buildPendingDataset,
  countDatasetRows,
  deriveLocalMutations,
  type SpacesSyncDataset,
  type SpaceTaskRow,
} from './spacesSyncReconciliation.ts';

const makeTaskRow = (
  id: string,
  name: string,
  updatedAt: string,
  overrides: Partial<SpaceTaskRow> = {}
): SpaceTaskRow => ({
  id,
  user_id: 'user-1',
  workspace_id: 'ws-1',
  space_id: 'space-1',
  folder_id: null,
  list_id: 'list-1',
  parent_task_id: null,
  position: 1,
  payload: {
    id,
    nombre: name,
    orden: 1,
    estado: 'TODO',
    progress: 0,
  },
  updated_at: updatedAt,
  deleted_at: null,
  ...overrides,
});

const makeDataset = (tasks: SpaceTaskRow[]): SpacesSyncDataset => ({
  workspaces: [],
  spaces: [],
  folders: [],
  lists: [],
  tasks,
  events: [],
});

test('bootstrap does not mark remote rows as local changes when cache is empty', () => {
  const remote = makeDataset([
    makeTaskRow('task-1', 'Desde remoto', '2026-03-27T10:00:00.000Z'),
  ]);
  const current = makeDataset([
    makeTaskRow('task-1', 'Desde remoto', '2026-03-27T09:00:00.000Z'),
  ]);

  const merged = deriveLocalMutations({
    cacheBase: makeDataset([]),
    currentDataset: current,
    remoteDataset: remote,
    reason: 'bootstrap',
    nowIso: '2026-03-27T11:00:00.000Z',
  });

  const pending = buildPendingDataset(remote, merged);

  assert.equal(countDatasetRows(pending), 0);
  assert.equal(merged.tasks[0]?.payload.nombre, 'Desde remoto');
  assert.equal(merged.tasks[0]?.updated_at, '2026-03-27T10:00:00.000Z');
});

test('bootstrap prefers remote edits over stale local state when cache is empty', () => {
  const remote = makeDataset([
    makeTaskRow('task-1', 'Titulo remoto nuevo', '2026-03-27T10:05:00.000Z'),
  ]);
  const current = makeDataset([
    makeTaskRow('task-1', 'Titulo viejo local', '2026-03-27T09:00:00.000Z'),
  ]);

  const merged = deriveLocalMutations({
    cacheBase: makeDataset([]),
    currentDataset: current,
    remoteDataset: remote,
    reason: 'remote-change',
    nowIso: '2026-03-27T11:00:00.000Z',
  });

  assert.equal(merged.tasks[0]?.payload.nombre, 'Titulo remoto nuevo');
  assert.equal(countDatasetRows(buildPendingDataset(remote, merged)), 0);
});

test('local-change allows editing a remote row even when cache is empty', () => {
  const remote = makeDataset([
    makeTaskRow('task-1', 'Original', '2026-03-27T10:00:00.000Z'),
  ]);
  const current = makeDataset([
    makeTaskRow('task-1', 'Editada localmente', '2026-03-27T09:00:00.000Z'),
  ]);

  const merged = deriveLocalMutations({
    cacheBase: makeDataset([]),
    currentDataset: current,
    remoteDataset: remote,
    reason: 'local-change',
    nowIso: '2026-03-27T11:00:00.000Z',
  });
  const pending = buildPendingDataset(remote, merged);

  assert.equal(merged.tasks[0]?.payload.nombre, 'Editada localmente');
  assert.equal(pending.tasks.length, 1);
  assert.equal(pending.tasks[0]?.deleted_at, null);
  assert.equal(pending.tasks[0]?.updated_at, '2026-03-27T11:00:00.000Z');
});

test('local-change emits tombstone delete for remote rows even when cache is empty', () => {
  const remote = makeDataset([
    makeTaskRow('task-1', 'Eliminarme', '2026-03-27T10:00:00.000Z'),
  ]);
  const current = makeDataset([]);

  const merged = deriveLocalMutations({
    cacheBase: makeDataset([]),
    currentDataset: current,
    remoteDataset: remote,
    reason: 'local-change',
    nowIso: '2026-03-27T11:00:00.000Z',
  });
  const pending = buildPendingDataset(remote, merged);

  assert.equal(pending.tasks.length, 1);
  assert.equal(pending.tasks[0]?.id, 'task-1');
  assert.equal(pending.tasks[0]?.deleted_at, '2026-03-27T11:00:00.000Z');
});

test('effective base takes remote-known rows over stale cache-only active rows', () => {
  const cacheBase = makeDataset([
    makeTaskRow('task-1', 'Vieja en cache', '2026-03-27T09:00:00.000Z'),
    makeTaskRow('task-2', 'Solo cache', '2026-03-27T09:00:00.000Z'),
  ]);
  const remote = makeDataset([
    makeTaskRow('task-1', 'Remota actual', '2026-03-27T10:00:00.000Z'),
  ]);

  const effective = buildEffectiveBaseDataset(cacheBase, remote);

  assert.equal(effective.tasks.length, 1);
  assert.equal(effective.tasks[0]?.id, 'task-1');
  assert.equal(effective.tasks[0]?.payload.nombre, 'Remota actual');
});

test('remote-change does not resurrect cache-only rows that disappeared remotely', () => {
  const cacheBase = makeDataset([
    makeTaskRow('task-1', 'Aun en cache', '2026-03-27T09:00:00.000Z'),
  ]);
  const remote = makeDataset([]);
  const current = makeDataset([
    makeTaskRow('task-1', 'Aun en cache', '2026-03-27T09:00:00.000Z'),
  ]);

  const merged = deriveLocalMutations({
    cacheBase,
    currentDataset: current,
    remoteDataset: remote,
    reason: 'remote-change',
    nowIso: '2026-03-27T11:00:00.000Z',
  });

  assert.equal(merged.tasks.length, 0);
  assert.equal(countDatasetRows(buildPendingDataset(remote, merged)), 0);
});
