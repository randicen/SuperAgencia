
import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { SpacesState, SpacesAction, Space, SpaceFolder, SpaceList, SpaceTask, Workspace, SpaceEvent } from '../spacesTypes';
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
    rules: DEFAULT_RULES,
    gcalEvents: [],
    rulesOverride: null,
};

// Helper: Run scheduling on the active workspace
const recalculateScheduling = (state: SpacesState): SpacesState => {
    if (!state.activeWorkspaceId) return state;

    const workspace = state.workspaces.find(w => w.id === state.activeWorkspaceId);
    if (!workspace) return state;

    // 1. Flatten ALL tasks AND events from active workspace
    const allTasks: Project[] = [];
    const allEvents: { nombre: string, startDate: string, endDate: string }[] = [];

    // Add Google Calendar Events as fixed anchors
    state.gcalEvents.forEach(e => {
        allEvents.push({
            nombre: `[GCal] ${e.nombre}`,
            startDate: e.startDate,
            endDate: e.endDate
        });
    });

    const getLocalDateStr = () => {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const extractProjectsRecursive = (tasks: SpaceTask[]) => {
        tasks.forEach(t => {
            const localToday = getLocalDateStr();
            const p: Project = {
                id: t.id,
                clientId: '',
                clientName: t.clientName || '',
                projectName: t.nombre,
                startDate: t.startDate || localToday,
                endDate: t.endDate || localToday,
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
                hasConflict: t.hasConflict,
                conflictDescription: t.conflictDescription
            };
            allTasks.push(p);

            // Recurse
            if (t.subtasks && t.subtasks.length > 0) {
                extractProjectsRecursive(t.subtasks);
            }
        });
    };

    workspace.espacios.forEach(s => {
        s.listas.forEach(l => {
            extractProjectsRecursive(l.tareas);
            if (l.eventos) {
                l.eventos.forEach(e => allEvents.push({ nombre: e.nombre, startDate: e.startDate, endDate: e.endDate }));
            }
        });
        s.carpetas.forEach(f => {
            f.listas.forEach(l => {
                extractProjectsRecursive(l.tareas);
                if (l.eventos) {
                    l.eventos.forEach(e => allEvents.push({ nombre: e.nombre, startDate: e.startDate, endDate: e.endDate }));
                }
            });
        });
    });

    if (allTasks.length === 0) return state;

    // DEBUG: Log events being passed to scheduler
    console.log('[Scheduler] Events passed:', allEvents.length, allEvents);
    console.log('[Scheduler] Tasks to schedule:', allTasks.length);

    // 2. Compute effective rules (merge temporary override if active)
    const now = new Date();
    const override = state.rulesOverride;
    const isOverrideActive = override && new Date(override.expiresAt) > now;
    const effectiveRules = isOverrideActive
        ? { ...state.rules, ...(override.workingHoursStart ? { workingHoursStart: override.workingHoursStart } : {}), ...(override.workingHoursEnd ? { workingHoursEnd: override.workingHoursEnd } : {}) }
        : state.rules;

    // 3. Run Scheduling with effective rules (now includes subtasks AND events)
    const scheduledProjects = runAutoScheduling(allTasks, effectiveRules, allEvents);

    // DEBUG: Log conflict status
    const conflicts = scheduledProjects.filter(p => p.hasConflict);
    if (conflicts.length > 0) {
        console.log('[Scheduler] Tasks with conflicts:', conflicts.map(c => ({ id: c.id, name: c.projectName, hasConflict: c.hasConflict })));
    }

    // 3. Update tasks in hierarchy (Bottom-Up Aggregation)
    const updates = new Map(scheduledProjects.map(p => [p.id, p]));

    const updateTaskRecursive = (t: SpaceTask): SpaceTask => {
        // 1. Apply Scheduler Updates to current node
        const p = updates.get(t.id);

        let newTask: SpaceTask = { ...t };

        if (p) {
            // ONLY Apply Schedule if Auto-Schedule is ENABLED
            if (t.autoSchedule) {
                newTask.scheduledSlots = p.scheduledSlots;
                newTask.startDate = p.startDate;
                newTask.endDate = p.endDate;
            } else {
                // For MANUAL mode, we strictly preserve what the user put in the Task object
                // although we still update conflict status.
                newTask.startDate = t.startDate;
                newTask.endDate = t.endDate;
                newTask.dueDate = t.dueDate;
            }
            // Always update conflict status (informational)
            newTask.hasConflict = p.hasConflict;
            newTask.conflictDescription = p.conflictDescription;
        }

        // 2. Process Children (Depth-First)
        if (newTask.subtasks && newTask.subtasks.length > 0) {
            const updatedSubtasks = newTask.subtasks.map(updateTaskRecursive);
            newTask.subtasks = updatedSubtasks;

            // 3. Aggregate Dates from Children (Robust Parsing)
            const dateToNum = (d: string) => {
                if (!d) return 0;
                // If DD/MM/YYYY
                if (d.includes('/') && d.split('/').length === 3) {
                    const [day, month, year] = d.split('/');
                    return new Date(`${year}-${month}-${day}`).getTime();
                }
                return new Date(d).getTime();
            };

            const allStarts = [newTask.startDate, ...updatedSubtasks.map(st => st.startDate)].filter(d => d);
            const allEnds = [newTask.endDate, ...updatedSubtasks.map(st => st.endDate)].filter(d => d);
            const allDues = [newTask.dueDate, ...updatedSubtasks.map(st => st.dueDate)].filter(d => d);

            if (allStarts.length > 0) {
                allStarts.sort((a, b) => dateToNum(a) - dateToNum(b));
                newTask.startDate = allStarts[0];
            }
            if (allEnds.length > 0) {
                allEnds.sort((a, b) => dateToNum(a) - dateToNum(b));
                newTask.endDate = allEnds[allEnds.length - 1];
            }
            // REMOVED: DueDate Aggregation. Parent Deadline is a constraint, not a summary.
            // if (allDues.length > 0) {
            //    allDues.sort((a, b) => dateToNum(a) - dateToNum(b));
            //    newTask.dueDate = allDues[allDues.length - 1];
            // }
        }

        return newTask;
    };

    const updatedWorkspace = {
        ...workspace,
        espacios: workspace.espacios.map(s => ({
            ...s,
            listas: s.listas.map(l => ({ ...l, tareas: l.tareas.map(updateTaskRecursive) })),
            carpetas: s.carpetas.map(f => ({
                ...f,
                listas: f.listas.map(l => ({ ...l, tareas: l.tareas.map(updateTaskRecursive) }))
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
                expandedIds: loadedState.expandedIds || [],
                gcalEvents: loadedState.gcalEvents || []
            };
        }

        // Migration Check: Ensure gcalEvents exist
        if (!loadedState.gcalEvents) {
            loadedState.gcalEvents = [];
        }

        // Ensure we have an active workspace if none is set
        if (!loadedState.activeWorkspaceId && loadedState.workspaces.length > 0) {
            loadedState.activeWorkspaceId = loadedState.workspaces[0].id;
        }

        // Migration Check: Ensure rules exist
        if (!loadedState.rules) {
            loadedState.rules = DEFAULT_RULES;
        }

        // Auto-clean expired rulesOverride
        if (loadedState.rulesOverride) {
            const expiresAt = new Date(loadedState.rulesOverride.expiresAt);
            if (expiresAt <= new Date()) {
                loadedState.rulesOverride = null;
            }
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
        const filtered = state.workspaces.filter(w => w.id !== action.payload.workspaceId);

        if (filtered.length === 0) {
            const fallback: Workspace = { id: generateId(), nombre: 'Mi Primer Workspace', espacios: [] };
            return {
                ...state,
                workspaces: [fallback],
                activeWorkspaceId: fallback.id,
                activeSpaceId: null, activeFolderId: null, activeListId: null
            };
        }

        return {
            ...state,
            workspaces: filtered,
            activeWorkspaceId: state.activeWorkspaceId === action.payload.workspaceId ? filtered[0].id : state.activeWorkspaceId,
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
        case 'RENAME_SPACE':
            updatedEspacios = updatedEspacios.map(s => s.id === action.payload.spaceId ? { ...s, nombre: action.payload.nombre } : s);
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
        case 'RENAME_FOLDER':
            updatedEspacios = updatedEspacios.map(s => s.id === action.payload.spaceId ? { ...s, carpetas: s.carpetas.map(f => f.id === action.payload.folderId ? { ...f, nombre: action.payload.nombre } : f) } : s);
            break;
        case 'ADD_LIST': {
            const newList: SpaceList = { id: action.payload.id || generateId(), nombre: action.payload.nombre, tareas: [], eventos: [] };
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
        case 'RENAME_LIST':
            updatedEspacios = updatedEspacios.map(s => {
                if (s.id !== action.payload.spaceId) return s;
                const updateList = (l: SpaceList) => l.id === action.payload.listId ? { ...l, nombre: action.payload.nombre } : l;
                if (action.payload.folderId) {
                    return { ...s, carpetas: s.carpetas.map(f => f.id === action.payload.folderId ? { ...f, listas: f.listas.map(updateList) } : f) };
                }
                return { ...s, listas: s.listas.map(updateList) };
            });
            break;
        case 'MOVE_LIST': {
            updatedEspacios = updatedEspacios.map(s => {
                if (s.id !== action.payload.spaceId) return s;

                // 1. Find and extract the list
                let listToMove: SpaceList | undefined;

                if (action.payload.sourceFolderId) {
                    const sourceFolder = s.carpetas.find(f => f.id === action.payload.sourceFolderId);
                    listToMove = sourceFolder?.listas.find(l => l.id === action.payload.listId);
                } else {
                    listToMove = s.listas.find(l => l.id === action.payload.listId);
                }

                if (!listToMove) return s;

                // 2. Remove from source
                let newEspacio = { ...s };
                if (action.payload.sourceFolderId) {
                    newEspacio = {
                        ...newEspacio,
                        carpetas: newEspacio.carpetas.map(f =>
                            f.id === action.payload.sourceFolderId
                                ? { ...f, listas: f.listas.filter(l => l.id !== action.payload.listId) }
                                : f
                        )
                    };
                } else {
                    newEspacio = { ...newEspacio, listas: newEspacio.listas.filter(l => l.id !== action.payload.listId) };
                }

                // 3. Add to target folder
                newEspacio = {
                    ...newEspacio,
                    carpetas: newEspacio.carpetas.map(f =>
                        f.id === action.payload.targetFolderId
                            ? { ...f, listas: [...f.listas, listToMove!] }
                            : f
                    )
                };

                return newEspacio;
            });
            break;
        }
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
            // Helper to recursively update tasks
            const updateTasksRecursive = (tasks: SpaceTask[]): SpaceTask[] => {
                return tasks.map(t => {
                    if (t.id === action.payload.task.id) {
                        return action.payload.task; // Use the payload
                    }
                    if (t.subtasks && t.subtasks.length > 0) {
                        return { ...t, subtasks: updateTasksRecursive(t.subtasks) }; // Recurse
                    }
                    return t;
                });
            };

            const updateList = (l: SpaceList) => {
                if (l.id === action.payload.listId) {
                    return { ...l, tareas: updateTasksRecursive(l.tareas) };
                }
                return l;
            };

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
            const deleteTasksRecursive = (tasks: SpaceTask[]): SpaceTask[] => {
                return tasks.filter(t => t.id !== action.payload.taskId).map(t => ({
                    ...t,
                    subtasks: t.subtasks ? deleteTasksRecursive(t.subtasks) : undefined
                }));
            };

            const updateList = (l: SpaceList) => l.id === action.payload.listId ? { ...l, tareas: deleteTasksRecursive(l.tareas) } : l;

            updatedEspacios = updatedEspacios.map(s => {
                if (s.id !== action.payload.spaceId) return s;
                if (action.payload.folderId) {
                    return { ...s, carpetas: s.carpetas.map(f => f.id === action.payload.folderId ? { ...f, listas: f.listas.map(updateList) } : f) };
                }
                return { ...s, listas: s.listas.map(updateList) };
            });
            break;
        }
        case 'ADD_EVENT': {
            const newEvent: SpaceEvent = { ...action.payload.event, id: generateId() };
            const updateList = (l: SpaceList) => l.id === action.payload.listId ? { ...l, eventos: [...(l.eventos || []), newEvent] } : l;
            updatedEspacios = updatedEspacios.map(s => {
                if (s.id !== action.payload.spaceId) return s;
                if (action.payload.folderId) {
                    return { ...s, carpetas: s.carpetas.map(f => f.id === action.payload.folderId ? { ...f, listas: f.listas.map(updateList) } : f) };
                }
                return { ...s, listas: s.listas.map(updateList) };
            });
            break;
        }
        case 'UPDATE_EVENT': {
            const updateList = (l: SpaceList) => l.id === action.payload.listId ? {
                ...l,
                eventos: (l.eventos || []).map(e => e.id === action.payload.event.id ? action.payload.event : e)
            } : l;
            updatedEspacios = updatedEspacios.map(s => {
                if (s.id !== action.payload.spaceId) return s;
                if (action.payload.folderId) {
                    return { ...s, carpetas: s.carpetas.map(f => f.id === action.payload.folderId ? { ...f, listas: f.listas.map(updateList) } : f) };
                }
                return { ...s, listas: s.listas.map(updateList) };
            });
            break;
        }
        case 'DELETE_EVENT': {
            const updateList = (l: SpaceList) => l.id === action.payload.listId ? {
                ...l,
                eventos: (l.eventos || []).filter(e => e.id !== action.payload.eventId)
            } : l;
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
        case 'UPDATE_RULES':
            newState = {
                ...state,
                rules: action.payload
            };
            break;
        case 'SET_GCAL_EVENTS':
            newState = {
                ...state,
                gcalEvents: action.payload.events
            };
            break;
        case 'SET_RULES_OVERRIDE':
            newState = {
                ...state,
                rulesOverride: action.payload
            };
            break;
    }

    // Construct new state with updated workspace
    newState = {
        ...newState,
        activeWorkspaceId: activeId, // Sync in case we auto-selected
        workspaces: state.workspaces.map((w, i) => i === activeWorkspaceIndex ? { ...w, espacios: updatedEspacios } : w)
    };

    // Run scheduling if task operation, data, rules or GCal changed
    if (['ADD_TASK', 'UPDATE_TASK', 'DELETE_TASK', 'ADD_EVENT', 'UPDATE_EVENT', 'DELETE_EVENT', 'UPDATE_RULES', 'SET_GCAL_EVENTS', 'SET_RULES_OVERRIDE'].includes(action.type)) {
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
            dispatch({ type: 'ADD_WORKSPACE', payload: { nombre: 'Mi Primer Workspace' } });
        }
    }, []);

    // Escuchar datos de la nube
    useEffect(() => {
        const handleCloudData = () => {
            const saved = localStorage.getItem('coo_spaces');
            if (saved) {
                try {
                    dispatch({ type: 'LOAD_STATE', payload: JSON.parse(saved) });
                } catch (e) {
                    console.error("Error al cargar datos de nube en espacios:", e);
                }
            }
        };
        window.addEventListener('coo_cloud_data_received', handleCloudData);
        return () => window.removeEventListener('coo_cloud_data_received', handleCloudData);
    }, []);




    // Save to localStorage
    useEffect(() => {
        // Save state to persistence. We check that we have at least one workspace to avoid 
        // overwriting with initial empty state on first render before LOAD_STATE.
        if (state.workspaces.length > 0) {
            localStorage.setItem('coo_spaces', JSON.stringify(state));
            // Notificar a App.tsx que hubo un cambio en los espacios para sincronizar
            window.dispatchEvent(new Event('coo_spaces_updated'));
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

// --- HELPER: Flatten ALL tasks from ALL workspaces ---
export interface TaskWithLocation {
    task: SpaceTask;
    spaceId: string;
    folderId?: string;
    listId: string;
    workspaceId: string;
}

export function getAllTasks(state: SpacesState): TaskWithLocation[] {
    const result: TaskWithLocation[] = [];

    const extractTasks = (tasks: SpaceTask[], loc: Omit<TaskWithLocation, 'task'>) => {
        tasks.forEach(t => {
            result.push({ task: t, ...loc });
            if (t.subtasks && t.subtasks.length > 0) {
                extractTasks(t.subtasks, loc);
            }
        });
    };

    state.workspaces.forEach(ws => {
        ws.espacios.forEach(space => {
            space.listas.forEach(list => {
                extractTasks(list.tareas, { spaceId: space.id, listId: list.id, workspaceId: ws.id });
            });
            space.carpetas.forEach(folder => {
                folder.listas.forEach(list => {
                    extractTasks(list.tareas, { spaceId: space.id, folderId: folder.id, listId: list.id, workspaceId: ws.id });
                });
            });
        });
    });

    return result;
}
