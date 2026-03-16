
import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { SpacesState, SpacesAction, Space, SpaceFolder, SpaceList, SpaceTask, Workspace } from '../spacesTypes';
import { runAutoScheduling } from '../utils/schedulingLogic';
import { DEFAULT_RULES } from '../mockData';
import { Project, Priority } from '../types';

const generateId = () => Math.random().toString(36).substr(2, 9);

const initialState: SpacesState = {
    workspaces: [],
    activeWorkspaceId: null,
    activeSpaceId: null,
    activeFolderId: null,
    activeListId: null,
    expandedIds: [],
};

// Helper: Run scheduling on the active workspace
const recalculateScheduling = (state: SpacesState): SpacesState => {
    if (!state.activeWorkspaceId) return state;

    const workspace = state.workspaces.find(w => w.id === state.activeWorkspaceId);
    if (!workspace) return state;

    // 1. Flatten tasks from active workspace
    const allTasks: Project[] = [];

    workspace.espacios.forEach(s => {
        s.listas.forEach(l => {
            l.tareas.forEach(t => {
                const p: Project = {
                    id: t.id,
                    clientId: '',
                    clientName: t.clientName || '',
                    projectName: t.nombre,
                    startDate: t.startDate || new Date().toISOString().split('T')[0],
                    endDate: t.endDate || new Date().toISOString().split('T')[0],
                    priority: t.priority === 'ASAP' ? Priority.ASAP : t.priority === 'High' ? Priority.HIGH : t.priority === 'Medium' ? Priority.MEDIUM : Priority.LOW,
                    progress: t.progress,
                    totalValue: t.totalValue,
                    paidValue: 0,
                    status: t.estado === 'TODO' ? 'todo' : t.estado === 'DONE' ? 'completed' : 'active',
                    duration: t.duration,
                    deadlineType: t.deadlineType as 'Hard Deadline' | 'Soft Deadline',
                    dueDate: t.dueDate,
                    autoSchedule: t.autoSchedule,
                    elasticity: t.elasticity,
                    scheduledSlots: t.scheduledSlots || [],
                    hasConflict: t.hasConflict
                };
                allTasks.push(p);
            });
        });
        s.carpetas.forEach(f => {
            f.listas.forEach(l => {
                l.tareas.forEach(t => {
                    const p: Project = {
                        id: t.id,
                        clientId: '',
                        clientName: t.clientName || '',
                        projectName: t.nombre,
                        startDate: t.startDate || new Date().toISOString().split('T')[0],
                        endDate: t.endDate || new Date().toISOString().split('T')[0],
                        priority: t.priority === 'ASAP' ? Priority.ASAP : t.priority === 'High' ? Priority.HIGH : t.priority === 'Medium' ? Priority.MEDIUM : Priority.LOW,
                        progress: t.progress,
                        totalValue: t.totalValue,
                        paidValue: 0,
                        status: t.estado === 'TODO' ? 'todo' : t.estado === 'DONE' ? 'completed' : 'active',
                        duration: t.duration,
                        deadlineType: t.deadlineType as 'Hard Deadline' | 'Soft Deadline',
                        dueDate: t.dueDate,
                        autoSchedule: t.autoSchedule,
                        elasticity: t.elasticity,
                        scheduledSlots: t.scheduledSlots || [],
                        hasConflict: t.hasConflict
                    };
                    allTasks.push(p);
                });
            });
        });
    });

    if (allTasks.length === 0) return state;

    // 2. Run Scheduling
    const scheduledProjects = runAutoScheduling(allTasks, DEFAULT_RULES);

    // 3. Update tasks in hierarchy
    const updates = new Map(scheduledProjects.map(p => [p.id, p]));

    const updateTask = (t: SpaceTask): SpaceTask => {
        const p = updates.get(t.id);
        if (!p) return t;
        return {
            ...t,
            scheduledSlots: p.scheduledSlots,
            startDate: p.startDate,
            endDate: p.endDate,
            hasConflict: p.hasConflict
        };
    };

    const updatedWorkspace = {
        ...workspace,
        espacios: workspace.espacios.map(s => ({
            ...s,
            listas: s.listas.map(l => ({ ...l, tareas: l.tareas.map(updateTask) })),
            carpetas: s.carpetas.map(f => ({
                ...f,
                listas: f.listas.map(l => ({ ...l, tareas: l.tareas.map(updateTask) }))
            }))
        }))
    };

    return {
        ...state,
        workspaces: state.workspaces.map(w => w.id === state.activeWorkspaceId ? updatedWorkspace : w)
    };
};

