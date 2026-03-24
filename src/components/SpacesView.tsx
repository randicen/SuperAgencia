
import React, { useState, useMemo, useEffect } from 'react';
import { useSpaces, getAllTasks } from '../contexts/SpacesContext';
import { Space, SpaceFolder, SpaceList, SpaceTask, SpaceEvent, TaskPriority, TaskStatus, DeadlineType } from '../spacesTypes';
import { Client } from '../types';
import { getPriorityBadgeStyle, getFormattedSlack } from '../utils/schedulingUtils';
import { getFormattedSlack as getFormattedSlackProject, runAutoScheduling } from '../utils/schedulingLogic';
import GanttChartView from './GanttChartView';
import SettingsView from './SettingsView';

// Helper: Calculate financial progress from installments
const getFinancialProgress = (task: SpaceTask): number => {
    if (!task.installments || task.installments.length === 0 || !task.totalValue || task.totalValue <= 0) return -1; // -1 means N/A
    const paid = task.installments.filter(i => i.status === 'PAGADO').reduce((sum, i) => sum + i.amount, 0);
    return Math.round((paid / task.totalValue) * 100);
};

type ViewMode = 'lista' | 'kanban' | 'gantt' | 'calendar' | 'settings';
type GroupBy = 'estado' | 'prioridad' | 'fecha';

// Translation maps for UI labels
const STATUS_LABELS: Record<TaskStatus, string> = {
    'TODO': 'Pendiente',
    'ACTIVE': 'En curso',
    'DONE': 'Hecho'
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
    'ASAP': 'Urgente',
    'High': 'Alta',
    'Medium': 'Normal',
    'Low': 'Baja'
};

const STATUS_ORDER: TaskStatus[] = ['TODO', 'ACTIVE', 'DONE'];
const PRIORITY_ORDER: TaskPriority[] = ['ASAP', 'High', 'Medium', 'Low'];

// Due date grouping helpers
const getDueDateGroup = (dueDate: string): string => {
    if (!dueDate) return 'Sin fecha límite';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'Con atraso';
    if (diffDays === 0) return 'Hoy';
    if (diffDays === 1) return 'Mañana';
    if (diffDays <= 7) return 'Esta semana';
    return 'Futuro';
};

const DUE_DATE_ORDER = ['Con atraso', 'Hoy', 'Mañana', 'Esta semana', 'Futuro', 'Sin fecha límite'];

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
    endDate: '', // Empty by default
    dueDate: '', // Empty by default (Optional)
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

// Effort Input component
const EffortInput = ({ duration, onChange, className = "" }: { duration: number, onChange: (d: number) => void, className?: string }) => {
    const hours = Math.floor(duration / 60);
    const minutes = duration % 60;
    return (
        <div className={`space-y-1.5 ${className}`}>
            <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1 flex items-center gap-1.5">
                <i className="fa-solid fa-stopwatch text-slate-300"></i> Esfuerzo Estimado
            </label>
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <input
                        type="number" min="0" 
                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-4 ring-blue-500/10 transition-all pr-8"
                        value={hours || ''} placeholder="0"
                        onChange={e => {
                            const val = e.target.value;
                            const h = val === '' ? 0 : Math.max(0, parseInt(val) || 0);
                            onChange(h * 60 + minutes);
                        }}
                    />
                    <span className="absolute right-3 top-[17px] text-[10px] font-black text-slate-400 uppercase">h</span>
                </div>
                <div className="relative flex-1">
                    <input
                        type="number" min="0" max="59" 
                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-4 ring-blue-500/10 transition-all pr-8"
                        value={minutes === 0 && hours === 0 ? '' : minutes} placeholder="0"
                        onChange={e => {
                            const val = e.target.value;
                            let m = val === '' ? 0 : parseInt(val) || 0;
                            if (m < 0) m = 0;
                            if (m > 59) m = 59;
                            onChange(hours * 60 + m);
                        }}
                    />
                    <span className="absolute right-3 top-[17px] text-[10px] font-black text-slate-400 uppercase">m</span>
                </div>
            </div>
        </div>
    );
};

