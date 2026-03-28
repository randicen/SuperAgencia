import { supabase } from '../contexts/AuthContext';
import { DEFAULT_RULES } from '../mockData';
import { Space, SpaceEvent, SpaceFolder, SpaceList, SpacesState, SpaceTask, Workspace } from '../spacesTypes';

type SpaceSyncMode = 'safe' | 'migrating' | 'live';
type RepairStatus = 'needs_repair' | 'repairing' | 'ready' | 'error';
type MigrationSource = 'normalized' | 'legacy_remote' | 'local_cache' | 'empty' | null;

export interface SpacesSyncDiagnostics {
  mode: SpaceSyncMode;
  deviceId: string;
  pending: number;
  lastPull: string | null;
  lastPush: string | null;
  lastRemote: string | null;
  lastError: string | null;
  migrationSource: MigrationSource;
  schemaVersion: number | null;
  snapshotVersion: number | null;
  repairStatus: RepairStatus | null;
}

interface SpacesSyncMeta {
  schema_version: number;
  snapshot_version: number;
  status: RepairStatus;
  updated_at: string | null;
  last_error: string | null;
}

interface SyncRowBase {
  id: string;
  user_id: string;
  position: number;
  updated_at: string;
  deleted_at: string | null;
}

interface SpaceWorkspaceRow extends SyncRowBase {
  name: string;
}

interface SpaceSpaceRow extends SyncRowBase {
  workspace_id: string;
  name: string;
  color: string;
}

interface SpaceFolderRow extends SyncRowBase {
  workspace_id: string;
  space_id: string;
  name: string;
}

interface SpaceListRow extends SyncRowBase {
  workspace_id: string;
  space_id: string;
  folder_id: string | null;
  name: string;
}

interface SpaceTaskRow extends SyncRowBase {
  workspace_id: string;
  space_id: string;
  folder_id: string | null;
  list_id: string;
  parent_task_id: string | null;
  payload: Record<string, any>;
}

type SpaceEventKind = 'workspace_agenda' | 'list_event' | 'global_gcal';

interface SpaceEventRow extends SyncRowBase {
  workspace_id: string;
  space_id: string | null;
  folder_id: string | null;
  list_id: string | null;
  kind: SpaceEventKind;
  payload: Record<string, any>;
}

interface SpacesSyncDataset {
  workspaces: SpaceWorkspaceRow[];
  spaces: SpaceSpaceRow[];
  folders: SpaceFolderRow[];
  lists: SpaceListRow[];
  tasks: SpaceTaskRow[];
  events: SpaceEventRow[];
}

interface LegacySpacesBackup {
  spaces: any | null;
  updatedAt: string | null;
}

interface LocalSyncCache {
  base: SpacesSyncDataset;
  diagnostics: SpacesSyncDiagnostics;
}

interface SpacesSyncCycleOptions {
  userId: string;
  currentLocalSpaces: any;
}

interface SpacesSyncCycleResult {
  nextSpacesState: SpacesState;
  diagnostics: SpacesSyncDiagnostics;
  didUpload: boolean;
}

interface SpacesSnapshotResponse {
  meta: SpacesSyncMeta;
  dataset: SpacesSyncDataset;
}

const TARGET_SCHEMA_VERSION = 2;
const DEVICE_ID_KEY = 'coo_spaces_sync_device_id';
const CACHE_KEY = 'coo_spaces_sync_cache_v2';
const LOCAL_BACKUP_KEY = 'coo_spaces_backup_local_pre_row_sync_v1';
const LEGACY_BACKUP_KEY = 'coo_spaces_backup_legacy_remote_pre_row_sync_v1';

const EMPTY_DATASET: SpacesSyncDataset = {
  workspaces: [],
  spaces: [],
  folders: [],
  lists: [],
  tasks: [],
  events: [],
};

const isRepairStatus = (value: unknown): value is RepairStatus =>
  value === 'needs_repair' || value === 'repairing' || value === 'ready' || value === 'error';

const createEmptyDiagnostics = (mode: SpaceSyncMode = 'safe'): SpacesSyncDiagnostics => ({
  mode,
  deviceId: '',
  pending: 0,
  lastPull: null,
  lastPush: null,
  lastRemote: null,
  lastError: null,
  migrationSource: null,
  schemaVersion: null,
  snapshotVersion: null,
  repairStatus: null,
});

const normalizeDiagnostics = (value?: Partial<SpacesSyncDiagnostics> | null): SpacesSyncDiagnostics => ({
  ...createEmptyDiagnostics(value?.mode === 'live' || value?.mode === 'migrating' ? value.mode : 'safe'),
  ...(value || {}),
  migrationSource: value?.migrationSource === 'normalized' || value?.migrationSource === 'legacy_remote' || value?.migrationSource === 'local_cache' || value?.migrationSource === 'empty'
    ? value.migrationSource
    : null,
  schemaVersion: typeof value?.schemaVersion === 'number' && Number.isFinite(value.schemaVersion) ? value.schemaVersion : null,
  snapshotVersion: typeof value?.snapshotVersion === 'number' && Number.isFinite(value.snapshotVersion) ? value.snapshotVersion : null,
  repairStatus: isRepairStatus(value?.repairStatus) ? value.repairStatus : null,
});

