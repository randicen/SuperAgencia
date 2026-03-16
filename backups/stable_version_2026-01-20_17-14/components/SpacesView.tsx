
import React, { useState, useMemo } from 'react';
import { useSpaces } from '../contexts/SpacesContext';
import { Space, SpaceFolder, SpaceList, SpaceTask, TaskPriority, TaskStatus, DeadlineType } from '../spacesTypes';

type ViewMode = 'lista' | 'kanban' | 'gantt' | 'calendar';

// Helper functions
const formatDuration = (minutes: number) => {
    if (minutes >= 60) {
        const h = minutes / 60;
        return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
    }
    return `${minutes}m`;
};

const getPriorityStyle = (p: TaskPriority) => {
    switch (p) {
        case 'ASAP': return 'bg-purple-100 text-purple-700 border-purple-300';
        case 'High': return 'bg-red-100 text-red-700 border-red-300';
        case 'Medium': return 'bg-orange-100 text-orange-700 border-orange-300';
        case 'Low': return 'bg-emerald-100 text-emerald-700 border-emerald-300';
        default: return 'bg-slate-100 text-slate-700 border-slate-300';
    }
};

const getStatusFromProgress = (progress: number): TaskStatus => {
    if (progress <= 0) return 'TODO';
    if (progress >= 100) return 'DONE';
    return 'ACTIVE';
};

// Default task template
const getDefaultTask = (): Omit<SpaceTask, 'id' | 'orden'> => ({
    nombre: '',
    estado: 'TODO',
    progress: 0,
    autoSchedule: true,
    startDate: '',
    endDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    deadlineType: 'Soft Deadline',
    duration: 60,
    elasticity: 1,
    priority: 'Medium',
    totalValue: 0,
});

// Input component
const Input = ({ label, value, onChange, type = "text", list, className = "" }: any) => (
    <div className={`space-y-1.5 flex-1 ${className}`}>
        <label className="text-[9px] font-black uppercase text-slate-400 ml-1 tracking-widest">{label}</label>
        <input
            list={list}
            type={type}
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-4 ring-blue-500/10 transition-all"
        />
    </div>
);