function spacesReducer(state: SpacesState, action: SpacesAction): SpacesState {
    let newState: SpacesState = state;

    // Helper to check migration status
    if (action.type === 'LOAD_STATE') {
        let loadedState = action.payload;
        // Migration Check: If payload has 'espacios' (old format) but no 'workspaces'
        if ((loadedState as any).espacios && (!loadedState.workspaces || loadedState.workspaces.length === 0)) {
            const defaultWorkspace: Workspace = {
                id: generateId(),
                nombre: 'Personal Workspace',
                espacios: (loadedState as any).espacios
            };
            loadedState = {
                ...initialState,
                workspaces: [defaultWorkspace],
                activeWorkspaceId: defaultWorkspace.id,
                activeSpaceId: loadedState.activeSpaceId,
                activeFolderId: loadedState.activeFolderId,
                activeListId: loadedState.activeListId,
                expandedIds: loadedState.expandedIds || []
            };
        }

        // Ensure we have an active workspace if none is set
        if (!loadedState.activeWorkspaceId && loadedState.workspaces.length > 0) {
            loadedState.activeWorkspaceId = loadedState.workspaces[0].id;
        }

        return recalculateScheduling(loadedState);
    }

    // --- WORKSPACE ACTIONS ---
    if (action.type === 'ADD_WORKSPACE') {
        const newWorkspace: Workspace = {
            id: generateId(),
            nombre: action.payload.nombre,
            espacios: []
        };
        return {
            ...state,
            workspaces: [...state.workspaces, newWorkspace],
            activeWorkspaceId: newWorkspace.id,
            activeSpaceId: null,
            activeFolderId: null,
            activeListId: null
        };
    }

    if (action.type === 'DELETE_WORKSPACE') {
        const newWorkspaces = state.workspaces.filter(w => w.id !== action.payload.workspaceId);
        // Determine new active workspace
        let newActiveId = state.activeWorkspaceId;
        if (state.activeWorkspaceId === action.payload.workspaceId) {
            newActiveId = newWorkspaces.length > 0 ? newWorkspaces[0].id : null;
        }
        return {
            ...state,
            workspaces: newWorkspaces,
            activeWorkspaceId: newActiveId,
            activeSpaceId: null,
            activeFolderId: null,
            activeListId: null
        };
    }

    if (action.type === 'RENAME_WORKSPACE') {
        return {
            ...state,
            workspaces: state.workspaces.map(w =>
                w.id === action.payload.workspaceId ? { ...w, nombre: action.payload.nombre } : w
            )
        };
    }

    if (action.type === 'SET_ACTIVE_WORKSPACE') {
        return {
            ...state,
            activeWorkspaceId: action.payload.workspaceId,
            activeSpaceId: null,
            activeFolderId: null,
            activeListId: null
        };
    }

    // --- SPACE/TASK ACTIONS (Scoped to Active Workspace) ---
    const getEffectiveActiveWorkspaceId = () => {
        if (state.activeWorkspaceId && state.workspaces.some(w => w.id === state.activeWorkspaceId)) {
            return state.activeWorkspaceId;
        }
        return state.workspaces.length > 0 ? state.workspaces[0].id : null;
    };

    const activeId = getEffectiveActiveWorkspaceId();
    if (!activeId) return state;

    const activeWorkspaceIndex = state.workspaces.findIndex(w => w.id === activeId);
    if (activeWorkspaceIndex === -1) return state;

    const currentWorkspace = state.workspaces[activeWorkspaceIndex];
    let updatedEspacios = [...currentWorkspace.espacios];
    let syncActiveId = state.activeWorkspaceId !== activeId;

    // Perform updates on `updatedEspacios` based on type
    switch (action.type) {
        case 'ADD_SPACE': {
            const newSpace: Space = {
                id: action.payload.id || generateId(),
                nombre: action.payload.nombre,
                color: action.payload.color,
                carpetas: [],
                listas: [],
            };
            updatedEspacios = [...updatedEspacios, newSpace];
            break;
        }
        case 'DELETE_SPACE':
            updatedEspacios = updatedEspacios.filter(s => s.id !== action.payload.spaceId);
            break;
        case 'ADD_FOLDER': {
            const newFolder: SpaceFolder = {
                id: generateId(),
                nombre: action.payload.nombre,
                listas: [],
            };
            updatedEspacios = updatedEspacios.map(s => s.id === action.payload.spaceId ? { ...s, carpetas: [...s.carpetas, newFolder] } : s);
            break;
        }
        case 'DELETE_FOLDER':
            updatedEspacios = updatedEspacios.map(s => s.id === action.payload.spaceId ? { ...s, carpetas: s.carpetas.filter(f => f.id !== action.payload.folderId) } : s);
            break;
        case 'ADD_LIST': {
            const newList: SpaceList = { id: action.payload.id || generateId(), nombre: action.payload.nombre, tareas: [] };
            updatedEspacios = updatedEspacios.map(s => {
                if (s.id !== action.payload.spaceId) return s;
                if (action.payload.folderId) {
                    return { ...s, carpetas: s.carpetas.map(f => f.id === action.payload.folderId ? { ...f, listas: [...f.listas, newList] } : f) };
                }
                return { ...s, listas: [...s.listas, newList] };
            });
            break;
        }
        case 'DELETE_LIST':
            updatedEspacios = updatedEspacios.map(s => {
                if (s.id !== action.payload.spaceId) return s;
                if (action.payload.folderId) {
                    return { ...s, carpetas: s.carpetas.map(f => f.id === action.payload.folderId ? { ...f, listas: f.listas.filter(l => l.id !== action.payload.listId) } : f) };
                }
                return { ...s, listas: s.listas.filter(l => l.id !== action.payload.listId) };
            });
            break;
        case 'ADD_TASK': {
            const newTask: SpaceTask = { ...action.payload.task, id: generateId(), orden: Date.now() };
            const updateList = (l: SpaceList) => l.id === action.payload.listId ? { ...l, tareas: [...l.tareas, newTask] } : l;
            updatedEspacios = updatedEspacios.map(s => {
                if (s.id !== action.payload.spaceId) return s;
                if (action.payload.folderId) {
                    return { ...s, carpetas: s.carpetas.map(f => f.id === action.payload.folderId ? { ...f, listas: f.listas.map(updateList) } : f) };
                }
                return { ...s, listas: s.listas.map(updateList) };
            });
            break;
        }
        case 'UPDATE_TASK': {
            const updateList = (l: SpaceList) => l.id === action.payload.listId ? { ...l, tareas: l.tareas.map(t => t.id === action.payload.task.id ? action.payload.task : t) } : l;
            updatedEspacios = updatedEspacios.map(s => {
                if (s.id !== action.payload.spaceId) return s;
                if (action.payload.folderId) {
                    return { ...s, carpetas: s.carpetas.map(f => f.id === action.payload.folderId ? { ...f, listas: f.listas.map(updateList) } : f) };
                }
                return { ...s, listas: s.listas.map(updateList) };
            });
            break;
        }
        case 'DELETE_TASK': {
            const updateList = (l: SpaceList) => l.id === action.payload.listId ? { ...l, tareas: l.tareas.filter(t => t.id !== action.payload.taskId) } : l;
            updatedEspacios = updatedEspacios.map(s => {
                if (s.id !== action.payload.spaceId) return s;
                if (action.payload.folderId) {
                    return { ...s, carpetas: s.carpetas.map(f => f.id === action.payload.folderId ? { ...f, listas: f.listas.map(updateList) } : f) };
                }
                return { ...s, listas: s.listas.map(updateList) };
            });
            break;
        }
        case 'SET_ACTIVE':
            return {
                ...state,
                activeSpaceId: action.payload.spaceId !== undefined ? action.payload.spaceId : state.activeSpaceId,
                activeFolderId: action.payload.folderId !== undefined ? action.payload.folderId : state.activeFolderId,
                activeListId: action.payload.listId !== undefined ? action.payload.listId : state.activeListId,
            };
        case 'TOGGLE_EXPAND':
            const isExpanded = state.expandedIds.includes(action.payload.id);
            return {
                ...state,
                expandedIds: isExpanded ? state.expandedIds.filter(id => id !== action.payload.id) : [...state.expandedIds, action.payload.id],
            };
    }

    // Construct new state with updated workspace
    newState = {
        ...state,
        activeWorkspaceId: activeId, // Sync in case we auto-selected
        workspaces: state.workspaces.map((w, i) => i === activeWorkspaceIndex ? { ...w, espacios: updatedEspacios } : w)
    };

    // Run scheduling if task operation or data changed
    if (['ADD_TASK', 'UPDATE_TASK', 'DELETE_TASK'].includes(action.type)) {
        return recalculateScheduling(newState);
    }

    return newState;
}

