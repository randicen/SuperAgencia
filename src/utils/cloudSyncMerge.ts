import { DEFAULT_RULES } from '../mockData';
import { BusinessRules, ChatSession, Client, Note, Project, Transaction } from '../types';

type EntityWithId = { id: string; [key: string]: any };

export interface CloudSyncStateSnapshot {
  projects: Project[];
  clients: Client[];
  transactions: Transaction[];
  rules: BusinessRules;
  notes: Note[];
  chatSessions: ChatSession[];
  spaces: any;
}

const isEqual = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const toRecord = <T extends Record<string, any>>(value: T | null | undefined): T | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  return value;
};

const mergeFieldRecord = <T extends Record<string, any>>(
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined
): T | null => {
  if (!base) {
    if (!local && !remote) return null;
    if (local && remote) return { ...remote, ...local };
    return local || remote || null;
  }

  const localChanged = local ? !isEqual(local, base) : true;
  const remoteChanged = remote ? !isEqual(remote, base) : true;

  if (!local) return null;
  if (!remote) return localChanged ? local : null;
  if (localChanged && remoteChanged) return { ...remote, ...local };
  if (localChanged) return local;
  if (remoteChanged) return remote;
  return remote;
};

const getOrderedIds = (
  base: EntityWithId[] = [],
  local: EntityWithId[] = [],
  remote: EntityWithId[] = []
) => {
  const baseIds = base.map(item => item.id);
  const localIds = local.map(item => item.id);
  const remoteIds = remote.map(item => item.id);
  const localOrderChanged = !isEqual(localIds, baseIds);
  const preferredIds = localOrderChanged
    ? [...localIds, ...remoteIds.filter(id => !localIds.includes(id))]
    : [...remoteIds, ...localIds.filter(id => !remoteIds.includes(id))];

  return [...preferredIds, ...baseIds.filter(id => !preferredIds.includes(id))];
};

const mergeEntityArray = <T extends EntityWithId>(
  base: T[] = [],
  local: T[] = [],
  remote: T[] = [],
  mergeEntity: (baseItem: T | undefined, localItem: T | undefined, remoteItem: T | undefined) => T | null
): T[] => {
  const baseById = new Map(base.map(item => [item.id, item]));
  const localById = new Map(local.map(item => [item.id, item]));
  const remoteById = new Map(remote.map(item => [item.id, item]));

  return getOrderedIds(base, local, remote)
    .map(id => mergeEntity(baseById.get(id), localById.get(id), remoteById.get(id)))
    .filter((item): item is T => item !== null);
};

const mergeSimpleEntity = <T extends EntityWithId>(
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined
): T | null => mergeFieldRecord(base, local, remote) as T | null;

const sanitizeSpacesRoot = (spaces: any) => {
  const source = toRecord(spaces) || {};
  return {
    workspaces: Array.isArray(source.workspaces) ? source.workspaces : [],
    rules: source.rules || DEFAULT_RULES,
    gcalEvents: Array.isArray(source.gcalEvents) ? source.gcalEvents : [],
  };
};

const collectExpandableIds = (workspaces: any[] = []) => {
  const ids = new Set<string>();

  workspaces.forEach((workspace: any) => {
    if (!workspace?.id) return;
    ids.add(workspace.id);

    (workspace.espacios || []).forEach((space: any) => {
      if (!space?.id) return;
      ids.add(space.id);

      (space.carpetas || []).forEach((folder: any) => {
        if (!folder?.id) return;
        ids.add(folder.id);

        (folder.listas || []).forEach((list: any) => {
          if (list?.id) ids.add(list.id);
        });
      });

      (space.listas || []).forEach((list: any) => {
        if (list?.id) ids.add(list.id);
      });
    });
  });

  return ids;
};

const findListLocation = (space: any, listId?: string | null) => {
  if (!space || !listId) {
    return { folder: null, list: null };
  }

  const directList = (space.listas || []).find((list: any) => list.id === listId) || null;
  if (directList) {
    return { folder: null, list: directList };
  }

  for (const folder of space.carpetas || []) {
    const nestedList = (folder.listas || []).find((list: any) => list.id === listId) || null;
    if (nestedList) {
      return { folder, list: nestedList };
    }
  }

  return { folder: null, list: null };
};

