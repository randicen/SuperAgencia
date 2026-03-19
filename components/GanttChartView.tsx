
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { SpaceTask } from '../spacesTypes';

export type GroupBy = 'estado' | 'prioridad' | 'fecha';
type TimeRange = 'Día' | 'Semana' | 'Mes' | 'Trimestre' | 'Año';

const GanttChartView: React.FC<{
    tasks: SpaceTask[];
    rules: any;
    groupBy: GroupBy;
    onEditTask: (t: SpaceTask) => void;
}> = ({ tasks, rules, groupBy, onEditTask }) => {
    const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});
    const [timeRange, setTimeRange] = useState<TimeRange>('Semana');
    const [showTable, setShowTable] = useState(true);
    const [showClientColumn, setShowClientColumn] = useState(true);
    const [showRangeSelector, setShowRangeSelector] = useState(false);

    const toggleExpand = (taskId: string) => {
        setExpandedTasks(prev => ({ ...prev, [taskId]: !prev[taskId] }));
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // --- TIMELINE CONFIGURATION ENGINE ---
    const config = useMemo(() => {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        let start = new Date(now);
        let end = new Date(now);
        let tickWidth = 50;
        let unit: 'hour' | 'day' | 'week' | 'month' | 'quarter' = 'day';

        switch (timeRange) {
            case 'Día':
                // View: Hours in Day
                start.setDate(now.getDate() - 1); // Start yerterday
                end.setDate(now.getDate() + 3);   // Show 4 days total
                tickWidth = 50;
                unit = 'hour';
                break;
            case 'Semana':
                // View: Days in Week
                const day = now.getDay(); // 0 is Sunday
                const diff = now.getDate() - day + (day === 0 ? -6 : 1);
                start.setDate(diff - 7); // Start last week
                end.setDate(diff + (4 * 7)); // Show 5 weeks
                tickWidth = 60;
                unit = 'day';
                break;
            case 'Mes':
                // View: Weeks in Month
                start.setMonth(now.getMonth() - 1);
                start.setDate(1);
                end.setMonth(now.getMonth() + 6); // Show 7 months
                tickWidth = 100;
                unit = 'week';
                break;
            case 'Trimestre':
                // View: Months in Quarter
                start.setMonth(Math.floor(now.getMonth() / 3) * 3 - 3); // Previous quarter
                start.setDate(1);
                end.setMonth(start.getMonth() + 12); // Show 4 quarters
                tickWidth = 120;
                unit = 'month';
                break;
            case 'Año':
                // View: Quarters in Year
                start.setFullYear(now.getFullYear() - 1);
                start.setMonth(0);
                start.setDate(1);
                end.setFullYear(now.getFullYear() + 4); // Show 5 years
                tickWidth = 150;
                unit = 'quarter';
                break;
        }
        return { start, end, tickWidth, unit };
    }, [timeRange]);

    // --- TICKS GENERATOR (BOTTOM ROW) ---
    const ticks = useMemo(() => {
        const arr: { date: Date; label: string; secondaryLabel?: string; isNow: boolean }[] = [];
        let current = new Date(config.start);
        const nowTime = new Date(); // Real "now" with hours

        // Helper to check if a date range includes "now"
        const isCurrentRange = (rangeStart: Date, rangeEnd: Date) => {
            return nowTime >= rangeStart && nowTime < rangeEnd;
        };

        while (current < config.end) {
            let label = '';
            let secondaryLabel = '';
            let isNow = false;
            let nextStep = new Date(current);

            if (config.unit === 'hour') {
                // Hour: 10a, 11a...
                const hour = current.getHours();
                const ampm = hour >= 12 ? 'p' : 'a';
                const h12 = hour % 12 || 12;
                label = `${h12}${ampm}`;

                nextStep.setHours(current.getHours() + 1);
                // Highlight actual current hour
                if (isCurrentRange(current, nextStep)) isNow = true;

            } else if (config.unit === 'day') {
                // Day: lu 12, ma 13...
                const days = ['do', 'lu', 'ma', 'mi', 'ju', 'vi', 'sá'];
                label = `${days[current.getDay()]} ${current.getDate()}`;

                nextStep.setDate(current.getDate() + 1);
                if (today.getTime() === current.getTime()) isNow = true;

            } else if (config.unit === 'week') {
                // Week: W34 18-24
                // Get ISO week number roughly
                const getWeek = (d: Date) => {
                    const date = new Date(d.getTime());
                    date.setHours(0, 0, 0, 0);
                    // Thursday in current week decides the year.
                    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
                    // January 4 is always in week 1.
                    const week1 = new Date(date.getFullYear(), 0, 4);
                    // Adjust to Thursday in week 1 and count number of weeks from date to week1.
                    return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
                };

                const weekNum = getWeek(current);
                const weekEnd = new Date(current);
                weekEnd.setDate(current.getDate() + 6);

                const d1 = current.getDate();
                const d2 = weekEnd.getDate();

                // If months differ, maybe show month name in label too? 
                // Image simple shows "W3 18-24"
                label = `W${weekNum}`;
                secondaryLabel = `${d1} - ${d2}`;

                nextStep.setDate(current.getDate() + 7);
                if (isCurrentRange(current, nextStep)) isNow = true;

            } else if (config.unit === 'month') {
                // Month: ene., feb.
                label = current.toLocaleDateString('es-ES', { month: 'short' });

                nextStep.setMonth(current.getMonth() + 1);
                if (nowTime.getMonth() === current.getMonth() && nowTime.getFullYear() === current.getFullYear()) isNow = true;

            } else if (config.unit === 'quarter') {
                // Quarter: Q1, Q2
                const q = Math.floor(current.getMonth() / 3) + 1;
                label = `Q${q}`;

                nextStep.setMonth(current.getMonth() + 3);
                const qStart = new Date(current);
                const qEnd = new Date(current);
                qEnd.setMonth(qEnd.getMonth() + 3);
                if (nowTime >= qStart && nowTime < qEnd) isNow = true;
            }

            arr.push({ date: new Date(current), label, secondaryLabel, isNow });
            current = nextStep;
        }
        return arr;
    }, [config, today]);

    // --- GROUPS GENERATOR (TOP ROW) ---
    const groups = useMemo(() => {
        const groupsArr: { label: string; count: number, isCurrent: boolean }[] = [];
        if (ticks.length === 0) return [];

        let currentLabel = '';
        let currentCount = 0;
        let isCurrentGroup = false;

        ticks.forEach((tick) => {
            let label = '';
            let groupIsCurrent = false;
            const tDate = tick.date;

            if (config.unit === 'hour') {
                // Group by Day: "jue., ene. 22"
                label = tDate.toLocaleDateString('es-ES', { weekday: 'short', month: 'short', day: 'numeric' });
                if (tDate.getDate() === today.getDate() && tDate.getMonth() === today.getMonth()) groupIsCurrent = true;

            } else if (config.unit === 'day') {
                // Group by Week: "W3 ene. 18 - 24"
                // Re-calculate week start/end for label
                // Need to find the "Monday" of this week
                const day = tDate.getDay();
                const diff = tDate.getDate() - day + (day === 0 ? -6 : 1);
                const weekStart = new Date(tDate);
                weekStart.setDate(diff);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6);

                // Calculate ISO week
                const getWeek = (d: Date) => {
                    const date = new Date(d.getTime());
                    date.setHours(0, 0, 0, 0);
                    // Thursday in current week decides the year.
                    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
                    // January 4 is always in week 1.
                    const week1 = new Date(date.getFullYear(), 0, 4);
                    // Adjust to Thursday in week 1 and count number of weeks from date to week1.
                    return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
                };

                const wNum = getWeek(weekStart);
                label = `W${wNum} ${weekStart.toLocaleDateString('es-ES', { month: 'short' })} ${weekStart.getDate()} - ${weekEnd.getDate()}`;

                const now = new Date();
                const nowWeekStart = new Date(now);
                const nowDay = now.getDay();
                nowWeekStart.setDate(now.getDate() - nowDay + (nowDay === 0 ? -6 : 1));
                if (weekStart.toDateString() === nowWeekStart.toDateString()) groupIsCurrent = true;

            } else if (config.unit === 'week') {
                // Group by Month: "2025 ene."
                label = tDate.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' });
                // Note: Weeks often cross months. We group by the month of the START of the week usually or just the month
                // Simple logic: Change group when month changes.
                const now = new Date();
                if (tDate.getMonth() === now.getMonth() && tDate.getFullYear() === now.getFullYear()) groupIsCurrent = true;

            } else if (config.unit === 'month') {
                // Group by Quarter: "2025 Q1"
                const q = Math.floor(tDate.getMonth() / 3) + 1;
                label = `${tDate.getFullYear()} Q${q}`;

                const now = new Date();
                const currentQ = Math.floor(now.getMonth() / 3) + 1;
                if (tDate.getFullYear() === now.getFullYear() && q === currentQ) groupIsCurrent = true;

            } else if (config.unit === 'quarter') {
                // Group by Year: "2025"
                label = tDate.getFullYear().toString();
                if (tDate.getFullYear() === new Date().getFullYear()) groupIsCurrent = true;
            }

            if (label !== currentLabel) {
                if (currentLabel) groupsArr.push({ label: currentLabel, count: currentCount, isCurrent: isCurrentGroup });
                currentLabel = label;
                currentCount = 1;
                isCurrentGroup = groupIsCurrent;
            } else {
                currentCount++;
                // If any tick in the group is 'current' (or aligns with logic), usually the group is current
                // But generally check start matches logic.
                // For simplicity, isCurrentGroup will be true if the FIRST tick triggered it, or we rely on tick props
                if (groupIsCurrent) isCurrentGroup = true;
            }
        });
        if (currentLabel) groupsArr.push({ label: currentLabel, count: currentCount, isCurrent: isCurrentGroup });

        return groupsArr;
    }, [ticks, config.unit, today]);

    // --- POSITION CALCULATOR ---
    const getPosition = (startDateStr: string, endDateStr: string) => {
        if (!startDateStr) return null;

        // Parse dates correctly, handling both YYYY-MM-DD and ISO strings
        const start = new Date(startDateStr);
        if (isNaN(start.getTime())) return null;

        let end = new Date(start);
        if (endDateStr) {
            const parsedEnd = new Date(endDateStr);
            if (!isNaN(parsedEnd.getTime())) {
                end = parsedEnd;
                // If end date is purely a date (no time component check roughly), maybe we want inclusive day?
                // But for now, trust the value. If it's YYYY-MM-DD, end is 00:00 of that day. 
                // If it was meant to be inclusive end of day, it should have been T23:59.
                // However, legacy data might be YYYY-MM-DD meaning "all day".
                // If length is 10, add 1 day to make it visually span the day
                if (endDateStr.length === 10) {
                    end.setDate(end.getDate() + 1);
                }
            }
        } else {
            // Default 1 hour for 'Día' view, 1 day for others?
            if (config.unit === 'hour') end.setHours(end.getHours() + 1);
            else end.setDate(end.getDate() + 1);
        }

        const msPerPixel = (() => {
            const msPerTickUnit = {
                'hour': 3600000,
                'day': 86400000,
                'week': 604800000,
                'month': 2629800000, // Approx
                'quarter': 7889400000 // Approx
            }[config.unit];
            return msPerTickUnit / config.tickWidth;
        })();

        const timelineStartMs = config.start.getTime();
        const startMs = start.getTime();
        const endMs = end.getTime();

        // Calculate raw pixels relative to start
        const left = (startMs - timelineStartMs) / msPerPixel;
        const width = (endMs - startMs) / msPerPixel;

        // Clip logic 
        const totalWidth = ticks.length * config.tickWidth;
        if (left + width < 0 || left > totalWidth) return null;

        return { left, width };
    };

    const renderTaskRow = (task: SpaceTask, level: number = 0): React.ReactNode => {
        const hasSubtasks = task.subtasks && task.subtasks.length > 0;
        const isExpanded = expandedTasks[task.id];
        const pos = getPosition(task.startDate, task.endDate || task.dueDate);

        const barColor = task.estado === 'DONE' ? 'bg-emerald-400' :
            task.priority === 'ASAP' ? 'bg-purple-400' :
                task.priority === 'High' ? 'bg-red-400' :
                    task.priority === 'Medium' ? 'bg-orange-400' : 'bg-blue-400';

        return (
            <React.Fragment key={task.id}>
                <div className="flex border-b border-slate-50 hover:bg-slate-50/50 transition-colors w-fit group">
                    {/* LEFT PANE - CLIENT & TASK NAMES */}
                    {showTable && (
                        <>
                            {showClientColumn && (
                                <div 
                                    className="w-48 shrink-0 p-2 border-r border-slate-100 bg-white sticky left-0 z-20 flex items-center shadow-[2px_0_8px_-4px_rgba(0,0,0,0.08)]"
                                    onClick={() => onEditTask(task)}
                                >
                                    <span className="text-[10px] font-black uppercase text-slate-400 truncate px-2">
                                        {task.clientName || '-'}
                                    </span>
                                </div>
                            )}
                            <div
                                className={`w-64 shrink-0 p-2 border-r border-slate-100 bg-white sticky z-20 flex items-center gap-2 shadow-[2px_0_8px_-4px_rgba(0,0,0,0.08)] ${showClientColumn ? 'left-[192px]' : 'left-0'}`}
                                style={{ paddingLeft: (level * 16) + 8 }}
                            >
                                {hasSubtasks ? (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); toggleExpand(task.id); }}
                                        className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                                    >
                                        <i className={`fa-solid fa-chevron-${isExpanded ? 'down' : 'right'} text-[9px]`}></i>
                                    </button>
                                ) : (
                                    <div className="w-4"></div>
                                )}
                                <div className={`w-2 h-2 rounded-full ${barColor.replace('bg-', 'bg-opacity-20 ')} border ${barColor.replace('bg-', 'border-').replace('400', '600')}`}></div>
                                <span className="text-[11px] font-medium text-slate-700 truncate cursor-pointer hover:text-blue-600 flex items-center gap-1" title={task.nombre} onClick={() => onEditTask(task)}>
                                    {task.hasConflict && <i className="fa-solid fa-triangle-exclamation text-red-500 text-[9px]" title="Conflicto de agenda"></i>}
                                    {task.nombre}
                                </span>
                            </div>
                        </>
                    )}

                    {/* RIGHT PANE - TIMELINE BARS */}
                    <div className="relative h-9 flex items-center bg-white" style={{ width: ticks.length * config.tickWidth }}>
                        {/* Show "Now" Line if visible */}
                        {/* We can calculate the 'now' position same as tasks */}
                        {(() => {
                            const nowPos = getPosition(new Date().toISOString().split('T')[0], null); // Pass date string roughly?
                            // Better to manually calc pixel for "Now" exact time
                            const nowMs = new Date().getTime();
                            const startMs = config.start.getTime();
                            const msPerTickUnit = { 'hour': 3600000, 'day': 86400000, 'week': 604800000, 'month': 2629800000, 'quarter': 7889400000 }[config.unit];
                            const msPerPx = msPerTickUnit / config.tickWidth;
                            const left = (nowMs - startMs) / msPerPx;

                            if (left >= 0 && left <= ticks.length * config.tickWidth) {
                                return <div className="absolute top-0 bottom-0 w-px bg-red-400 z-10 pointer-events-none" style={{ left }}>
                                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 -ml-[2px] -mt-[1px]"></div>
                                </div>
                            }
                            return null;
                        })()}

                        {/* Grid Lines */}
                        {ticks.map((t, i) => {
                            const isWeekend = !rules.workingDays.includes(t.date.getDay());
                            const [startH, startM] = rules.workingHoursStart.split(':').map(Number);
                            const [endH, endM] = rules.workingHoursEnd.split(':').map(Number);
                            const hour = t.date.getHours();
                            const isOffHours = config.unit === 'hour' && (hour < startH || hour >= endH);
                            const isOffPeriod = config.unit === 'day' ? isWeekend : (config.unit === 'hour' ? (isWeekend || isOffHours) : false);

                            return (
                                <div key={i} style={{ width: config.tickWidth, minWidth: config.tickWidth }}
                                    className={`h-full border-r border-slate-50 ${t.isNow ? 'bg-blue-50/20' : (isOffPeriod ? 'bg-slate-50/50' : '')}`}>
                                </div>
                            );
                        })}

                        {/* Task Bar */}
                        {pos && (
                            <div
                                onClick={() => onEditTask(task)}
                                className={`absolute h-5 rounded-md shadow-sm cursor-pointer transition-all hover:scale-[1.01] hover:shadow-md z-10 ${barColor} flex items-center overflow-visible group/bar`}
                                style={{
                                    left: pos.left + 2,
                                    width: Math.max(pos.width - 4, 16),
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    opacity: task.estado === 'DONE' ? 0.6 : 1
                                }}
                            >
                                {pos.width > 30 && (
                                    <span className="px-2 text-[8px] font-bold text-white whitespace-nowrap overflow-hidden text-ellipsis shadow-sm opacity-90">
                                        {task.progress}%
                                    </span>
                                )}

                                {/* Label when table is hidden */}
                                {!showTable && (
                                    <span
                                        className="absolute left-[102%] top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-600 whitespace-nowrap px-1 z-20 pointer-events-none opacity-0 group-hover/bar:opacity-100 transition-opacity bg-white/80 rounded px-1 backdrop-blur-sm"
                                        style={{ textShadow: '0 1px 2px rgba(255,255,255,0.8)' }}
                                    >
                                        {task.nombre}
                                    </span>
                                )}
                            </div>
                        )}

                        {!showTable && pos && (
                            <span
                                className="absolute text-[10px] font-medium text-slate-500 whitespace-nowrap px-1 z-20 pointer-events-none"
                                style={{
                                    left: pos.left + pos.width + 4,
                                    top: '50%',
                                    transform: 'translateY(-50%)'
                                }}
                            >
                                {task.nombre}
                            </span>
                        )}

                    </div>
                </div>

                {hasSubtasks && isExpanded && (
                    task.subtasks!.map(st => renderTaskRow(st, level + 1))
                )}
            </React.Fragment>
        );
    };

    // --- ZOOM & SCROLL HANDLER ---
    const ZOOM_LEVELS: TimeRange[] = ['Día', 'Semana', 'Mes', 'Trimestre', 'Año'];
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const onWheel = (e: WheelEvent) => {
            // Check if we are hovering the Gantt chart (visual safety)
            // But this listener is attached to the specific div, so efficient enough.

            if (e.ctrlKey || e.metaKey) {
                // ZOOM MODE
                e.preventDefault();

                // Throttle slightly or just react? 
                // Simple reaction is fine for now, state update might be slow though.
                // React batching handles it usually.

                const currentIndex = ZOOM_LEVELS.indexOf(timeRange);
                if (e.deltaY < 0) {
                    // Zoom In
                    if (currentIndex > 0) setTimeRange(ZOOM_LEVELS[currentIndex - 1]);
                } else {
                    // Zoom Out
                    if (currentIndex < ZOOM_LEVELS.length - 1) setTimeRange(ZOOM_LEVELS[currentIndex + 1]);
                }
            } else {
                // HORIZONTAL SCROLL MODE (Convert Vertical Scroll to Horizontal)
                if (e.deltaY !== 0) {
                    e.preventDefault();
                    container.scrollLeft += e.deltaY;
                }
            }
        };

        // Important: passive: false is required to use preventDefault
        container.addEventListener('wheel', onWheel, { passive: false });

        return () => {
            container.removeEventListener('wheel', onWheel);
        };
    }, [timeRange]); // Re-bind if timeRange changes to ensure we have fresh state closure if needed, though setState doesn't need it.
    // Actually setTimeRange uses closure ? No, state setter is stable. 
    // But `timeRange` value IS needed inside checking indexes. Yes.


    return (
        <div className="flex flex-col h-full gap-3">
            {/* GANTT TOOLBAR */}
            <div className="flex items-center justify-between px-1">
                <div className="flex gap-2 relative">
                    <button
                        onClick={() => setShowTable(!showTable)}
                        className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${!showTable ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600'}`}
                        title={showTable ? 'Ocultar tabla lateral' : 'Mostrar tabla lateral'}
                    >
                        <i className={`fa-solid fa-${showTable ? 'table' : 'table-columns'}`}></i>
                    </button>

                    {showTable && (
                        <button
                            onClick={() => setShowClientColumn(!showClientColumn)}
                            className={`px-3 h-8 rounded-lg border flex items-center gap-2 transition-colors text-[10px] font-black uppercase tracking-widest ${showClientColumn ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600'}`}
                            title={showClientColumn ? 'Ocultar columna cliente' : 'Mostrar columna cliente'}
                        >
                            <i className="fa-solid fa-user-tie"></i>
                            <span>Cliente</span>
                        </button>
                    )}

                    <div className="relative">
                        <button
                            onClick={() => setShowRangeSelector(!showRangeSelector)}
                            className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-2 shadow-sm"
                            title="Ctrl + Rueda para Zoom"
                        >
                            <span>{timeRange}</span>
                            <i className="fa-solid fa-chevron-down text-[10px] text-slate-400"></i>
                        </button>

                        {showRangeSelector && (
                            <div className="absolute top-10 left-0 bg-white border border-slate-200 rounded-xl shadow-xl py-2 z-50 min-w-[140px] animate-in slide-in-from-top-2 flex flex-col">
                                <span className="px-3 py-1.5 text-[9px] font-black uppercase text-slate-400 tracking-widest border-b border-slate-50 mb-1">Periodo de tiempo</span>
                                {ZOOM_LEVELS.map((r) => (
                                    <button
                                        key={r}
                                        onClick={() => { setTimeRange(r as TimeRange); setShowRangeSelector(false); }}
                                        className={`px-3 py-2 text-left text-xs font-bold hover:bg-slate-50 flex justify-between items-center ${timeRange === r ? 'text-blue-600 bg-blue-50/50' : 'text-slate-600'}`}
                                    >
                                        {r}
                                        {timeRange === r && <i className="fa-solid fa-check text-[10px]"></i>}
                                    </button>
                                ))}
                            </div>
                        )}
                        {showRangeSelector && <div className="fixed inset-0 z-40" onClick={() => setShowRangeSelector(false)}></div>}
                    </div>
                </div>
            </div>

            <div
                ref={scrollContainerRef}
                className="overflow-x-auto custom-scrollbar bg-white rounded-xl border border-slate-200 shadow-sm flex-1"
            >
                <div className="min-w-max">
                    {/* HEADER GROUP (Sticky) */}
                    <div className="sticky top-0 z-30 bg-slate-50 shadow-sm border-b border-slate-200">
                        {/* ROW 1: GROUPS (Years / Months) */}
                        <div className="flex">
                            {showTable && (
                                <>
                                    {showClientColumn && <div className="w-48 shrink-0 bg-slate-50 border-r border-slate-200"></div>}
                                    <div className="w-64 shrink-0 bg-slate-50 border-r border-slate-200"></div>
                                </>
                            )}
                            <div className="flex border-b border-slate-200/50">
                                {groups.map((group, idx) => (
                                    <div
                                        key={idx}
                                        className={`h-6 px-2 flex items-center text-[10px] font-bold uppercase tracking-wider border-r border-slate-200/50 ${group.isCurrent ? 'text-blue-600 bg-blue-50/50' : 'text-slate-500 bg-slate-100/50'}`}
                                        style={{ width: group.count * config.tickWidth }}
                                    >
                                        <span className="truncate">{group.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* ROW 2: TICKS (Days / Weeks / etc) */}
                        <div className="flex">
                            {showTable && (
                                <>
                                    {showClientColumn && (
                                        <div className="w-48 shrink-0 px-4 h-8 flex items-center justify-between text-[10px] font-black text-slate-500 uppercase border-r border-slate-200 bg-slate-50 sticky left-0 z-40 shadow-[4px_0_12px_-6px_rgba(0,0,0,0.1)]">
                                            <span>Cliente</span>
                                        </div>
                                    )}
                                    <div className={`w-64 shrink-0 px-4 h-8 flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase border-r border-slate-200 bg-slate-50 sticky z-40 shadow-[4px_0_12px_-6px_rgba(0,0,0,0.1)] ${showClientColumn ? 'left-[192px]' : 'left-0'}`}>
                                        <span>Tarea</span>
                                        <i className="fa-solid fa-sort text-slate-300"></i>
                                    </div>
                                </>
                            )}
                            <div className="flex">
                                {ticks.map((t, i) => (
                                    <div
                                        key={i}
                                        style={{ width: config.tickWidth, minWidth: config.tickWidth }}
                                        className={`h-8 flex flex-col justify-center items-center border-r border-slate-200/50 text-[10px] ${t.isNow ? 'bg-blue-100/50 text-blue-700 font-bold' : 'text-slate-500 font-medium'}`}
                                    >
                                        <span>{t.label}</span>
                                        {t.secondaryLabel && <span className="text-[8px] text-slate-400 font-normal -mt-0.5">{t.secondaryLabel}</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* TASKS BODY */}
                    <div className="bg-white pb-10">
                        {tasks.length > 0 ? (
                            tasks.map(task => renderTaskRow(task, 0))
                        ) : (
                            <div className="p-10 text-center text-slate-400 text-xs italic">
                                No hay tareas para este periodo
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
export default GanttChartView;