interface SpacesContextValue {
    state: SpacesState;
    dispatch: React.Dispatch<SpacesAction>;
}

const SpacesContext = createContext<SpacesContextValue | null>(null);

export function SpacesProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(spacesReducer, initialState);

    // Load from localStorage on mount
    useEffect(() => {
        const saved = localStorage.getItem('coo_spaces');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                dispatch({ type: 'LOAD_STATE', payload: parsed });

                // If after loading we have NO active workspace, but have workspaces, fix it
                if (!parsed.activeWorkspaceId && parsed.workspaces && parsed.workspaces.length > 0) {
                    dispatch({ type: 'SET_ACTIVE_WORKSPACE', payload: { workspaceId: parsed.workspaces[0].id } });
                }
            } catch (e) {
                console.error('Error loading spaces from localStorage:', e);
                dispatch({ type: 'ADD_WORKSPACE', payload: { nombre: 'Personal Workspace' } });
            }
        } else {
            // Init default workspace if clean start
            dispatch({ type: 'ADD_WORKSPACE', payload: { nombre: 'Personal Workspace' } });
        }
    }, []);

    // Save to localStorage
    useEffect(() => {
        // Only save if we have initialized (state.activeWorkspaceId or workspaces exist)
        if (state.workspaces.length > 0) {
            localStorage.setItem('coo_spaces', JSON.stringify(state));
        }
    }, [state]);

    return (
        <SpacesContext.Provider value={{ state, dispatch }}>
            {children}
        </SpacesContext.Provider>
    );
}

export function useSpaces() {
    const context = useContext(SpacesContext);
    if (!context) {
        throw new Error('useSpaces must be used within a SpacesProvider');
    }
    return context;
}