export const resolveSpacesLocalSelection = (workspaces: any[] = [], currentLocalSpaces: any = {}) => {
  const activeWorkspace =
    workspaces.find((workspace: any) => workspace.id === currentLocalSpaces.activeWorkspaceId) ||
    workspaces[0] ||
    null;

  let activeSpace: any | null = null;
  if (activeWorkspace) {
    const availableSpaces = activeWorkspace.espacios || [];
    const hasPreferredSelection = !!(
      currentLocalSpaces.activeSpaceId ||
      currentLocalSpaces.activeFolderId ||
      currentLocalSpaces.activeListId
    );
    activeSpace =
      availableSpaces.find((space: any) => space.id === currentLocalSpaces.activeSpaceId) ||
      availableSpaces.find((space: any) => {
        if (currentLocalSpaces.activeFolderId && (space.carpetas || []).some((folder: any) => folder.id === currentLocalSpaces.activeFolderId)) {
          return true;
        }

        if (!currentLocalSpaces.activeListId) return false;
        return !!findListLocation(space, currentLocalSpaces.activeListId).list;
      }) ||
      (hasPreferredSelection ? availableSpaces[0] : null) ||
      null;
  }

  let activeFolder: any | null = null;
  let activeList: any | null = null;

  if (activeSpace) {
    const preferredFolder =
      (activeSpace.carpetas || []).find((folder: any) => folder.id === currentLocalSpaces.activeFolderId) || null;
    const preferredListLocation = findListLocation(activeSpace, currentLocalSpaces.activeListId);

    if (preferredFolder) {
      activeFolder = preferredFolder;
      activeList =
        (preferredFolder.listas || []).find((list: any) => list.id === currentLocalSpaces.activeListId) || null;
    } else if (preferredListLocation.folder && preferredListLocation.list) {
      activeFolder = preferredListLocation.folder;
      activeList = preferredListLocation.list;
    } else if (preferredListLocation.list) {
      activeList = preferredListLocation.list;
    }
  }

  const expandableIds = collectExpandableIds(workspaces);
  const validExpandedIds = Array.isArray(currentLocalSpaces.expandedIds)
    ? currentLocalSpaces.expandedIds.filter((id: string) => expandableIds.has(id))
    : [];

  return {
    activeWorkspaceId: activeWorkspace?.id || null,
    activeSpaceId: activeSpace?.id || null,
    activeFolderId: activeFolder?.id || null,
    activeListId: activeList?.id || null,
    expandedIds: validExpandedIds,
  };
};

const stripTask = (task?: any) => {
  const source = toRecord(task);
  if (!source) return undefined;
  const { subtasks, ...rest } = source;
  return rest;
};

const stripList = (list?: any) => {
  const source = toRecord(list);
  if (!source) return undefined;
  const { tareas, eventos, ...rest } = source;
  return rest;
};

const stripFolder = (folder?: any) => {
  const source = toRecord(folder);
  if (!source) return undefined;
  const { listas, ...rest } = source;
  return rest;
};

const stripSpace = (space?: any) => {
  const source = toRecord(space);
  if (!source) return undefined;
  const { listas, carpetas, ...rest } = source;
  return rest;
};

const stripWorkspace = (workspace?: any) => {
  const source = toRecord(workspace);
  if (!source) return undefined;
  const { espacios, agendaEvents, ...rest } = source;
  return rest;
};

const mergeSpaceTask = (base?: any, local?: any, remote?: any): any | null => {
  const mergedFields = mergeFieldRecord(stripTask(base), stripTask(local), stripTask(remote));
  if (!mergedFields) return null;

  return {
    ...mergedFields,
    subtasks: mergeEntityArray(base?.subtasks || [], local?.subtasks || [], remote?.subtasks || [], mergeSpaceTask),
  };
};

const mergeSpaceEvent = (base?: any, local?: any, remote?: any): any | null =>
  mergeFieldRecord(base, local, remote);

const mergeSpaceList = (base?: any, local?: any, remote?: any): any | null => {
  const mergedFields = mergeFieldRecord(stripList(base), stripList(local), stripList(remote));
  if (!mergedFields) return null;

  return {
    ...mergedFields,
    tareas: mergeEntityArray(base?.tareas || [], local?.tareas || [], remote?.tareas || [], mergeSpaceTask),
    eventos: mergeEntityArray(base?.eventos || [], local?.eventos || [], remote?.eventos || [], mergeSpaceEvent),
  };
};

