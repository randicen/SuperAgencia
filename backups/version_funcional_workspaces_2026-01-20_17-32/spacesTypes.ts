
export type TaskPriority = 'ASAP' | 'High' | 'Medium' | 'Low';
export type TaskStatus = 'TODO' | 'ACTIVE' | 'DONE';
export type DeadlineType = 'Hard Deadline' | 'Soft Deadline';

export interface ScheduledSlot {
    id: string;
    start: string;
    end: string;
    isFragment: boolean;
}

export interface SpaceTask {
    id: string;
    nombre: string;
    // BASIC
    estado: TaskStatus;
    orden: number;
    progress: number;
    // SCHEDULING
    autoSchedule: boolean;
    startDate: string;
    endDate: string;
    dueDate: string;
    deadlineType: DeadlineType;
    duration: number;        // minutos de esfuerzo
    elasticity: number;      // 0=Rígido, 1=Flexible
    // PRIORITY & VALUE
    priority: TaskPriority;
    totalValue: number;
    // OPTIONAL
    clientName?: string;
    scheduledSlots?: ScheduledSlot[];
    hasConflict?: boolean;
}

export interface SpaceList {
    id: string;
    nombre: string;
    tareas: SpaceTask[];
}

export interface SpaceFolder {
    id: string;
    nombre: string;
    listas: SpaceList[];
}

export interface Space {
    id: string;
    nombre: string;
    color: string;
    carpetas: SpaceFolder[];
    listas: SpaceList[];
}

export interface Workspace {
    id: string;
    nombre: string;
    espacios: Space[];
}

export interface SpacesState {
    workspaces: Workspace[];
    activeWorkspaceId: string | null;
    // Navigation state within active workspace
    activeSpaceId: string | null;
    activeFolderId: string | null;
    activeListId: string | null;
    expandedIds: string[];
}

export type SpacesAction =
    // WORKSPACE ACTIONS
    | { type: 'ADD_WORKSPACE'; payload: { nombre: string } }
    | { type: 'DELETE_WORKSPACE'; payload: { workspaceId: string } }
    | { type: 'RENAME_WORKSPACE'; payload: { workspaceId: string; nombre: string } }
    | { type: 'SET_ACTIVE_WORKSPACE'; payload: { workspaceId: string } }
    // SPACE ACTIONS (operate on active workspace)
    | { type: 'ADD_SPACE'; payload: { id?: string; nombre: string; color: string } }
    | { type: 'DELETE_SPACE'; payload: { spaceId: string } }
    | { type: 'ADD_FOLDER'; payload: { spaceId: string; nombre: string } }
    | { type: 'DELETE_FOLDER'; payload: { spaceId: string; folderId: string } }
    | { type: 'ADD_LIST'; payload: { id?: string; spaceId: string; folderId?: string; nombre: string } }
    | { type: 'DELETE_LIST'; payload: { spaceId: string; folderId?: string; listId: string } }
    | { type: 'ADD_TASK'; payload: { spaceId: string; folderId?: string; listId: string; task: Omit<SpaceTask, 'id' | 'orden'> } }
    | { type: 'UPDATE_TASK'; payload: { spaceId: string; folderId?: string; listId: string; task: SpaceTask } }
    | { type: 'DELETE_TASK'; payload: { spaceId: string; folderId?: string; listId: string; taskId: string } }
    | { type: 'SET_ACTIVE'; payload: { spaceId?: string | null; folderId?: string | null; listId?: string | null } }
    | { type: 'TOGGLE_EXPAND'; payload: { id: string } }
    | { type: 'LOAD_STATE'; payload: SpacesState }
    // MIGRATION HELPER
    | { type: 'MIGRATE_OLD_STATE'; payload: { oldEspacios: Space[] } };
