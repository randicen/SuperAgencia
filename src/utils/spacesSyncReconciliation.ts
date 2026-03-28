export type SpacesSyncCycleReason = 'manual' | 'local-change' | 'remote-change' | 'online' | 'bootstrap';

export interface SyncRowBase {
  id: string;
  user_id: string;
  position: number;
  updated_at: string;
  deleted_at: string | null;
}

export interface SpaceWorkspaceRow extends SyncRowBase {
  name: string;
}

export interface SpaceSpaceRow extends SyncRowBase {
  workspace_id: string;
  name: string;
  color: string;
}

export interface SpaceFolderRow extends SyncRowBase {
  workspace_id: string;
  space_id: string;
  name: string;
}

export interface SpaceListRow extends SyncRowBase {
  workspace_id: string;
  space_id: string;
  folder_id: string | null;
  name: string;
}

export interface SpaceTaskRow extends SyncRowBase {
  workspace_id: string;
  space_id: string;
  folder_id: string | null;
  list_id: string;
  parent_task_id: string | null;
  payload: Record<string, any>;
}

export type SpaceEventKind = 'workspace_agenda' | 'list_event' | 'global_gcal';

export interface SpaceEventRow extends SyncRowBase {
  workspace_id: string;
  space_id: string | null;
  folder_id: string | null;
  list_id: string | null;
  kind: SpaceEventKind;
  payload: Record<string, any>;
}

export interface SpacesSyncDataset {
  workspaces: SpaceWorkspaceRow[];
  spaces: SpaceSpaceRow[];
  folders: SpaceFolderRow[];
  lists: SpaceListRow[];
  tasks: SpaceTaskRow[];
  events: SpaceEventRow[];
}

const LOCAL_INTENT_REASONS = new Set<SpacesSyncCycleReason>(['manual', 'local-change', 'online']);

export const normalizePosition = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

export const sortByPosition = <T extends { position: number; updated_at: string; id: string }>(rows: T[]) =>
  [...rows].sort((left, right) =>
    left.position - right.position ||
    left.updated_at.localeCompare(right.updated_at) ||
    left.id.localeCompare(right.id)
  );

export const cloneDataset = (dataset?: Partial<SpacesSyncDataset> | null): SpacesSyncDataset => ({
  workspaces: [...(dataset?.workspaces || [])],
  spaces: [...(dataset?.spaces || [])],
  folders: [...(dataset?.folders || [])],
  lists: [...(dataset?.lists || [])],
  tasks: [...(dataset?.tasks || [])],
  events: [...(dataset?.events || [])],
});

export const mapById = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));

const stripMeta = <T extends Record<string, any>>(row: T | undefined | null) => {
  if (!row) return null;
  const { updated_at, deleted_at, user_id, ...rest } = row;
  return rest;
};

export const canonicalRowEquals = <T extends Record<string, any>>(left: T | undefined | null, right: T | undefined | null) =>
  JSON.stringify(stripMeta(left)) === JSON.stringify(stripMeta(right));

const rowVersion = (row?: { updated_at: string; deleted_at: string | null } | null) =>
  row?.deleted_at || row?.updated_at || '';

export const chooseLatestRow = <T extends { updated_at: string; deleted_at: string | null }>(
  left?: T | null,
  right?: T | null
): T | null => {
  if (!left) return right || null;
  if (!right) return left;

  const leftVersion = rowVersion(left);
  const rightVersion = rowVersion(right);

  if (leftVersion === rightVersion) {
    if (left.deleted_at && !right.deleted_at) return left;
    if (right.deleted_at && !left.deleted_at) return right;
    return right;
  }

  return leftVersion > rightVersion ? left : right;
};

export const countDatasetRows = (dataset: SpacesSyncDataset) =>
  dataset.workspaces.length +
  dataset.spaces.length +
  dataset.folders.length +
  dataset.lists.length +
  dataset.tasks.length +
  dataset.events.length;

export const activeRows = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((row) => !row.deleted_at);