const mergeSpaceFolder = (base?: any, local?: any, remote?: any): any | null => {
  const mergedFields = mergeFieldRecord(stripFolder(base), stripFolder(local), stripFolder(remote));
  if (!mergedFields) return null;

  return {
    ...mergedFields,
    listas: mergeEntityArray(base?.listas || [], local?.listas || [], remote?.listas || [], mergeSpaceList),
  };
};

const mergeSpace = (base?: any, local?: any, remote?: any): any | null => {
  const mergedFields = mergeFieldRecord(stripSpace(base), stripSpace(local), stripSpace(remote));
  if (!mergedFields) return null;

  return {
    ...mergedFields,
    carpetas: mergeEntityArray(base?.carpetas || [], local?.carpetas || [], remote?.carpetas || [], mergeSpaceFolder),
    listas: mergeEntityArray(base?.listas || [], local?.listas || [], remote?.listas || [], mergeSpaceList),
  };
};

const mergeWorkspace = (base?: any, local?: any, remote?: any): any | null => {
  const mergedFields = mergeFieldRecord(stripWorkspace(base), stripWorkspace(local), stripWorkspace(remote));
  if (!mergedFields) return null;

  return {
    ...mergedFields,
    espacios: mergeEntityArray(base?.espacios || [], local?.espacios || [], remote?.espacios || [], mergeSpace),
    agendaEvents: mergeEntityArray(base?.agendaEvents || [], local?.agendaEvents || [], remote?.agendaEvents || [], mergeSpaceEvent),
  };
};

const mergeRules = (
  base?: BusinessRules,
  local?: BusinessRules,
  remote?: BusinessRules
): BusinessRules => {
  const merged = mergeFieldRecord(base, local, remote);
  return (merged || local || remote || DEFAULT_RULES) as BusinessRules;
};

export const sanitizeSpacesForCloud = (spaces: any) => sanitizeSpacesRoot(spaces);

export const rehydrateSpacesLocalState = (cloudSpaces: any, currentLocalSpaces: any) => {
  const sanitizedCloud = sanitizeSpacesRoot(cloudSpaces);
  const currentLocal = toRecord(currentLocalSpaces) || {};
  const activeSelection = resolveSpacesLocalSelection(sanitizedCloud.workspaces || [], currentLocal);

  return {
    ...sanitizedCloud,
    ...activeSelection,
    rulesOverride: currentLocal.rulesOverride || null,
  };
};

export const normalizeCloudSyncState = (state?: Partial<CloudSyncStateSnapshot> | null): CloudSyncStateSnapshot => ({
  projects: state?.projects || [],
  clients: state?.clients || [],
  transactions: state?.transactions || [],
  rules: state?.rules || DEFAULT_RULES,
  notes: state?.notes || [],
  chatSessions: state?.chatSessions || [],
  spaces: sanitizeSpacesForCloud(state?.spaces),
});

export const mergeCloudSyncState = (
  baseState?: Partial<CloudSyncStateSnapshot> | null,
  localState?: Partial<CloudSyncStateSnapshot> | null,
  remoteState?: Partial<CloudSyncStateSnapshot> | null
): CloudSyncStateSnapshot => {
  const base = normalizeCloudSyncState(baseState);
  const local = normalizeCloudSyncState(localState);
  const remote = normalizeCloudSyncState(remoteState);

  return {
    projects: mergeEntityArray(base.projects, local.projects, remote.projects, mergeSimpleEntity),
    clients: mergeEntityArray(base.clients, local.clients, remote.clients, mergeSimpleEntity),
    transactions: mergeEntityArray(base.transactions, local.transactions, remote.transactions, mergeSimpleEntity),
    rules: mergeRules(base.rules, local.rules, remote.rules),
    notes: mergeEntityArray(base.notes, local.notes, remote.notes, mergeSimpleEntity),
    chatSessions: mergeEntityArray(base.chatSessions, local.chatSessions, remote.chatSessions, mergeSimpleEntity),
    spaces: {
      workspaces: mergeEntityArray(
        base.spaces.workspaces || [],
        local.spaces.workspaces || [],
        remote.spaces.workspaces || [],
        mergeWorkspace
      ),
      rules: mergeRules(base.spaces.rules, local.spaces.rules, remote.spaces.rules),
      gcalEvents: mergeEntityArray(
        base.spaces.gcalEvents || [],
        local.spaces.gcalEvents || [],
        remote.spaces.gcalEvents || [],
        mergeSpaceEvent
      ),
    },
  };
};