// Progress Input component (slider + quick buttons)
const ProgressInput = ({ progress, onChange, className = "" }: { progress: number, onChange: (p: number) => void, className?: string }) => {
    return (
        <div className={`space-y-3 flex-1 ${className}`}>
            <div className="flex justify-between items-center mb-1">
                <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5">
                    <i className="fa-solid fa-bars-progress text-slate-300"></i> Progreso Total
                </label>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${progress === 100 ? 'bg-emerald-100 text-emerald-700' : progress > 0 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                    {progress}%
                </span>
            </div>
            
            <div className="flex items-center gap-3">
                <input
                    type="range" min="0" max="100" step="1"
                    className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    value={progress}
                    onChange={(e) => onChange(Number(e.target.value))}
                />
                <input
                    type="number" min="0" max="100"
                    className="w-16 p-3 bg-slate-50 border border-slate-200 rounded-xl font-black text-xs text-center outline-none focus:ring-4 ring-blue-500/10 transition-all"
                    value={progress}
                    onChange={(e) => {
                        const val = e.target.value;
                        const p = val === '' ? 0 : Math.min(100, Math.max(0, parseInt(val) || 0));
                        onChange(p);
                    }}
                />
            </div>
            
            <div className="flex gap-1 justify-between mt-2">
                {[0, 25, 50, 75, 100].map(p => (
                    <button key={p} type="button" onClick={() => onChange(p)} className={`flex-1 text-[9px] font-black py-1.5 rounded-lg transition-colors ${progress === p ? 'bg-slate-800 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}>
                        {p}%
                    </button>
                ))}
            </div>
        </div>
    );
};

// Helper for user-friendly date formatting
const formatFriendlyDate = (dateStr: string) => {
    if (!dateStr) return '-';
    // Handle both YYYY-MM-DD and ISO string
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '-';

    // If it has time component (T) and not T00:00:00ish, show time
    // Basic check: if original string length > 10, assume time matters
    const hasTime = dateStr.includes('T') && dateStr.length > 10;

    const day = date.getDate();
    const month = date.toLocaleDateString('es-ES', { month: 'short' });

    if (hasTime) {
        const h = date.getHours();
        const h12 = h % 12 || 12;
        const m = date.getMinutes().toString().padStart(2, '0');
        const ampm = h >= 12 ? 'pm' : 'am';
        return `${day} ${month}, ${h12}:${m} ${ampm}`;
    }
    return `${day} ${month}`;
};

// ==================== LISTA VIEW (TABLE-BASED) ====================
// Column definitions
type ColumnId = 'nombre' | 'startDate' | 'dueDate' | 'priority' | 'estado' | 'duration' | 'progress' | 'slack' | 'clientName' | 'totalValue' | 'financialProgress';
const ALL_COLUMNS: { id: ColumnId; label: string; width: string }[] = [
    { id: 'nombre', label: 'Nombre', width: 'w-[300px] shrink-0' },
    { id: 'clientName', label: 'Cliente', width: 'w-32 shrink-0' },
    { id: 'totalValue', label: 'Valor', width: 'w-28 shrink-0' },
    { id: 'financialProgress', label: 'Pago', width: 'w-28 shrink-0' },
    { id: 'startDate', label: 'Fecha inicio', width: 'w-36 shrink-0' },
    { id: 'dueDate', label: 'Fecha límite', width: 'w-36 shrink-0' },
    { id: 'priority', label: 'Prioridad', width: 'w-28 shrink-0' },
    { id: 'slack', label: 'Margen', width: 'w-28 shrink-0' },
    { id: 'estado', label: 'Estado', width: 'w-32 shrink-0' },
    { id: 'duration', label: 'Esfuerzo', width: 'w-24 shrink-0' },
    { id: 'progress', label: 'Progreso', width: 'w-24 shrink-0' },
];

const ListaView: React.FC<{
    tasks: SpaceTask[];
    rules: any; // BusinessRules from state
    groupBy: GroupBy;
    onEditTask: (t: SpaceTask) => void;
    onToggleTask: (taskId: string) => void;
    onDeleteTask: (task: SpaceTask) => void;
    onAddSubtask: (parentTask: SpaceTask) => void;
    onAddTask: (defaults: Partial<SpaceTask>) => void;
    deletingTaskId?: string | null;
}> = ({ tasks, rules, groupBy, onEditTask, onToggleTask, onDeleteTask, onAddSubtask, onAddTask, deletingTaskId }) => {
    const [columnOrder, setColumnOrder] = useState<ColumnId[]>(() => {
        try {
            const saved = localStorage.getItem('lista_column_order');
            const defaultOrder: ColumnId[] = ['nombre', 'clientName', 'totalValue', 'financialProgress', 'startDate', 'dueDate', 'priority', 'slack', 'estado', 'duration', 'progress'];
            if (saved) {
                const parsed = JSON.parse(saved);
                const missing = defaultOrder.filter(id => !parsed.includes(id));
                return [...parsed, ...missing];
            }
            return defaultOrder;
        } catch { return ['nombre', 'clientName', 'totalValue', 'financialProgress', 'startDate', 'dueDate', 'priority', 'slack', 'estado', 'duration', 'progress']; }
    });
    const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(() => {
        try {
            const saved = localStorage.getItem('lista_columns');
            if (saved) {
                 const parsed = JSON.parse(saved);
                 // If we find that the newly added mandatory columns were missed from a previous save, we add them at the front?
                 // Or just trust the current toggle. 
                 return parsed;
            }
            return ['nombre', 'clientName', 'totalValue', 'financialProgress', 'startDate', 'dueDate', 'priority', 'slack', 'estado'];
        } catch { return ['nombre', 'clientName', 'totalValue', 'financialProgress', 'startDate', 'dueDate', 'priority', 'slack', 'estado']; }
    });
    const [showColumnSelector, setShowColumnSelector] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});
    const [draggedColumn, setDraggedColumn] = useState<ColumnId | null>(null);

    useEffect(() => {
        localStorage.setItem('lista_column_order', JSON.stringify(columnOrder));
    }, [columnOrder]);
    useEffect(() => {
        localStorage.setItem('lista_columns', JSON.stringify(visibleColumns));
    }, [visibleColumns]);

    const toggleColumn = (colId: ColumnId) => {
        if (colId === 'nombre') return;
        setVisibleColumns(prev => prev.includes(colId) ? prev.filter(c => c !== colId) : [...prev, colId]);
    };

    const toggleGroupCollapse = (key: string) => {
        setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const toggleTaskExpand = (taskId: string) => {
        setExpandedTasks(prev => ({ ...prev, [taskId]: !prev[taskId] }));
    };

    const handleDragStart = (colId: ColumnId) => {
        if (colId === 'nombre') return;
        setDraggedColumn(colId);
    };
    const handleDragOver = (e: React.DragEvent, targetColId: ColumnId) => {
        e.preventDefault();
        if (!draggedColumn || draggedColumn === targetColId || targetColId === 'nombre') return;
    };
    const handleDrop = (targetColId: ColumnId) => {
        if (!draggedColumn || draggedColumn === targetColId || targetColId === 'nombre') {
            setDraggedColumn(null);
            return;
        }
        const newOrder = [...columnOrder];
        const dragIdx = newOrder.indexOf(draggedColumn);
        const targetIdx = newOrder.indexOf(targetColId);
        newOrder.splice(dragIdx, 1);
        newOrder.splice(targetIdx, 0, draggedColumn);
        setColumnOrder(newOrder);
        setDraggedColumn(null);
    };

    const getGroups = (): { key: string; label: string; tasks: SpaceTask[]; color: string; icon: string }[] => {
        if (groupBy === 'estado') {
            return STATUS_ORDER.map(status => ({
                key: status, label: STATUS_LABELS[status], tasks: tasks.filter(t => t.estado === status),
                color: status === 'TODO' ? 'bg-orange-500' : status === 'ACTIVE' ? 'bg-blue-500' : 'bg-green-500',
                icon: status === 'TODO' ? 'fa-circle-dot' : status === 'ACTIVE' ? 'fa-spinner' : 'fa-check-circle'
            }));
        } else if (groupBy === 'prioridad') {
            return PRIORITY_ORDER.map(priority => ({
                key: priority, label: PRIORITY_LABELS[priority], tasks: tasks.filter(t => t.priority === priority),
                color: priority === 'ASAP' ? 'bg-purple-500' : priority === 'High' ? 'bg-red-500' : priority === 'Medium' ? 'bg-orange-500' : 'bg-emerald-500',
                icon: priority === 'ASAP' ? 'fa-bolt' : 'fa-flag'
            }));
        } else {
            return DUE_DATE_ORDER.map(group => ({
                key: group, label: group, tasks: tasks.filter(t => getDueDateGroup(t.dueDate) === group),
                color: group === 'Con atraso' ? 'bg-red-500' : group === 'Hoy' ? 'bg-orange-500' : 'bg-slate-400',
                icon: group === 'Con atraso' ? 'fa-exclamation-triangle' : 'fa-calendar'
            }));
        }
    };

    const groups = getGroups();
    const orderedColumns = columnOrder.filter(id => visibleColumns.includes(id)).map(id => ALL_COLUMNS.find(c => c.id === id)!);

    const renderCell = (task: SpaceTask, colId: ColumnId, level: number = 0) => {
        const hasSubtasks = task.subtasks && task.subtasks.length > 0;
        const isExpanded = expandedTasks[task.id];
        switch (colId) {
            case 'nombre':
                const hasSubtasks = task.subtasks && task.subtasks.length > 0;
                const isExpanded = expandedTasks[task.id];
                return (
                    <div className="flex items-center" style={{ paddingLeft: level * 20 }}>
                        {/* Unified Action Zone (Fixed Width for Symmetry) */}
                        <div className="flex items-center gap-2 w-24 shrink-0">
                            {/* Expand/Collapse Chevron */}
                            <div className="w-5 flex items-center justify-center">
                                {hasSubtasks && (
                                    <button onClick={(e) => { e.stopPropagation(); toggleTaskExpand(task.id); }}
                                        className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors">
                                        <i className={`fa-solid fa-chevron-${isExpanded ? 'down' : 'right'} text-[9px]`}></i>
                                    </button>
                                )}
                            </div>

                            {/* Quick Delete Trash */}
                            <button 
                                onClick={(e) => { e.stopPropagation(); onDeleteTask(task); }}
                                className="w-6 h-6 flex items-center justify-center text-slate-200 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100 rounded-lg hover:bg-red-50"
                                title="Eliminar Tarea"
                            >
                                <i className="fa-solid fa-trash-can text-[10px]"></i>
                            </button>

                            {/* Checkbox */}
                            <button 
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleTask(task.id); }}
                                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all cursor-pointer z-10 ${task.estado === 'DONE' ? 'bg-green-500 border-green-500 text-white shadow-sm' : 'border-slate-300 hover:border-blue-500 hover:bg-blue-50'}`}
                                title={task.estado === 'DONE' ? 'Marcar como pendiente' : 'Marcar como completada'}
                            >
                                {task.estado === 'DONE' && <i className="fa-solid fa-check text-[10px]"></i>}
                            </button>
                        </div>

                        <span className={`text-sm font-bold truncate tracking-tight transition-colors pl-1 ${task.estado === 'DONE' ? 'line-through text-slate-400' : 'text-slate-700'}`}>{task.nombre}</span>
                        {task.hasConflict && task.estado !== 'DONE' && (
                            <span className="text-[10px] text-red-500 bg-red-50 px-1.5 py-0.5 rounded border border-red-100 flex items-center gap-1">
                                <i className="fa-solid fa-triangle-exclamation"></i>
                                Conflicto
                            </span>
                        )}
                        {hasSubtasks && (
                            <span className="text-[9px] text-slate-400 bg-slate-100 px-1.5 rounded"><i className="fa-solid fa-diagram-project mr-1"></i>{task.subtasks!.filter(s => s.estado === 'DONE').length}/{task.subtasks!.length}</span>
                        )}
                    </div>
                );
            case 'startDate': return <span className="text-xs text-slate-500 whitespace-nowrap">{formatFriendlyDate(task.startDate)}</span>;
            case 'dueDate': 
                return (
                    <div className="flex flex-col">
                        <span className="text-xs text-slate-700 font-bold whitespace-nowrap">
                            {formatFriendlyDate(task.dueDate)}
                        </span>
                        {task.autoSchedule && task.startDate && task.endDate && (
                            <span className="text-[9px] text-slate-400 whitespace-nowrap mt-0.5" title="Horario programado por IA">
                                <i className="fa-solid fa-robot text-blue-400 mr-1"></i>
                                {new Date(task.startDate).toLocaleTimeString('en-US', {hour: 'numeric', minute:'2-digit', hour12: true}).toLowerCase()} - {new Date(task.endDate).toLocaleTimeString('en-US', {hour: 'numeric', minute:'2-digit', hour12: true}).toLowerCase()}
                                {new Date(task.endDate) > new Date(task.dueDate!) && (
                                    <span className="text-red-500 font-bold ml-1" title="La IA estima que terminarás después del deadline">¡Riesgo!</span>
                                )}
                            </span>
                        )}
                    </div>
                );
            case 'priority': return <span className={`text-[9px] font-black uppercase px-2 py-1 rounded ${getPriorityStyle(task.priority)}`}>{PRIORITY_LABELS[task.priority]}</span>;
            case 'slack': {
                const slack = getFormattedSlack({ dueDate: task.dueDate, duration: task.duration });
                if (task.estado === 'DONE') {
                    return <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded border border-slate-200 opacity-80">Completado</span>;
                }
                return <span className={`text-[9px] font-bold ${slack.isOverdue ? 'text-red-500 bg-red-50' : 'text-emerald-600 bg-emerald-50'} px-2 py-1 rounded border border-current opacity-80`}>{slack.text}</span>;
            }
            case 'estado': return <span className={`text-[9px] font-black uppercase px-2 py-1 rounded ${task.estado === 'TODO' ? 'bg-orange-100 text-orange-700' : task.estado === 'ACTIVE' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{STATUS_LABELS[task.estado]}</span>;
            case 'duration': return <span className="text-xs text-slate-500">{formatDuration(task.duration)}</span>;
            case 'progress': return <span className="text-xs text-slate-500">{task.progress}%</span>;
            case 'clientName': return <span className="text-xs text-slate-500 truncate">{task.clientName || '-'}</span>;
            case 'totalValue': return <span className="text-xs text-slate-500">{task.totalValue > 0 ? `$${task.totalValue.toLocaleString()}` : '-'}</span>;
            case 'financialProgress': {
                const fp = getFinancialProgress(task);
                if (fp < 0) return <span className="text-xs text-slate-300">-</span>;
                return (
                    <div className="flex items-center gap-1.5">
                        <div className="w-12 bg-slate-100 h-1.5 rounded-full overflow-hidden"><div className="bg-emerald-500 h-full" style={{width: `${fp}%`}}></div></div>
                        <span className="text-[9px] font-bold text-emerald-600">{fp}%</span>
                    </div>
                );
            }
            default: return null;
        }
    };

    if (tasks.length === 0) {
        return (<div className="text-center py-12"><i className="fa-solid fa-inbox text-4xl text-slate-300 mb-3"></i><p className="text-sm text-slate-500">No hay tareas en esta lista</p></div>);
    }

    return (
        <div className="space-y-4 pb-20">
            <div className="flex justify-end relative">
                <button onClick={() => setShowColumnSelector(!showColumnSelector)} className="text-[10px] font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-slate-100 relative z-50">
                    <i className="fa-solid fa-table-columns"></i> Columnas
                </button>
                {showColumnSelector && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowColumnSelector(false)}></div>
                        <div className="absolute top-8 right-0 bg-white border border-slate-200 rounded-xl shadow-xl p-3 z-50 min-w-[180px] animate-in slide-in-from-top-2">
                            {ALL_COLUMNS.map(col => (
                                <label key={col.id} className="flex items-center gap-2 py-1.5 px-2 hover:bg-slate-50 rounded-lg cursor-pointer">
                                    <input type="checkbox" checked={visibleColumns.includes(col.id)} onChange={() => toggleColumn(col.id)} disabled={col.id === 'nombre'} className="w-4 h-4 rounded border-slate-300" />
                                    <span className="text-xs text-slate-600">{col.label}</span>
                                </label>
                            ))}
                        </div>
                    </>
                )}
            </div>
            {groups.map(group => {
                if (group.tasks.length === 0) return null;
                const isCollapsed = collapsedGroups[group.key];
                return (
                    <div key={group.key} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-100 cursor-pointer hover:bg-slate-100" onClick={() => toggleGroupCollapse(group.key)}>
                            <i className={`fa-solid fa-chevron-${isCollapsed ? 'right' : 'down'} text-[10px] text-slate-400`}></i>
                            <span className={`w-2 h-2 rounded-full ${group.color}`}></span>
                            <i className={`fa-solid ${group.icon} text-[10px] text-slate-400`}></i>
                            <span className="text-xs font-black uppercase text-slate-600">{group.label}</span>
                            <span className="text-[10px] text-slate-400 font-bold">{group.tasks.length}</span>
                        </div>
                        {!isCollapsed && (
                            <div className="overflow-x-auto">
                                <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50/50 min-w-max">
                                    {orderedColumns.map(col => (
                                        <div
                                            key={col.id}
                                            className={`${col.width} text-[9px] font-black uppercase px-2 ${col.id === 'nombre' ? 'text-slate-400 pl-24' : 'text-slate-400 pl-1'}`}
                                        >
                                            {col.label}
                                        </div>
                                    ))}
                                    <div className="w-16"></div>
                                </div>
                                {/* Recursive TaskRow Component */}
                                {(() => {
                                    const renderTaskRow = (task: SpaceTask, level: number = 0): React.ReactNode => {
                                        const hasSubtasks = task.subtasks && task.subtasks.length > 0;
                                        const isExpanded = expandedTasks[task.id];
                                        const isDeleting = deletingTaskId === task.id;
                                        return (
                                            <React.Fragment key={task.id}>
                                                <div onClick={(e) => { e.stopPropagation(); onEditTask(task); }} className={`flex items-center gap-2 px-0 py-2.5 border-b border-slate-50 hover:bg-blue-50/50 cursor-pointer group min-w-max transition-all duration-300 ${isDeleting ? 'translate-x-full opacity-0 scale-95' : ''} ${level > 0 ? 'bg-slate-50/30' : ''}`}>
                                                    {orderedColumns.map(col => (<div key={col.id} className={`${col.width} px-2`}>{renderCell(task, col.id, level)}</div>))}
                                                    <div className="w-16 flex items-center gap-1 opacity-0 group-hover:opacity-100">
                                                        <button onClick={(e) => { e.stopPropagation(); onAddSubtask(task); }} className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-blue-600 rounded"><i className="fa-solid fa-plus text-[10px]"></i></button>
                                                    </div>
                                                </div>
                                                {/* Render subtasks if expanded */}
                                                {isExpanded && hasSubtasks && task.subtasks!.map(sub => renderTaskRow(sub, level + 1))}
                                            </React.Fragment>
                                        );
                                    };
                                    return group.tasks.map(task => renderTaskRow(task, 0));
                                })()}
                                {/* Add Task Button - Now functional */}
                                <div
                                    className="flex items-center gap-2 px-4 py-2 text-slate-400 hover:bg-slate-50 cursor-pointer"
                                    onClick={() => {
                                        const defaultData: Partial<SpaceTask> = {
                                            ...getDefaultTask(),
                                            nombre: '',
                                            // Set group-specific defaults
                                            ...(groupBy === 'estado' ? { estado: group.key as TaskStatus } : {}),
                                            ...(groupBy === 'prioridad' ? { priority: group.key as TaskPriority } : {}),
                                        };
                                        onAddTask(defaultData);
                                    }}
                                >
                                    <i className="fa-solid fa-plus text-[10px]"></i>
                                    <span className="text-xs">Añadir Tarea</span>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

// ==================== KANBAN VIEW ====================
const KanbanView: React.FC<{
    tasks: SpaceTask[];
    groupBy: GroupBy;
    onEditTask: (t: SpaceTask) => void;
    onUpdateTask: (id: string, updates: Partial<SpaceTask>) => void;
    onDeleteTask: (t: SpaceTask) => void;
    deletingTaskId?: string | null;
}> = ({ tasks, groupBy, onEditTask, onUpdateTask, onDeleteTask, deletingTaskId }) => {

    // Drag & Drop Handlers
    const handleDragStart = (e: React.DragEvent, taskId: string) => {
        e.dataTransfer.setData('taskId', taskId);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent, groupKey: string) => {
        e.preventDefault();
        const taskId = e.dataTransfer.getData('taskId');
        if (!taskId) return;

        // Verify if we are moving to a different group
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        if (groupBy === 'estado') {
            if (task.estado !== groupKey) {
                let newProgress = task.progress;
                const newStatus = groupKey as TaskStatus;

                // Auto-update progress based on status change
                if (newStatus === 'DONE') newProgress = 100;
                else if (newStatus === 'TODO') newProgress = 0;
                else if (newStatus === 'ACTIVE' && (task.progress === 0 || task.progress === 100)) {
                    newProgress = 10; // Default to 10% if coming from complete/empty
                }

                onUpdateTask(taskId, { estado: newStatus, progress: newProgress });
            }
        } else if (groupBy === 'prioridad') {
            if (task.priority !== groupKey) onUpdateTask(taskId, { priority: groupKey as TaskPriority });
        }
        // TODO: Handle date grouping drops if needed
    };

    // Dynamic columns based on groupBy
    const getColumns = (): { id: string; label: string; icon: string; color: string; bgColor: string; filterFn: (t: SpaceTask) => boolean }[] => {
        if (groupBy === 'estado') {
            return [
                { id: 'TODO', label: 'Pendiente', icon: 'fa-circle-dot', color: 'text-orange-500', bgColor: 'bg-orange-500', filterFn: t => t.estado === 'TODO' },
                { id: 'ACTIVE', label: 'En curso', icon: 'fa-spinner', color: 'text-blue-500', bgColor: 'bg-blue-500', filterFn: t => t.estado === 'ACTIVE' },
                { id: 'DONE', label: 'Hecho', icon: 'fa-check-circle', color: 'text-emerald-500', bgColor: 'bg-emerald-500', filterFn: t => t.estado === 'DONE' }
            ];
        } else if (groupBy === 'prioridad') {
            return [
                { id: 'ASAP', label: 'Urgente', icon: 'fa-bolt', color: 'text-purple-500', bgColor: 'bg-purple-500', filterFn: t => t.priority === 'ASAP' },
                { id: 'High', label: 'Alta', icon: 'fa-arrow-up', color: 'text-red-500', bgColor: 'bg-red-500', filterFn: t => t.priority === 'High' },
                { id: 'Medium', label: 'Normal', icon: 'fa-minus', color: 'text-orange-500', bgColor: 'bg-orange-500', filterFn: t => t.priority === 'Medium' },
                { id: 'Low', label: 'Baja', icon: 'fa-arrow-down', color: 'text-emerald-500', bgColor: 'bg-emerald-500', filterFn: t => t.priority === 'Low' }
            ];
        } else {
            return DUE_DATE_ORDER.map(group => ({
                id: group,
                label: group,
                icon: group === 'Con atraso' ? 'fa-exclamation-triangle' : group === 'Hoy' ? 'fa-clock' : 'fa-calendar',
                color: group === 'Con atraso' ? 'text-red-500' : group === 'Hoy' ? 'text-orange-500' : 'text-slate-400',
                bgColor: group === 'Con atraso' ? 'bg-red-500' : group === 'Hoy' ? 'bg-orange-500' : 'bg-slate-400',
                filterFn: (t: SpaceTask) => getDueDateGroup(t.dueDate) === group
            }));
        }
    };
    const columns = getColumns();

    return (
        <div className="flex gap-4 h-full min-h-[400px] overflow-x-auto pb-4">
            {columns.map(col => {
                const colTasks = tasks.filter(col.filterFn);
                return (
                    <div
                        key={col.id}
                        className="flex flex-col bg-slate-50/50 rounded-2xl p-3 border border-slate-100 shadow-inner min-w-[220px] shrink-0"
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, col.id)}
                    >
                        <div className="flex items-center justify-between mb-4 px-2">
                            <div className="flex items-center gap-2">
                                <i className={`fa-solid ${col.icon} ${col.color} text-xs`}></i>
                                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">{col.label}</h3>
                            </div>
                            <span className="text-[10px] font-black bg-white px-2 py-0.5 rounded-full border border-slate-200 text-slate-400">
                                {tasks.filter(col.filterFn).length}
                            </span>
                        </div>
                        <div className="flex-1 space-y-3 overflow-y-auto custom-scrollbar pr-1">
                            {tasks.filter(col.filterFn).map(task => {
                                const slack = getFormattedSlack({ dueDate: task.dueDate, duration: task.duration });
                                const isDeleting = deletingTaskId === task.id;

                                return (
                                    <div
                                        key={task.id}
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, task.id)}
                                        onClick={() => onEditTask(task)}
                                        className={`bg-white p-5 rounded-2xl border shadow-sm hover:shadow-md cursor-pointer group relative overflow-hidden transition-all duration-300 ${isDeleting ? 'scale-90 opacity-0 -translate-y-4' : ''} ${task.hasConflict && task.estado !== 'DONE' ? 'border-red-400 ring-1 ring-red-400 hover:border-red-500 hover:ring-red-500' : 'border-slate-200 hover:border-blue-200'}`}
                                    >
                                        {/* Priority Indicator Line */}
                                        <div className={`absolute top-0 left-0 w-1 h-full ${task.priority === 'ASAP' ? 'bg-purple-500' :
                                            task.priority === 'High' ? 'bg-red-500' :
                                                task.priority === 'Medium' ? 'bg-orange-400' : 'bg-emerald-400'
                                            }`}></div>

                                        {/* Quick Delete Button - Refined Premium Styling */}
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); onDeleteTask(task); }}
                                            className="absolute top-2.5 right-2.5 w-7 h-7 flex items-center justify-center rounded-xl bg-white/80 backdrop-blur-sm border border-slate-100 text-slate-300 opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500 hover:text-white z-10 shadow-sm"
                                            title="Eliminar Tarea"
                                        >
                                            <i className="fa-solid fa-trash-can text-[10px]"></i>
                                        </button>

                                        <div className="flex justify-between items-start mb-3 pl-2">
                                            <h4 className="font-bold text-slate-800 text-sm leading-tight group-hover:text-blue-600 transition-colors line-clamp-2">
                                                {task.nombre}
                                            </h4>
                                        </div>

                                        <div className="pl-2 space-y-3">
                                            {task.clientName && (
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">
                                                    <i className="fa-solid fa-user mr-1 text-[8px]"></i>{task.clientName}
                                                </p>
                                            )}

                                            <div className="flex flex-wrap gap-2">
                                                <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded border ${getPriorityStyle(task.priority)}`}>
                                                    {PRIORITY_LABELS[task.priority]}
                                                </span>
                                                {task.elasticity === 0 && (
                                                    <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded border bg-yellow-50 text-yellow-600 border-yellow-200">
                                                        Rígido
                                                    </span>
                                                )}
                                            </div>

                                            {/* Metrics Box */}
                                            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100/50 space-y-2">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[9px] font-black text-slate-400 uppercase">Margen</span>
                                                    <span className={`text-[9px] font-black ${task.estado === 'DONE' ? 'text-slate-400' : slack.isOverdue ? 'text-red-500' : 'text-emerald-500'}`}>
                                                        {task.estado === 'DONE' ? 'Completado' : slack.text}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[9px] font-black text-slate-400 uppercase">Esfuerzo</span>
                                                    <span className="text-[9px] font-bold text-slate-600">
                                                        {formatDuration(task.duration)}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between items-center pt-2 border-t border-slate-200/50">
                                                    <span className="text-[9px] font-black text-slate-400 uppercase">Entrega</span>
                                                    <div className="text-right">
                                                        <span className="text-[10px] font-bold text-slate-700 block">
                                                            {formatFriendlyDate(task.autoSchedule && task.endDate ? task.endDate : task.dueDate)}
                                                            {task.autoSchedule && <i className="fa-solid fa-robot text-blue-500 text-[9px] ml-1 opacity-70" title="Calculado automático"></i>}
                                                        </span>
                                                        {task.autoSchedule && task.endDate && (
                                                            <span className="text-[8px] text-slate-400">Límite: {formatFriendlyDate(task.dueDate)}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                {task.totalValue > 0 && (
                                                    <div className="flex justify-between items-center pt-2 border-t border-slate-200/50">
                                                        <span className="text-[9px] font-black text-slate-400 uppercase">Valor</span>
                                                        <span className="text-[9px] font-bold text-blue-600">${task.totalValue.toLocaleString()}</span>
                                                    </div>
                                                )}
                                                {(() => { const fp = getFinancialProgress(task); return fp >= 0 ? (
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[9px] font-black text-slate-400 uppercase">Pago</span>
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="w-10 bg-slate-200 h-1 rounded-full overflow-hidden"><div className="bg-emerald-500 h-full" style={{width: `${fp}%`}}></div></div>
                                                            <span className="text-[9px] font-bold text-emerald-600">{fp}%</span>
                                                        </div>
                                                    </div>
                                                ) : null; })()}
                                            </div>

                                            {/* Progress Bar */}
                                            <div className="space-y-1">
                                                <div className="flex justify-between items-center text-[8px] font-black uppercase">
                                                    <span className="text-slate-400">Progreso</span>
                                                    <span className="text-blue-600">{task.progress}%</span>
                                                </div>
                                                <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
                                                    <div className="bg-blue-600 h-full transition-all duration-1000" style={{ width: `${task.progress}%` }}></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// ==================== GANTT VIEW ====================
type TimeRange = 'Día' | 'Semana' | 'Mes' | 'Trimestre' | 'Año';



// ==================== CALENDAR VIEW ====================
const CalendarViewComponent: React.FC<{
    tasks: SpaceTask[];
    events: SpaceEvent[];
    rules: any;
    onEditTask: (t: SpaceTask) => void;
    onEditEvent?: (e: SpaceEvent) => void;
}> = ({ tasks, events, rules, onEditTask, onEditEvent }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [view, setView] = useState<'month' | 'week' | '4days' | 'day'>('month');

    // Helper functions for date manipulation
    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (year: number, month: number) => {
        const day = new Date(year, month, 1).getDay();
        return day === 0 ? 6 : day - 1; // Ajuste para iniciar Lunes
    };

    // Generate dates to show based on View
    const getDatesToShow = () => {
        const dates: Date[] = [];
        const start = new Date(currentDate);
        start.setHours(0, 0, 0, 0);

        if (view === 'month') {
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const daysInMonth = getDaysInMonth(year, month);
            for (let i = 1; i <= daysInMonth; i++) {
                dates.push(new Date(year, month, i));
            }
        } else if (view === 'week') {
            // Get start of week (Monday)
            const day = start.getDay();
            const diff = start.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(start.setDate(diff));
            for (let i = 0; i < 7; i++) {
                const d = new Date(monday);
                d.setDate(monday.getDate() + i);
                dates.push(d);
            }
        } else if (view === '4days') {
            for (let i = 0; i < 4; i++) {
                const d = new Date(start);
                d.setDate(start.getDate() + i);
                dates.push(d);
            }
        } else if (view === 'day') {
            dates.push(new Date(start));
        }
        return dates;
    };

    const datesToShow = getDatesToShow();
    const monthName = currentDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

    const handleNext = () => {
        const d = new Date(currentDate);
        if (view === 'month') d.setMonth(d.getMonth() + 1);
        else if (view === 'week') d.setDate(d.getDate() + 7);
        else if (view === '4days') d.setDate(d.getDate() + 4);
        else d.setDate(d.getDate() + 1);
        setCurrentDate(d);
    };

    const handlePrev = () => {
        const d = new Date(currentDate);
        if (view === 'month') d.setMonth(d.getMonth() - 1);
        else if (view === 'week') d.setDate(d.getDate() - 7);
        else if (view === '4days') d.setDate(d.getDate() - 4);
        else d.setDate(d.getDate() - 1);
        setCurrentDate(d);
    };

    const isTaskActiveOnDay = (task: SpaceTask, date: Date) => {
        const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
        const dayStartTs = dayStart.getTime();
        const dayEndTs = dayEnd.getTime();

        const parseLocal = (dateStr: string) => {
            if (!dateStr) return 0;
            // Robust parsing for ISO strings (YYYY-MM-DDTHH:mm) or simple dates (YYYY-MM-DD)
            return new Date(dateStr).getTime();
        };

        if (task.startDate && task.endDate) {
            const start = parseLocal(task.startDate);
            let end = parseLocal(task.endDate);

            // If endDate is date-only, assume inclusive end-of-day
            if (task.endDate.length <= 10) {
                end += (24 * 60 * 60 * 1000) - 1;
            }
            // If it has time, 'end' is the exact moment.

            return start <= dayEndTs && end >= dayStartTs;
        }

        const due = parseLocal(task.dueDate);
        return due >= dayStartTs && due <= dayEndTs;
    };

    const isEventActiveOnDay = (event: SpaceEvent, date: Date) => {
        const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
        const dayStartTs = dayStart.getTime();
        const dayEndTs = dayEnd.getTime();
        const parseLocal = (dateStr: string) => dateStr ? new Date(dateStr).getTime() : 0;

        const start = parseLocal(event.startDate);
        const end = parseLocal(event.endDate);
        return start <= dayEndTs && end >= dayStartTs;
    };

    // Grid rendering logic
    const gridCols = view === 'month' ? 'grid-cols-7' : view === 'week' ? 'grid-cols-7' : view === '4days' ? 'grid-cols-4' : 'grid-cols-1';

    const [selectedDay, setSelectedDay] = useState<number | null>(null);
    const dayExpanded = selectedDay !== null ? datesToShow[selectedDay] : null;

    return (
        <div className="flex flex-col h-full bg-white rounded-3xl border border-slate-200 shadow-sm p-4 overflow-hidden relative">
            <div className="flex items-center justify-between mb-4 shrink-0">
                <div className="flex items-center gap-4">
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                        <button onClick={() => { setView('month'); setSelectedDay(null); }} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${view === 'month' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>Mes</button>
                        <button onClick={() => { setView('week'); setSelectedDay(null); }} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${view === 'week' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>Semana</button>
                        <button onClick={() => { setView('4days'); setSelectedDay(null); }} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${view === '4days' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>4 Días</button>
                        <button onClick={() => { setView('day'); setSelectedDay(null); }} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${view === 'day' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>Día</button>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <button onClick={handlePrev} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"><i className="fa-solid fa-chevron-left"></i></button>
                    <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest min-w-[140px] text-center">
                        {view === 'month' ? monthName : currentDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}
                    </h3>
                    <button onClick={handleNext} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"><i className="fa-solid fa-chevron-right"></i></button>
                </div>
            </div>

            <div className={`grid ${gridCols} gap-2 mb-2`}>
                {view !== 'day' && ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].slice(0, view === '4days' ? 4 : 7).map((d, i) => (
                    <div key={i} className="text-center text-[10px] font-black uppercase text-slate-400 tracking-widest py-2">
                        {view === '4days' ? new Date(datesToShow[i]).toLocaleDateString('es-ES', { weekday: 'short' }) : d}
                    </div>
                ))}
            </div>

            <div className={`grid ${gridCols} gap-2 flex-1 overflow-y-auto custom-scrollbar`}>
                {/* Blank spaces for month view start */}
                {view === 'month' && Array.from({ length: getFirstDayOfMonth(currentDate.getFullYear(), currentDate.getMonth()) }, (_, i) => i).map(b => (
                    <div key={`blank-${b}`} className="min-h-[80px] bg-slate-50/30 rounded-xl"></div>
                ))}

                {datesToShow.map((date, idx) => {
                    const activeEvents = events.filter(e => isEventActiveOnDay(e, date));
                    const activeTasks = tasks.filter(t => isTaskActiveOnDay(t, date) && t.estado !== 'DONE');
                    const isToday = new Date().toDateString() === date.toDateString();
                    const isWorkingDay = rules.workingDays.includes(date.getDay());

                    return (
                        <div 
                            key={idx} 
                            onClick={() => {
                                if (view !== 'day') setSelectedDay(idx);
                            }}
                            className={`
                                ${isWorkingDay ? 'bg-white' : 'bg-slate-50/80'} 
                                border text-center border-slate-100 rounded-xl p-2 relative 
                                hover:border-blue-300 transition-all duration-300 ease-in-out flex flex-col 
                                ${view === 'day' ? 'min-h-[300px]' : 'min-h-[120px] cursor-pointer hover:shadow-lg hover:-translate-y-0.5'} 
                                ${isToday ? 'ring-2 ring-blue-500/20 bg-blue-50/10' : ''}
                            `}
                        >
                            <div className="flex justify-between items-center mb-2 px-1">
                                <span className={`text-[11px] font-black ${isToday ? 'text-blue-600 font-black scale-110' : isWorkingDay ? 'text-slate-400' : 'text-slate-300'}`}>
                                    {date.getDate()} {view === 'day' && date.toLocaleDateString('es-ES', { weekday: 'long' })}
                                </span>
                            </div>
                            
                            <div className="space-y-1 overflow-y-auto flex-1 custom-scrollbar">
                                {activeEvents.slice(0, 3).map(event => (
                                    <div
                                        key={event.id}
                                        className="text-[8px] px-2 py-1 rounded-md font-bold uppercase truncate border-l-2 text-left bg-orange-50 text-orange-700 border-orange-500 pointer-events-none"
                                    >
                                        {event.nombre}
                                    </div>
                                ))}
                                {activeTasks.slice(0, 3).map(task => (
                                    <div
                                        key={task.id}
                                        className={`text-[8px] px-2 py-1 rounded-md font-bold uppercase truncate border-l-2 text-left ${task.priority === 'ASAP' ? 'bg-purple-50 text-purple-700 border-purple-500' : 'bg-blue-50 text-blue-700 border-blue-500'} pointer-events-none`}
                                    >
                                        {task.nombre}
                                    </div>
                                ))}
                                {(activeEvents.length + activeTasks.length) > 6 && (
                                    <div className="text-[7px] font-black text-slate-400 uppercase tracking-widest mt-1">
                                        +{(activeEvents.length + activeTasks.length) - 6} más
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* MODERN EXPANDED DAY MODAL - PREMIUM UI */}
            {selectedDay !== null && dayExpanded && (
                <div 
                    className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-300"
                    onClick={() => setSelectedDay(null)}
                >
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xl"></div>
                    
                    <div 
                        className="relative w-full max-w-2xl bg-white rounded-[3rem] shadow-2xl shadow-black/20 overflow-hidden flex flex-col animate-in zoom-in-95 slide-in-from-bottom-10 duration-500"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header Modal */}
                        <div className="px-10 py-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <div className="flex items-center gap-5">
                                <div className="w-16 h-16 bg-white rounded-3xl shadow-xl flex flex-col items-center justify-center border border-slate-100">
                                    <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{dayExpanded.toLocaleDateString('es-ES', { month: 'short' })}</span>
                                    <span className="text-2xl font-black text-slate-900 leading-none">{dayExpanded.getDate()}</span>
                                </div>
                                <div>
                                    <h4 className="text-2xl font-black text-slate-900 uppercase tracking-tight leading-none mb-1">
                                        {dayExpanded.toLocaleDateString('es-ES', { weekday: 'long' })}
                                    </h4>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                                        {events.filter(e => isEventActiveOnDay(e, dayExpanded)).length} Eventos · {tasks.filter(t => isTaskActiveOnDay(t, dayExpanded) && t.estado !== 'DONE').length} Pendientes
                                    </p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setSelectedDay(null)}
                                className="w-12 h-12 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all active:scale-90"
                            >
                                <i className="fa-solid fa-xmark text-lg"></i>
                            </button>
                        </div>

                        {/* Content Scrollable */}
                        <div className="flex-1 overflow-y-auto p-10 space-y-8 custom-scrollbar max-h-[70vh]">
                            {/* EVENTS SECTION */}
                            <section>
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-8 h-8 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center"><i className="fa-solid fa-calendar-star text-xs"></i></div>
                                    <h5 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Google & Local Events</h5>
                                </div>
                                <div className="space-y-3">
                                    {events.filter(e => isEventActiveOnDay(e, dayExpanded)).length === 0 && (
                                        <p className="text-xs italic text-slate-300">No hay eventos para este día.</p>
                                    )}
                                    {events.filter(e => isEventActiveOnDay(e, dayExpanded)).map(event => (
                                        <div 
                                            key={event.id}
                                            onClick={() => { onEditEvent?.(event); }}
                                            className="group bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-md hover:border-orange-200 transition-all cursor-pointer flex items-center gap-6"
                                        >
                                            <div className="w-1.5 h-12 bg-orange-500 rounded-full"></div>
                                            <div className="flex-1">
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className="text-[10px] font-black text-orange-500 uppercase tracking-tighter">Evento en agenda</span>
                                                    <span className="text-[10px] font-bold text-slate-400">{event.startDate.includes('T') ? new Date(event.startDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase() : 'Todo el día'}</span>
                                                </div>
                                                <h6 className="font-bold text-slate-800 text-lg group-hover:text-orange-600 transition-colors">{event.nombre}</h6>
                                                {event.description && <p className="text-xs text-slate-400 mt-2 line-clamp-2 italic">{event.description}</p>}
                                            </div>
                                            <i className="fa-solid fa-chevron-right text-slate-200 group-hover:text-orange-300 group-hover:translate-x-1 transition-all"></i>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            {/* TASKS SECTION */}
                            <section>
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center"><i className="fa-solid fa-list-check text-xs"></i></div>
                                    <h5 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Tareas de Producción</h5>
                                </div>
                                <div className="space-y-3">
                                    {tasks.filter(t => isTaskActiveOnDay(t, dayExpanded) && t.estado !== 'DONE').length === 0 && (
                                        <p className="text-xs italic text-slate-300">No hay tareas pendientes.</p>
                                    )}
                                    {tasks.filter(t => isTaskActiveOnDay(t, dayExpanded) && t.estado !== 'DONE').map(task => (
                                        <div 
                                            key={task.id}
                                            onClick={() => onEditTask(task)}
                                            className="group bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer flex items-center gap-6"
                                        >
                                            <div className={`w-1.5 h-12 rounded-full ${task.priority === 'ASAP' ? 'bg-purple-500' : task.priority === 'High' ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                                            <div className="flex-1">
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className={`text-[10px] font-black uppercase tracking-tighter ${task.priority === 'ASAP' ? 'text-purple-500' : 'text-blue-500'}`}>{task.priority} Priority</span>
                                                    <span className="text-[10px] font-bold text-slate-400">{formatDuration(task.duration)} de esfuerzo</span>
                                                </div>
                                                <h6 className="font-bold text-slate-800 text-lg group-hover:text-blue-600 transition-colors uppercase tracking-tight">{task.nombre}</h6>
                                                {task.clientName && (
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <i className="fa-solid fa-user text-[10px] text-slate-300"></i>
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{task.clientName}</span>
                                                    </div>
                                                )}
                                            </div>
                                            <i className="fa-solid fa-chevron-right text-slate-200 group-hover:text-blue-300 group-hover:translate-x-1 transition-all"></i>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ==================== MAIN COMPONENT ====================
// ==================== CLIENT SELECTOR ====================
const ClientSelector: React.FC<{
    clients: Client[];
    selectedId: string;
    onSelect: (id: string | null, name: string | null) => void;
    onCreateClient: (name: string) => void;
}> = ({ clients, selectedId, onSelect, onCreateClient }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');

    const filtered = clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
    const selectedClient = clients.find(c => c.id === selectedId);

    return (
        <div className="space-y-1.5 flex-1 relative">
            <label className="text-[9px] font-black uppercase text-slate-400 ml-1 tracking-widest">Cliente (Opcional)</label>
            <div className="relative">
                <button
                    type="button"
                    onClick={() => setIsOpen(!isOpen)}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none text-left flex justify-between items-center hover:border-blue-300 transition-colors"
                >
                    <span className={selectedClient ? 'text-slate-700' : 'text-slate-400'}>
                        {selectedClient ? selectedClient.name : 'Sin cliente'}
                    </span>
                    <div className="flex items-center gap-2">
                        {selectedClient && (
                            <span
                                onClick={(e) => { e.stopPropagation(); onSelect(null, null); }}
                                className="text-[9px] text-slate-400 hover:text-red-500 cursor-pointer"
                            >
                                <i className="fa-solid fa-xmark"></i>
                            </span>
                        )}
                        <i className={`fa-solid fa-chevron-${isOpen ? 'up' : 'down'} text-[9px] text-slate-400`}></i>
                    </div>
                </button>

                {isOpen && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => { setIsOpen(false); setCreating(false); }}></div>
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden animate-in slide-in-from-top-2">
                            <div className="p-2 border-b border-slate-100">
                                <input
                                    type="text"
                                    placeholder="Buscar cliente..."
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    className="w-full p-2 bg-slate-50 rounded-lg text-xs outline-none"
                                    autoFocus
                                />
                            </div>
                            <div className="max-h-40 overflow-y-auto">
                                {filtered.map(c => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => { onSelect(c.id, c.name); setIsOpen(false); setSearch(''); }}
                                        className={`w-full text-left px-4 py-2.5 text-xs font-bold hover:bg-blue-50 transition-colors ${c.id === selectedId ? 'bg-blue-50 text-blue-600' : 'text-slate-700'}`}
                                    >
                                        {c.name}
                                    </button>
                                ))}
                                {filtered.length === 0 && !creating && (
                                    <p className="text-center text-xs text-slate-400 py-3">Sin resultados</p>
                                )}
                            </div>
                            <div className="p-2 border-t border-slate-100">
                                {creating ? (
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder="Nombre del nuevo cliente"
                                            value={newName}
                                            onChange={e => setNewName(e.target.value)}
                                            className="flex-1 p-2 bg-slate-50 rounded-lg text-xs outline-none border border-slate-200"
                                            autoFocus
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (newName.trim()) {
                                                    onCreateClient(newName.trim());
                                                    setNewName('');
                                                    setCreating(false);
                                                    setIsOpen(false);
                                                }
                                            }}
                                            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-[9px] font-black uppercase"
                                        >
                                            Crear
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setCreating(true)}
                                        className="w-full text-left px-4 py-2 text-[10px] font-black text-blue-600 uppercase hover:bg-blue-50 rounded-lg transition-colors"
                                    >
                                        <i className="fa-solid fa-plus mr-1"></i>Crear Nuevo Cliente
                                    </button>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

const SpacesView: React.FC = () => {
    const { state, dispatch } = useSpaces();
    const [viewMode, setViewMode] = useState<ViewMode>('lista');
    const [showModal, setShowModal] = useState(false);
    const [editingTask, setEditingTask] = useState<SpaceTask | null>(null);
    const [editingTaskParent, setEditingTaskParent] = useState<SpaceTask | null>(null); // Captured parent for validation
    const [newTask, setNewTask] = useState(getDefaultTask());
    const [notification, setNotification] = useState<{ message: string, type: 'error' | 'success' } | null>(null);
    const [groupBy, setGroupBy] = useState<GroupBy>('estado');
    const [taskToDelete, setTaskToDelete] = useState<SpaceTask | null>(null);
    const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
    const [subtaskWarning, setSubtaskWarning] = useState<{ task: SpaceTask, missingCount: number } | null>(null);
    const [showWorkHoursQuickfix, setShowWorkHoursQuickfix] = useState(false);
    const [tempWorkStart, setTempWorkStart] = useState(state.rules.workingHoursStart);
    const [tempWorkEnd, setTempWorkEnd] = useState(state.rules.workingHoursEnd);

    // CLIENTS STATE (read from localStorage, synced with App.tsx)
    const [clients, setClients] = useState<Client[]>(() => {
        try {
            const raw = localStorage.getItem('coo_clients');
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    });

    // Sync clients from localStorage when it changes
    useEffect(() => {
        const handleStorage = (e: StorageEvent) => {
            if (e.key === 'coo_clients' && e.newValue) {
                try { setClients(JSON.parse(e.newValue)); } catch {}
            }
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    // Also refresh on focus (same tab updates)
    useEffect(() => {
        const refreshClients = () => {
            try {
                const raw = localStorage.getItem('coo_clients');
                if (raw) setClients(JSON.parse(raw));
            } catch {}
        };
        window.addEventListener('focus', refreshClients);
        return () => window.removeEventListener('focus', refreshClients);
    }, []);

    const handleCreateClientInline = (name: string) => {
        const newClient: Client = {
            id: Math.random().toString(36).substr(2, 9),
            name,
            email: '',
            phone: ''
        };
        const updated = [...clients, newClient];
        setClients(updated);
        localStorage.setItem('coo_clients', JSON.stringify(updated));
    };

    // EVENT STATES
    const [showEventModal, setShowEventModal] = useState(false);
    const [newEvent, setNewEvent] = useState({ nombre: '', startDate: '', endDate: '', description: '' });
    const [editingEvent, setEditingEvent] = useState<SpaceEvent | null>(null);
    const [eventToDelete, setEventToDelete] = useState<SpaceEvent | null>(null);

    // Auto-dismiss notification
    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => setNotification(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [notification]);

    // LIVE PREVIEW: Recalculate scheduledSlots when user changes scheduling fields
    useEffect(() => {
        if (!editingTask || !editingTask.autoSchedule) return;
        
        const timer = setTimeout(() => {
            try {
                // Collect all tasks from the workspace to respect the global queue
                const allProjects: any[] = [];
                const allEvents: { nombre: string, startDate: string, endDate: string }[] = [];
                
                const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId);
                if (!ws) return;
                
                const extractTasks = (tasks: SpaceTask[]) => {
                    const now = new Date();
                    const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                    tasks.forEach(t => {
                        // Use the editingTask's live values if this is the task being edited
                        const src = t.id === editingTask.id ? editingTask : t;
                        allProjects.push({
                            id: src.id,
                            clientId: '',
                            clientName: src.clientName || '',
                            projectName: src.nombre,
                            startDate: src.startDate || localToday,
                            endDate: src.endDate || localToday,
                            priority: src.priority === 'ASAP' ? 'ASAP' : src.priority === 'High' ? 'High' : src.priority === 'Medium' ? 'Medium' : 'Low',
                            progress: src.progress,
                            totalValue: src.totalValue,
                            paidValue: 0,
                            status: src.estado === 'TODO' ? 'todo' : src.estado === 'DONE' ? 'completed' : 'active',
                            duration: src.duration,
                            deadlineType: src.deadlineType,
                            dueDate: src.dueDate,
                            autoSchedule: src.autoSchedule,
                            elasticity: src.elasticity,
                            scheduledSlots: src.scheduledSlots || [],
                            hasConflict: src.hasConflict,
                            conflictDescription: src.conflictDescription
                        });
                        if (t.subtasks) extractTasks(t.subtasks);
                    });
                };
                
                ws.espacios.forEach(s => {
                    s.listas.forEach(l => {
                        extractTasks(l.tareas);
                        l.eventos?.forEach(e => allEvents.push({ nombre: e.nombre, startDate: e.startDate, endDate: e.endDate }));
                    });
                    s.carpetas.forEach(f => f.listas.forEach(l => {
                        extractTasks(l.tareas);
                        l.eventos?.forEach(e => allEvents.push({ nombre: e.nombre, startDate: e.startDate, endDate: e.endDate }));
                    }));
                });
                
                const scheduled = runAutoScheduling(allProjects, state.rules, allEvents);
                const updated = scheduled.find(p => p.id === editingTask.id);
                
                if (updated) {
                    setEditingTask(prev => prev ? {
                        ...prev,
                        scheduledSlots: updated.scheduledSlots,
                        hasConflict: updated.hasConflict,
                        conflictDescription: updated.conflictDescription,
                    } : prev);
                }
            } catch (e) {
                console.error('[LivePreview] Error recalculating slots:', e);
            }
        }, 300); // 300ms debounce
        
        return () => clearTimeout(timer);
    }, [
        editingTask?.startDate, 
        editingTask?.dueDate, 
        editingTask?.duration, 
        editingTask?.elasticity, 
        editingTask?.priority, 
        editingTask?.autoSchedule,
        editingTask?.deadlineType,
    ]);

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

        let finalTask = { ...newTask, nombre: newTask.nombre.trim() };

        // AUTO-SYNC for Manual Mode
        if (!finalTask.autoSchedule) {
            finalTask.dueDate = finalTask.endDate;
            // No longer auto-calculating duration from dates to respect user input
        }

        const finalStartDate = finalTask.startDate || new Date().toISOString().split('T')[0];

        // Ensure manual tasks have a scheduled slot for overlap detection
        if (!finalTask.autoSchedule && finalTask.startDate && finalTask.endDate) {
            finalTask.scheduledSlots = [{
                id: Math.random().toString(36).substr(2, 9),
                start: finalTask.startDate,
                end: finalTask.endDate,
                isFragment: false
            }];
        }

        dispatch({
            type: 'ADD_TASK',
            payload: {
                spaceId: state.activeSpaceId,
                folderId: state.activeFolderId || undefined,
                listId: state.activeListId,
                task: { ...finalTask, startDate: finalStartDate },
            },
        });
        setNewTask(getDefaultTask());
        setShowModal(false);
    };

    const handleUpdateTask = () => {
        if (!editingTask || !state.activeSpaceId) return;

        let foundListId = state.activeListId;
        let foundFolderId = state.activeFolderId;
        
        const taskExistsNested = (tasks: SpaceTask[], idSearch: string): boolean => {
            return tasks.some(t => t.id === idSearch || (t.subtasks && taskExistsNested(t.subtasks, idSearch)));
        };

        if (!foundListId && activeSpace) {
            activeSpace.listas.forEach(l => { if (taskExistsNested(l.tareas, editingTask.id)) foundListId = l.id; });
            if (!foundListId) {
                activeSpace.carpetas.forEach(f => { f.listas.forEach(l => { if (taskExistsNested(l.tareas, editingTask.id)) { foundListId = l.id; foundFolderId = f.id; } }); });
            }
        }

        if (!foundListId) return;

        // STRICT VALIDATION: Parent Constraint Check
        // Helper to find parent of the current editingTask
        const findParentTask = (tasks: SpaceTask[], childId: string): SpaceTask | null => {
            for (const t of tasks) {
                if (t.subtasks && t.subtasks.some(st => st.id === childId)) return t;
                if (t.subtasks && t.subtasks.length > 0) {
                    const found = findParentTask(t.subtasks, childId);
                    if (found) return found;
                }
            }
            return null;
        };

        // Use the CAPTURED parent for validation (avoids race condition)
        const parent = editingTaskParent;
        if (parent) {
            // Parse dates robustly
            const parseDate = (d: string) => {
                if (!d) return null;
                if (d.includes('/') && d.split('/').length === 3) {
                    const [day, month, year] = d.split('/');
                    return new Date(`${year}-${month}-${day}`).getTime();
                }
                return new Date(d).getTime();
            };

            const childStart = parseDate(editingTask.startDate);
            const childEnd = parseDate(editingTask.endDate || editingTask.dueDate); // Child's effective end
            const parentStart = parseDate(parent.startDate);
            // FIX: Use dueDate (user's deadline) as the constraint, NOT endDate (auto-calculated)
            const parentDeadline = parseDate(parent.dueDate || parent.endDate);

            // Validation 1: Child starts before Parent
            if (childStart && parentStart && childStart < parentStart) {
                setNotification({
                    message: `La subtarea no puede empezar el ${editingTask.startDate} porque la tarea padre comienza el ${parent.startDate}.`,
                    type: 'error'
                });
                return; // BLOCK SAVE
            }

            // Validation 2: Child DEADLINE > Parent DEADLINE (Logical Inconsistency)
            if (editingTask.dueDate && parentDeadline) {
                const childDeadline = parseDate(editingTask.dueDate);
                if (childDeadline && childDeadline > parentDeadline) {
                    setNotification({
                        message: `La fecha límite de la subtarea (${editingTask.dueDate}) no puede ser posterior a la de la tarea padre (${parent.dueDate || parent.endDate}).`,
                        type: 'error'
                    });
                    return; // BLOCK SAVE
                }
            }

            // Validation 3: Child Ends (scheduled) > Parent DEADLINE
            if (childEnd && parentDeadline && childEnd > parentDeadline) {
                setNotification({
                    message: `La subtarea no puede terminar después del ${editingTask.endDate || editingTask.dueDate} porque la fecha límite de la tarea padre es el ${parent.dueDate || parent.endDate}.`,
                    type: 'error'
                });
                return; // BLOCK SAVE
            }
        }

        let finalTask = { ...editingTask };

        // AUTO-SYNC for Manual Mode
        if (!finalTask.autoSchedule) {
            finalTask.dueDate = finalTask.endDate;
            // No longer auto-calculating duration from dates to respect user input

            // Ensure manual tasks have a scheduled slot for overlap detection
            if (finalTask.startDate && finalTask.endDate) {
                finalTask.scheduledSlots = [{
                    id: Math.random().toString(36).substr(2, 9),
                    start: finalTask.startDate,
                    end: finalTask.endDate,
                    isFragment: false
                }];
            }
        }

        dispatch({
            type: 'UPDATE_TASK',
            payload: {
                spaceId: state.activeSpaceId,
                folderId: foundFolderId || undefined,
                listId: foundListId,
                task: finalTask,
            },
        });
        setEditingTask(null);
    };

    const handleToggleTask = (taskId: string, forceAction?: 'RESOLVE_ALL' | 'IGNORE' | 'CANCEL') => {
        if (!state.activeSpaceId) return;

        let foundListId = state.activeListId;
        let foundFolderId = state.activeFolderId;
        
        const taskExistsNested = (tasks: SpaceTask[], idSearch: string): boolean => {
            return tasks.some(t => t.id === idSearch || (t.subtasks && taskExistsNested(t.subtasks, idSearch)));
        };

        let targetList = activeList;

        if (!foundListId && activeSpace) {
            activeSpace.listas.forEach(l => { if (taskExistsNested(l.tareas, taskId)) { foundListId = l.id; targetList = l; } });
            if (!foundListId) {
                activeSpace.carpetas.forEach(f => { f.listas.forEach(l => { if (taskExistsNested(l.tareas, taskId)) { foundListId = l.id; foundFolderId = f.id; targetList = l; } }); });
            }
        }

        if (!foundListId || !targetList) return;

        // 1. Recursive helper to find task and its FULL LINEAGE (path of parents)
        const findTaskPath = (tasks: SpaceTask[], id: string, path: SpaceTask[] = []): { task: SpaceTask, path: SpaceTask[] } | null => {
            for (const t of tasks) {
                if (t.id === id) return { task: t, path };
                if (t.subtasks && t.subtasks.length > 0) {
                    const found = findTaskPath(t.subtasks, id, [...path, t]);
                    if (found) return found;
                }
            }
            return null;
        };

        const result = findTaskPath(targetList.tareas, taskId);
        if (!result) return;
        const { task, path } = result;

        // --- NEW LOGIC: CHECK SUBTASKS BEFORE COMPLETION ---
        // Only if we are toggling to DONE (currently not done)
        const isCompleting = task.estado !== 'DONE';

        if (isCompleting && !forceAction) {
            // Check if there are any non-DONE subtasks
            if (task.subtasks && task.subtasks.length > 0) {
                const incompleteCount = task.subtasks.filter(st => st.estado !== 'DONE').length;
                if (incompleteCount > 0) {
                    // Show Warning Modal and HALT
                    setSubtaskWarning({ task, missingCount: incompleteCount });
                    return;
                }
            }
        }

        // 2. Determine new status for the toggled task
        let newStatus: TaskStatus = task.estado === 'DONE' ? 'TODO' : 'DONE';
        let newProgress = newStatus === 'DONE' ? 100 : 0;

        // Special handling if forced action
        if (forceAction === 'RESOLVE_ALL') {
            newStatus = 'DONE';
            newProgress = 100;
        } else if (forceAction === 'IGNORE') {
            newStatus = 'DONE';
            newProgress = 100;
        }

        let updatedTask = { ...task, estado: newStatus, progress: newProgress };

        // 3. Handle Children Downwards
        if (updatedTask.subtasks && updatedTask.subtasks.length > 0) {
            if (forceAction === 'RESOLVE_ALL') {
                // Mark ALL children as DONE
                const updateChildren = (st: SpaceTask[]): SpaceTask[] => st.map(child => ({
                    ...child,
                    estado: 'DONE',
                    progress: 100,
                    subtasks: child.subtasks ? updateChildren(child.subtasks) : []
                }));
                updatedTask.subtasks = updateChildren(updatedTask.subtasks);
            } else if (forceAction === 'IGNORE') {
                // Do NOT touch children
            } else {
                if (newStatus === 'TODO') {
                    // USER REQUEST CHANGE: When un-checking a parent, do NOT un-check children automatically.
                }
            }
        }

        // 4. Update Parent Hierarchy (Bottom-Up)
        let currentChild: SpaceTask = updatedTask;
        const ancestors = [...path].reverse();
        let finalTaskToDispatch: SpaceTask = updatedTask;

        if (ancestors.length > 0) {
            for (const ancestor of ancestors) {
                const updatedSubtasks = ancestor.subtasks!.map(st => st.id === currentChild.id ? currentChild : st);

                const totalCount = updatedSubtasks.length;
                const totalProgressSum = updatedSubtasks.reduce((acc, curr) => acc + (curr.progress || 0), 0);
                const newParentProgress = Math.round(totalProgressSum / totalCount);

                currentChild = {
                    ...ancestor,
                    subtasks: updatedSubtasks,
                    progress: newParentProgress
                };
            }
            finalTaskToDispatch = currentChild;
        }

        dispatch({
            type: 'UPDATE_TASK',
            payload: {
                spaceId: state.activeSpaceId,
                folderId: foundFolderId || undefined,
                listId: foundListId,
                task: finalTaskToDispatch,
            },
        });

        // Clear warning if any
        setSubtaskWarning(null);
    };

    const handleDeleteTask = (taskId: string) => {
        if (!state.activeSpaceId) return;
        
        let foundListId = state.activeListId;
        let foundFolderId = state.activeFolderId;
        
        const taskExistsNested = (tasks: SpaceTask[], idSearch: string): boolean => {
            return tasks.some(t => t.id === idSearch || (t.subtasks && taskExistsNested(t.subtasks, idSearch)));
        };
        
        if (!foundListId && activeSpace) {
            activeSpace.listas.forEach(l => { if (taskExistsNested(l.tareas, taskId)) foundListId = l.id; });
            if (!foundListId) {
                activeSpace.carpetas.forEach(f => { f.listas.forEach(l => { if (taskExistsNested(l.tareas, taskId)) { foundListId = l.id; foundFolderId = f.id; } }); });
            }
        }
        
        if (!foundListId) return;

        dispatch({
            type: 'DELETE_TASK',
            payload: {
                spaceId: state.activeSpaceId,
                folderId: foundFolderId || undefined,
                listId: foundListId,
                taskId,
            },
        });
    };

    // EVENT HANDLERS
    const handleAddEvent = () => {
        if (!newEvent.nombre.trim() || !state.activeSpaceId || !state.activeListId) {
            alert('Debes seleccionar una lista específica en el panel izquierdo para crear eventos.');
            return;
        }

        // CHECK EVENT OVERLAPS
        // 1. Flatten all existing events
        const allEvents: SpaceEvent[] = [];
        const activeWorkspace = state.workspaces.find(w => w.id === state.activeWorkspaceId);
        if (activeWorkspace) {
            activeWorkspace.espacios.forEach(s => {
                s.listas.forEach(l => l.eventos?.forEach(e => allEvents.push(e)));
                s.carpetas.forEach(f => f.listas.forEach(l => l.eventos?.forEach(e => allEvents.push(e))));
            });
        }

        // 2. Check overlap
        // (Visual feedback is handled via inline UI, no notification blocker needed here)
        /* 
        const newStart = new Date(newEvent.startDate).getTime();
        const newEnd = new Date(newEvent.endDate).getTime();
        const overlap = allEvents.find(e => {
            if ((newEvent as any).id && e.id === (newEvent as any).id) return false; // Ignore self
            const eStart = new Date(e.startDate).getTime();
            const eEnd = new Date(e.endDate).getTime();
            return newStart < eEnd && newEnd > eStart;
        });
        */

        if ((newEvent as any).id) {
            dispatch({
                type: 'UPDATE_EVENT',
                payload: {
                    spaceId: state.activeSpaceId,
                    folderId: state.activeFolderId || undefined,
                    listId: state.activeListId,
                    event: newEvent as SpaceEvent,
                },
            });
            setNotification({ message: 'Evento actualizado exitosamente', type: 'success' });
        } else {
            dispatch({
                type: 'ADD_EVENT',
                payload: {
                    spaceId: state.activeSpaceId,
                    folderId: state.activeFolderId || undefined,
                    listId: state.activeListId,
                    event: { ...newEvent, nombre: newEvent.nombre.trim() },
                },
            });
            setNotification({ message: 'Evento creado exitosamente', type: 'success' });
        }
        setNewEvent({ nombre: '', startDate: '', endDate: '', description: '' });
        setShowEventModal(false);
    };

    const handleDeleteEvent = (eventId: string) => {
        if (!state.activeSpaceId) return;
        
        let foundListId = state.activeListId;
        let foundFolderId = state.activeFolderId;
        
        if (!foundListId && activeSpace) {
            activeSpace.listas.forEach(l => { if (l.eventos?.some(e => e.id === eventId)) foundListId = l.id; });
            if (!foundListId) {
                activeSpace.carpetas.forEach(f => { f.listas.forEach(l => { if (l.eventos?.some(e => e.id === eventId)) { foundListId = l.id; foundFolderId = f.id; } }); });
            }
        }
        
        if (!foundListId) return;

        dispatch({
            type: 'DELETE_EVENT',
            payload: {
                spaceId: state.activeSpaceId,
                folderId: foundFolderId || undefined,
                listId: foundListId,
                eventId,
            },
        });
        setShowEventModal(false);
        setNewEvent({ nombre: '', startDate: '', endDate: '', description: '' });
        setNotification({ message: 'Evento eliminado', type: 'success' });
    };

    const openEditModal = (task: SpaceTask) => {
        // Find parent task to ensure validation uses correct data
        const findParentTask = (tasks: SpaceTask[], childId: string): SpaceTask | null => {
            for (const t of tasks) {
                if (t.subtasks && t.subtasks.some(st => st.id === childId)) return t;
                if (t.subtasks && t.subtasks.length > 0) {
                    const found = findParentTask(t.subtasks, childId);
                    if (found) return found;
                }
            }
            return null;
        };
        const parent = activeList ? findParentTask(activeList.tareas, task.id) : null;
        setEditingTaskParent(parent);
        setEditingTask({ ...task });
    };

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

    if (!activeSpace) {
        return (
            <div className="flex-1 flex items-center justify-center bg-[#F4F5F8]">
                <div className="text-center max-w-sm p-8">
                    <div className="w-16 h-16 bg-slate-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <i className="fa-solid fa-hand-pointer text-2xl text-slate-400"></i>
                    </div>
                    <h3 className="text-lg font-bold text-slate-700 mb-2">Selecciona un Espacio</h3>
                    <p className="text-xs text-slate-500">Haz clic en un espacio, carpeta o lista para visualizar sus tareas.</p>
                </div>
            </div>
        );
    }

    let tasks: SpaceTask[] = [];
    let events: SpaceEvent[] = [];

    if (activeList) {
        tasks = activeList.tareas;
        events = activeList.eventos || [];
    } else if (activeFolder) {
        activeFolder.listas.forEach(l => {
            tasks = [...tasks, ...l.tareas];
            events = [...events, ...(l.eventos || [])];
        });
    } else if (activeSpace) {
        activeSpace.listas.forEach(l => {
            tasks = [...tasks, ...l.tareas];
            events = [...events, ...(l.eventos || [])];
        });
        activeSpace.carpetas.forEach(f => {
            f.listas.forEach(l => {
                tasks = [...tasks, ...l.tareas];
                events = [...events, ...(l.eventos || [])];
            });
        });
    }

    // Agregar también los eventos importados de Google Calendar
    if (state.gcalEvents && state.gcalEvents.length > 0) {
        events = [...events, ...state.gcalEvents];
    }

    return (
        <div className="flex-1 flex flex-col bg-[#F4F5F8] overflow-hidden">
            {/* Temporary Work Hours Override Banner */}
            {state.rulesOverride && new Date(state.rulesOverride.expiresAt) > new Date() && (() => {
                const fmt12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`; };
                return (
                    <div className="bg-gradient-to-r from-amber-50 to-amber-100 border-b border-amber-200 px-6 py-2.5 flex items-center justify-between shrink-0 animate-in slide-in-from-top-2">
                        <div className="flex items-center gap-3">
                            <div className="w-7 h-7 bg-amber-400 rounded-lg flex items-center justify-center shadow-sm">
                                <i className="fa-solid fa-clock text-white text-xs"></i>
                            </div>
                            <div>
                                <span className="text-[10px] font-black uppercase text-amber-800 tracking-wider">
                                    Jornada extendida temporalmente
                                </span>
                                <span className="text-[10px] text-amber-600 font-bold ml-2">
                                    {fmt12(state.rulesOverride.workingHoursStart || state.rules.workingHoursStart)} – {fmt12(state.rulesOverride.workingHoursEnd || state.rules.workingHoursEnd)}
                                </span>
                                <span className="text-[9px] text-amber-500 ml-2 italic">
                                    (expira automáticamente mañana)
                                </span>
                            </div>
                        </div>
                        <button onClick={() => dispatch({ type: 'SET_RULES_OVERRIDE', payload: null })} className="px-4 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/40 text-amber-800 text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 border border-amber-300 hover:border-amber-400">
                            <i className="fa-solid fa-rotate-left text-[8px]"></i> Restaurar horario normal
                        </button>
                    </div>
                );
            })()}
            {/* Header with breadcrumb and view switcher */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
                <div className="flex items-center gap-2 text-sm mb-3">
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: activeSpace?.color || '#3A57E8' }}></div>
                    <span className={`font-semibold ${!activeFolder && !activeList ? 'text-slate-800' : 'text-slate-700'}`}>{activeSpace?.nombre}</span>
                    {activeFolder && (
                        <>
                            <i className="fa-solid fa-chevron-right text-[8px] text-slate-400"></i>
                            <span className={`${!activeList ? 'font-bold text-slate-800' : 'text-slate-500'}`}>{activeFolder.nombre}</span>
                        </>
                    )}
                    {activeList && (
                        <>
                            <i className="fa-solid fa-chevron-right text-[8px] text-slate-400"></i>
                            <span className="font-bold text-slate-800">{activeList.nombre}</span>
                        </>
                    )}
                </div>

                {/* View switcher + Add button */}
                <div className="flex items-center justify-between">
                    <div className="flex gap-4 items-center">
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
                        <button onClick={() => setViewMode('settings')} className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-colors ${viewMode === 'settings' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                            <i className="fa-solid fa-gear"></i> Configuración
                        </button>

                        {/* Grouping Selector */}
                        {['lista', 'kanban', 'gantt'].includes(viewMode) && (
                            <div className="ml-4 pl-4 border-l border-slate-200 flex items-center gap-2">
                                <span className="text-[9px] font-bold text-slate-400 uppercase">Grupo:</span>
                                <select
                                    value={groupBy}
                                    onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                                    className="text-[10px] font-bold bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg border-0 outline-none cursor-pointer"
                                >
                                    <option value="estado">Estado</option>
                                    <option value="prioridad">Prioridad</option>
                                    {viewMode !== 'gantt' && <option value="fecha">Fecha límite</option>}
                                </select>
                            </div>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => { 
                                if (!activeList) { alert('Debes seleccionar una lista específica en el panel izquierdo para crear un evento.'); return; }
                                setNewEvent({ nombre: '', startDate: '', endDate: '', description: '' }); setShowEventModal(true); 
                            }}
                            className="px-4 py-2 bg-orange-500 text-white rounded-xl text-[10px] font-black uppercase shadow-lg shadow-orange-200 hover:bg-orange-600 transition-colors"
                        >
                            <i className="fa-solid fa-calendar-plus mr-2"></i>Evento
                        </button>
                        <button
                            onClick={() => { 
                                if (!activeList) { alert('Debes seleccionar una lista específica en el panel izquierdo para crear una tarea.'); return; }
                                setNewTask(getDefaultTask()); setShowModal(true); 
                            }}
                            className="px-6 py-2 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase shadow-lg shadow-blue-200 hover:bg-blue-700 transition-colors"
                        >
                            <i className="fa-solid fa-plus mr-2"></i>Nueva Tarea
                        </button>
                    </div>
                </div>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-5xl mx-auto h-full">
                    {viewMode === 'lista' && <ListaView tasks={tasks} rules={state.rules} groupBy={groupBy} onEditTask={openEditModal} onToggleTask={handleToggleTask} onDeleteTask={(t) => setTaskToDelete(t)} deletingTaskId={deletingTaskId} onAddTask={(defaults) => {
                        setNewTask({ ...getDefaultTask(), ...defaults });
                        setShowModal(true);
                    }} onAddSubtask={(p) => {
                        // Quick-add subtask logic
                        const subtask: SpaceTask = {
                            ...getDefaultTask(),
                            id: Math.random().toString(36).substr(2, 9),
                            nombre: 'Nueva Subtarea',
                            orden: Date.now()
                        };
                        const updatedParent = { ...p, subtasks: [...(p.subtasks || []), subtask] };
                        dispatch({
                            type: 'UPDATE_TASK',
                            payload: { spaceId: state.activeSpaceId!, folderId: state.activeFolderId || undefined, listId: state.activeListId!, task: updatedParent }
                        });
                        // FIX: Capture the parent NOW to avoid race condition when validating subtask dates
                        setEditingTaskParent(updatedParent);
                        setEditingTask(subtask);
                    }}
                    />}
                    {viewMode === 'kanban' && <KanbanView tasks={tasks} groupBy={groupBy} onEditTask={openEditModal} onDeleteTask={(t) => setTaskToDelete(t)} deletingTaskId={deletingTaskId} onUpdateTask={(id, updates) => {
                        // FIX: Aggregated tasks update needs to locate the correct list of the task
                        const taskToUpdate = tasks.find(t => t.id === id);
                        if (!taskToUpdate) return;
                        // Find which list it belongs to
                        let foundListId: string | undefined;
                        let foundFolderId: string | undefined;
                        activeSpace?.listas.forEach(l => { if (l.tareas.some(t => t.id === id)) foundListId = l.id; });
                        activeSpace?.carpetas.forEach(f => { f.listas.forEach(l => { if (l.tareas.some(t => t.id === id)) { foundListId = l.id; foundFolderId = f.id; } }); });

                        if (foundListId) {
                            dispatch({
                                type: 'UPDATE_TASK',
                                payload: { spaceId: activeSpace!.id, folderId: foundFolderId, listId: foundListId, task: { ...taskToUpdate, ...updates } }
                            });
                        }
                    }} />}
                    {viewMode === 'gantt' && <GanttChartView tasks={tasks} rules={state.rules} groupBy={groupBy} onEditTask={openEditModal} />}
                    {viewMode === 'calendar' && <CalendarViewComponent tasks={tasks} events={events} rules={state.rules} onEditTask={openEditModal} onEditEvent={(e) => {
                        setNewEvent({ ...e });
                        setShowEventModal(true);
                    }} />}
                    {viewMode === 'settings' && <SettingsView />}
                </div>
            </div>

            {/* CREATE TASK MODAL */}
            {showModal && (
                <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-2xl rounded-[2.5rem] p-10 space-y-6 shadow-2xl animate-in zoom-in-95 overflow-y-auto max-h-[90vh] custom-scrollbar">
                        <h3 className="text-3xl font-black text-slate-800 tracking-tighter uppercase">Crear Tarea</h3>

                        <div className="space-y-4">
                            <Input label="Nombre de la Tarea" value={newTask.nombre} onChange={(v: string) => setNewTask({ ...newTask, nombre: v })} />
                            <ClientSelector
                                clients={clients}
                                selectedId={newTask.clientId || ''}
                                onSelect={(id, name) => setNewTask({ ...newTask, clientId: id || undefined, clientName: name || undefined })}
                                onCreateClient={handleCreateClientInline}
                            />

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
                                            <Input label="Fecha Mín. Inicio" type="datetime-local" value={newTask.startDate.slice(0, 16)} onChange={(v: string) => setNewTask({ ...newTask, startDate: v })} />
                                            <Input label="Fecha Límite (Deadline)" type="datetime-local" value={newTask.dueDate.slice(0, 16)} onChange={(v: string) => setNewTask({ ...newTask, dueDate: v })} />
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
                                            <EffortInput duration={newTask.duration} onChange={d => setNewTask({ ...newTask, duration: d })} className="flex-1" />
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
                                        <Input label="Inicio Exacto" type="datetime-local" value={newTask.startDate.slice(0, 16)} onChange={(v: string) => setNewTask({ ...newTask, startDate: v })} />
                                        <Input label="Fin Exacto" type="datetime-local" value={newTask.endDate.slice(0, 16)} onChange={(v: string) => setNewTask({ ...newTask, endDate: v })} />
                                        <EffortInput duration={newTask.duration} onChange={d => setNewTask({ ...newTask, duration: d })} />
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
                                        <option value="ASAP">Urgente</option>
                                        <option value="High">Alta</option>
                                        <option value="Medium">Normal</option>
                                        <option value="Low">Baja</option>
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
                            <div className="flex items-center gap-4">
                                <h2 className="text-3xl font-black text-slate-800 uppercase tracking-tighter">Mi Entorno</h2>
                            </div>
                            <button type="button" onClick={() => setEditingTask(null)} className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100">
                                <i className="fa-solid fa-xmark text-xl"></i>
                            </button>
                        </div>

                        <div className="space-y-4">
                            <Input label="Nombre de la Tarea" value={editingTask.nombre} onChange={(v: string) => setEditingTask({ ...editingTask, nombre: v })} />
                            <ClientSelector
                                clients={clients}
                                selectedId={editingTask.clientId || ''}
                                onSelect={(id, name) => setEditingTask({ ...editingTask, clientId: id || undefined, clientName: name || undefined })}
                                onCreateClient={handleCreateClientInline}
                            />

                            {editingTask.hasConflict && (
                                <div className="bg-red-50 border-2 border-red-100 rounded-3xl p-5 animate-in fade-in slide-in-from-top-2">
                                    <div className="flex items-start gap-4">
                                        <div className="w-10 h-10 bg-red-500 rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-red-200">
                                            <i className="fa-solid fa-triangle-exclamation text-white"></i>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-red-600">Conflicto de Agendamiento</p>
                                            <p className="text-xs font-bold text-red-900 leading-snug whitespace-pre-line">
                                                {editingTask.conflictDescription || "Esta tarea no se puede completar en el tiempo previsto debido a restricciones de agenda."}
                                            </p>
                                            <div className="mt-4 pt-4 border-t border-red-200/60">
                                                <p className="text-[9px] font-black uppercase text-red-700 tracking-widest mb-2 flex items-center gap-1.5">
                                                    <i className="fa-solid fa-wand-magic-sparkles"></i> Resolución Rápida
                                                </p>
                                                <div className="flex flex-wrap gap-2">
                                                    <button type="button" onClick={() => {
                                                        const currentDue = new Date(editingTask.dueDate);
                                                        currentDue.setDate(currentDue.getDate() + 1);
                                                        setEditingTask({ ...editingTask, dueDate: currentDue.toISOString().split('T')[0] });
                                                    }} className="px-3 py-1.5 bg-white/60 rounded-lg text-[9px] font-black uppercase text-red-700 border border-red-200 hover:bg-white hover:border-red-400 transition-all shadow-sm">
                                                        <i className="fa-regular fa-calendar-plus mr-1"></i> +1 Día Límite
                                                    </button>
                                                    {editingTask.elasticity === 0 && (
                                                        <button type="button" onClick={() => setEditingTask({ ...editingTask, elasticity: 1 })} className="px-3 py-1.5 bg-white/60 rounded-lg text-[9px] font-black uppercase text-red-700 border border-red-200 hover:bg-white hover:border-red-400 transition-all shadow-sm">
                                                            <i className="fa-solid fa-puzzle-piece mr-1"></i> Hacer Flexible
                                                        </button>
                                                    )}
                                                    {editingTask.priority !== 'ASAP' && (
                                                        <button type="button" onClick={() => setEditingTask({ ...editingTask, priority: 'ASAP' })} className="px-3 py-1.5 bg-white/60 rounded-lg text-[9px] font-black uppercase text-red-700 border border-red-200 hover:bg-white hover:border-red-400 transition-all shadow-sm">
                                                            <i className="fa-solid fa-bolt mr-1"></i> Subir a ASAP
                                                        </button>
                                                    )}
                                                    <button type="button" onClick={() => setEditingTask({ ...editingTask, duration: Math.max(30, Math.round(editingTask.duration * 0.75)) })} className="px-3 py-1.5 bg-white/60 rounded-lg text-[9px] font-black uppercase text-red-700 border border-red-200 hover:bg-white hover:border-red-400 transition-all shadow-sm">
                                                        <i className="fa-solid fa-compress mr-1"></i> -25% Esfuerzo
                                                    </button>
                                                    <button type="button" onClick={() => {
                                                        setTempWorkStart(state.rulesOverride?.workingHoursStart || state.rules.workingHoursStart);
                                                        setTempWorkEnd(state.rulesOverride?.workingHoursEnd || state.rules.workingHoursEnd);
                                                        setShowWorkHoursQuickfix(!showWorkHoursQuickfix);
                                                    }} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase border transition-all shadow-sm ${showWorkHoursQuickfix ? 'bg-amber-500 text-white border-amber-600' : 'bg-white/60 text-red-700 border-red-200 hover:bg-white hover:border-red-400'}`}>
                                                        <i className="fa-solid fa-business-time mr-1"></i> Ampliar Jornada
                                                    </button>
                                                </div>
                                                {/* Inline Work Hours Quickfix Panel */}
                                                {showWorkHoursQuickfix && (() => {
                                                    const adjustTime = (timeStr: string, deltaMinutes: number): string => {
                                                        const [h, m] = timeStr.split(':').map(Number);
                                                        const totalMins = Math.max(0, Math.min(23 * 60 + 59, h * 60 + m + deltaMinutes));
                                                        const newH = Math.floor(totalMins / 60);
                                                        const newM = totalMins % 60;
                                                        return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
                                                    };
                                                    const fmt12 = (timeStr: string): string => {
                                                        const [h, m] = timeStr.split(':').map(Number);
                                                        const h12 = h % 12 || 12;
                                                        const ampm = h >= 12 ? 'pm' : 'am';
                                                        return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
                                                    };
                                                    const startNum = parseInt(tempWorkStart.split(':')[0]) * 60 + parseInt(tempWorkStart.split(':')[1]);
                                                    const endNum = parseInt(tempWorkEnd.split(':')[0]) * 60 + parseInt(tempWorkEnd.split(':')[1]);
                                                    const isValid = endNum > startNum + 60; // At least 1h gap
                                                    const isChanged = tempWorkStart !== state.rules.workingHoursStart || tempWorkEnd !== state.rules.workingHoursEnd;
                                                    return (
                                                        <div className="mt-3 p-4 bg-white rounded-2xl border-2 border-amber-200 shadow-lg animate-in slide-in-from-top-2 duration-300">
                                                            <div className="flex items-center gap-2 mb-3">
                                                                <i className="fa-solid fa-clock text-amber-500"></i>
                                                                <span className="text-[9px] font-black uppercase text-amber-700 tracking-widest">Ajustar Jornada Laboral (Temporal)</span>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-3">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[9px] font-black text-slate-500 uppercase w-12">Inicio</span>
                                                                    <button type="button" onClick={() => setTempWorkStart(adjustTime(tempWorkStart, -15))} className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 font-black text-xs hover:bg-slate-200 transition-colors">−</button>
                                                                    <input 
                                                                        type="time" 
                                                                        value={tempWorkStart} 
                                                                        onChange={(e) => setTempWorkStart(e.target.value)}
                                                                        className="text-xs font-black text-slate-800 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 min-w-[120px] text-center focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                                                                    />
                                                                    <button type="button" onClick={() => setTempWorkStart(adjustTime(tempWorkStart, 15))} className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 font-black text-xs hover:bg-slate-200 transition-colors">+</button>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[9px] font-black text-slate-500 uppercase w-12">Fin</span>
                                                                    <button type="button" onClick={() => setTempWorkEnd(adjustTime(tempWorkEnd, -15))} className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 font-black text-xs hover:bg-slate-200 transition-colors">−</button>
                                                                    <input 
                                                                        type="time" 
                                                                        value={tempWorkEnd} 
                                                                        onChange={(e) => setTempWorkEnd(e.target.value)}
                                                                        className="text-xs font-black text-slate-800 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 min-w-[120px] text-center focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                                                                    />
                                                                    <button type="button" onClick={() => setTempWorkEnd(adjustTime(tempWorkEnd, 15))} className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 font-black text-xs hover:bg-slate-200 transition-colors">+</button>
                                                                </div>
                                                            </div>
                                                            {!isValid && <p className="text-[9px] text-red-500 font-bold mt-2"><i className="fa-solid fa-triangle-exclamation mr-1"></i>El fin debe ser al menos 1h después del inicio.</p>}
                                                            <div className="flex items-center gap-2 mt-3">
                                                                <button type="button" disabled={!isValid || !isChanged} onClick={() => {
                                                                    const endOfToday = new Date();
                                                                    endOfToday.setHours(23, 59, 59, 999);
                                                                    dispatch({ type: 'SET_RULES_OVERRIDE', payload: {
                                                                        workingHoursStart: tempWorkStart,
                                                                        workingHoursEnd: tempWorkEnd,
                                                                        expiresAt: endOfToday.toISOString()
                                                                    }});
                                                                    setShowWorkHoursQuickfix(false);
                                                                }} className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${isValid && isChanged ? 'bg-amber-500 text-white shadow-lg shadow-amber-200 hover:bg-amber-600 cursor-pointer' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
                                                                    <i className="fa-solid fa-check mr-1"></i> Aplicar solo hoy
                                                                </button>
                                                                <button type="button" onClick={() => setShowWorkHoursQuickfix(false)} className="px-3 py-2 rounded-xl text-[9px] font-black uppercase text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors">Cancelar</button>
                                                            </div>
                                                            <p className="text-[8px] text-slate-400 mt-2 italic"><i className="fa-solid fa-info-circle mr-1"></i>Tus reglas permanentes ({fmt12(state.rules.workingHoursStart)} – {fmt12(state.rules.workingHoursEnd)}) no se modificarán. Este cambio expira automáticamente mañana.</p>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

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
                                            <Input label="Fecha Mín. Inicio" type="datetime-local" value={editingTask.startDate.slice(0, 16)} onChange={(v: string) => setEditingTask({ ...editingTask, startDate: v })} />
                                            <Input label="Fecha Límite (Deadline)" type="datetime-local" value={editingTask.dueDate.slice(0, 16)} onChange={(v: string) => setEditingTask({ ...editingTask, dueDate: v })} />
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
                                            <EffortInput duration={editingTask.duration} onChange={d => setEditingTask({ ...editingTask, duration: d })} className="flex-1" />
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
                                                            <span>{(() => {
                                                                const d = new Date(s.start);
                                                                const h = d.getHours();
                                                                const h12 = h % 12 || 12;
                                                                const ampm = h >= 12 ? 'pm' : 'am';
                                                                return `${d.getDate()}/${d.getMonth() + 1} ${h12}:${d.getMinutes().toString().padStart(2, '0')} ${ampm}`;
                                                            })()}</span>
                                                            <i className="fa-solid fa-arrow-right text-[8px] text-slate-300 mx-2"></i>
                                                            <span>{(() => {
                                                                const d = new Date(s.end);
                                                                const h = d.getHours();
                                                                const h12 = h % 12 || 12;
                                                                const ampm = h >= 12 ? 'pm' : 'am';
                                                                return `${h12}:${d.getMinutes().toString().padStart(2, '0')} ${ampm}`;
                                                            })()}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="grid grid-cols-2 gap-4">
                                        {/* Helper for Parent Range */}
                                        {(() => {
                                            // Quick Find Parent Logic inside Render to show restriction hint
                                            const findParentTask = (tasks: SpaceTask[], childId: string): SpaceTask | null => {
                                                for (const t of tasks) {
                                                    if (t.subtasks && t.subtasks.some(st => st.id === childId)) return t;
                                                    if (t.subtasks && t.subtasks.length > 0) {
                                                        const found = findParentTask(t.subtasks, childId);
                                                        if (found) return found;
                                                    }
                                                }
                                                return null;
                                            };
                                            const parent = activeList && editingTask ? findParentTask(activeList.tareas, editingTask.id) : null;

                                            if (parent) {
                                                return (
                                                    <div className="col-span-2 bg-orange-50 border border-orange-100 rounded-xl p-3 flex items-start gap-3">
                                                        <i className="fa-solid fa-triangle-exclamation text-orange-500 text-xs mt-0.5"></i>
                                                        <div>
                                                            <p className="text-[10px] font-black text-orange-800 uppercase tracking-wide">Restricción de Subtarea</p>
                                                            <p className="text-[10px] text-orange-700 leading-tight mt-0.5">
                                                                Debe estar entre <span className="font-bold">{new Date(parent.startDate).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()}</span> y <span className="font-bold">{new Date(parent.endDate || parent.dueDate).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()}</span> (Tarea Padre)
                                                            </p>
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        })()}

                                        <Input label="Inicio Exacto" type="datetime-local" value={editingTask.startDate.slice(0, 16)} onChange={(v: string) => setEditingTask({ ...editingTask, startDate: v })} />
                                        <Input label="Fin Exacto" type="datetime-local" value={editingTask.endDate.slice(0, 16)} onChange={(v: string) => setEditingTask({ ...editingTask, endDate: v })} />
                                        <EffortInput duration={editingTask.duration} onChange={d => setEditingTask({ ...editingTask, duration: d })} />
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
                                        <option value="ASAP">Urgente</option>
                                        <option value="High">Alta</option>
                                        <option value="Medium">Normal</option>
                                        <option value="Low">Baja</option>
                                    </select>
                                </div>
                                <Input label="Valor Total ($)" type="number" value={editingTask.totalValue} onChange={(v: string) => setEditingTask({ ...editingTask, totalValue: Number(v) })} />
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                                <ProgressInput 
                                    progress={editingTask.progress} 
                                    onChange={(val) => {
                                        setEditingTask({ ...editingTask, progress: val, estado: getStatusFromProgress(val) });
                                    }} 
                                    className="flex-1 p-4 bg-slate-50 rounded-2xl border border-slate-200"
                                />
                                <div className="space-y-1.5 flex-1">
                                    <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Estado</label>
                                    <select
                                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-xs uppercase opacity-80 cursor-not-allowed"
                                        value={editingTask.estado}
                                        disabled
                                    >
                                        <option value="TODO">Pendiente</option>
                                        <option value="ACTIVE">En curso</option>
                                        <option value="DONE">Hecho</option>
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
                            onClick={() => { setTaskToDelete(editingTask); }}
                            className="w-full py-3 rounded-2xl font-black text-[9px] uppercase text-red-400 hover:bg-red-50 transition-colors"
                        >
                            Eliminar Tarea
                        </button>
                    </div>
                </div>
            )}

            {/* MODERN TOAST NOTIFICATION */}
            {notification && (
                <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[300] animate-in slide-in-from-top-4 duration-300">
                    <div className={`flex items-center gap-4 px-6 py-4 rounded-3xl shadow-2xl backdrop-blur-xl border ${notification.type === 'error'
                        ? 'bg-white/90 border-red-100 text-red-900'
                        : 'bg-white/90 border-green-100 text-green-900'
                        }`}>
                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg ${notification.type === 'error' ? 'bg-red-500 text-white' : 'bg-green-500 text-white'
                            }`}>
                            <i className={`fa-solid ${notification.type === 'error' ? 'fa-triangle-exclamation' : 'fa-check'}`}></i>
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest opacity-50 mb-0.5">
                                {notification.type === 'error' ? 'Restricción' : 'Éxito'}
                            </p>
                            <p className="text-xs font-bold leading-tight max-w-[300px]">{notification.message}</p>
                        </div>
                        <button
                            onClick={() => setNotification(null)}
                            className="ml-4 w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors"
                        >
                            <i className="fa-solid fa-xmark text-slate-400"></i>
                        </button>
                    </div>
                </div>
            )}
            {/* DELETE CONFIRMATION MODAL */}
            {taskToDelete && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[400] flex items-center justify-center p-4" onClick={() => setTaskToDelete(null)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-sm rounded-[2rem] p-8 shadow-2xl animate-in zoom-in-95">
                        <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
                            <i className="fa-solid fa-trash-can text-2xl"></i>
                        </div>
                        <h3 className="text-xl font-black text-slate-800 text-center mb-2 uppercase tracking-tight">¿Eliminar Tarea?</h3>
                        <p className="text-slate-500 text-center text-xs mb-8 font-medium">
                            Estás a punto de eliminar <span className="font-bold text-slate-700">"{taskToDelete.nombre}"</span>. Esta acción no se puede deshacer.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setTaskToDelete(null)}
                                className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black text-[10px] uppercase hover:bg-slate-200 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    const id = taskToDelete.id;
                                    setDeletingTaskId(id);
                                    setTaskToDelete(null);
                                    if (editingTask?.id === id) setEditingTask(null);
                                    
                                    // Give time for animation
                                    setTimeout(() => {
                                        handleDeleteTask(id);
                                        setDeletingTaskId(null);
                                    }, 400);
                                }}
                                className="flex-1 py-4 bg-red-500 text-white rounded-2xl font-black text-[10px] uppercase shadow-lg shadow-red-200 hover:bg-red-600 transition-colors"
                            >
                                Sí, Eliminar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* INCOMPLETE SUBTASKS WARNING MODAL */}
            {subtaskWarning && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[450] flex items-center justify-center p-4" onClick={() => setSubtaskWarning(null)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-md rounded-[2rem] p-8 shadow-2xl animate-in zoom-in-95 border-2 border-orange-100">
                        <div className="w-16 h-16 bg-orange-50 text-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-orange-100">
                            <i className="fa-solid fa-layer-group text-2xl"></i>
                        </div>
                        <h3 className="text-xl font-black text-slate-800 text-center mb-2 uppercase tracking-tight">Subtareas Pendientes</h3>
                        <p className="text-slate-500 text-center text-xs mb-8 font-medium px-4">
                            La tarea <span className="font-bold text-slate-700">"{subtaskWarning.task.nombre}"</span> tiene <span className="font-bold text-orange-500">{subtaskWarning.missingCount} subtareas</span> que aún no han sido completadas.
                        </p>

                        <div className="space-y-3">
                            <button
                                onClick={() => handleToggleTask(subtaskWarning.task.id, 'IGNORE')}
                                className="w-full py-4 bg-white border-2 border-slate-100 text-slate-700 rounded-2xl font-black text-[10px] uppercase hover:bg-slate-50 hover:border-slate-200 transition-all flex items-center justify-between px-6 group"
                            >
                                <span>Continuar sin resolver</span>
                                <i className="fa-solid fa-arrow-right text-slate-300 group-hover:text-slate-500"></i>
                            </button>

                            <button
                                onClick={() => handleToggleTask(subtaskWarning.task.id, 'RESOLVE_ALL')}
                                className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-black transition-all flex items-center justify-between px-6"
                            >
                                <span>Resolver Todas</span>
                                <i className="fa-solid fa-check-double text-slate-400"></i>
                            </button>

                            <button
                                onClick={() => setSubtaskWarning(null)}
                                className="w-full py-3 text-slate-400 rounded-2xl font-bold text-[10px] uppercase hover:text-slate-600 transition-colors"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* EVENT MODAL */}
            {showEventModal && (
                <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setShowEventModal(false)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-lg rounded-[2.5rem] p-10 space-y-6 shadow-2xl animate-in zoom-in-95">
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-orange-100 rounded-2xl flex items-center justify-center">
                                    <i className="fa-solid fa-calendar-day text-orange-600 text-xl"></i>
                                </div>
                                <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">
                                    {(newEvent as any).id ? 'Editar Evento' : 'Nuevo Evento'}
                                </h2>
                            </div>
                            <button type="button" onClick={() => setShowEventModal(false)} className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100">
                                <i className="fa-solid fa-xmark text-xl"></i>
                            </button>
                        </div>

                        <p className="text-xs text-slate-500 -mt-2">
                            Los eventos son bloques de tiempo fijos (compromisos inamovibles) que el algoritmo respetará al planificar tareas.
                        </p>

                        <div className="space-y-4">
                            <Input label="Nombre del Evento" value={newEvent.nombre} onChange={(v: string) => setNewEvent({ ...newEvent, nombre: v })} />
                            <div className="grid grid-cols-2 gap-4">
                                <Input label="Fecha Inicio" type="datetime-local" value={newEvent.startDate.slice(0, 16)} onChange={(v: string) => setNewEvent({ ...newEvent, startDate: v })} />
                                <Input label="Fecha Fin" type="datetime-local" value={newEvent.endDate.slice(0, 16)} onChange={(v: string) => setNewEvent({ ...newEvent, endDate: v })} />
                            </div>
                            {/* Inline Conflict Warning */}
                            {(() => {
                                // Real-time conflict check
                                const allEvents: SpaceEvent[] = [];
                                const activeWorkspace = state.workspaces.find(w => w.id === state.activeWorkspaceId);
                                if (activeWorkspace) {
                                    activeWorkspace.espacios.forEach(s => {
                                        s.listas.forEach(l => l.eventos?.forEach(e => allEvents.push(e)));
                                        s.carpetas.forEach(f => f.listas.forEach(l => l.eventos?.forEach(e => allEvents.push(e))));
                                    });
                                }
                                const newStart = new Date(newEvent.startDate).getTime();
                                const newEnd = new Date(newEvent.endDate).getTime();
                                const overlap = allEvents.find(e => {
                                    if ((newEvent as any).id && e.id === (newEvent as any).id) return false;
                                    const eStart = new Date(e.startDate).getTime();
                                    const eEnd = new Date(e.endDate).getTime();
                                    return newStart < eEnd && newEnd > eStart;
                                });

                                if (overlap && newStart && newEnd) {
                                    return (
                                        <div className="bg-red-50 border border-red-100 p-3 rounded-xl flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-red-100 text-red-500 flex items-center justify-center shrink-0">
                                                <i className="fa-solid fa-triangle-exclamation text-xs"></i>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-black uppercase text-red-500">Conflicto de Horario</p>
                                                <p className="text-[10px] text-red-400 font-medium">Se solapa con "<span className="font-bold">{overlap.nombre}</span>"</p>
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            })()}
                            <div className="space-y-1.5">
                                <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Descripción (Opcional)</label>
                                <textarea
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs outline-none resize-none min-h-[80px]"
                                    value={newEvent.description || ''}
                                    onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                                    placeholder="Añade detalles sobre este evento..."
                                />
                            </div>
                        </div>

                        <div className="flex gap-4 pt-4">
                            <button type="button" onClick={() => setShowEventModal(false)} className="flex-1 font-black text-slate-400 uppercase text-[10px]">Cerrar</button>
                            {(newEvent as any).id && (
                                <button
                                    type="button"
                                    onClick={() => handleDeleteEvent((newEvent as any).id)}
                                    className="px-6 py-4 bg-red-50 text-red-500 rounded-2xl font-black text-[10px] uppercase hover:bg-red-100 transition-colors"
                                >
                                    Eliminar
                                </button>
                            )}
                            <button type="button" onClick={handleAddEvent} className="flex-1 py-4 bg-orange-500 text-white rounded-2xl font-black text-[10px] uppercase shadow-2xl tracking-widest hover:bg-orange-600 transition-colors">
                                {(newEvent as any).id ? 'Guardar Cambios' : 'Crear Evento'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SpacesView;
