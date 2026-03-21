import { BusinessRules, Installment } from './types';

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
    clientId?: string;
    installments?: Installment[];
    scheduledSlots?: ScheduledSlot[];
    hasConflict?: boolean;
    conflictDescription?: string;
    subtasks?: SpaceTask[];
    description?: string;
}

export interface SpaceEvent {
    id: string;
    nombre: string;
    startDate: string;
    endDate: string;
    description?: string;
}

export interface SpaceList {
    id: string;
    nombre: string;
    tareas: SpaceTask[];
    eventos: SpaceEvent[];
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
    rules: BusinessRules;
    gcalEvents: SpaceEvent[];
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
    | { type: 'RENAME_SPACE'; payload: { spaceId: string; nombre: string } }
    | { type: 'ADD_FOLDER'; payload: { spaceId: string; nombre: string } }
    | { type: 'DELETE_FOLDER'; payload: { spaceId: string; folderId: string } }
    | { type: 'RENAME_FOLDER'; payload: { spaceId: string; folderId: string; nombre: string } }
    | { type: 'ADD_LIST'; payload: { id?: string; spaceId: string; folderId?: string; nombre: string } }
    | { type: 'DELETE_LIST'; payload: { spaceId: string; folderId?: string; listId: string } }
    | { type: 'RENAME_LIST'; payload: { spaceId: string; folderId?: string; listId: string; nombre: string } }
    | { type: 'MOVE_LIST'; payload: { spaceId: string; listId: string; sourceFolderId?: string; targetFolderId: string } }
    | { type: 'ADD_TASK'; payload: { spaceId: string; folderId?: string; listId: string; task: Omit<SpaceTask, 'id' | 'orden'> } }
    | { type: 'UPDATE_TASK'; payload: { spaceId: string; folderId?: string; listId: string; task: SpaceTask } }
    | { type: 'DELETE_TASK'; payload: { spaceId: string; folderId?: string; listId: string; taskId: string } }
    // EVENT ACTIONS
    | { type: 'ADD_EVENT'; payload: { spaceId: string; folderId?: string; listId: string; event: Omit<SpaceEvent, 'id'> } }
    | { type: 'UPDATE_EVENT'; payload: { spaceId: string; folderId?: string; listId: string; event: SpaceEvent } }
    | { type: 'DELETE_EVENT'; payload: { spaceId: string; folderId?: string; listId: string; eventId: string } }
    | { type: 'SET_ACTIVE'; payload: { spaceId?: string | null; folderId?: string | null; listId?: string | null } }
    | { type: 'TOGGLE_EXPAND'; payload: { id: string } }
    | { type: 'UPDATE_RULES'; payload: BusinessRules }
    | { type: 'LOAD_STATE'; payload: SpacesState }
    | { type: 'SET_GCAL_EVENTS'; payload: { events: SpaceEvent[] } }
    // MIGRATION HELPER
    | { type: 'MIGRATE_OLD_STATE'; payload: { oldEspacios: Space[] } };