export const activeOnlyDataset = (dataset: SpacesSyncDataset): SpacesSyncDataset => ({
  workspaces: activeRows(dataset.workspaces),
  spaces: activeRows(dataset.spaces),
  folders: activeRows(dataset.folders),
  lists: activeRows(dataset.lists),
  tasks: activeRows(dataset.tasks),
  events: activeRows(dataset.events),
});

const maxRowVersionMs = <T extends { updated_at: string; deleted_at: string | null }>(rows: T[]) =>
  rows.reduce((max, row) => {
    const values = [row.updated_at, row.deleted_at].filter(Boolean) as string[];
    if (!values.length) return max;
    const nextMax = Math.max(...values.map((value) => new Date(value).getTime()).filter((value) => Number.isFinite(value)));
    return Math.max(max, nextMax || 0);
  }, 0);

export const datasetVersionMs = (dataset: SpacesSyncDataset) => Math.max(
  maxRowVersionMs(dataset.workspaces),
  maxRowVersionMs(dataset.spaces),
  maxRowVersionMs(dataset.folders),
  maxRowVersionMs(dataset.lists),
  maxRowVersionMs(dataset.tasks),
  maxRowVersionMs(dataset.events)
);

const buildEffectiveBaseRows = <T extends SyncRowBase>(cacheRows: T[], remoteRows: T[]) => {
  const cacheById = mapById(cacheRows);
  const remoteById = mapById(remoteRows);
  const allIds = new Set<string>([...cacheById.keys(), ...remoteById.keys()]);
  const rows: T[] = [];

  allIds.forEach((id) => {
    const remoteRow = remoteById.get(id);
    const cacheRow = cacheById.get(id);

    if (remoteRow) {
      const winner = chooseLatestRow(cacheRow, remoteRow);
      rows.push(winner || remoteRow);
      return;
    }

    if (cacheRow?.deleted_at) {
      rows.push(cacheRow);
    }
  });

  return sortByPosition(rows);
};

export const buildEffectiveBaseDataset = (cacheBase: SpacesSyncDataset, remoteDataset: SpacesSyncDataset): SpacesSyncDataset => ({
  workspaces: buildEffectiveBaseRows(cacheBase.workspaces, remoteDataset.workspaces),
  spaces: buildEffectiveBaseRows(cacheBase.spaces, remoteDataset.spaces),
  folders: buildEffectiveBaseRows(cacheBase.folders, remoteDataset.folders),
  lists: buildEffectiveBaseRows(cacheBase.lists, remoteDataset.lists),
  tasks: buildEffectiveBaseRows(cacheBase.tasks, remoteDataset.tasks),
  events: buildEffectiveBaseRows(cacheBase.events, remoteDataset.events),
});

const hasRowChangedFromBase = <T extends SyncRowBase>(baseRow: T | undefined, currentRow: T | undefined) => {
  if (!baseRow) return !!currentRow;
  if (!currentRow) return !baseRow.deleted_at;
  return !canonicalRowEquals(baseRow, currentRow) || !!baseRow.deleted_at;
};

const createDeletedRow = <T extends SyncRowBase>(row: T, nowIso: string): T => ({
  ...row,
  updated_at: nowIso,
  deleted_at: nowIso,
});

const createUpdatedRow = <T extends SyncRowBase>(row: T, nowIso: string): T => ({
  ...row,
  updated_at: nowIso,
  deleted_at: null,
});