// ==================== LISTA VIEW ====================
const ListaView: React.FC<{
    tasks: SpaceTask[];
    onEditTask: (t: SpaceTask) => void;
    onToggleTask: (taskId: string) => void;
    onDeleteTask: (taskId: string) => void;
}> = ({ tasks, onEditTask, onToggleTask, onDeleteTask }) => {
    const sortedTasks = [...tasks].sort((a, b) => {
        if (a.estado === b.estado) return a.orden - b.orden;
        if (a.estado === 'TODO') return -1;
        if (a.estado === 'DONE') return 1;
        return 0;
    });

    const todoCount = tasks.filter(t => t.estado !== 'DONE').length;
    const doneCount = tasks.filter(t => t.estado === 'DONE').length;

    if (tasks.length === 0) {
        return (
            <div className="text-center py-12">
                <i className="fa-solid fa-inbox text-4xl text-slate-300 mb-3"></i>
                <p className="text-sm text-slate-500">No hay tareas en esta lista</p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-4 mb-4 text-xs text-slate-400">
                <span><span className="font-bold text-slate-600">{todoCount}</span> pendientes</span>
                <span><span className="font-bold text-green-600">{doneCount}</span> completadas</span>
            </div>
            {sortedTasks.map((task) => (
                <div
                    key={task.id}
                    className={`group flex items-center gap-3 bg-white p-4 rounded-xl border transition-all cursor-pointer ${task.estado === 'DONE'
                        ? 'border-green-200 bg-green-50/50'
                        : 'border-gray-200 hover:border-blue-300 hover:shadow-md'
                        }`}
                    onClick={() => onEditTask(task)}
                >
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggleTask(task.id); }}
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors shrink-0 ${task.estado === 'DONE'
                            ? 'bg-green-500 border-green-500 text-white'
                            : 'border-slate-300 hover:border-blue-500'
                            }`}
                    >
                        {task.estado === 'DONE' && <i className="fa-solid fa-check text-[10px]"></i>}
                    </button>
                    <div className="flex-1 min-w-0">
                        <span className={`text-sm block truncate ${task.estado === 'DONE' ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                            {task.nombre}
                        </span>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded border ${getPriorityStyle(task.priority)}`}>
                                {task.priority}
                            </span>
                            <span className="text-[9px] text-slate-400">{formatDuration(task.duration)}</span>
                            {task.dueDate && <span className="text-[9px] text-slate-400">• {task.dueDate}</span>}
                        </div>
                    </div>
                    <button
                        onClick={(e) => { e.stopPropagation(); onDeleteTask(task.id); }}
                        className="hidden group-hover:flex w-7 h-7 items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                        <i className="fa-solid fa-trash text-xs"></i>
                    </button>
                </div>
            ))}
        </div>
    );
};

// ==================== KANBAN VIEW ====================
const KanbanView: React.FC<{
    tasks: SpaceTask[];
    onEditTask: (t: SpaceTask) => void;
}> = ({ tasks, onEditTask }) => {
    const columns = [
        { id: 'TODO', label: 'To Do', icon: 'fa-warehouse', color: 'text-orange-500' },
        { id: 'ACTIVE', label: 'En Marcha', icon: 'fa-rocket', color: 'text-blue-500' },
        { id: 'DONE', label: 'Finalizados', icon: 'fa-check-double', color: 'text-emerald-500' }
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-full min-h-[400px]">
            {columns.map(col => (
                <div key={col.id} className="flex flex-col bg-slate-50/50 rounded-3xl p-4 border border-slate-100 shadow-inner">
                    <div className="flex items-center justify-between mb-4 px-2">
                        <div className="flex items-center gap-2">
                            <i className={`fa-solid ${col.icon} ${col.color} text-xs`}></i>
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">{col.label}</h3>
                        </div>
                        <span className="text-[10px] font-black bg-white px-2 py-0.5 rounded-full border border-slate-200 text-slate-400">
                            {tasks.filter(t => t.estado === col.id).length}
                        </span>
                    </div>
                    <div className="flex-1 space-y-3 overflow-y-auto custom-scrollbar pr-1">
                        {tasks.filter(t => t.estado === col.id).map(task => (
                            <div
                                key={task.id}
                                onClick={() => onEditTask(task)}
                                className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group"
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded border ${getPriorityStyle(task.priority)}`}>
                                        {task.priority}
                                    </span>
                                </div>
                                <h4 className="font-bold text-slate-800 text-sm mb-1 group-hover:text-blue-600 transition-colors">{task.nombre}</h4>
                                {task.clientName && <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-4">{task.clientName}</p>}
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center text-[9px] font-black uppercase">
                                        <span className="text-slate-400">Progreso</span>
                                        <span className="text-blue-600">{task.progress}%</span>
                                    </div>
                                    <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                                        <div className="bg-blue-600 h-full transition-all duration-1000" style={{ width: `${task.progress}%` }}></div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};

// ==================== GANTT VIEW ====================
const GanttChartView: React.FC<{
    tasks: SpaceTask[];
    onEditTask: (t: SpaceTask) => void;
}> = ({ tasks, onEditTask }) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysToShow = 20;
    const dates = Array.from({ length: daysToShow }, (_, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() + i - 3);
        return d;
    });

    const getPosition = (startDateStr: string, endDateStr: string) => {
        if (!startDateStr || !endDateStr) return null;
        const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number);
        const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number);
        const start = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
        const end = new Date(endYear, endMonth - 1, endDay, 0, 0, 0, 0);

        let startIdx = -1, endIdx = -1;
        for (let i = 0; i < dates.length; i++) {
            if (dates[i].getTime() === start.getTime()) startIdx = i;
            if (dates[i].getTime() === end.getTime()) endIdx = i;
        }
        if (startIdx === -1 && start < dates[0]) startIdx = 0;
        if (endIdx === -1 && end > dates[dates.length - 1]) endIdx = dates.length - 1;
        if (startIdx === -1 || endIdx === -1) return null;
        return { left: `${(startIdx / daysToShow) * 100}%`, width: `${((endIdx - startIdx + 1) / daysToShow) * 100}%` };
    };

    return (
        <div className="overflow-x-auto custom-scrollbar">
            <div className="min-w-max">
                <div className="flex border-b border-slate-100 bg-white sticky top-0 z-10">
                    <div className="w-48 shrink-0 p-4 font-black text-[9px] text-slate-400 uppercase border-r">Tarea</div>
                    <div className="w-20 shrink-0 p-4 font-black text-[9px] text-slate-400 uppercase border-r text-center">Prioridad</div>
                    <div className="flex-1 flex bg-slate-50/50">
                        {dates.map((d, i) => (
                            <div key={i} className={`w-12 shrink-0 flex items-center justify-center py-3 border-r border-slate-100/50 ${d.getDate() === today.getDate() && d.getMonth() === today.getMonth() ? 'bg-blue-600/5' : ''}`}>
                                <div className={`text-[8px] font-black uppercase ${d.getDate() === today.getDate() && d.getMonth() === today.getMonth() ? 'text-blue-600' : 'text-slate-400'}`}>
                                    {d.toLocaleDateString('es-ES', { day: 'numeric' })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                {tasks.filter(t => t.estado !== 'DONE').map(task => {
                    const pos = getPosition(task.startDate || new Date().toISOString().split('T')[0], task.endDate || task.dueDate);
                    return (
                        <div key={task.id} className="flex border-b border-slate-50 hover:bg-slate-50/30 transition-colors">
                            <div className="w-48 shrink-0 p-4 border-r flex items-center font-bold text-slate-600 text-[10px] truncate">{task.nombre}</div>
                            <div className={`w-20 shrink-0 p-4 border-r flex items-center justify-center font-black text-[9px] uppercase ${task.priority === 'ASAP' ? 'text-purple-500' : task.priority === 'High' ? 'text-red-500' : task.priority === 'Medium' ? 'text-orange-500' : 'text-emerald-500'}`}>
                                {task.priority}
                            </div>
                            <div className="flex-1 relative h-16 flex items-center bg-white">
                                {dates.map((_, i) => <div key={i} className="w-12 shrink-0 border-r border-slate-50 h-full"></div>)}
                                {pos && (
                                    <div
                                        onClick={() => onEditTask(task)}
                                        className="absolute h-10 rounded-xl shadow-lg border border-white/40 overflow-hidden cursor-pointer transition-all hover:scale-[1.02] z-10 bg-blue-100"
                                        style={{ left: pos.left, width: pos.width }}
                                    >
                                        <div className="h-full bg-blue-500 transition-all duration-500 flex items-center px-3" style={{ width: `${task.progress}%` }}>
                                            <span className="text-[9px] text-white font-black drop-shadow-sm whitespace-nowrap">{task.progress}%</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ==================== CALENDAR VIEW ====================
const CalendarViewComponent: React.FC<{
    tasks: SpaceTask[];
    onEditTask: (t: SpaceTask) => void;
}> = ({ tasks, onEditTask }) => {
    const [currentDate, setCurrentDate] = useState(new Date());

    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (year: number, month: number) => {
        const day = new Date(year, month, 1).getDay();
        return day === 0 ? 6 : day - 1;
    };

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const monthName = currentDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

    const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
    const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

    const blanks = Array.from({ length: firstDay }, (_, i) => i);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    const isTaskActiveOnDay = (task: SpaceTask, day: number) => {
        const dayStart = new Date(year, month, day, 0, 0, 0, 0).getTime();
        const dayEnd = new Date(year, month, day, 23, 59, 59, 999).getTime();

        const parseLocal = (dateStr: string) => {
            if (!dateStr) return 0;
            const [y, m, d] = dateStr.split('-').map(Number);
            return new Date(y, m - 1, d).getTime();
        };

        if (task.startDate && task.endDate) {
            const start = parseLocal(task.startDate);
            const end = parseLocal(task.endDate) + (24 * 60 * 60 * 1000) - 1; // End of that day
            return start <= dayEnd && end >= dayStart;
        }

        const due = parseLocal(task.dueDate);
        return due >= dayStart && due <= dayEnd;
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6 px-4">
                <button onClick={prevMonth} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500">
                    <i className="fa-solid fa-chevron-left"></i>
                </button>
                <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest">{monthName}</h3>
                <button onClick={nextMonth} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500">
                    <i className="fa-solid fa-chevron-right"></i>
                </button>
            </div>
            <div className="grid grid-cols-7 mb-2">
                {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => (
                    <div key={d} className="text-center text-[10px] font-black uppercase text-slate-400 tracking-widest py-2">{d}</div>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
                {blanks.map(b => <div key={`blank-${b}`} className="h-24 bg-slate-50/30 rounded-xl"></div>)}
                {days.map(day => {
                    const activeTasks = tasks.filter(t => isTaskActiveOnDay(t, day) && t.estado !== 'DONE');
                    const isToday = new Date().toDateString() === new Date(year, month, day).toDateString();
                    return (
                        <div key={day} className={`h-24 bg-white border border-slate-100 rounded-xl p-2 relative hover:border-blue-300 transition-colors overflow-hidden ${isToday ? 'ring-2 ring-blue-500/20' : ''}`}>
                            <span className={`text-xs font-bold mb-1 block ${isToday ? 'text-blue-600' : 'text-slate-400'}`}>{day}</span>
                            <div className="space-y-1 overflow-y-auto max-h-[60px] custom-scrollbar">
                                {activeTasks.map(task => (
                                    <div
                                        key={task.id}
                                        onClick={() => onEditTask(task)}
                                        className={`text-[7px] px-1.5 py-0.5 rounded font-bold uppercase truncate cursor-pointer hover:opacity-80 border-l-2 ${task.priority === 'ASAP' ? 'bg-purple-50 text-purple-700 border-purple-500' :
                                            task.priority === 'High' ? 'bg-red-50 text-red-700 border-red-500' :
                                                task.priority === 'Medium' ? 'bg-orange-50 text-orange-700 border-orange-500' :
                                                    'bg-emerald-50 text-emerald-700 border-emerald-500'
                                            }`}
                                    >
                                        {task.nombre}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ==================== MAIN COMPONENT ====================
const SpacesView: React.FC = () => {
    const { state, dispatch } = useSpaces();
    const [viewMode, setViewMode] = useState<ViewMode>('lista');
    const [showModal, setShowModal] = useState(false);
    const [editingTask, setEditingTask] = useState<SpaceTask | null>(null);
    const [newTask, setNewTask] = useState(getDefaultTask());

    // DERIVE ACTIVE WORKSPACE
    const activeWorkspace = state.workspaces.find(w => w.id === state.activeWorkspaceId);
    if (!activeWorkspace) return <div className="flex-1 bg-slate-50 flex items-center justify-center text-slate-400">Select a workspace</div>;
    const spaces = activeWorkspace.espacios;

    // Find active items
    const activeSpace = spaces.find(s => s.id === state.activeSpaceId);
    let activeFolder: SpaceFolder | undefined;
    let activeList: SpaceList | undefined;

    if (activeSpace && state.activeFolderId) {
        activeFolder = activeSpace.carpetas.find(f => f.id === state.activeFolderId);
        if (activeFolder && state.activeListId) {
            activeList = activeFolder.listas.find(l => l.id === state.activeListId);
        }
    } else if (activeSpace && state.activeListId) {
        activeList = activeSpace.listas.find(l => l.id === state.activeListId);
    }

    const handleAddTask = () => {
        if (!newTask.nombre.trim() || !state.activeSpaceId || !state.activeListId) return;
        const finalStartDate = newTask.startDate || new Date().toISOString().split('T')[0];
        dispatch({
            type: 'ADD_TASK',
            payload: {
                spaceId: state.activeSpaceId,
                folderId: state.activeFolderId || undefined,
                listId: state.activeListId,
                task: { ...newTask, nombre: newTask.nombre.trim(), startDate: finalStartDate },
            },
        });
        setNewTask(getDefaultTask());
        setShowModal(false);
    };

    const handleUpdateTask = () => {
        if (!editingTask || !state.activeSpaceId || !state.activeListId) return;
        dispatch({
            type: 'UPDATE_TASK',
            payload: {
                spaceId: state.activeSpaceId,
                folderId: state.activeFolderId || undefined,
                listId: state.activeListId,
                task: editingTask,
            },
        });
        setEditingTask(null);
    };

    const handleToggleTask = (taskId: string) => {
        if (!state.activeSpaceId || !state.activeListId || !activeList) return;
        const task = activeList.tareas.find(t => t.id === taskId);
        if (!task) return;
        const newProgress = task.estado === 'DONE' ? 0 : 100;
        dispatch({
            type: 'UPDATE_TASK',
            payload: {
                spaceId: state.activeSpaceId,
                folderId: state.activeFolderId || undefined,
                listId: state.activeListId,
                task: { ...task, progress: newProgress, estado: getStatusFromProgress(newProgress) },
            },
        });
    };

    const handleDeleteTask = (taskId: string) => {
        if (!state.activeSpaceId || !state.activeListId) return;
        dispatch({
            type: 'DELETE_TASK',
            payload: {
                spaceId: state.activeSpaceId,
                folderId: state.activeFolderId || undefined,
                listId: state.activeListId,
                taskId,
            },
        });
    };

    const openEditModal = (task: SpaceTask) => setEditingTask({ ...task });

    // Empty states
    if (spaces.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center bg-[#F4F5F8]">
                <div className="text-center max-w-md p-8">
                    <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-blue-500/20">
                        <i className="fa-solid fa-layer-group text-3xl text-white"></i>
                    </div>
                    <h2 className="text-2xl font-black text-slate-800 mb-2">Bienvenido a Espacios</h2>
                    <p className="text-sm text-slate-500 mb-6">Organiza tu trabajo en una jerarquía flexible.</p>
                    <p className="text-xs text-slate-400">Usa el panel lateral para crear tu primer espacio <i className="fa-solid fa-arrow-left ml-1"></i></p>
                </div>
            </div>
        );
    }

    if (!activeList) {
        return (
            <div className="flex-1 flex items-center justify-center bg-[#F4F5F8]">
                <div className="text-center max-w-sm p-8">
                    <div className="w-16 h-16 bg-slate-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <i className="fa-solid fa-hand-pointer text-2xl text-slate-400"></i>
                    </div>
                    <h3 className="text-lg font-bold text-slate-700 mb-2">Selecciona una Lista</h3>
                    <p className="text-xs text-slate-500">Haz clic en una lista del panel lateral para ver y gestionar sus tareas.</p>
                </div>
            </div>
        );
    }

    const tasks = activeList.tareas;

    return (
        <div className="flex-1 flex flex-col bg-[#F4F5F8] overflow-hidden">
            {/* Header with breadcrumb and view switcher */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
                <div className="flex items-center gap-2 text-sm mb-3">
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: activeSpace?.color || '#3A57E8' }}></div>
                    <span className="font-semibold text-slate-700">{activeSpace?.nombre}</span>
                    {activeFolder && (
                        <>
                            <i className="fa-solid fa-chevron-right text-[8px] text-slate-400"></i>
                            <span className="text-slate-500">{activeFolder.nombre}</span>
                        </>
                    )}
                    <i className="fa-solid fa-chevron-right text-[8px] text-slate-400"></i>
                    <span className="font-bold text-slate-800">{activeList.nombre}</span>
                </div>

                {/* View switcher + Add button */}
                <div className="flex items-center justify-between">
                    <div className="flex gap-4">
                        <button onClick={() => setViewMode('lista')} className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-colors ${viewMode === 'lista' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                            <i className="fa-solid fa-list"></i> Lista
                        </button>
                        <button onClick={() => setViewMode('kanban')} className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-colors ${viewMode === 'kanban' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                            <i className="fa-solid fa-columns"></i> Kanban
                        </button>
                        <button onClick={() => setViewMode('gantt')} className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-colors ${viewMode === 'gantt' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                            <i className="fa-solid fa-chart-gantt"></i> Gantt
                        </button>
                        <button onClick={() => setViewMode('calendar')} className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-colors ${viewMode === 'calendar' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                            <i className="fa-solid fa-calendar-days"></i> Calendario
                        </button>
                    </div>
                    <button
                        onClick={() => { setNewTask(getDefaultTask()); setShowModal(true); }}
                        className="px-6 py-2 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase shadow-lg shadow-blue-200 hover:bg-blue-700 transition-colors"
                    >
                        <i className="fa-solid fa-plus mr-2"></i>Nueva Tarea
                    </button>
                </div>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-5xl mx-auto">
                    {viewMode === 'lista' && <ListaView tasks={tasks} onEditTask={openEditModal} onToggleTask={handleToggleTask} onDeleteTask={handleDeleteTask} />}
                    {viewMode === 'kanban' && <KanbanView tasks={tasks} onEditTask={openEditModal} />}
                    {viewMode === 'gantt' && <GanttChartView tasks={tasks} onEditTask={openEditModal} />}
                    {viewMode === 'calendar' && <CalendarViewComponent tasks={tasks} onEditTask={openEditModal} />}
                </div>
            </div>

            {/* CREATE TASK MODAL */}
            {showModal && (
                <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-2xl rounded-[2.5rem] p-10 space-y-6 shadow-2xl animate-in zoom-in-95 overflow-y-auto max-h-[90vh] custom-scrollbar">
                        <h3 className="text-3xl font-black text-slate-800 tracking-tighter uppercase">Crear Tarea</h3>

                        <div className="space-y-4">
                            <Input label="Nombre de la Tarea" value={newTask.nombre} onChange={(v: string) => setNewTask({ ...newTask, nombre: v })} />
                            <Input label="Cliente (opcional)" value={newTask.clientName || ''} onChange={(v: string) => setNewTask({ ...newTask, clientName: v })} />

                            {/* Auto-schedule section */}
                            <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-4">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <i className={`fa-solid ${newTask.autoSchedule ? 'fa-brain text-blue-500' : 'fa-anchor text-orange-500'}`}></i>
                                        <span className={`text-[10px] font-black uppercase ${newTask.autoSchedule ? 'text-blue-800' : 'text-orange-800'}`}>
                                            {newTask.autoSchedule ? 'Planificación Automática' : 'Bloqueo Manual'}
                                        </span>
                                    </div>
                                    <div className="flex bg-white p-1 rounded-lg border border-slate-200">
                                        <button type="button" onClick={() => setNewTask({ ...newTask, autoSchedule: true })} className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase transition-all ${newTask.autoSchedule ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Auto (IA)</button>
                                        <button type="button" onClick={() => setNewTask({ ...newTask, autoSchedule: false })} className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase transition-all ${!newTask.autoSchedule ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Manual</button>
                                    </div>
                                </div>

                                {newTask.autoSchedule ? (
                                    <>
                                        <div className="grid grid-cols-2 gap-4">
                                            <Input label="Fecha Límite (Deadline)" type="date" value={newTask.dueDate} onChange={(v: string) => setNewTask({ ...newTask, dueDate: v })} />
                                            <Input label="Fecha Mín. Inicio" type="date" value={newTask.startDate} onChange={(v: string) => setNewTask({ ...newTask, startDate: v })} />
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1.5 flex-1">
                                                <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Tipo Deadline</label>
                                                <select
                                                    className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-black text-xs uppercase"
                                                    value={newTask.deadlineType}
                                                    onChange={e => setNewTask({ ...newTask, deadlineType: e.target.value as DeadlineType })}
                                                >
                                                    <option value="Soft Deadline">Soft Deadline</option>
                                                    <option value="Hard Deadline">Hard Deadline</option>
                                                </select>
                                            </div>
                                            <div className="space-y-1.5 flex-1">
                                                <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Esfuerzo (Horas)</label>
                                                <input
                                                    type="number"
                                                    step="0.5"
                                                    min="0.1"
                                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none"
                                                    value={newTask.duration / 60}
                                                    onChange={(e) => setNewTask({ ...newTask, duration: Math.round(Number(e.target.value) * 60) })}
                                                />
                                            </div>
                                        </div>
                                        <div className="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between">
                                            <div>
                                                <p className="text-[9px] font-black text-slate-500 uppercase">Elasticidad</p>
                                                <p className="text-[8px] text-slate-400 font-bold">{newTask.elasticity === 1 ? 'Puede realizarse en bloques separados' : 'Debe realizarse de corrido'}</p>
                                            </div>
                                            <button type="button" onClick={() => setNewTask({ ...newTask, elasticity: newTask.elasticity === 1 ? 0 : 1 })} className={`w-12 h-6 rounded-full transition-all relative ${newTask.elasticity === 1 ? 'bg-green-500' : 'bg-slate-300'}`}>
                                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${newTask.elasticity === 1 ? 'left-7' : 'left-1'}`}></div>
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="grid grid-cols-2 gap-4">
                                        <Input label="Inicio Exacto" type="date" value={newTask.startDate} onChange={(v: string) => setNewTask({ ...newTask, startDate: v })} />
                                        <Input label="Fin Exacto" type="date" value={newTask.endDate} onChange={(v: string) => setNewTask({ ...newTask, endDate: v })} />
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5 flex-1">
                                    <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Prioridad</label>
                                    <select
                                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-xs uppercase"
                                        value={newTask.priority}
                                        onChange={e => setNewTask({ ...newTask, priority: e.target.value as TaskPriority })}
                                    >
                                        <option value="ASAP">ASAP</option>
                                        <option value="High">High</option>
                                        <option value="Medium">Medium</option>
                                        <option value="Low">Low</option>
                                    </select>
                                </div>
                                <Input label="Valor Total ($)" type="number" value={newTask.totalValue} onChange={(v: string) => setNewTask({ ...newTask, totalValue: Number(v) })} />
                            </div>
                        </div>

                        <div className="flex gap-4 pt-4">
                            <button type="button" onClick={() => setShowModal(false)} className="flex-1 font-black text-slate-400 uppercase text-[10px]">Cerrar</button>
                            <button type="button" onClick={handleAddTask} className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black text-[10px] uppercase shadow-2xl tracking-widest">Crear Tarea</button>
                        </div>
                    </div>
                </div>
            )}

            {/* EDIT TASK MODAL */}
            {editingTask && (
                <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setEditingTask(null)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-2xl rounded-[2.5rem] p-10 space-y-6 shadow-2xl animate-in zoom-in-95 overflow-y-auto max-h-[90vh] custom-scrollbar">
                        <div className="flex justify-between items-center">
                            <h3 className="text-3xl font-black text-slate-800 tracking-tighter uppercase">Editar Tarea</h3>
                            <button type="button" onClick={() => setEditingTask(null)} className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100">
                                <i className="fa-solid fa-xmark text-xl"></i>
                            </button>
                        </div>

                        <div className="space-y-4">
                            <Input label="Nombre de la Tarea" value={editingTask.nombre} onChange={(v: string) => setEditingTask({ ...editingTask, nombre: v })} />
                            <Input label="Cliente (opcional)" value={editingTask.clientName || ''} onChange={(v: string) => setEditingTask({ ...editingTask, clientName: v })} />

                            {/* Auto-schedule section */}
                            <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-4">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <i className={`fa-solid ${editingTask.autoSchedule ? 'fa-brain text-blue-500' : 'fa-anchor text-orange-500'}`}></i>
                                        <span className={`text-[10px] font-black uppercase ${editingTask.autoSchedule ? 'text-blue-800' : 'text-orange-800'}`}>
                                            {editingTask.autoSchedule ? 'Planificación Automática' : 'Bloqueo Manual'}
                                        </span>
                                    </div>
                                    <div className="flex bg-white p-1 rounded-lg border border-slate-200">
                                        <button type="button" onClick={() => setEditingTask({ ...editingTask, autoSchedule: true })} className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase transition-all ${editingTask.autoSchedule ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400'}`}>Auto</button>
                                        <button type="button" onClick={() => setEditingTask({ ...editingTask, autoSchedule: false })} className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase transition-all ${!editingTask.autoSchedule ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-400'}`}>Manual</button>
                                    </div>
                                </div>

                                {editingTask.autoSchedule ? (
                                    <>
                                        <div className="grid grid-cols-2 gap-4">
                                            <Input label="Fecha Límite (Deadline)" type="date" value={editingTask.dueDate} onChange={(v: string) => setEditingTask({ ...editingTask, dueDate: v })} />
                                            <Input label="Fecha Mín. Inicio" type="date" value={editingTask.startDate} onChange={(v: string) => setEditingTask({ ...editingTask, startDate: v })} />
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1.5 flex-1">
                                                <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Tipo Deadline</label>
                                                <select
                                                    className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-black text-xs uppercase"
                                                    value={editingTask.deadlineType}
                                                    onChange={e => setEditingTask({ ...editingTask, deadlineType: e.target.value as DeadlineType })}
                                                >
                                                    <option value="Soft Deadline">Soft Deadline</option>
                                                    <option value="Hard Deadline">Hard Deadline</option>
                                                </select>
                                            </div>
                                            <div className="space-y-1.5 flex-1">
                                                <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Esfuerzo (Horas)</label>
                                                <input
                                                    type="number"
                                                    step="0.5"
                                                    min="0.1"
                                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none"
                                                    value={editingTask.duration / 60}
                                                    onChange={(e) => setEditingTask({ ...editingTask, duration: Math.round(Number(e.target.value) * 60) })}
                                                />
                                            </div>
                                        </div>
                                        <div className="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between">
                                            <div>
                                                <p className="text-[9px] font-black text-slate-500 uppercase">Elasticidad</p>
                                                <p className="text-[8px] text-slate-400 font-bold">{editingTask.elasticity === 1 ? 'Puede realizarse en bloques separados' : 'Debe realizarse de corrido'}</p>
                                            </div>
                                            <button type="button" onClick={() => setEditingTask({ ...editingTask, elasticity: editingTask.elasticity === 1 ? 0 : 1 })} className={`w-12 h-6 rounded-full transition-all relative ${editingTask.elasticity === 1 ? 'bg-green-500' : 'bg-slate-300'}`}>
                                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${editingTask.elasticity === 1 ? 'left-7' : 'left-1'}`}></div>
                                            </button>
                                        </div>

                                        {/* Horarios Sugeridos (Auto-Schedule) */}
                                        {editingTask.scheduledSlots && editingTask.scheduledSlots.length > 0 && (
                                            <div className="p-4 bg-white rounded-2xl border border-slate-200">
                                                <h5 className="text-[9px] font-black uppercase text-slate-400 mb-2">Horarios Sugeridos (Auto-Schedule)</h5>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                    {editingTask.scheduledSlots.map((s, idx) => (
                                                        <div key={idx} className="text-[10px] font-bold text-slate-700 bg-slate-50 p-2 rounded-lg border flex justify-between items-center">
                                                            <span>{new Date(s.start).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                                            <i className="fa-solid fa-arrow-right text-[8px] text-slate-300"></i>
                                                            <span>{new Date(s.end).toLocaleString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="grid grid-cols-2 gap-4">
                                        <Input label="Inicio Exacto" type="date" value={editingTask.startDate} onChange={(v: string) => setEditingTask({ ...editingTask, startDate: v })} />
                                        <Input label="Fin Exacto" type="date" value={editingTask.endDate} onChange={(v: string) => setEditingTask({ ...editingTask, endDate: v })} />
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5 flex-1">
                                    <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Prioridad</label>
                                    <select
                                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-xs uppercase"
                                        value={editingTask.priority}
                                        onChange={e => setEditingTask({ ...editingTask, priority: e.target.value as TaskPriority })}
                                    >
                                        <option value="ASAP">ASAP</option>
                                        <option value="High">High</option>
                                        <option value="Medium">Medium</option>
                                        <option value="Low">Low</option>
                                    </select>
                                </div>
                                <Input label="Valor Total ($)" type="number" value={editingTask.totalValue} onChange={(v: string) => setEditingTask({ ...editingTask, totalValue: Number(v) })} />
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                                <div className="space-y-1.5 flex-1">
                                    <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Progreso (%)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-xs"
                                        value={editingTask.progress}
                                        onChange={(e) => {
                                            const val = Math.min(100, Math.max(0, Number(e.target.value)));
                                            setEditingTask({ ...editingTask, progress: val, estado: getStatusFromProgress(val) });
                                        }}
                                    />
                                </div>
                                <div className="space-y-1.5 flex-1">
                                    <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Estado</label>
                                    <select
                                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-xs uppercase opacity-80 cursor-not-allowed"
                                        value={editingTask.estado}
                                        disabled
                                    >
                                        <option value="TODO">To Do</option>
                                        <option value="ACTIVE">En Marcha</option>
                                        <option value="DONE">Finalizado</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-4 pt-4">
                            <button type="button" onClick={() => setEditingTask(null)} className="flex-1 font-black text-slate-400 uppercase text-[10px]">Cancelar</button>
                            <button type="button" onClick={handleUpdateTask} className="flex-1 py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase shadow-xl">Guardar Cambios</button>
                        </div>

                        <button
                            type="button"
                            onClick={() => { handleDeleteTask(editingTask.id); setEditingTask(null); }}
                            className="w-full py-3 rounded-2xl font-black text-[9px] uppercase text-red-400 hover:bg-red-50 transition-colors"
                        >
                            Eliminar Tarea
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SpacesView;
