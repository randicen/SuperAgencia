import React, { useState, useEffect, useMemo } from 'react';
import { CalendarEvent, ScheduledTask, Task, WorkWindow } from '../lib/solver';
import { formatMinutesToTime, cn } from '../lib/utils';
import { motion } from 'motion/react';
import { Calendar, Clock, AlertCircle, CalendarDays, Zap, ChevronLeft, ChevronRight } from 'lucide-react';
import { 
  startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, 
  startOfQuarter, endOfQuarter, startOfYear, endOfYear, addDays, addWeeks, 
  addMonths, addQuarters, addYears, subDays, subWeeks, subMonths, subQuarters, 
  subYears, format, differenceInMinutes, addMinutes, eachHourOfInterval, 
  eachDayOfInterval, eachMonthOfInterval, getDaysInMonth
} from 'date-fns';
import { es } from 'date-fns/locale';

interface GanttProps {
  schedule: ScheduledTask[] | null;
  tasks: Task[];
  calendarEvents: CalendarEvent[];
  workWindow: WorkWindow;
  diagnostics?: any;
  baseDate: Date;
}

type ViewMode = 'day' | 'week' | 'month' | 'quarter' | 'year';

export function Gantt({ schedule, tasks, calendarEvents, workWindow, diagnostics, baseDate }: GanttProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [now, setNow] = useState(new Date());
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const timelineRef = React.useRef<HTMLDivElement>(null);
  const prevTaskIdsRef = React.useRef<Set<string>>(new Set(tasks.map(t => t.id)));
  const prevScheduleRef = React.useRef<ScheduledTask[] | null>(schedule);

  // Auto-navigate to newly added or moved tasks
  useEffect(() => {
    const currentIds = new Set(tasks.map(t => t.id));
    const newIds = [...currentIds].filter(id => !prevTaskIdsRef.current.has(id));
    
    let targetScheduledPart: ScheduledTask | undefined;

    if (newIds.length > 0 && schedule) {
      // Find the first newly added task
      const newTask = tasks.find(t => t.id === newIds[0]);
      if (newTask) {
        targetScheduledPart = schedule.find(s => s.id === newTask.id || s.originalId === newTask.id);
      }
    } else if (schedule && prevScheduleRef.current) {
      // Check for moved tasks
      targetScheduledPart = schedule.find(s => {
        const prev = prevScheduleRef.current?.find(p => p.id === s.id);
        return prev && prev.start !== s.start;
      });
    }

    if (targetScheduledPart) {
      const taskStartDate = addMinutes(startOfDay(baseDate), targetScheduledPart.start);
      
      // If the task is outside the current view, change the date
      setCurrentDate(taskStartDate);

      // Auto-scroll horizontally to the task's start time
      setTimeout(() => {
        if (scrollContainerRef.current) {
          // Calculate the percentage of the day/week where the task starts
          let newViewStart = taskStartDate;
          if (viewMode === 'day') newViewStart = startOfDay(taskStartDate);
          else if (viewMode === 'week') newViewStart = startOfWeek(taskStartDate, { weekStartsOn: 1 });
          else if (viewMode === 'month') newViewStart = startOfMonth(taskStartDate);
          else if (viewMode === 'quarter') newViewStart = startOfQuarter(taskStartDate);
          else if (viewMode === 'year') newViewStart = startOfYear(taskStartDate);

          let newViewEnd = taskStartDate;
          if (viewMode === 'day') newViewEnd = endOfDay(taskStartDate);
          else if (viewMode === 'week') newViewEnd = endOfWeek(taskStartDate, { weekStartsOn: 1 });
          else if (viewMode === 'month') newViewEnd = endOfMonth(taskStartDate);
          else if (viewMode === 'quarter') newViewEnd = endOfQuarter(taskStartDate);
          else if (viewMode === 'year') newViewEnd = endOfYear(taskStartDate);

          const totalMins = differenceInMinutes(newViewEnd, newViewStart);
          const taskMins = differenceInMinutes(taskStartDate, newViewStart);
          const percentage = Math.max(0, taskMins / totalMins);

          const container = scrollContainerRef.current;
          const targetScrollLeft = (container.scrollWidth * percentage) - (container.clientWidth / 2);
          
          container.scrollTo({
            left: Math.max(0, targetScrollLeft),
            behavior: 'smooth'
          });
        }
      }, 100);
    }
    
    prevTaskIdsRef.current = currentIds;
    prevScheduleRef.current = schedule;
  }, [tasks, schedule, viewMode, baseDate]);

  // Horizontal scroll with mouse wheel on the timeline area
  useEffect(() => {
    const timeline = timelineRef.current;
    const container = scrollContainerRef.current;
    if (!timeline || !container) return;

    const handleWheel = (e: WheelEvent) => {
      // If the user is holding Shift, the browser already scrolls horizontally.
      if (e.shiftKey) return;
      
      // If it's a pure horizontal scroll (e.g. trackpad), let the browser handle it
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      
      // Prevent vertical scrolling and apply it to horizontal scroll on the main container
      e.preventDefault();
      // Multiply deltaY by a factor to make it feel more responsive
      container.scrollLeft += e.deltaY * 1.5;
    };

    // Use passive: false to allow preventDefault
    timeline.addEventListener('wheel', handleWheel, { passive: false });
    return () => timeline.removeEventListener('wheel', handleWheel);
  }, []);

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Calculate view boundaries based on selected mode and date
  const { viewStart, viewEnd } = useMemo(() => {
    switch(viewMode) {
      case 'day': return { viewStart: startOfDay(currentDate), viewEnd: endOfDay(currentDate) };
      case 'week': return { viewStart: startOfWeek(currentDate, {weekStartsOn: 1}), viewEnd: endOfWeek(currentDate, {weekStartsOn: 1}) };
      case 'month': return { viewStart: startOfMonth(currentDate), viewEnd: endOfMonth(currentDate) };
      case 'quarter': return { viewStart: startOfQuarter(currentDate), viewEnd: endOfQuarter(currentDate) };
      case 'year': return { viewStart: startOfYear(currentDate), viewEnd: endOfYear(currentDate) };
    }
  }, [viewMode, currentDate]);

  const totalViewMinutes = differenceInMinutes(viewEnd, viewStart);
  const currentTimeLeft = (differenceInMinutes(now, viewStart) / totalViewMinutes) * 100;

  // Navigation handlers
  const handlePrev = () => {
    switch(viewMode) {
      case 'day': setCurrentDate(subDays(currentDate, 1)); break;
      case 'week': setCurrentDate(subWeeks(currentDate, 1)); break;
      case 'month': setCurrentDate(subMonths(currentDate, 1)); break;
      case 'quarter': setCurrentDate(subQuarters(currentDate, 1)); break;
      case 'year': setCurrentDate(subYears(currentDate, 1)); break;
    }
  };

  const handleNext = () => {
    switch(viewMode) {
      case 'day': setCurrentDate(addDays(currentDate, 1)); break;
      case 'week': setCurrentDate(addWeeks(currentDate, 1)); break;
      case 'month': setCurrentDate(addMonths(currentDate, 1)); break;
      case 'quarter': setCurrentDate(addQuarters(currentDate, 1)); break;
      case 'year': setCurrentDate(addYears(currentDate, 1)); break;
    }
  };

  const handleToday = () => setCurrentDate(new Date());

  const formatHeaderDate = () => {
    if (viewMode === 'day') return format(currentDate, "EEEE, d 'de' MMMM yyyy", { locale: es });
    if (viewMode === 'week') return `${format(viewStart, "d MMM", { locale: es })} - ${format(viewEnd, "d MMM yyyy", { locale: es })}`;
    if (viewMode === 'month') return format(currentDate, "MMMM yyyy", { locale: es });
    if (viewMode === 'quarter') return `Trimestre ${Math.floor(currentDate.getMonth()/3)+1} ${format(currentDate, "yyyy")}`;
    if (viewMode === 'year') return format(currentDate, "yyyy");
    return '';
  };

  // Generate grid columns based on view mode
  const gridHeaders = useMemo(() => {
    if (viewMode === 'day') {
      const hours = eachHourOfInterval({ start: viewStart, end: viewEnd });
      return hours.map(h => ({ 
        label: format(h, 'h:mm a'), 
        left: (differenceInMinutes(h, viewStart) / totalViewMinutes) * 100,
        width: (60 / totalViewMinutes) * 100
      }));
    }
    if (viewMode === 'week') {
      const days = eachDayOfInterval({ start: viewStart, end: viewEnd });
      return days.map(d => ({ 
        label: format(d, 'EEEE d', { locale: es }), 
        left: (differenceInMinutes(d, viewStart) / totalViewMinutes) * 100, 
        width: (1440 / totalViewMinutes) * 100 
      }));
    }
    if (viewMode === 'month') {
      const days = eachDayOfInterval({ start: viewStart, end: viewEnd });
      return days.map(d => ({ 
        label: format(d, 'd'), 
        left: (differenceInMinutes(d, viewStart) / totalViewMinutes) * 100, 
        width: (1440 / totalViewMinutes) * 100 
      }));
    }
    if (viewMode === 'quarter' || viewMode === 'year') {
      const months = eachMonthOfInterval({ start: viewStart, end: viewEnd });
      return months.map(m => {
        const daysInMonth = getDaysInMonth(m);
        return {
          label: format(m, 'MMM yyyy', { locale: es }),
          left: (differenceInMinutes(m, viewStart) / totalViewMinutes) * 100,
          width: ((daysInMonth * 1440) / totalViewMinutes) * 100
        };
      });
    }
    return [];
  }, [viewMode, viewStart, viewEnd, totalViewMinutes]);

  if (tasks.length === 0 && calendarEvents.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
        <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-6">
          <CalendarDays className="w-10 h-10 text-gray-400" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-3">Tu agenda está vacía</h3>
        <p className="text-gray-500 max-w-md text-base leading-relaxed">
          Usa el chat o la llamada de voz para añadir tareas, reuniones y restricciones. El motor COP organizará todo automáticamente.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-3 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-center bg-white z-30 gap-4 shrink-0">
        <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
          {(['day', 'week', 'month', 'quarter', 'year'] as ViewMode[]).map(mode => (
            <button 
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-md capitalize transition-all", 
                viewMode === mode ? "bg-white text-blue-600 shadow-sm" : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/50"
              )}
            >
              {mode === 'day' ? 'Día' : mode === 'week' ? 'Semana' : mode === 'month' ? 'Mes' : mode === 'quarter' ? 'Trimestre' : 'Año'}
            </button>
          ))}
        </div>
        
        <div className="flex items-center gap-3">
          <button onClick={handlePrev} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-md transition-colors"><ChevronLeft className="w-5 h-5" /></button>
          <button onClick={handleToday} className="px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-md transition-colors">Hoy</button>
          <button onClick={handleNext} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-md transition-colors"><ChevronRight className="w-5 h-5" /></button>
          <div className="w-px h-6 bg-gray-300 mx-2"></div>
          <span className="text-sm font-bold text-gray-800 capitalize min-w-[150px] text-right">
            {formatHeaderDate()}
          </span>
        </div>
      </div>
      
      {/* Body */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-auto force-scrollbar bg-[#F8FAFC] relative flex flex-col"
      >
        {/* Non-blocking Error Banner */}
        {diagnostics && diagnostics.conflicts && Object.keys(diagnostics.conflicts).length > 0 && (
          <div className="sticky top-0 left-0 right-0 z-50 bg-red-50 border-b border-red-200 p-4 flex items-start gap-3 shadow-sm">
            <div className="bg-red-100 p-1.5 rounded-full shrink-0 mt-0.5">
              <AlertCircle className="w-5 h-5 text-red-600" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-bold text-red-900 mb-2">Atención: Conflictos en la agenda</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(diagnostics.conflicts).map(([taskName, conflicts]) => {
                  const isSpecificError = (conflicts as string[]).some(c => 
                    c.includes("horario") || c.includes("excede") || c.includes("límite")
                  );
                  
                  return (
                    <div key={taskName} className="bg-white rounded border border-red-200 p-2.5 text-xs shadow-sm flex flex-col gap-1 min-w-[250px] max-w-sm">
                      <span className="font-semibold text-red-900">{taskName}</span>
                      <span className="text-red-700">
                        {isSpecificError 
                          ? (conflicts as string[])[0] 
                          : `Se superpone con: ${(conflicts as string[]).join(', ')}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-1 min-w-max">
          {/* Y-Axis (Tasks) - Sticky */}
          <div className="w-64 shrink-0 sticky left-0 z-40 bg-white border-r border-gray-200 shadow-[4px_0_12px_rgba(0,0,0,0.03)] flex flex-col">
            <div className="h-12 border-b border-gray-200 bg-gray-50/90 flex items-center px-5 shrink-0 sticky top-0 z-50">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Agenda ({tasks.length + calendarEvents.length})</span>
            </div>
            {calendarEvents.map(event => (
              <div key={event.id} className="h-16 px-5 flex flex-col justify-center border-b border-gray-100 bg-amber-50/50 group hover:bg-amber-50 transition-colors shrink-0 relative">
                <span className="text-sm font-semibold line-clamp-1 transition-colors flex items-center gap-1.5 text-amber-800">
                  <Calendar className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  {event.title}
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex items-center gap-1 text-amber-700">
                    <Clock className="w-3 h-3" />
                    <span className="text-[10px] font-medium">{event.end - event.start}m</span>
                  </div>
                  <span className="text-[9px] bg-amber-100 text-amber-700 px-1 rounded font-bold border border-amber-200 uppercase">{event.kind ?? 'blocked'}</span>
                </div>
              </div>
            ))}
            {tasks.map(task => {
              const hasConflict = diagnostics?.conflicts && diagnostics.conflicts[task.name];
              return (
                <div key={task.id} className={cn("h-16 px-5 flex flex-col justify-center border-b border-gray-100 bg-white group hover:bg-slate-50 transition-colors shrink-0 relative", hasConflict && "bg-red-50/30")}>
                  <span className={cn("text-sm font-semibold line-clamp-1 transition-colors flex items-center gap-1.5", hasConflict ? "text-red-700" : "text-gray-800 group-hover:text-blue-600")}>
                    {hasConflict && <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                    {!hasConflict && task.priority === 'ASAP' && <Zap className="w-3.5 h-3.5 text-purple-500 fill-purple-500 shrink-0" />}
                    {task.name}
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <div className={cn("flex items-center gap-1", hasConflict ? "text-red-500" : "text-gray-500")}>
                      <Clock className="w-3 h-3" />
                      <span className="text-[10px] font-medium">{task.duration}m</span>
                    </div>
                    {task.elastic && <span className="text-[9px] bg-blue-50 text-blue-600 px-1 rounded font-bold border border-blue-100">ELÁSTICA</span>}
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* X-Axis (Timeline) */}
          <div 
            ref={timelineRef}
            className="relative flex flex-col shrink-0"
            style={{ 
              width: viewMode === 'day' ? '2400px' : 
                     viewMode === 'week' ? '1400px' : 
                     viewMode === 'month' ? '1800px' : 
                     viewMode === 'quarter' ? '1200px' : '1200px' 
            }}
          >
            {/* Timeline Header */}
            <div className="h-12 border-b border-gray-200 bg-gray-50/90 sticky top-0 z-30 shrink-0">
              {gridHeaders.map((header, i) => (
                <div 
                  key={i} 
                  className="absolute top-0 bottom-0 border-l border-gray-200 px-2 py-1 flex items-center" 
                  style={{ left: `${header.left}%`, width: `${header.width}%` }}
                >
                  <span className="text-[11px] font-bold text-gray-500 capitalize truncate">{header.label}</span>
                </div>
              ))}
            </div>
            
            {/* Grid Lines & Task Bars Container */}
            <div className="relative flex-1 flex flex-col">
              {/* Background Grid Lines */}
              <div className="absolute inset-0 pointer-events-none z-0">
                {gridHeaders.map((header, i) => (
                  <div key={i} className="absolute top-0 bottom-0 border-l border-dashed border-gray-200" style={{ left: `${header.left}%` }} />
                ))}
                
                {/* Current Time Indicator */}
                {currentTimeLeft >= 0 && currentTimeLeft <= 100 && (
                  <div 
                    className="absolute top-0 bottom-0 border-l-2 border-red-500 z-20"
                    style={{ left: `${currentTimeLeft}%` }}
                  >
                    <div className="absolute -top-1.5 -translate-x-1/2 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-sm shadow-sm whitespace-nowrap">
                      AHORA
                    </div>
                  </div>
                )}
              </div>
              
              {/* Task Rows */}
              {calendarEvents.map((event) => {
                const eventStart = addMinutes(startOfDay(baseDate), event.start);
                const eventEnd = addMinutes(startOfDay(baseDate), event.end);
                if (eventEnd <= viewStart || eventStart >= viewEnd) return null;

                const leftRaw = (differenceInMinutes(eventStart, viewStart) / totalViewMinutes) * 100;
                const widthRaw = (differenceInMinutes(eventEnd, eventStart) / totalViewMinutes) * 100;
                const renderLeft = Math.max(0, leftRaw);
                let renderWidth = widthRaw;
                if (leftRaw < 0) renderWidth += leftRaw;
                renderWidth = Math.min(renderWidth, 100 - renderLeft);

                return (
                  <div key={event.id} className="h-16 border-b border-gray-100 relative w-full shrink-0 bg-amber-50/20">
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3 }}
                      className="absolute top-2 bottom-2 rounded-md bg-gradient-to-r from-amber-400 to-orange-500 shadow-sm flex flex-col justify-center px-2 overflow-hidden border border-white/20 cursor-default z-10"
                      style={{ left: `${renderLeft}%`, width: `${renderWidth}%` }}
                      title={`${event.title}\nInicio: ${format(eventStart, 'dd/MM/yyyy h:mm a')}\nFin: ${format(eventEnd, 'dd/MM/yyyy h:mm a')}`}
                    >
                      <span className="text-[11px] font-semibold text-white truncate drop-shadow-sm flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-white shrink-0" />
                        {event.title}
                      </span>
                    </motion.div>
                  </div>
                );
              })}
              {tasks.map((task) => {
                // Find scheduled parts for this task
                const parts = (schedule || []).filter(s => s.id === task.id || s.originalId === task.id);
                const hasConflict = diagnostics?.conflicts && diagnostics.conflicts[task.name];
                
                return (
                  <div key={task.id} className={cn("h-16 border-b border-gray-100 relative w-full shrink-0 hover:bg-slate-50/50 transition-colors", hasConflict && "bg-red-50/10")}>
                    {parts.map((part) => {
                      // Convert solver minutes (from Day 0) to actual Dates
                      const partStart = addMinutes(startOfDay(baseDate), part.start);
                      const partEnd = addMinutes(startOfDay(baseDate), part.end);
                      
                      // Skip rendering if completely outside the current view
                      if (partEnd <= viewStart || partStart >= viewEnd) return null;

                      const leftRaw = (differenceInMinutes(partStart, viewStart) / totalViewMinutes) * 100;
                      const widthRaw = (differenceInMinutes(partEnd, partStart) / totalViewMinutes) * 100;

                      // Cap values to keep them within the visible container
                      const renderLeft = Math.max(0, leftRaw);
                      let renderWidth = widthRaw;
                      if (leftRaw < 0) renderWidth += leftRaw; // Reduce width by the hidden left part
                      renderWidth = Math.min(renderWidth, 100 - renderLeft); // Cap at the right edge

                      let gradient = "from-blue-500 to-blue-600";
                      if (hasConflict) gradient = "from-red-400 to-red-500 border-red-400";
                      else if (task.priority === 'ASAP') gradient = "from-purple-500 to-purple-600";
                      else if (task.priority === 'high') gradient = "from-rose-500 to-rose-600";
                      else if (task.priority === 'low') gradient = "from-emerald-500 to-emerald-600";

                      return (
                        <motion.div
                          key={part.id}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                          className={`absolute top-2 bottom-2 rounded-md bg-gradient-to-r ${gradient} shadow-sm flex flex-col justify-center px-2 overflow-hidden border border-white/20 cursor-default z-10 hover:shadow-md hover:brightness-110 transition-all ${hasConflict ? 'opacity-80' : ''}`}
                          style={{ left: `${renderLeft}%`, width: `${renderWidth}%` }}
                          title={`${task.name}\nInicio: ${format(partStart, 'dd/MM/yyyy h:mm a')}\nFin: ${format(partEnd, 'dd/MM/yyyy h:mm a')}`}
                        >
                          <span className="text-[11px] font-semibold text-white truncate drop-shadow-sm flex items-center gap-1">
                            {hasConflict && <AlertCircle className="w-3 h-3 text-white shrink-0" />}
                            {!hasConflict && task.priority === 'ASAP' && <Zap className="w-3 h-3 fill-white shrink-0" />}
                            {task.name}
                          </span>
                        </motion.div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