const normalizeMeta = (value?: Partial<SpacesSyncMeta> | null): SpacesSyncMeta => {
  const schemaVersion = Number(value?.schema_version);
  const snapshotVersion = Number(value?.snapshot_version);

  return {
    schema_version: Number.isFinite(schemaVersion) ? schemaVersion : TARGET_SCHEMA_VERSION,
    snapshot_version: Number.isFinite(snapshotVersion) ? snapshotVersion : 0,
    status: isRepairStatus(value?.status) ? value.status : 'needs_repair',
    updated_at: typeof value?.updated_at === 'string' ? value.updated_at : null,
    last_error: typeof value?.last_error === 'string' ? value.last_error : null,
  };
};

const cloneDataset = (dataset?: Partial<SpacesSyncDataset> | null): SpacesSyncDataset => ({
  workspaces: [...(dataset?.workspaces || [])],
  spaces: [...(dataset?.spaces || [])],
  folders: [...(dataset?.folders || [])],
  lists: [...(dataset?.lists || [])],
  tasks: [...(dataset?.tasks || [])],
  events: [...(dataset?.events || [])],
});

const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value));
};

export const getOrCreateSpacesSyncDeviceId = () => {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const nextId = `dev-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(DEVICE_ID_KEY, nextId);
  return nextId;
};

const readLocalCache = (): LocalSyncCache => {
  const rawCache = readJson<Partial<LocalSyncCache>>(CACHE_KEY, {});
  return {
    base: cloneDataset(rawCache.base),
    diagnostics: normalizeDiagnostics({
      ...rawCache.diagnostics,
      deviceId: getOrCreateSpacesSyncDeviceId(),
    }),
  };
};

const writeLocalCache = (cache: LocalSyncCache) => {
  writeJson(CACHE_KEY, cache);
};

export const getSpacesSyncDiagnostics = () => {
  const cache = readLocalCache();
  return {
    ...cache.diagnostics,
    deviceId: getOrCreateSpacesSyncDeviceId(),
  };
};

const normalizePosition = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const sortByPosition = <T extends { position: number; updated_at: string; id: string }>(rows: T[]) =>
  [...rows].sort((left, right) =>
    left.position - right.position ||
    left.updated_at.localeCompare(right.updated_at) ||
    left.id.localeCompare(right.id)
  );

const stripMeta = <T extends Record<string, any>>(row: T | undefined | null) => {
  if (!row) return null;
  const { updated_at, deleted_at, user_id, ...rest } = row;
  return rest;
};

const canonicalRowEquals = <T extends Record<string, any>>(left: T | undefined | null, right: T | undefined | null) =>
  JSON.stringify(stripMeta(left)) === JSON.stringify(stripMeta(right));

const rowVersion = (row?: { updated_at: string; deleted_at: string | null } | null) =>
  row?.deleted_at || row?.updated_at || '';

const chooseLatestRow = <T extends { updated_at: string; deleted_at: string | null }>(
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

const countDatasetRows = (dataset: SpacesSyncDataset) =>
  dataset.workspaces.length +
  dataset.spaces.length +
  dataset.folders.length +
  dataset.lists.length +
  dataset.tasks.length +
  dataset.events.length;

const activeRows = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((row) => !row.deleted_at);

const activeOnlyDataset = (dataset: SpacesSyncDataset): SpacesSyncDataset => ({
  workspaces: activeRows(dataset.workspaces),
  spaces: activeRows(dataset.spaces),
  folders: activeRows(dataset.folders),
  lists: activeRows(dataset.lists),
  tasks: activeRows(dataset.tasks),
  events: activeRows(dataset.events),
});

const toIsoFromMillis = (value: number | null | undefined, fallbackIso: string) => {
  if (!value || value <= 0) return fallbackIso;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallbackIso : date.toISOString();
};

const maxRowVersionMs = <T extends { updated_at: string; deleted_at: string | null }>(rows: T[]) =>
  rows.reduce((max, row) => {
    const values = [row.updated_at, row.deleted_at].filter(Boolean) as string[];
    if (!values.length) return max;
    const nextMax = Math.max(...values.map((value) => new Date(value).getTime()).filter((value) => Number.isFinite(value)));
    return Math.max(max, nextMax || 0);
  }, 0);

const datasetVersionMs = (dataset: SpacesSyncDataset) => Math.max(
  maxRowVersionMs(dataset.workspaces),
  maxRowVersionMs(dataset.spaces),
  maxRowVersionMs(dataset.folders),
  maxRowVersionMs(dataset.lists),
  maxRowVersionMs(dataset.tasks),
  maxRowVersionMs(dataset.events)
);

const mapById = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));

const createWorkspaceRow = (
  userId: string,
  workspace: Workspace,
  position: number,
  updatedAt: string,
  deletedAt: string | null = null
): SpaceWorkspaceRow => ({
  id: workspace.id,
  user_id: userId,
  name: workspace.nombre,
  position,
  updated_at: updatedAt,
  deleted_at: deletedAt,
});

const createSpaceRow = (
  userId: string,
  workspaceId: string,
  space: Space,
  position: number,
  updatedAt: string,
  deletedAt: string | null = null
): SpaceSpaceRow => ({
  id: space.id,
  user_id: userId,
  workspace_id: workspaceId,
  name: space.nombre,
  color: space.color,
  position,
  updated_at: updatedAt,
  deleted_at: deletedAt,
});

const createFolderRow = (
  userId: string,
  workspaceId: string,
  spaceId: string,
  folder: SpaceFolder,
  position: number,
  updatedAt: string,
  deletedAt: string | null = null
): SpaceFolderRow => ({
  id: folder.id,
  user_id: userId,
  workspace_id: workspaceId,
  space_id: spaceId,
  name: folder.nombre,
  position,
  updated_at: updatedAt,
  deleted_at: deletedAt,
});

const createListRow = (
  userId: string,
  workspaceId: string,
  spaceId: string,
  list: SpaceList,
  position: number,
  updatedAt: string,
  folderId: string | null = null,
  deletedAt: string | null = null
): SpaceListRow => ({
  id: list.id,
  user_id: userId,
  workspace_id: workspaceId,
  space_id: spaceId,
  folder_id: folderId,
  name: list.nombre,
  position,
  updated_at: updatedAt,
  deleted_at: deletedAt,
});

const stripTaskPayload = (task: SpaceTask) => {
  const { subtasks, ...payload } = task;
  return payload;
};

const stripEventPayload = (event: SpaceEvent) => ({ ...event, id: undefined });

const flattenTaskRows = (
  rows: SpaceTaskRow[],
  userId: string,
  workspaceId: string,
  spaceId: string,
  folderId: string | null,
  listId: string,
  tasks: SpaceTask[],
  updatedAt: string,
  parentTaskId: string | null = null
) => {
  tasks.forEach((task, taskIndex) => {
    rows.push({
      id: task.id,
      user_id: userId,
      workspace_id: workspaceId,
      space_id: spaceId,
      folder_id: folderId,
      list_id: listId,
      parent_task_id: parentTaskId,
      position: normalizePosition(task.orden, taskIndex),
      payload: stripTaskPayload(task),
      updated_at: updatedAt,
      deleted_at: null,
    });

    if (task.subtasks?.length) {
      flattenTaskRows(rows, userId, workspaceId, spaceId, folderId, listId, task.subtasks, updatedAt, task.id);
    }
  });
};

const flattenEventRows = (
  rows: SpaceEventRow[],
  userId: string,
  workspaceId: string,
  events: SpaceEvent[],
  updatedAt: string,
  kind: SpaceEventKind,
  refs: { spaceId?: string | null; folderId?: string | null; listId?: string | null } = {}
) => {
  events.forEach((event, eventIndex) => {
    rows.push({
      id: event.id,
      user_id: userId,
      workspace_id: workspaceId,
      space_id: refs.spaceId ?? null,
      folder_id: refs.folderId ?? null,
      list_id: refs.listId ?? null,
      kind,
      position: eventIndex,
      payload: stripEventPayload(event),
      updated_at: updatedAt,
      deleted_at: null,
    });
  });
};

const buildCurrentDataset = (userId: string, localSpaces: any, fallbackUpdatedAt = new Date().toISOString()): SpacesSyncDataset => {
  const source = localSpaces && typeof localSpaces === 'object' ? localSpaces : {};
  const workspaces: Workspace[] = Array.isArray(source.workspaces) ? source.workspaces : [];
  const nextDataset = cloneDataset(EMPTY_DATASET);

  workspaces.forEach((workspace, workspaceIndex) => {
    nextDataset.workspaces.push(createWorkspaceRow(userId, workspace, workspaceIndex, fallbackUpdatedAt));
    flattenEventRows(nextDataset.events, userId, workspace.id, workspace.agendaEvents || [], fallbackUpdatedAt, 'workspace_agenda');

    (workspace.espacios || []).forEach((space, spaceIndex) => {
      nextDataset.spaces.push(createSpaceRow(userId, workspace.id, space, spaceIndex, fallbackUpdatedAt));

      (space.carpetas || []).forEach((folder, folderIndex) => {
        nextDataset.folders.push(createFolderRow(userId, workspace.id, space.id, folder, folderIndex, fallbackUpdatedAt));

        (folder.listas || []).forEach((list, listIndex) => {
          nextDataset.lists.push(createListRow(userId, workspace.id, space.id, list, listIndex, fallbackUpdatedAt, folder.id));
          flattenTaskRows(nextDataset.tasks, userId, workspace.id, space.id, folder.id, list.id, list.tareas || [], fallbackUpdatedAt);
          flattenEventRows(nextDataset.events, userId, workspace.id, list.eventos || [], fallbackUpdatedAt, 'list_event', {
            spaceId: space.id,
            folderId: folder.id,
            listId: list.id,
          });
        });
      });

      (space.listas || []).forEach((list, listIndex) => {
        nextDataset.lists.push(createListRow(userId, workspace.id, space.id, list, listIndex, fallbackUpdatedAt));
        flattenTaskRows(nextDataset.tasks, userId, workspace.id, space.id, null, list.id, list.tareas || [], fallbackUpdatedAt);
        flattenEventRows(nextDataset.events, userId, workspace.id, list.eventos || [], fallbackUpdatedAt, 'list_event', {
          spaceId: space.id,
          listId: list.id,
        });
      });
    });
  });

  if (source.activeWorkspaceId || Array.isArray(source.gcalEvents)) {
    const fallbackWorkspaceId = workspaces[0]?.id || 'global';
    flattenEventRows(nextDataset.events, userId, fallbackWorkspaceId, source.gcalEvents || [], fallbackUpdatedAt, 'global_gcal');
  }

  return {
    workspaces: sortByPosition(nextDataset.workspaces),
    spaces: sortByPosition(nextDataset.spaces),
    folders: sortByPosition(nextDataset.folders),
    lists: sortByPosition(nextDataset.lists),
    tasks: sortByPosition(nextDataset.tasks),
    events: sortByPosition(nextDataset.events),
  };
};

const prepareRowsFromBase = <T extends SyncRowBase>(currentRows: T[], baseRows: T[], nowIso: string) => {
  const baseById = mapById(baseRows);
  const currentById = mapById(currentRows);
  const nextRows = new Map<string, T>();

  currentRows.forEach((row) => {
    const baseRow = baseById.get(row.id);
    if (baseRow && !baseRow.deleted_at && canonicalRowEquals(baseRow, row)) {
      nextRows.set(row.id, { ...baseRow, deleted_at: null } as T);
      return;
    }

    nextRows.set(row.id, { ...row, updated_at: nowIso, deleted_at: null });
  });

  baseRows.forEach((baseRow) => {
    if (currentById.has(baseRow.id)) return;
    if (baseRow.deleted_at) {
      nextRows.set(baseRow.id, baseRow);
      return;
    }
    nextRows.set(baseRow.id, { ...baseRow, updated_at: nowIso, deleted_at: nowIso });
  });

  return sortByPosition([...nextRows.values()]);
};

const prepareLocalDataset = (userId: string, localSpaces: any, baseDataset: SpacesSyncDataset) => {
  const currentDataset = buildCurrentDataset(userId, localSpaces);
  const nowIso = new Date().toISOString();

  return {
    workspaces: prepareRowsFromBase(currentDataset.workspaces, baseDataset.workspaces, nowIso),
    spaces: prepareRowsFromBase(currentDataset.spaces, baseDataset.spaces, nowIso),
    folders: prepareRowsFromBase(currentDataset.folders, baseDataset.folders, nowIso),
    lists: prepareRowsFromBase(currentDataset.lists, baseDataset.lists, nowIso),
    tasks: prepareRowsFromBase(currentDataset.tasks, baseDataset.tasks, nowIso),
    events: prepareRowsFromBase(currentDataset.events, baseDataset.events, nowIso),
  };
};

const mergeRowSet = <T extends SyncRowBase>(baseRows: T[], localRows: T[], remoteRows: T[]) => {
  const baseById = mapById(baseRows);
  const localById = mapById(localRows);
  const remoteById = mapById(remoteRows);
  const allIds = new Set<string>([
    ...baseRows.map((row) => row.id),
    ...localRows.map((row) => row.id),
    ...remoteRows.map((row) => row.id),
  ]);

  const mergedRows: T[] = [];
  allIds.forEach((id) => {
    const baseRow = baseById.get(id);
    const localRow = localById.get(id);
    const remoteRow = remoteById.get(id);

    if (!baseRow) {
      const winner = chooseLatestRow(localRow, remoteRow);
      if (winner) mergedRows.push(winner);
      return;
    }

    const localChanged = !canonicalRowEquals(baseRow, localRow) || !!localRow?.deleted_at !== !!baseRow.deleted_at;
    const remoteChanged = !canonicalRowEquals(baseRow, remoteRow) || !!remoteRow?.deleted_at !== !!baseRow.deleted_at;

    if (localChanged && remoteChanged) {
      const winner = chooseLatestRow(localRow, remoteRow);
      if (winner) mergedRows.push(winner);
      return;
    }

    if (localChanged && localRow) {
      mergedRows.push(localRow);
      return;
    }

    if (remoteChanged && remoteRow) {
      mergedRows.push(remoteRow);
      return;
    }

    if (remoteRow) {
      mergedRows.push(remoteRow);
      return;
    }

    if (localRow) {
      mergedRows.push(localRow);
      return;
    }

    mergedRows.push(baseRow);
  });

  return sortByPosition(mergedRows);
};

const mergeDatasets = (base: SpacesSyncDataset, local: SpacesSyncDataset, remote: SpacesSyncDataset): SpacesSyncDataset => ({
  workspaces: mergeRowSet(base.workspaces, local.workspaces, remote.workspaces),
  spaces: mergeRowSet(base.spaces, local.spaces, remote.spaces),
  folders: mergeRowSet(base.folders, local.folders, remote.folders),
  lists: mergeRowSet(base.lists, local.lists, remote.lists),
  tasks: mergeRowSet(base.tasks, local.tasks, remote.tasks),
  events: mergeRowSet(base.events, local.events, remote.events),
});

const buildPendingRows = <T extends SyncRowBase>(baseRows: T[], nextRows: T[]) => {
  const baseById = mapById(baseRows);
  return nextRows.filter((row) => {
    const baseRow = baseById.get(row.id);
    if (!baseRow) return true;
    return !canonicalRowEquals(baseRow, row) || baseRow.deleted_at !== row.deleted_at || baseRow.updated_at !== row.updated_at;
  });
};

const buildPendingDataset = (base: SpacesSyncDataset, next: SpacesSyncDataset): SpacesSyncDataset => ({
  workspaces: buildPendingRows(base.workspaces, next.workspaces),
  spaces: buildPendingRows(base.spaces, next.spaces),
  folders: buildPendingRows(base.folders, next.folders),
  lists: buildPendingRows(base.lists, next.lists),
  tasks: buildPendingRows(base.tasks, next.tasks),
  events: buildPendingRows(base.events, next.events),
});

const buildSpacesStateFromDataset = (dataset: SpacesSyncDataset, currentLocal: any): SpacesState => {
  const workspaceRows = activeRows(dataset.workspaces);
  const spaceRows = activeRows(dataset.spaces);
  const folderRows = activeRows(dataset.folders);
  const listRows = activeRows(dataset.lists);
  const taskRows = activeRows(dataset.tasks);
  const eventRows = activeRows(dataset.events);

  const workspaceById = new Map<string, Workspace>();
  const spaceById = new Map<string, Space>();
  const folderById = new Map<string, SpaceFolder>();
  const listById = new Map<string, SpaceList>();

  sortByPosition(workspaceRows).forEach((workspaceRow) => {
    workspaceById.set(workspaceRow.id, {
      id: workspaceRow.id,
      nombre: workspaceRow.name,
      espacios: [],
      agendaEvents: [],
    });
  });

  sortByPosition(spaceRows).forEach((spaceRow) => {
    const parentWorkspace = workspaceById.get(spaceRow.workspace_id);
    if (!parentWorkspace) return;

    const space: Space = {
      id: spaceRow.id,
      nombre: spaceRow.name,
      color: spaceRow.color,
      carpetas: [],
      listas: [],
    };
    parentWorkspace.espacios.push(space);
    spaceById.set(spaceRow.id, space);
  });

  sortByPosition(folderRows).forEach((folderRow) => {
    const parentSpace = spaceById.get(folderRow.space_id);
    if (!parentSpace) return;

    const folder: SpaceFolder = {
      id: folderRow.id,
      nombre: folderRow.name,
      listas: [],
    };
    parentSpace.carpetas.push(folder);
    folderById.set(folderRow.id, folder);
  });

  sortByPosition(listRows).forEach((listRow) => {
    const parentSpace = spaceById.get(listRow.space_id);
    if (!parentSpace) return;

    const list: SpaceList = {
      id: listRow.id,
      nombre: listRow.name,
      tareas: [],
      eventos: [],
    };

    if (listRow.folder_id) {
      const parentFolder = folderById.get(listRow.folder_id);
      if (!parentFolder) return;
      parentFolder.listas.push(list);
    } else {
      parentSpace.listas.push(list);
    }

    listById.set(listRow.id, list);
  });

  const tasksByParentKey = new Map<string, SpaceTaskRow[]>();
  sortByPosition(taskRows).forEach((taskRow) => {
    const key = `${taskRow.list_id}:${taskRow.parent_task_id || 'root'}`;
    const bucket = tasksByParentKey.get(key) || [];
    bucket.push(taskRow);
    tasksByParentKey.set(key, bucket);
  });

  const buildTaskTree = (listId: string, parentTaskId: string | null = null): SpaceTask[] => {
    const key = `${listId}:${parentTaskId || 'root'}`;
    const rows = tasksByParentKey.get(key) || [];
    return sortByPosition(rows).map((taskRow) => ({
      ...taskRow.payload,
      id: taskRow.id,
      orden: taskRow.payload?.orden ?? taskRow.position,
      subtasks: buildTaskTree(listId, taskRow.id),
    }));
  };

  listById.forEach((list) => {
    list.tareas = buildTaskTree(list.id);
  });

  eventRows.forEach((eventRow) => {
    const event: SpaceEvent = {
      ...(eventRow.payload || {}),
      id: eventRow.id,
    };

    if (eventRow.kind === 'global_gcal') return;
    if (eventRow.kind === 'workspace_agenda') {
      workspaceById.get(eventRow.workspace_id)?.agendaEvents.push(event);
      return;
    }

    if (eventRow.kind === 'list_event') {
      listById.get(eventRow.list_id || '')?.eventos.push(event);
    }
  });

  const gcalEvents = eventRows
    .filter((eventRow) => eventRow.kind === 'global_gcal')
    .map((eventRow) => ({
      ...(eventRow.payload || {}),
      id: eventRow.id,
    }));

  const currentState = currentLocal && typeof currentLocal === 'object' ? currentLocal : {};
  return {
    workspaces: [...workspaceById.values()],
    activeWorkspaceId: currentState.activeWorkspaceId || workspaceRows[0]?.id || null,
    activeSpaceId: currentState.activeSpaceId || null,
    activeFolderId: currentState.activeFolderId || null,
    activeListId: currentState.activeListId || null,
    lastSelectionByWorkspace: currentState.lastSelectionByWorkspace || {},
    expandedIds: currentState.expandedIds || [],
    rules: currentState.rules || DEFAULT_RULES,
    gcalEvents,
    rulesOverride: currentState.rulesOverride || null,
  };
};

const normalizeRemoteDataset = (dataset?: Partial<Record<keyof SpacesSyncDataset, any[]>> | null): SpacesSyncDataset => ({
  workspaces: sortByPosition((dataset?.workspaces || []).map((row, index) => ({
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    position: normalizePosition(row.position, index),
    updated_at: row.updated_at || '',
    deleted_at: row.deleted_at || null,
  }))),
  spaces: sortByPosition((dataset?.spaces || []).map((row, index) => ({
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    name: row.name,
    color: row.color,
    position: normalizePosition(row.position, index),
    updated_at: row.updated_at || '',
    deleted_at: row.deleted_at || null,
  }))),
  folders: sortByPosition((dataset?.folders || []).map((row, index) => ({
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    space_id: row.space_id,
    name: row.name,
    position: normalizePosition(row.position, index),
    updated_at: row.updated_at || '',
    deleted_at: row.deleted_at || null,
  }))),
  lists: sortByPosition((dataset?.lists || []).map((row, index) => ({
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    space_id: row.space_id,
    folder_id: row.folder_id || null,
    name: row.name,
    position: normalizePosition(row.position, index),
    updated_at: row.updated_at || '',
    deleted_at: row.deleted_at || null,
  }))),
  tasks: sortByPosition((dataset?.tasks || []).map((row, index) => ({
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    space_id: row.space_id,
    folder_id: row.folder_id || null,
    list_id: row.list_id,
    parent_task_id: row.parent_task_id || null,
    position: normalizePosition(row.position, index),
    payload: row.payload || {},
    updated_at: row.updated_at || '',
    deleted_at: row.deleted_at || null,
  }))),
  events: sortByPosition((dataset?.events || []).map((row, index) => ({
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    space_id: row.space_id || null,
    folder_id: row.folder_id || null,
    list_id: row.list_id || null,
    kind: row.kind,
    position: normalizePosition(row.position, index),
    payload: row.payload || {},
    updated_at: row.updated_at || '',
    deleted_at: row.deleted_at || null,
  }))),
});

const serializeDataset = (dataset: SpacesSyncDataset) => ({
  workspaces: dataset.workspaces.map((row) => ({ id: row.id, name: row.name, position: Math.trunc(normalizePosition(row.position, 0)), deleted_at: row.deleted_at })),
  spaces: dataset.spaces.map((row) => ({ id: row.id, workspace_id: row.workspace_id, name: row.name, color: row.color, position: Math.trunc(normalizePosition(row.position, 0)), deleted_at: row.deleted_at })),
  folders: dataset.folders.map((row) => ({ id: row.id, workspace_id: row.workspace_id, space_id: row.space_id, name: row.name, position: Math.trunc(normalizePosition(row.position, 0)), deleted_at: row.deleted_at })),
  lists: dataset.lists.map((row) => ({ id: row.id, workspace_id: row.workspace_id, space_id: row.space_id, folder_id: row.folder_id, name: row.name, position: Math.trunc(normalizePosition(row.position, 0)), deleted_at: row.deleted_at })),
  tasks: dataset.tasks.map((row) => ({ id: row.id, workspace_id: row.workspace_id, space_id: row.space_id, folder_id: row.folder_id, list_id: row.list_id, parent_task_id: row.parent_task_id, position: Math.trunc(normalizePosition(row.position, 0)), payload: row.payload || {}, deleted_at: row.deleted_at })),
  events: dataset.events.map((row) => ({ id: row.id, workspace_id: row.workspace_id, space_id: row.space_id, folder_id: row.folder_id, list_id: row.list_id, kind: row.kind, position: Math.trunc(normalizePosition(row.position, 0)), payload: row.payload || {}, deleted_at: row.deleted_at })),
});

const parseRpcJson = <T>(payload: any): T => typeof payload === 'string' ? JSON.parse(payload) as T : (payload || {}) as T;

const downloadSpacesSnapshot = async (): Promise<SpacesSnapshotResponse> => {
  const response = await supabase.rpc('spaces_sync_get_snapshot');
  if (response.error) throw response.error;

  const payload = parseRpcJson<any>(response.data);
  return {
    meta: normalizeMeta(payload?.meta),
    dataset: normalizeRemoteDataset(payload),
  };
};

const applyBatchDataset = async (dataset: SpacesSyncDataset, options: { replaceAll?: boolean; status?: RepairStatus } = {}): Promise<SpacesSyncMeta> => {
  const response = await supabase.rpc('spaces_sync_apply_batch', {
    p_payload: serializeDataset(dataset),
    p_replace_all: !!options.replaceAll,
    p_status: options.status || 'ready',
  });

  if (response.error) throw response.error;
  return normalizeMeta(parseRpcJson<any>(response.data));
};

export const getSpacesCloudLastModified = async (userId: string): Promise<number> => {
  const response = await supabase
    .from('spaces_sync_meta')
    .select('updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (response.error) {
    throw new Error(`[spaces sync] refresh check failed: ${response.error.message}`);
  }

  const updatedAt = response.data?.updated_at;
  return updatedAt ? new Date(updatedAt).getTime() : 0;
};

export const downloadLegacySpacesStore = async (userId: string): Promise<LegacySpacesBackup> => {
  const response = await supabase
    .from('spaces_store')
    .select('spaces_data, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (response.error) throw response.error;

  return {
    spaces: response.data?.spaces_data || null,
    updatedAt: response.data?.updated_at || null,
  };
};

const savePreMigrationBackups = (localSpaces: any, legacySpaces: any) => {
  if (!localStorage.getItem(LOCAL_BACKUP_KEY)) writeJson(LOCAL_BACKUP_KEY, localSpaces || {});
  if (!localStorage.getItem(LEGACY_BACKUP_KEY)) writeJson(LEGACY_BACKUP_KEY, legacySpaces || {});
};

const mergeRepairRowSet = <T extends SyncRowBase>(rowGroups: T[][]) => {
  const allIds = new Set<string>();
  rowGroups.forEach((rows) => rows.forEach((row) => allIds.add(row.id)));
  const sourceMaps = rowGroups.map((rows) => mapById(rows));

  const mergedRows: T[] = [];
  allIds.forEach((id) => {
    let winner: T | null = null;
    sourceMaps.forEach((sourceMap) => {
      winner = chooseLatestRow(winner, sourceMap.get(id) || null);
    });
    if (winner) mergedRows.push(winner);
  });

  return sortByPosition(mergedRows);
};

const mergeRepairDatasets = (datasets: SpacesSyncDataset[]): SpacesSyncDataset => ({
  workspaces: mergeRepairRowSet(datasets.map((dataset) => dataset.workspaces)),
  spaces: mergeRepairRowSet(datasets.map((dataset) => dataset.spaces)),
  folders: mergeRepairRowSet(datasets.map((dataset) => dataset.folders)),
  lists: mergeRepairRowSet(datasets.map((dataset) => dataset.lists)),
  tasks: mergeRepairRowSet(datasets.map((dataset) => dataset.tasks)),
  events: mergeRepairRowSet(datasets.map((dataset) => dataset.events)),
});

const chooseRepairSource = (normalizedDataset: SpacesSyncDataset, localDataset: SpacesSyncDataset, legacyDataset: SpacesSyncDataset) => {
  const normalizedActive = activeOnlyDataset(normalizedDataset);
  const ranked = [
    { dataset: normalizedActive, migrationSource: 'normalized' as MigrationSource, count: countDatasetRows(normalizedActive), version: datasetVersionMs(normalizedDataset) },
    { dataset: localDataset, migrationSource: 'local_cache' as MigrationSource, count: countDatasetRows(localDataset), version: datasetVersionMs(localDataset) },
    { dataset: legacyDataset, migrationSource: 'legacy_remote' as MigrationSource, count: countDatasetRows(legacyDataset), version: datasetVersionMs(legacyDataset) },
  ].sort((left, right) => right.count - left.count || right.version - left.version);

  const best = ranked[0];
  if (!best || best.count === 0) {
    return { dataset: cloneDataset(EMPTY_DATASET), migrationSource: 'empty' as MigrationSource };
  }

  return { dataset: best.dataset, migrationSource: best.migrationSource };
};

const needsRepair = (meta: SpacesSyncMeta) =>
  meta.schema_version < TARGET_SCHEMA_VERSION || meta.status !== 'ready';

const repairNormalizedSnapshot = async (userId: string, currentLocalSpaces: any, remoteSnapshot: SpacesSnapshotResponse) => {
  const legacyBackup = await downloadLegacySpacesStore(userId);
  savePreMigrationBackups(currentLocalSpaces, legacyBackup.spaces);

  const nowIso = new Date().toISOString();
  const localLastModified = parseInt(localStorage.getItem('coo_last_local_mod') || '0', 10);
  const localDataset = buildCurrentDataset(userId, currentLocalSpaces, toIsoFromMillis(localLastModified, nowIso));
  const legacyDataset = buildCurrentDataset(userId, legacyBackup.spaces, legacyBackup.updatedAt || nowIso);

  const preferred = chooseRepairSource(remoteSnapshot.dataset, localDataset, legacyDataset);
  const additionalSources = [remoteSnapshot.dataset, legacyDataset, localDataset].filter((dataset) => dataset !== preferred.dataset);
  const repairedDataset = activeOnlyDataset(mergeRepairDatasets([...additionalSources, preferred.dataset]));

  const appliedMeta = await applyBatchDataset(repairedDataset, {
    replaceAll: true,
    status: 'ready',
  });
  const freshSnapshot = await downloadSpacesSnapshot();

  return {
    dataset: freshSnapshot.dataset,
    meta: freshSnapshot.meta,
    migrationSource: preferred.migrationSource,
    appliedMeta,
  };
};

export const getLocalPendingSpacesCount = (userId: string, currentLocalSpaces: any) => {
  const cache = readLocalCache();
  const pending = buildPendingDataset(cache.base, prepareLocalDataset(userId, currentLocalSpaces, cache.base));
  return countDatasetRows(pending);
};

export const runSpacesSyncCycle = async ({ userId, currentLocalSpaces }: SpacesSyncCycleOptions): Promise<SpacesSyncCycleResult> => {
  const cache = readLocalCache();
  const diagnostics: SpacesSyncDiagnostics = normalizeDiagnostics({
    ...cache.diagnostics,
    deviceId: getOrCreateSpacesSyncDeviceId(),
    mode: 'live',
    lastError: null,
  });

  try {
    let snapshot = await downloadSpacesSnapshot();
    diagnostics.lastPull = new Date().toISOString();
    diagnostics.lastRemote = snapshot.meta.updated_at || diagnostics.lastPull;
    diagnostics.schemaVersion = snapshot.meta.schema_version;
    diagnostics.snapshotVersion = snapshot.meta.snapshot_version;
    diagnostics.repairStatus = snapshot.meta.status;

    if (needsRepair(snapshot.meta)) {
      diagnostics.mode = 'migrating';
      const repaired = await repairNormalizedSnapshot(userId, currentLocalSpaces, snapshot);
      snapshot = { dataset: repaired.dataset, meta: repaired.meta };
      diagnostics.lastPush = repaired.appliedMeta.updated_at || new Date().toISOString();
      diagnostics.lastPull = new Date().toISOString();
      diagnostics.lastRemote = snapshot.meta.updated_at || diagnostics.lastPull;
      diagnostics.schemaVersion = snapshot.meta.schema_version;
      diagnostics.snapshotVersion = snapshot.meta.snapshot_version;
      diagnostics.repairStatus = snapshot.meta.status;
      diagnostics.migrationSource = repaired.migrationSource;
    } else {
      diagnostics.migrationSource = 'normalized';
    }

    const baseDataset = cloneDataset(cache.base);
    const localPrepared = prepareLocalDataset(userId, currentLocalSpaces, baseDataset);
    const mergedDataset = mergeDatasets(baseDataset, localPrepared, snapshot.dataset);
    const pendingDataset = buildPendingDataset(snapshot.dataset, mergedDataset);
    const didUpload = countDatasetRows(pendingDataset) > 0;

    if (didUpload) {
      const appliedMeta = await applyBatchDataset(pendingDataset, { replaceAll: false, status: 'ready' });
      diagnostics.lastPush = appliedMeta.updated_at || new Date().toISOString();
      snapshot = await downloadSpacesSnapshot();
      diagnostics.lastPull = new Date().toISOString();
      diagnostics.lastRemote = snapshot.meta.updated_at || diagnostics.lastPull;
      diagnostics.schemaVersion = snapshot.meta.schema_version;
      diagnostics.snapshotVersion = snapshot.meta.snapshot_version;
      diagnostics.repairStatus = snapshot.meta.status;
    }

    const nextSpacesState = buildSpacesStateFromDataset(snapshot.dataset, currentLocalSpaces);
    const nextDiagnostics: SpacesSyncDiagnostics = normalizeDiagnostics({
      ...diagnostics,
      mode: snapshot.meta.status === 'ready' ? 'live' : 'migrating',
      pending: 0,
      lastRemote: snapshot.meta.updated_at || diagnostics.lastPull,
      lastError: snapshot.meta.last_error || null,
    });

    writeLocalCache({
      base: snapshot.dataset,
      diagnostics: nextDiagnostics,
    });

    return {
      nextSpacesState,
      diagnostics: nextDiagnostics,
      didUpload,
    };
  } catch (error: any) {
    const nextDiagnostics: SpacesSyncDiagnostics = normalizeDiagnostics({
      ...diagnostics,
      mode: 'safe',
      lastError: error?.message || 'No se pudo sincronizar Espacios.',
      pending: getLocalPendingSpacesCount(userId, currentLocalSpaces),
    });

    writeLocalCache({
      base: cache.base,
      diagnostics: nextDiagnostics,
    });

    return {
      nextSpacesState: {
        ...(currentLocalSpaces || {}),
        workspaces: Array.isArray(currentLocalSpaces?.workspaces) ? currentLocalSpaces.workspaces : [],
        activeWorkspaceId: currentLocalSpaces?.activeWorkspaceId || null,
        activeSpaceId: currentLocalSpaces?.activeSpaceId || null,
        activeFolderId: currentLocalSpaces?.activeFolderId || null,
        activeListId: currentLocalSpaces?.activeListId || null,
        lastSelectionByWorkspace: currentLocalSpaces?.lastSelectionByWorkspace || {},
        expandedIds: currentLocalSpaces?.expandedIds || [],
        rules: currentLocalSpaces?.rules || DEFAULT_RULES,
        gcalEvents: currentLocalSpaces?.gcalEvents || [],
        rulesOverride: currentLocalSpaces?.rulesOverride || null,
      } as SpacesState,
      diagnostics: nextDiagnostics,
      didUpload: false,
    };
  }
};
