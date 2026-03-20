
import React, { useState, useMemo } from 'react';
import { Project, Priority, Client } from '../types';
import { getSortedSchedulingQueue } from '../utils/schedulingLogic';
import { getFormattedSlack } from '../utils/schedulingUtils';

interface GanttViewProps {
    projects: Project[];
    clients: Client[];
    onAddProject: (p: Project) => void;
    onAddClient: (c: Client) => void;
    onUpdateClients: (c: Client[]) => void;
    onDeleteProject: (id: string) => void;
    onUpdateProject: (p: Project) => void;
    onUndo: () => void;
    onRedo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onExport: () => void;
}

const getStatusFromProgress = (progress: number): 'todo' | 'active' | 'completed' => {
    if (progress <= 0) return 'todo';
    if (progress >= 100) return 'completed';
    return 'active';
};

// Helper para mostrar duración amigable
const formatDuration = (minutes: number) => {
    if (minutes >= 60) {
        const h = minutes / 60;
        return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
    }
    return `${minutes}m`;
};

const SchedulingQueue = ({ projects, onEditTask }: { projects: Project[], onEditTask: (p: Project) => void }) => {
    const sortedQueue = getSortedSchedulingQueue(projects);

    return (
        <div className="bg-slate-900 rounded-[2rem] p-6 text-white shadow-2xl border border-white/5 h-full flex flex-col">
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                    <i className="fa-solid fa-arrow-trend-up text-sm"></i>
                </div>
                <div>
                    <h3 className="text-sm font-black uppercase tracking-widest">Plan de Ejecución</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">Jerarquía Operativa</p>
                </div>
            </div>

            <div className="space-y-4 overflow-y-auto custom-scrollbar flex-1 pr-1">
                {sortedQueue.length === 0 && (
                    <div className="py-10 text-center text-slate-600 italic text-xs">
                        Sin tareas pendientes.
                    </div>
                )}
                {sortedQueue.map((p, idx) => {
                    const slackInfo = getFormattedSlack(p);
                    const slackText = slackInfo.text;
                    const isOverdue = slackInfo.isOverdue;
                    const isStarted = p.progress > 0;
                    const isRigid = p.elasticity === 0;

                    return (
                        <div
                            key={p.id}
                            onClick={() => onEditTask(p)}
                            className={`bg-white/5 border p-4 rounded-2xl hover:bg-white/10 transition-all cursor-pointer group relative overflow-hidden ${p.hasConflict ? 'border-red-500/50' : 'border-white/10'}`}
                        >
                            <div className={`absolute top-0 left-0 w-1.5 h-full ${p.priority === Priority.ASAP ? 'bg-purple-500 animate-pulse' : isStarted ? 'bg-blue-400' : 'bg-slate-600'}`}></div>

                            <div className="flex justify-between items-start mb-2 pl-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-black text-blue-400 uppercase tracking-tighter">POS. {idx + 1}</span>
                                    {p.hasConflict && (
                                        <i className="fa-solid fa-fire-flame-curved text-xs text-red-500 animate-bounce"></i>
                                    )}
                                </div>
                                <div className="flex gap-1">
                                    {isRigid && <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-md bg-yellow-500/20 text-yellow-500 border border-yellow-500/30" title="Indivisible"><i className="fa-solid fa-magnet"></i></span>}
                                    <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-md ${p.priority === Priority.ASAP ? 'bg-purple-600 text-white' :
                                        p.priority === Priority.HIGH ? 'bg-red-600 text-white' :
                                            p.priority === Priority.MEDIUM ? 'bg-orange-500 text-white' : 'bg-slate-600 text-white'
                                        }`}>
                                        {p.priority}
                                    </span>
                                </div>
                            </div>

                            <h4 className="font-bold text-xs truncate mb-1 pl-1">{p.projectName}</h4>
                            <p className="text-[9px] text-slate-500 font-bold uppercase pl-1 mb-3">{p.clientName}</p>

                            <div className="bg-black/20 p-3 rounded-xl border border-white/5 space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-[9px] font-black text-slate-500 uppercase">Margen (Slack):</span>
                                    <span className={`text-[10px] font-bold ${isOverdue ? 'text-red-400' : 'text-emerald-400'}`}>
                                        {slackText}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center border-t border-white/5 pt-2">
                                    <div className="flex flex-col">
                                        <span className="text-[8px] font-black text-slate-600 uppercase mb-0.5">Esfuerzo:</span>
                                        <span className="text-[10px] font-bold text-slate-300">{formatDuration(p.duration)}</span>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <span className="text-[8px] font-black text-slate-600 uppercase mb-0.5">Entrega:</span>
                                        <span className="text-[10px] font-bold text-slate-400">{p.dueDate}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const CalendarMode = ({ projects, onEditTask }: { projects: Project[], onEditTask: (p: Project) => void }) => {
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

    const isProjectActiveOnDay = (p: Project, day: number) => {
        const dayStartTimestamp = new Date(year, month, day, 0, 0, 0, 0).getTime();
        const dayEndTimestamp = new Date(year, month, day, 23, 59, 59, 999).getTime();

        if (p.scheduledSlots && p.scheduledSlots.length > 0) {
            return p.scheduledSlots.some(s => {
                const slotStartTimestamp = new Date(s.start).getTime();
                const slotEndTimestamp = new Date(s.end).getTime();
                return slotStartTimestamp <= dayEndTimestamp && slotEndTimestamp >= dayStartTimestamp;
            });
        }

        const startDate = new Date(p.startDate);
        const endDate = new Date(p.endDate);

        // Normalize for day comparison
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);

        return startDate.getTime() <= dayEndTimestamp && endDate.getTime() >= dayStartTimestamp;
    };

    return (
        <div className="animate-in fade-in duration-500">
            <div className="flex items-center justify-between mb-6 px-4">
                <button onClick={prevMonth} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500"><i className="fa-solid fa-chevron-left"></i></button>
                <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest">{monthName}</h3>
                <button onClick={nextMonth} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500"><i className="fa-solid fa-chevron-right"></i></button>
            </div>
            <div className="grid grid-cols-7 mb-2">
                {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => (
                    <div key={d} className="text-center text-[10px] font-black uppercase text-slate-400 tracking-widest py-2">{d}</div>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
                {blanks.map(b => <div key={`blank-${b}`} className="h-32 bg-slate-50/30 rounded-xl"></div>)}
                {days.map(day => {
                    const activeProjects = projects.filter(p => isProjectActiveOnDay(p, day) && (p.status === 'active' || p.status === 'todo'));
                    const isToday = new Date().toDateString() === new Date(year, month, day).toDateString();
                    return (
                        <div key={day} className={`h-32 bg-white border border-slate-100 rounded-xl p-2 relative hover:border-blue-300 transition-colors overflow-hidden group ${isToday ? 'ring-2 ring-blue-500/20' : ''}`}>
                            <span className={`text-xs font-bold mb-1 block ${isToday ? 'text-blue-600' : 'text-slate-400'}`}>{day}</span>
                            <div className="space-y-1 overflow-y-auto max-h-[90px] custom-scrollbar">
                                {activeProjects.map(p => (
                                    <div key={p.id} onClick={() => onEditTask(p)} className={`text-[8px] px-2 py-1 rounded-md font-bold uppercase truncate cursor-pointer hover:opacity-80 transition-opacity border-l-2 shadow-sm ${p.priority === Priority.ASAP ? 'bg-purple-50 text-purple-700 border-purple-500' :
                                        p.priority === Priority.HIGH ? 'bg-red-50 text-red-700 border-red-500' :
                                            p.priority === Priority.MEDIUM ? 'bg-orange-50 text-orange-700 border-orange-500' :
                                                'bg-emerald-50 text-emerald-700 border-emerald-500'
                                        }`}>
                                        {p.hasConflict && <i className="fa-solid fa-fire mr-1 text-red-500"></i>}
                                        {p.projectName}
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

const KanbanMode = ({ projects, onEditTask }: { projects: Project[], onEditTask: (p: Project) => void }) => {
    const columns = [
        { id: 'todo', label: 'To Do (Almacén)', icon: 'fa-warehouse', color: 'text-orange-500' },
        { id: 'active', label: 'En Marcha', icon: 'fa-rocket', color: 'text-blue-500' },
        { id: 'completed', label: 'Finalizados', icon: 'fa-check-double', color: 'text-emerald-500' }
    ];

    const getPriorityStyle = (p: Priority) => {
        switch (p) {
            case Priority.ASAP: return 'bg-purple-100 text-purple-700';
            case Priority.HIGH: return 'bg-red-100 text-red-700';
            case Priority.MEDIUM: return 'bg-orange-100 text-orange-700';
            case Priority.LOW: return 'bg-emerald-100 text-emerald-700';
            default: return 'bg-slate-100 text-slate-700';
        }
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-full min-h-[500px] animate-in slide-in-from-right-4 duration-500">
            {columns.map(col => (
                <div key={col.id} className="flex flex-col bg-slate-50/50 rounded-3xl p-4 border border-slate-100 shadow-inner">
                    <div className="flex items-center justify-between mb-4 px-2">
                        <div className="flex items-center gap-2">
                            <i className={`fa-solid ${col.icon} ${col.color} text-xs`}></i>
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">{col.label}</h3>
                        </div>
                        <span className="text-[10px] font-black bg-white px-2 py-0.5 rounded-full border border-slate-200 text-slate-400">
                            {projects.filter(p => p.status === col.id).length}
                        </span>
                    </div>

                    <div className="flex-1 space-y-3 overflow-y-auto custom-scrollbar pr-1">
                        {projects.filter(p => p.status === col.id).map(p => (
                            <div key={p.id} onClick={() => onEditTask(p)} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group">
                                <div className="flex justify-between items-start mb-2">
                                    <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-md ${getPriorityStyle(p.priority)}`}>{p.priority}</span>
                                    {p.hasConflict && <i className="fa-solid fa-fire text-red-500 text-[10px] animate-pulse"></i>}
                                </div>
                                <h4 className="font-bold text-slate-800 text-sm mb-1 group-hover:text-blue-600 transition-colors">{p.projectName}</h4>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-4">{p.clientName}</p>
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center text-[9px] font-black uppercase"><span className="text-slate-400">Progreso</span><span className="text-blue-600">{p.progress}%</span></div>
                                    <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden"><div className="bg-blue-600 h-full transition-all duration-1000" style={{ width: `${p.progress}%` }}></div></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};

const GanttView: React.FC<GanttViewProps> = ({
    projects, clients, onAddProject, onAddClient, onUpdateClients, onDeleteProject, onUpdateProject,
    onUndo, onRedo, canUndo, canRedo, onExport
}) => {
    const [showModal, setShowModal] = useState(false);
    const [isAdminMode, setIsAdminMode] = useState(false);
    const [viewMode, setViewMode] = useState<'gantt' | 'calendar' | 'kanban'>('gantt');
    const [editingProject, setEditingProject] = useState<Project | null>(null);
    const [originalProject, setOriginalProject] = useState<Project | null>(null);
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);

    const [newTask, setNewTask] = useState({
        clientName: '', projectName: '',
        startDate: '', // Ahora inicia vacío en auto-schedule (significa "HOY")
        endDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        priority: Priority.MEDIUM, totalValue: 0,
        duration: 60, deadlineType: 'Soft Deadline' as any,
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        autoSchedule: true,
        elasticity: 1 // 1 Flexible, 0 Rigido
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysToShow = 25;
    const dates = Array.from({ length: daysToShow }, (_, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() + i - 4);
        return d;
    });

    const hasChanges = useMemo(() => {
        if (!editingProject || !originalProject) return false;
        return editingProject.projectName !== originalProject.projectName ||
            editingProject.startDate !== originalProject.startDate ||
            editingProject.endDate !== originalProject.endDate ||
            editingProject.progress !== originalProject.progress ||
            editingProject.priority !== originalProject.priority ||
            editingProject.status !== originalProject.status ||
            editingProject.duration !== originalProject.duration ||
            editingProject.deadlineType !== originalProject.deadlineType ||
            editingProject.dueDate !== originalProject.dueDate ||
            editingProject.autoSchedule !== originalProject.autoSchedule ||
            editingProject.elasticity !== originalProject.elasticity;
    }, [editingProject, originalProject]);

    const handleUpdate = () => {
        if (editingProject && hasChanges) {
            onUpdateProject(editingProject);
            setEditingProject(null);
            setOriginalProject(null);
        }
    };

    const handleCloseEditor = (e?: React.MouseEvent) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (hasChanges) { setShowCloseConfirm(true); } else { setEditingProject(null); setOriginalProject(null); }
    };

    const forceCloseEditor = () => { setEditingProject(null); setOriginalProject(null); setShowCloseConfirm(false); };

    const getPosition = (startDateStr: string, endDateStr: string) => {
        // Parseamos usando Date constructor para soportar ISO y YYYY-MM-DD
        const start = new Date(startDateStr);
        let end = new Date(endDateStr);

        // Si la fecha de fin no tiene hora (es solo fecha), ajustar al final del día o inicio del siguiente
        if (endDateStr && !endDateStr.includes('T')) {
            // end.setHours(23, 59, 59, 999); // Opcional, dependiendo de la logica visual
        }

        // Resetear a horas 0 para comparar con el array de fechas 'dates' que son dias puros
        start.setHours(0, 0, 0, 0);
        end.setHours(0, 0, 0, 0);

        let startIdx = -1;
        let endIdx = -1;

        for (let i = 0; i < dates.length; i++) {
            if (dates[i].getTime() === start.getTime()) startIdx = i;
            if (dates[i].getTime() === end.getTime()) endIdx = i;
        }

        if (startIdx === -1 && start < dates[0]) startIdx = 0;
        if (endIdx === -1 && end > dates[dates.length - 1]) endIdx = dates.length - 1;

        if (startIdx === -1 || endIdx === -1) return null;

        return { left: `${(startIdx / daysToShow) * 100}%`, width: `${((endIdx - startIdx + 1) / daysToShow) * 100}%` };
    };

    const handleEditTask = (p: Project) => { setEditingProject(p); setOriginalProject({ ...p }); };

    return (
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden animate-in fade-in duration-700">
            <div className="p-8 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-slate-50/30">
                <div>
                    <h2 className="text-3xl font-black text-slate-800 tracking-tighter uppercase">Proyectos</h2>
                    <div className="flex flex-wrap gap-4 mt-2">
                        <button onClick={() => setViewMode('gantt')} className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-colors ${viewMode === 'gantt' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}><i className="fa-solid fa-chart-gantt"></i> Diagrama Gantt</button>
                        <button onClick={() => setViewMode('calendar')} className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-colors ${viewMode === 'calendar' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}><i className="fa-solid fa-calendar-days"></i> Calendario</button>
                        <button onClick={() => setViewMode('kanban')} className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-colors ${viewMode === 'kanban' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}><i className="fa-solid fa-warehouse"></i> Almacén Kanban</button>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button onClick={() => setIsAdminMode(!isAdminMode)} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 ${isAdminMode ? 'bg-red-500 text-white shadow-lg shadow-red-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}><i className={`fa-solid ${isAdminMode ? 'fa-toggle-on' : 'fa-toggle-off'}`}></i>{isAdminMode ? 'Modo Admin: ON' : 'Modo Admin: OFF'}</button>
                    <button onClick={() => setShowModal(true)} className="px-8 py-3 bg-blue-600 text-white rounded-2xl text-[10px] font-black uppercase shadow-2xl shadow-blue-200 tracking-widest active:scale-95 transition-all">Nueva Tarea</button>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row h-full min-h-[600px]">
                <div className="w-full lg:w-80 shrink-0 border-r border-slate-100 p-6 bg-slate-50/50"><SchedulingQueue projects={projects} onEditTask={handleEditTask} /></div>
                <div className="flex-1 p-6 overflow-hidden flex flex-col">
                    {viewMode === 'calendar' ? (<CalendarMode projects={projects} onEditTask={handleEditTask} />) :
                        viewMode === 'kanban' ? (<KanbanMode projects={projects} onEditTask={handleEditTask} />) : (
                            <div className="overflow-x-auto custom-scrollbar flex-1">
                                <div className="min-w-max">
                                    <div className="flex border-b border-slate-100 bg-white sticky top-0 z-20">
                                        <div className="w-24 shrink-0 p-5 font-black text-[9px] text-slate-400 uppercase border-r text-center">Prioridad</div>
                                        <div className="w-48 shrink-0 p-5 font-black text-[9px] text-slate-400 uppercase border-r">Cliente</div>
                                        <div className="w-56 shrink-0 p-5 font-black text-[9px] text-slate-400 uppercase border-r">Tarea</div>
                                        <div className="flex-1 flex bg-slate-50/50">
                                            {dates.map((d, i) => (
                                                <div key={i} className={`w-16 shrink-0 flex items-center justify-center py-4 border-r border-slate-100/50 ${d.getDate() === today.getDate() && d.getMonth() === today.getMonth() ? 'bg-blue-600/5' : ''}`}>
                                                    <div className={`text-[9px] font-black uppercase ${d.getDate() === today.getDate() && d.getMonth() === today.getMonth() ? 'text-blue-600' : 'text-slate-400'}`}>{d.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' })}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    {projects.map(p => {
                                        const pos = getPosition(p.startDate, p.endDate);
                                        return (
                                            <div key={p.id} className="flex border-b border-slate-50 hover:bg-slate-50/30 transition-colors">
                                                <div className={`w-24 shrink-0 p-5 border-r flex items-center justify-center font-black text-[10px] uppercase ${p.priority === Priority.ASAP ? 'text-purple-500' : p.priority === Priority.HIGH ? 'text-red-500' : p.priority === Priority.MEDIUM ? 'text-orange-500' : 'text-emerald-500'}`}>
                                                    {p.hasConflict && <i className="fa-solid fa-fire text-red-500 mr-1 animate-pulse"></i>}
                                                    {p.priority}
                                                </div>
                                                <div className="w-48 shrink-0 p-5 border-r flex items-center font-black text-slate-900 text-[10px] uppercase truncate">{p.clientName}</div>
                                                <div className="w-56 shrink-0 p-5 border-r flex items-center font-bold text-slate-600 text-[10px] uppercase truncate">{p.projectName}</div>
                                                <div className="flex-1 relative h-20 flex items-center bg-white">
                                                    {dates.map((_, i) => <div key={i} className="w-16 shrink-0 border-r border-slate-50 h-full"></div>)}
                                                    {pos && (<div onClick={() => handleEditTask(p)} className="absolute h-12 rounded-2xl shadow-xl border border-white/40 overflow-hidden cursor-pointer transition-all hover:scale-[1.01] z-10 bg-slate-100/50" style={{ left: pos.left, width: pos.width }}><div className="h-full bg-blue-600 transition-all duration-1000 flex items-center px-4" style={{ width: `${p.progress}%` }}><span className="text-[10px] text-white font-black drop-shadow-sm">{p.progress}%</span></div></div>)}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                </div>
            </div>

            {editingProject && (
                <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-[100] flex items-center justify-center p-4" onClick={handleCloseEditor}>
                    <div className="bg-white w-full max-w-2xl rounded-[2.5rem] p-10 space-y-8 shadow-2xl animate-in zoom-in-95 overflow-y-auto max-h-[90vh] custom-scrollbar" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center"><h3 className="text-3xl font-black text-slate-800 tracking-tighter uppercase">Expediente de Tarea</h3><button type="button" onClick={handleCloseEditor} className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors cursor-pointer rounded-full hover:bg-slate-100"><i className="fa-solid fa-xmark text-xl"></i></button></div>
                        <div className="space-y-6">
                            <Input label="Nombre del Proyecto" value={editingProject.projectName} onChange={(v: any) => setEditingProject({ ...editingProject, projectName: v })} />

                            {!editingProject.autoSchedule ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-6 rounded-3xl border border-slate-200">
                                    <p className="col-span-2 text-[10px] font-black uppercase text-blue-600 mb-2 tracking-widest">Ajuste de Bloque Rígido (Ancla)</p>
                                    <Input label="Inicio Manual" type="date" value={editingProject.startDate} onChange={(v: any) => setEditingProject({ ...editingProject, startDate: v })} />
                                    <Input label="Fin Manual" type="date" value={editingProject.endDate} onChange={(v: any) => setEditingProject({ ...editingProject, endDate: v })} />
                                </div>
                            ) : (
                                <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100 flex items-center gap-3">
                                    <i className="fa-solid fa-robot text-blue-600"></i>
                                    <div className="flex-1">
                                        <p className="text-[10px] font-black text-blue-800 uppercase tracking-tighter">Este bloque se calcula automáticamente.</p>
                                        <p className="text-[9px] text-blue-600">Basado en Deadline: <strong>{editingProject.dueDate}</strong></p>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <Input label="Fecha Límite (Due Date)" type="date" value={editingProject.dueDate} onChange={(v: any) => setEditingProject({ ...editingProject, dueDate: v })} />
                                <div className="space-y-1.5 flex-1"><label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Tipo de Deadline</label><select className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-xs uppercase" value={editingProject.deadlineType} onChange={e => setEditingProject({ ...editingProject, deadlineType: e.target.value as any })}><option value="Hard Deadline">Hard Deadline (Fijo)</option><option value="Soft Deadline">Soft Deadline (Flexible)</option></select></div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* CONVERSION DE INPUT A HORAS PERO STORAGE EN MINUTOS */}
                                <EffortInput duration={editingProject.duration} onChange={d => setEditingProject({ ...editingProject, duration: d })} className="flex-1" />
                                <div className="space-y-1.5 flex-1"><label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Prioridad</label><select className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-xs uppercase" value={editingProject.priority} onChange={e => setEditingProject({ ...editingProject, priority: e.target.value as Priority })}><option value={Priority.ASAP}>ASAP</option><option value={Priority.HIGH}>High</option><option value={Priority.MEDIUM}>Medium</option><option value={Priority.LOW}>Low</option></select></div>
                                <div className="space-y-1.5 flex-1 flex flex-col justify-center"><label className="text-[9px] font-black uppercase text-slate-400 tracking-widest mb-2">Auto-Agendamiento</label><div className="flex items-center gap-3"><button type="button" onClick={() => setEditingProject({ ...editingProject, autoSchedule: !editingProject.autoSchedule })} className={`w-14 h-8 rounded-full transition-all relative ${editingProject.autoSchedule ? 'bg-blue-600' : 'bg-slate-300'}`}><div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${editingProject.autoSchedule ? 'left-7' : 'left-1 shadow-sm'}`}></div></button><span className="text-[10px] font-black uppercase text-slate-600">{editingProject.autoSchedule ? 'ON' : 'OFF'}</span></div></div>
                            </div>

                            {editingProject.autoSchedule && (
                                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200">
                                    <div>
                                        <p className="text-[10px] font-black uppercase text-slate-500">Elasticidad de Bloques</p>
                                        <p className="text-[8px] text-slate-400 font-bold">{editingProject.elasticity === 0 ? 'La tarea se realiza de seguido' : 'La tarea puede ser realizada en momentos separados'}</p>
                                    </div>
                                    <button type="button" onClick={() => setEditingProject({ ...editingProject, elasticity: editingProject.elasticity === 0 ? 1 : 0 })} className={`w-12 h-6 rounded-full transition-all relative ${editingProject.elasticity !== 0 ? 'bg-green-500' : 'bg-slate-300'}`}>
                                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${editingProject.elasticity !== 0 ? 'left-7' : 'left-1'}`}></div>
                                    </button>
                                </div>
                            )}
                            {editingProject.scheduledSlots && editingProject.scheduledSlots.length > 0 && (
                                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                                    <h5 className="text-[9px] font-black uppercase text-slate-400 mb-2">Horarios Sugeridos (Auto-Schedule)</h5>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {editingProject.scheduledSlots.map((s, idx) => (
                                            <div key={idx} className="text-[10px] font-bold text-slate-700 bg-white p-2 rounded-lg border flex justify-between items-center">
                                                <span>{new Date(s.start).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                                <i className="fa-solid fa-arrow-right text-[8px] text-slate-300"></i>
                                                <span>{new Date(s.end).toLocaleString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-50">
                                <div className="space-y-1.5 flex-1"><label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Progreso (%)</label><input type="number" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-xs" value={editingProject.progress} onChange={e => { const val = Math.min(100, Math.max(0, Number(e.target.value))); setEditingProject({ ...editingProject, progress: val, status: getStatusFromProgress(val) }); }} /></div>
                                <div className="space-y-1.5 flex-1"><label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Estado</label><select className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-xs uppercase opacity-80 cursor-not-allowed" value={editingProject.status} disabled={true}><option value="todo">To Do</option><option value="active">En Marcha</option><option value="completed">Finalizado</option></select></div>
                            </div>
                        </div>
                        <div className="space-y-4 pt-6 border-t border-slate-100">
                            <button type="button" onClick={handleUpdate} disabled={!hasChanges} className={`w-full py-4 rounded-2xl font-black text-[10px] uppercase shadow-xl tracking-widest transition-all ${hasChanges ? 'bg-slate-900 text-white opacity-100 hover:bg-slate-800 cursor-pointer' : 'bg-slate-100 text-slate-400 cursor-not-allowed shadow-none'}`}>Guardar Cambios</button>
                            {isAdminMode && (
                                <button type="button" onClick={() => { if (editingProject) onDeleteProject(editingProject.id); setEditingProject(null); }} className="w-full py-3 rounded-2xl font-black text-[9px] uppercase text-red-400 hover:bg-red-50 transition-colors">Eliminar Definitivamente</button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {showCloseConfirm && (<div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4"><div className="bg-white w-full max-sm rounded-3xl p-8 shadow-2xl animate-in zoom-in-95" onClick={e => e.stopPropagation()}><h3 className="text-xl font-black text-slate-800 mb-2">¿Cerrar sin guardar?</h3><p className="text-sm text-slate-500 mb-6 font-medium">Hay cambios pendientes. Se perderán si sales.</p><div className="flex gap-3"><button onClick={() => setShowCloseConfirm(false)} className="flex-1 py-3 rounded-xl font-black text-xs uppercase bg-slate-100 text-slate-500">Volver</button><button onClick={forceCloseEditor} className="flex-1 py-3 rounded-xl font-black text-xs uppercase bg-red-500 text-white shadow-lg">Sí, Cerrar</button></div></div></div>)}

            {showModal && (
                <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
                    <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => {
                        e.preventDefault();
                        const trimmedClientName = newTask.clientName.trim(); const trimmedProjectName = newTask.projectName.trim();
                        if (!trimmedClientName || !trimmedProjectName) return;
                        const projectId = Math.random().toString(36).substr(2, 9);
                        const existingClient = clients.find(c => c.name.toLowerCase().trim() === trimmedClientName.toLowerCase());
                        const clientId = existingClient ? existingClient.id : Math.random().toString(36).substr(2, 9);
                        const finalClientName = existingClient ? existingClient.name : trimmedClientName;

                        // Si es AutoSchedule y no hay startDate, usar HOY como constraint implícito.
                        // Si es Fixed, startDate es obligatorio.
                        const finalStartDate = newTask.startDate || new Date().toISOString().split('T')[0];
                        const finalEndDate = newTask.endDate || newTask.dueDate; // Fallback para Fixed mode

                        const projectObj: Project = {
                            id: projectId, clientId, clientName: finalClientName, projectName: trimmedProjectName,
                            startDate: finalStartDate, endDate: finalEndDate,
                            priority: newTask.priority, progress: 0, totalValue: newTask.totalValue, paidValue: 0,
                            status: 'todo', duration: newTask.duration, deadlineType: newTask.deadlineType,
                            dueDate: newTask.dueDate, autoSchedule: newTask.autoSchedule,
                            elasticity: newTask.elasticity
                        };

                        if (existingClient) { /* client already exists, no action needed */ } else { onAddClient({ id: clientId, name: finalClientName, email: '', phone: '' }); }
                        onAddProject(projectObj); setShowModal(false);
                        setNewTask({ clientName: '', projectName: '', startDate: '', endDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], priority: Priority.MEDIUM, totalValue: 0, duration: 60, deadlineType: 'Soft Deadline' as any, dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], autoSchedule: true, elasticity: 1 });
                    }} className="bg-white w-full max-w-2xl rounded-[2.5rem] p-10 space-y-6 shadow-2xl animate-in zoom-in-95 overflow-y-auto max-h-[90vh] custom-scrollbar">

                        <div className="flex justify-between items-center">
                            <h3 className="text-3xl font-black text-slate-800 tracking-tighter uppercase">Crear Tarea</h3>
                        </div>

                        <div className="space-y-4">
                            <Input label="Cliente" list="clients-list" value={newTask.clientName} onChange={(v: any) => setNewTask({ ...newTask, clientName: v })} /><datalist id="clients-list">{clients.map(c => <option key={c.id} value={c.name} />)}</datalist>
                            <Input label="Descripción / Tarea" value={newTask.projectName} onChange={(v: any) => setNewTask({ ...newTask, projectName: v })} />

                            {/* UNIFIED DATE & MODE SECTION */}
                            <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-4">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <i className={`fa-solid ${newTask.autoSchedule ? 'fa-brain text-blue-500' : 'fa-anchor text-orange-500'}`}></i>
                                        <span className={`text-[10px] font-black uppercase ${newTask.autoSchedule ? 'text-blue-800' : 'text-orange-800'}`}>
                                            {newTask.autoSchedule ? 'Planificación Automática' : 'Bloqueo Manual (Fijo)'}
                                        </span>
                                    </div>
                                    <div className="flex bg-white p-1 rounded-lg border border-slate-200">
                                        <button type="button" onClick={() => setNewTask({ ...newTask, autoSchedule: true })} className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase transition-all ${newTask.autoSchedule ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Auto (IA)</button>
                                        <button type="button" onClick={() => setNewTask({ ...newTask, autoSchedule: false })} className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase transition-all ${!newTask.autoSchedule ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Manual</button>
                                    </div>
                                </div>

                                {newTask.autoSchedule ? (
                                    // MODO INTELIGENTE (Auto)
                                    <>
                                        <div className="grid grid-cols-2 gap-4">
                                            <Input label="Fecha Límite (Deadline)" type="date" value={newTask.dueDate} onChange={(v: any) => setNewTask({ ...newTask, dueDate: v })} />
                                            <div className="relative">
                                                <Input label="Fecha Mín. Inicio" type="date" value={newTask.startDate} onChange={(v: any) => setNewTask({ ...newTask, startDate: v })} />
                                                <span className="absolute top-0 right-1 text-[8px] font-black text-slate-400 uppercase">Restricción</span>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1.5 flex-1"><label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Tipo Deadline</label><select className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-black text-xs uppercase" value={newTask.deadlineType} onChange={e => setNewTask({ ...newTask, deadlineType: e.target.value as any })}><option value="Soft Deadline">Soft Deadline</option><option value="Hard Deadline">Hard Deadline</option></select></div>
                                            {/* INPUT DE HORAS EN MODAL DE CREACIÓN */}
                                            <EffortInput duration={newTask.duration} onChange={d => setNewTask({ ...newTask, duration: d })} className="flex-1" />
                                        </div>
                                        {/* Elasticity Toggle */}
                                        <div className="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between">
                                            <div>
                                                <p className="text-[9px] font-black text-slate-500 uppercase">Elasticidad</p>
                                                <p className="text-[8px] text-slate-400 font-bold">{newTask.elasticity === 1 ? 'La tarea puede ser realizada en momentos separados' : 'La tarea se realiza de seguido'}</p>
                                            </div>
                                            <button type="button" onClick={() => setNewTask({ ...newTask, elasticity: newTask.elasticity === 1 ? 0 : 1 })} className={`w-12 h-6 rounded-full transition-all relative ${newTask.elasticity === 1 ? 'bg-green-500' : 'bg-slate-300'}`}>
                                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${newTask.elasticity === 1 ? 'left-7' : 'left-1'}`}></div>
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    // MODO FIJO (Manual)
                                    <div className="grid grid-cols-2 gap-4">
                                        <Input label="Inicio Exacto" type="date" value={newTask.startDate} onChange={(v: any) => setNewTask({ ...newTask, startDate: v })} />
                                        <Input label="Fin Exacto" type="date" value={newTask.endDate} onChange={(v: any) => setNewTask({ ...newTask, endDate: v })} />
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5 flex-1"><label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Prioridad</label><select className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-xs uppercase" value={newTask.priority} onChange={e => setNewTask({ ...newTask, priority: e.target.value as Priority })}><option value={Priority.ASAP}>ASAP</option><option value={Priority.HIGH}>High</option><option value={Priority.MEDIUM}>Medium</option><option value={Priority.LOW}>Low</option></select></div>
                                <Input label="Valor Total ($)" type="number" value={newTask.totalValue} onChange={(v: any) => setNewTask({ ...newTask, totalValue: Number(v) })} />
                            </div>
                        </div>
                        <div className="flex gap-4 pt-4"><button type="button" onClick={() => setShowModal(false)} className="flex-1 font-black text-slate-400 uppercase text-[10px]">Cerrar</button><button type="submit" className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black text-[10px] uppercase shadow-2xl tracking-widest">Crear Tarea</button></div>
                    </form>
                </div>
            )}
        </div>
    );
};

// Effort Input component (hours + minutes)
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

const Input = ({ label, value, onChange, type = "text", list = undefined }: any) => (
    <div className="space-y-1.5 flex-1"><label className="text-[9px] font-black uppercase text-slate-400 ml-1 tracking-widest">{label}</label><input list={list} type={type} value={value} onChange={e => onChange(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-4 ring-blue-500/10 transition-all" /></div>
);

export default GanttView;