export const mergeRemoteAndLocalRows = <T extends SyncRowBase>(params: {
  cacheRows: T[];
  currentRows: T[];
  remoteRows: T[];
  reason: SpacesSyncCycleReason;
  nowIso: string;
}) => {
  const { cacheRows, currentRows, remoteRows, reason, nowIso } = params;
  const cacheById = mapById(cacheRows);
  const currentById = mapById(currentRows);
  const remoteById = mapById(remoteRows);
  const effectiveById = mapById(buildEffectiveBaseRows(cacheRows, remoteRows));
  const allIds = new Set<string>([
    ...cacheById.keys(),
    ...currentById.keys(),
    ...remoteById.keys(),
  ]);
  const allowAmbiguousRemoteRows = LOCAL_INTENT_REASONS.has(reason);
  const mergedRows: T[] = [];

  allIds.forEach((id) => {
    const cacheRow = cacheById.get(id);
    const currentRow = currentById.get(id);
    const remoteRow = remoteById.get(id);
    const effectiveRow = effectiveById.get(id);

    if (cacheRow) {
      const localChanged = hasRowChangedFromBase(cacheRow, currentRow);
      const remoteChanged = hasRowChangedFromBase(cacheRow, remoteRow);

      if (!localChanged) {
        if (remoteRow) mergedRows.push(remoteRow);
        return;
      }

      const localMutationRow = currentRow
        ? createUpdatedRow(currentRow, nowIso)
        : createDeletedRow(effectiveRow || cacheRow, nowIso);

      if (!remoteChanged || !remoteRow) {
        mergedRows.push(localMutationRow);
        return;
      }

      const winner = chooseLatestRow(localMutationRow, remoteRow);
      if (winner) mergedRows.push(winner);
      return;
    }

    if (remoteRow) {
      if (!currentRow) {
        if (allowAmbiguousRemoteRows && !remoteRow.deleted_at) {
          mergedRows.push(createDeletedRow(remoteRow, nowIso));
          return;
        }
        mergedRows.push(remoteRow);
        return;
      }

      if (canonicalRowEquals(remoteRow, currentRow)) {
        mergedRows.push(remoteRow);
        return;
      }

      if (!allowAmbiguousRemoteRows || remoteRow.deleted_at) {
        mergedRows.push(remoteRow);
        return;
      }

      mergedRows.push(createUpdatedRow(currentRow, nowIso));
      return;
    }

    if (currentRow) {
      mergedRows.push(createUpdatedRow(currentRow, nowIso));
    }
  });

  return sortByPosition(mergedRows);
};

export const deriveLocalMutations = (params: {
  cacheBase: SpacesSyncDataset;
  currentDataset: SpacesSyncDataset;
  remoteDataset: SpacesSyncDataset;
  reason: SpacesSyncCycleReason;
  nowIso: string;
}): SpacesSyncDataset => {
  const { cacheBase, currentDataset, remoteDataset, reason, nowIso } = params;

  return {
    workspaces: mergeRemoteAndLocalRows({ cacheRows: cacheBase.workspaces, currentRows: currentDataset.workspaces, remoteRows: remoteDataset.workspaces, reason, nowIso }),
    spaces: mergeRemoteAndLocalRows({ cacheRows: cacheBase.spaces, currentRows: currentDataset.spaces, remoteRows: remoteDataset.spaces, reason, nowIso }),
    folders: mergeRemoteAndLocalRows({ cacheRows: cacheBase.folders, currentRows: currentDataset.folders, remoteRows: remoteDataset.folders, reason, nowIso }),
    lists: mergeRemoteAndLocalRows({ cacheRows: cacheBase.lists, currentRows: currentDataset.lists, remoteRows: remoteDataset.lists, reason, nowIso }),
    tasks: mergeRemoteAndLocalRows({ cacheRows: cacheBase.tasks, currentRows: currentDataset.tasks, remoteRows: remoteDataset.tasks, reason, nowIso }),
    events: mergeRemoteAndLocalRows({ cacheRows: cacheBase.events, currentRows: currentDataset.events, remoteRows: remoteDataset.events, reason, nowIso }),
  };
};

const buildPendingRows = <T extends SyncRowBase>(baseRows: T[], nextRows: T[]) => {
  const baseById = mapById(baseRows);
  return nextRows.filter((row) => {
    const baseRow = baseById.get(row.id);
    if (!baseRow) return true;
    return !canonicalRowEquals(baseRow, row) || baseRow.deleted_at !== row.deleted_at || baseRow.updated_at !== row.updated_at;
  });
};

export const buildPendingDataset = (base: SpacesSyncDataset, next: SpacesSyncDataset): SpacesSyncDataset => ({
  workspaces: buildPendingRows(base.workspaces, next.workspaces),
  spaces: buildPendingRows(base.spaces, next.spaces),
  folders: buildPendingRows(base.folders, next.folders),
  lists: buildPendingRows(base.lists, next.lists),
  tasks: buildPendingRows(base.tasks, next.tasks),
  events: buildPendingRows(base.events, next.events),
});
