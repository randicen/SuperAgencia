import React, { useMemo, useState } from 'react';
import { getAllTasks, useSpaces } from '../contexts/SpacesContext';
import { SpaceEvent, SpaceTask } from '../spacesTypes';

interface AgendaViewProps {
    onGoToSpaces: () => void;
}

const Input = ({ label, value, onChange, type = "text" }: any) => (
    <div className="space-y-1.5 flex-1">
        <label className="text-[9px] font-black uppercase text-slate-400 ml-1 tracking-widest">{label}</label>
        <input
            type={type}
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-4 ring-blue-500/10 transition-all"
        />
    </div>
);

const formatDuration = (minutes: number) => {
    if (minutes >= 60) {
        const hours = minutes / 60;
        return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
    }
    return `${minutes}m`;
};

const CalendarViewComponent: React.FC<{
    tasks: SpaceTask[];
    events: SpaceEvent[];
    rules: any;
    onEditTask: (task: SpaceTask) => void;
    onEditEvent: (event: SpaceEvent) => void;
}> = ({ tasks, events, rules, onEditTask, onEditEvent }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [view, setView] = useState<'month' | 'week' | '4days' | 'day'>('month');
    const [selectedDay, setSelectedDay] = useState<number | null>(null);

    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (year: number, month: number) => {
        const day = new Date(year, month, 1).getDay();
        return day === 0 ? 6 : day - 1;
    };

    const getDatesToShow = () => {
        const dates: Date[] = [];
        const start = new Date(currentDate);
        start.setHours(0, 0, 0, 0);

        if (view === 'month') {
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const daysInMonth = getDaysInMonth(year, month);
            for (let i = 1; i <= daysInMonth; i++) dates.push(new Date(year, month, i));
        } else if (view === 'week') {
            const day = start.getDay();
            const diff = start.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(start.setDate(diff));
            for (let i = 0; i < 7; i++) {
                const date = new Date(monday);
                date.setDate(monday.getDate() + i);
                dates.push(date);
            }
        } else if (view === '4days') {
            for (let i = 0; i < 4; i++) {
                const date = new Date(start);
                date.setDate(start.getDate() + i);
                dates.push(date);
            }
        } else {
            dates.push(new Date(start));
        }

        return dates;
    };

    const datesToShow = getDatesToShow();
    const dayExpanded = selectedDay !== null ? datesToShow[selectedDay] : null;
    const monthName = currentDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

    const handleNext = () => {
        const date = new Date(currentDate);
        if (view === 'month') date.setMonth(date.getMonth() + 1);
        else if (view === 'week') date.setDate(date.getDate() + 7);
        else if (view === '4days') date.setDate(date.getDate() + 4);
        else date.setDate(date.getDate() + 1);
        setCurrentDate(date);
    };

    const handlePrev = () => {
        const date = new Date(currentDate);
        if (view === 'month') date.setMonth(date.getMonth() - 1);
        else if (view === 'week') date.setDate(date.getDate() - 7);
        else if (view === '4days') date.setDate(date.getDate() - 4);
        else date.setDate(date.getDate() - 1);
        setCurrentDate(date);
    };

    const isTaskActiveOnDay = (task: SpaceTask, date: Date) => {
        const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);

        const parseLocal = (dateStr: string) => dateStr ? new Date(dateStr).getTime() : 0;

        if (task.startDate && task.endDate) {
            const start = parseLocal(task.startDate);
            let end = parseLocal(task.endDate);
            if (task.endDate.length <= 10) end += (24 * 60 * 60 * 1000) - 1;
            return start <= dayEnd.getTime() && end >= dayStart.getTime();
        }

        const due = parseLocal(task.dueDate);
        return due >= dayStart.getTime() && due <= dayEnd.getTime();
    };

    const isEventActiveOnDay = (event: SpaceEvent, date: Date) => {
        const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
        const start = event.startDate ? new Date(event.startDate).getTime() : 0;
        const end = event.endDate ? new Date(event.endDate).getTime() : 0;
        return start <= dayEnd.getTime() && end >= dayStart.getTime();
    };

    const gridCols = view === 'month' || view === 'week' ? 'grid-cols-7' : view === '4days' ? 'grid-cols-4' : 'grid-cols-1';

    return (
        <div className="flex flex-col h-full bg-white rounded-3xl border border-slate-200 shadow-sm p-4 overflow-hidden relative">
            <div className="flex items-center justify-between mb-4 shrink-0">
                <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button onClick={() => { setView('month'); setSelectedDay(null); }} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${view === 'month' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>Mes</button>
                    <button onClick={() => { setView('week'); setSelectedDay(null); }} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${view === 'week' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>Semana</button>
                    <button onClick={() => { setView('4days'); setSelectedDay(null); }} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${view === '4days' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>4 Días</button>
                    <button onClick={() => { setView('day'); setSelectedDay(null); }} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${view === 'day' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>Día</button>
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
                {view !== 'day' && ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].slice(0, view === '4days' ? 4 : 7).map((label, index) => (
                    <div key={index} className="text-center text-[10px] font-black uppercase text-slate-400 tracking-widest py-2">
                        {view === '4days' ? new Date(datesToShow[index]).toLocaleDateString('es-ES', { weekday: 'short' }) : label}
                    </div>
                ))}
            </div>

            <div className={`grid ${gridCols} gap-2 flex-1 overflow-y-auto custom-scrollbar`}>
                {view === 'month' && Array.from({ length: getFirstDayOfMonth(currentDate.getFullYear(), currentDate.getMonth()) }, (_, index) => (
                    <div key={`blank-${index}`} className="min-h-[80px] bg-slate-50/30 rounded-xl"></div>
                ))}

                {datesToShow.map((date, index) => {
                    const activeEvents = events.filter(event => isEventActiveOnDay(event, date));
                    const activeTasks = tasks.filter(task => isTaskActiveOnDay(task, date) && task.estado !== 'DONE');
                    const isToday = new Date().toDateString() === date.toDateString();
                    const isWorkingDay = rules.workingDays.includes(date.getDay());

                    return (
                        <div
                            key={index}
                            onClick={() => { if (view !== 'day') setSelectedDay(index); }}
                            className={`${isWorkingDay ? 'bg-white' : 'bg-slate-50/80'} border text-center border-slate-100 rounded-xl p-2 relative hover:border-blue-300 transition-all duration-300 ease-in-out flex flex-col ${view === 'day' ? 'min-h-[300px]' : 'min-h-[120px] cursor-pointer hover:shadow-lg hover:-translate-y-0.5'} ${isToday ? 'ring-2 ring-blue-500/20 bg-blue-50/10' : ''}`}
                        >
                            <div className="flex justify-between items-center mb-2 px-1">
                                <span className={`text-[11px] font-black ${isToday ? 'text-blue-600 scale-110' : isWorkingDay ? 'text-slate-400' : 'text-slate-300'}`}>
                                    {date.getDate()} {view === 'day' && date.toLocaleDateString('es-ES', { weekday: 'long' })}
                                </span>
                            </div>

                            <div className="space-y-1 overflow-y-auto flex-1 custom-scrollbar">
                                {activeEvents.slice(0, 3).map(event => (
                                    <div key={event.id} className="text-[8px] px-2 py-1 rounded-md font-bold uppercase truncate border-l-2 text-left bg-orange-50 text-orange-700 border-orange-500 pointer-events-none">
                                        {event.nombre}
                                    </div>
                                ))}
                                {activeTasks.slice(0, 3).map(task => (
                                    <div key={task.id} className={`text-[8px] px-2 py-1 rounded-md font-bold uppercase truncate border-l-2 text-left ${task.priority === 'ASAP' ? 'bg-purple-50 text-purple-700 border-purple-500' : 'bg-blue-50 text-blue-700 border-blue-500'} pointer-events-none`}>
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

            {selectedDay !== null && dayExpanded && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-300" onClick={() => setSelectedDay(null)}>
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xl"></div>
                    <div className="relative w-full max-w-2xl bg-white rounded-[3rem] shadow-2xl shadow-black/20 overflow-hidden flex flex-col animate-in zoom-in-95 slide-in-from-bottom-10 duration-500" onClick={event => event.stopPropagation()}>
                        <div className="px-10 py-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <div className="flex items-center gap-5">
                                <div className="w-16 h-16 bg-white rounded-3xl shadow-xl flex flex-col items-center justify-center border border-slate-100">
                                    <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{dayExpanded.toLocaleDateString('es-ES', { month: 'short' })}</span>
                                    <span className="text-2xl font-black text-slate-900 leading-none">{dayExpanded.getDate()}</span>
                                </div>
                                <div>
                                    <h4 className="text-2xl font-black text-slate-900 uppercase tracking-tight leading-none mb-1">{dayExpanded.toLocaleDateString('es-ES', { weekday: 'long' })}</h4>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                                        {events.filter(event => isEventActiveOnDay(event, dayExpanded)).length} Eventos · {tasks.filter(task => isTaskActiveOnDay(task, dayExpanded) && task.estado !== 'DONE').length} Pendientes
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => setSelectedDay(null)} className="w-12 h-12 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all active:scale-90">
                                <i className="fa-solid fa-xmark text-lg"></i>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-10 space-y-8 custom-scrollbar max-h-[70vh]">
                            <section>
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-8 h-8 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center"><i className="fa-solid fa-calendar-star text-xs"></i></div>
                                    <h5 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Agenda y Eventos</h5>
                                </div>
                                <div className="space-y-3">
                                    {events.filter(event => isEventActiveOnDay(event, dayExpanded)).length === 0 && <p className="text-xs italic text-slate-300">No hay eventos para este día.</p>}
                                    {events.filter(event => isEventActiveOnDay(event, dayExpanded)).map(event => (
                                        <div key={event.id} onClick={() => onEditEvent(event)} className="group bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-md hover:border-orange-200 transition-all cursor-pointer flex items-center gap-6">
                                            <div className="w-1.5 h-12 bg-orange-500 rounded-full"></div>
                                            <div className="flex-1">
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className="text-[10px] font-black text-orange-500 uppercase tracking-tighter">Evento en agenda</span>
                                                    <span className="text-[10px] font-bold text-slate-400">{event.startDate.includes('T') ? new Date(event.startDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase() : 'Todo el día'}</span>
                                                </div>
                                                <h6 className="font-bold text-slate-800 text-lg group-hover:text-orange-600 transition-colors">{event.nombre}</h6>
                                                {event.description && <p className="text-xs text-slate-400 mt-2 line-clamp-2 italic">{event.description}</p>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <section>
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center"><i className="fa-solid fa-list-check text-xs"></i></div>
                                    <h5 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Tareas de Producción</h5>
                                </div>
                                <div className="space-y-3">
                                    {tasks.filter(task => isTaskActiveOnDay(task, dayExpanded) && task.estado !== 'DONE').length === 0 && <p className="text-xs italic text-slate-300">No hay tareas pendientes.</p>}
                                    {tasks.filter(task => isTaskActiveOnDay(task, dayExpanded) && task.estado !== 'DONE').map(task => (
                                        <div key={task.id} onClick={() => onEditTask(task)} className="group bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer flex items-center gap-6">
                                            <div className={`w-1.5 h-12 rounded-full ${task.priority === 'ASAP' ? 'bg-purple-500' : task.priority === 'High' ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                                            <div className="flex-1">
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className={`text-[10px] font-black uppercase tracking-tighter ${task.priority === 'ASAP' ? 'text-purple-500' : 'text-blue-500'}`}>{task.priority} Priority</span>
                                                    <span className="text-[10px] font-bold text-slate-400">{formatDuration(task.duration)} de esfuerzo</span>
                                                </div>
                                                <h6 className="font-bold text-slate-800 text-lg group-hover:text-blue-600 transition-colors uppercase tracking-tight">{task.nombre}</h6>
                                                {task.clientName && <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{task.clientName}</span>}
                                            </div>
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

const AgendaView: React.FC<AgendaViewProps> = ({ onGoToSpaces }) => {
    const { state, dispatch } = useSpaces();
    const activeWorkspace = state.workspaces.find(workspace => workspace.id === state.activeWorkspaceId) || state.workspaces[0];
    const [showEventModal, setShowEventModal] = useState(false);
    const [eventDraft, setEventDraft] = useState({ nombre: '', startDate: '', endDate: '', description: '' } as SpaceEvent | Omit<SpaceEvent, 'id'>);

    const taskLocations = useMemo(
        () => activeWorkspace ? getAllTasks(state).filter(task => task.workspaceId === activeWorkspace.id) : [],
        [state, activeWorkspace]
    );

    const tasks = taskLocations.map(item => item.task);

    const localEvents = useMemo(() => {
        if (!activeWorkspace) return [];

        const collected: SpaceEvent[] = [...(activeWorkspace.agendaEvents || [])];
        activeWorkspace.espacios.forEach(space => {
            space.listas.forEach(list => collected.push(...(list.eventos || [])));
            space.carpetas.forEach(folder => folder.listas.forEach(list => collected.push(...(list.eventos || []))));
        });
        return collected;
    }, [activeWorkspace]);

    const events = useMemo(
        () => [...localEvents, ...(state.gcalEvents || [])],
        [localEvents, state.gcalEvents]
    );

    const findEventLocation = (eventId: string) => {
        if (!activeWorkspace) return null;
        if (activeWorkspace.agendaEvents.some(event => event.id === eventId)) {
            return { scope: 'workspace' as const, workspaceId: activeWorkspace.id };
        }

        for (const space of activeWorkspace.espacios) {
            for (const list of space.listas) {
                if (list.eventos?.some(event => event.id === eventId)) {
                    return { scope: 'list' as const, spaceId: space.id, listId: list.id, folderId: undefined as string | undefined };
                }
            }

            for (const folder of space.carpetas) {
                for (const list of folder.listas) {
                    if (list.eventos?.some(event => event.id === eventId)) {
                        return { scope: 'list' as const, spaceId: space.id, listId: list.id, folderId: folder.id };
                    }
                }
            }
        }

        return null;
    };

    const resetEventDraft = () => setEventDraft({ nombre: '', startDate: '', endDate: '', description: '' });

    const handleOpenTask = (task: SpaceTask) => {
        const location = taskLocations.find(item => item.task.id === task.id);
        if (!location) return;

        dispatch({
            type: 'SET_ACTIVE',
            payload: {
                spaceId: location.spaceId,
                folderId: location.folderId || null,
                listId: location.listId
            }
        });
        onGoToSpaces();
    };

    const handleEditEvent = (event: SpaceEvent) => {
        if (state.gcalEvents.some(gcalEvent => gcalEvent.id === event.id)) {
            alert('Los eventos importados de Google Calendar se editan desde Google Calendar.');
            return;
        }

        setEventDraft({ ...event });
        setShowEventModal(true);
    };

    const handleSaveEvent = () => {
        if (!activeWorkspace || !eventDraft.nombre.trim() || !eventDraft.startDate || !eventDraft.endDate) return;

        if ('id' in eventDraft && eventDraft.id) {
            const location = findEventLocation(eventDraft.id);
            if (!location) return;

            if (location.scope === 'workspace') {
                dispatch({
                    type: 'UPDATE_AGENDA_EVENT',
                    payload: {
                        workspaceId: location.workspaceId,
                        event: { ...eventDraft, nombre: eventDraft.nombre.trim() }
                    }
                });
            } else {
                dispatch({
                    type: 'UPDATE_EVENT',
                    payload: {
                        spaceId: location.spaceId,
                        folderId: location.folderId,
                        listId: location.listId,
                        event: { ...eventDraft, nombre: eventDraft.nombre.trim() }
                    }
                });
            }
        } else {
            dispatch({
                type: 'ADD_AGENDA_EVENT',
                payload: {
                    workspaceId: activeWorkspace.id,
                    event: { ...eventDraft, nombre: eventDraft.nombre.trim() }
                }
            });
        }

        resetEventDraft();
        setShowEventModal(false);
    };

    const handleDeleteEvent = () => {
        if (!activeWorkspace || !('id' in eventDraft) || !eventDraft.id) return;
        const location = findEventLocation(eventDraft.id);
        if (!location) return;

        if (location.scope === 'workspace') {
            dispatch({
                type: 'DELETE_AGENDA_EVENT',
                payload: { workspaceId: location.workspaceId, eventId: eventDraft.id }
            });
        } else {
            dispatch({
                type: 'DELETE_EVENT',
                payload: {
                    spaceId: location.spaceId,
                    folderId: location.folderId,
                    listId: location.listId,
                    eventId: eventDraft.id
                }
            });
        }

        resetEventDraft();
        setShowEventModal(false);
    };

    if (!activeWorkspace) {
        return (
            <div className="h-full bg-white rounded-3xl border border-slate-200 flex items-center justify-center">
                <p className="text-sm font-bold text-slate-400">Crea o selecciona un workspace para usar la agenda.</p>
            </div>
        );
    }

    const overlappingEvent = (() => {
        const start = new Date(eventDraft.startDate || '').getTime();
        const end = new Date(eventDraft.endDate || '').getTime();
        if (!start || !end) return null;

        return events.find(event => {
            if ('id' in eventDraft && eventDraft.id && event.id === eventDraft.id) return false;
            const eventStart = new Date(event.startDate).getTime();
            const eventEnd = new Date(event.endDate).getTime();
            return start < eventEnd && end > eventStart;
        }) || null;
    })();

    return (
        <div className="h-full flex flex-col gap-4">
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm px-6 py-5 flex items-center justify-between">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-500 mb-2">Agenda Global</p>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight">{activeWorkspace.nombre}</h2>
                    <p className="text-sm text-slate-500">Aquí puedes registrar compromisos del workspace sin atarlos a una lista específica.</p>
                </div>
                <button
                    onClick={() => { resetEventDraft(); setShowEventModal(true); }}
                    className="px-5 py-3 rounded-2xl bg-orange-500 text-white font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-orange-600 transition-colors flex items-center gap-2"
                >
                    <i className="fa-solid fa-calendar-plus"></i> Nuevo Evento
                </button>
            </div>

            <div className="flex-1 min-h-0">
                <CalendarViewComponent
                    tasks={tasks}
                    events={events}
                    rules={state.rules}
                    onEditTask={handleOpenTask}
                    onEditEvent={handleEditEvent}
                />
            </div>

            {showEventModal && (
                <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setShowEventModal(false)}>
                    <div onClick={(event) => event.stopPropagation()} className="bg-white w-full max-w-lg rounded-[2.5rem] p-10 space-y-6 shadow-2xl animate-in zoom-in-95">
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-orange-100 rounded-2xl flex items-center justify-center">
                                    <i className="fa-solid fa-calendar-day text-orange-600 text-xl"></i>
                                </div>
                                <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">
                                    {'id' in eventDraft && eventDraft.id ? 'Editar Evento' : 'Nuevo Evento'}
                                </h2>
                            </div>
                            <button type="button" onClick={() => setShowEventModal(false)} className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100">
                                <i className="fa-solid fa-xmark text-xl"></i>
                            </button>
                        </div>

                        <p className="text-xs text-slate-500 -mt-2">
                            Estos eventos viven en la agenda general del workspace y el planificador los respeta como compromisos fijos.
                        </p>

                        <div className="space-y-4">
                            <Input label="Nombre del Evento" value={eventDraft.nombre} onChange={(value: string) => setEventDraft({ ...eventDraft, nombre: value })} />
                            <div className="grid grid-cols-2 gap-4">
                                <Input label="Fecha Inicio" type="datetime-local" value={eventDraft.startDate.slice(0, 16)} onChange={(value: string) => setEventDraft({ ...eventDraft, startDate: value })} />
                                <Input label="Fecha Fin" type="datetime-local" value={eventDraft.endDate.slice(0, 16)} onChange={(value: string) => setEventDraft({ ...eventDraft, endDate: value })} />
                            </div>
                            {overlappingEvent && (
                                <div className="bg-red-50 border border-red-100 p-3 rounded-xl flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-red-100 text-red-500 flex items-center justify-center shrink-0">
                                        <i className="fa-solid fa-triangle-exclamation text-xs"></i>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase text-red-500">Conflicto de Horario</p>
                                        <p className="text-[10px] text-red-400 font-medium">Se solapa con "<span className="font-bold">{overlappingEvent.nombre}</span>"</p>
                                    </div>
                                </div>
                            )}
                            <div className="space-y-1.5">
                                <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Descripción (Opcional)</label>
                                <textarea
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs outline-none resize-none min-h-[80px]"
                                    value={eventDraft.description || ''}
                                    onChange={(event) => setEventDraft({ ...eventDraft, description: event.target.value })}
                                    placeholder="Añade detalles sobre este evento..."
                                />
                            </div>
                        </div>

                        <div className="flex gap-4 pt-4">
                            <button type="button" onClick={() => setShowEventModal(false)} className="flex-1 font-black text-slate-400 uppercase text-[10px]">Cerrar</button>
                            {'id' in eventDraft && eventDraft.id && (
                                <button type="button" onClick={handleDeleteEvent} className="px-6 py-4 bg-red-50 text-red-500 rounded-2xl font-black text-[10px] uppercase hover:bg-red-100 transition-colors">
                                    Eliminar
                                </button>
                            )}
                            <button type="button" onClick={handleSaveEvent} className="flex-1 py-4 bg-orange-500 text-white rounded-2xl font-black text-[10px] uppercase shadow-2xl tracking-widest hover:bg-orange-600 transition-colors">
                                {'id' in eventDraft && eventDraft.id ? 'Guardar Cambios' : 'Crear Evento'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AgendaView;
