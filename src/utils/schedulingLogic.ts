
import { Project, Priority, BusinessRules, ScheduledSlot } from '../types';

export const getSortedSchedulingQueue = (projects: Project[]): Project[] => {
  const workInProgress = projects.filter(p => p.status === 'todo' || p.status === 'active' || p.status === 'proposal');
  const now = new Date();

  return [...workInProgress].sort((a, b) => {
    // 1. REGLA SUPREMA: ASAP (Emergencias reales)
    if (a.priority === Priority.ASAP && b.priority !== Priority.ASAP) return -1;
    if (b.priority === Priority.ASAP && a.priority !== Priority.ASAP) return 1;

    const calculateSlackMs = (p: Project) => {
      const dueDateStr = p.dueDate.includes('T') ? p.dueDate : `${p.dueDate}T23:59:59`;
      const deadline = new Date(dueDateStr).getTime();
      const nowTime = now.getTime();
      const workRemainingMinutes = (p.duration || 0) * ((100 - p.progress) / 100);
      const workRemainingMs = workRemainingMinutes * 60 * 1000;
      return (deadline - nowTime) - workRemainingMs;
    };

    const slackA = calculateSlackMs(a);
    const slackB = calculateSlackMs(b);

    // 2. REGLA DE SUPERVIVENCIA: Hard Deadline Crítico (Margen < 24h)
    const isCriticalHard = (p: Project, slack: number) => p.deadlineType === 'Hard Deadline' && slack < (24 * 60 * 60 * 1000);
    const critA = isCriticalHard(a, slackA);
    const critB = isCriticalHard(b, slackB);

    if (critA && !critB) return -1;
    if (!critA && critB) return 1;
    if (critA && critB) return slackA - slackB;

    // 3. PRIORIDAD POR PESO (High, Medium, Low)
    const priorityWeight = { [Priority.ASAP]: 4, [Priority.HIGH]: 3, [Priority.MEDIUM]: 2, [Priority.LOW]: 1 };
    if (priorityWeight[a.priority] !== priorityWeight[b.priority]) {
      return priorityWeight[b.priority] - priorityWeight[a.priority];
    }

    // 4. DESEMPATE POR RIGIDEZ (Hard Deadline siempre gana a Soft a igual prioridad)
    if (a.deadlineType === 'Hard Deadline' && b.deadlineType !== 'Hard Deadline') return -1;
    if (b.deadlineType === 'Hard Deadline' && a.deadlineType !== 'Hard Deadline') return 1;

    // 5. DESEMPATE POR RIESGO (Menos Slack = Más arriba en la lista)
    if (Math.abs(slackA - slackB) > 1000) { // Margen de 1 segundo para evitar oscilaciones
      return slackA - slackB;
    }

    // 6. ÚLTIMO RECURSO: Fecha de entrega cronológica
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });
};

/**
 * Calcula los minutos de trabajo efectivos entre dos fechas
 */
export const getWorkingMinutesBetween = (start: Date, end: Date, rules: BusinessRules): number => {
  if (start >= end) return 0;
  if (!rules.workingDays || rules.workingDays.length === 0) return 0;

  let totalMinutes = 0;
  let current = new Date(start);
  const [startHour, startMin] = rules.workingHoursStart.split(':').map(Number);
  const [endHour, endMin] = rules.workingHoursEnd.split(':').map(Number);


  let safetyDays = 0;
  while (current < end && safetyDays < 1000) {
    const day = current.getDay();
    if (rules.workingDays.includes(day)) {
      const dayStart = new Date(current);
      dayStart.setHours(startHour, startMin, 0, 0);
      const dayEnd = new Date(current);
      dayEnd.setHours(endHour, endMin, 0, 0);

      const effectiveStart = current > dayStart ? current : dayStart;
      const effectiveEnd = end < dayEnd ? end : dayEnd;

      if (effectiveStart < effectiveEnd) {
        totalMinutes += (effectiveEnd.getTime() - effectiveStart.getTime()) / 60000;
      }
    }
    current.setDate(current.getDate() + 1);
    current.setHours(startHour, startMin, 0, 0);
    safetyDays++;
  }
  return Math.round(totalMinutes);
};

/**
 * Añade minutos de trabajo a una fecha saltando periodos no laborales
 */
export const addWorkingMinutes = (start: Date, minutes: number, rules: BusinessRules): Date => {
  if (!rules.workingDays || rules.workingDays.length === 0) return start;

  let remaining = minutes;
  let current = new Date(start);
  const [startHour, startMin] = rules.workingHoursStart.split(':').map(Number);
  const [endHour, endMin] = rules.workingHoursEnd.split(':').map(Number);

  let safetyDays = 0;
  while (remaining > 0 && safetyDays < 2000) {
    const day = current.getDay();
    if (!rules.workingDays.includes(day)) {
      current.setDate(current.getDate() + 1);
      current.setHours(startHour, startMin, 0, 0);
      safetyDays++;
      continue;
    }

    const dayEnd = new Date(current);
    dayEnd.setHours(endHour, endMin, 0, 0);

    if (current >= dayEnd) {
      current.setDate(current.getDate() + 1);
      current.setHours(startHour, startMin, 0, 0);
      safetyDays++;
      continue;
    }

    const dayStart = new Date(current);
    dayStart.setHours(startHour, startMin, 0, 0);
    if (current < dayStart) {
      current = new Date(dayStart);
    }

    const minutesAvailable = (dayEnd.getTime() - current.getTime()) / 60000;
    if (remaining <= minutesAvailable) {
      return new Date(current.getTime() + remaining * 60000);
    } else {
      remaining -= minutesAvailable;
      current.setDate(current.getDate() + 1);
      current.setHours(startHour, startMin, 0, 0);
      safetyDays++;
    }
  }
  return current;
};

export const getFormattedSlack = (p: Project, rules: BusinessRules): { text: string; isOverdue: boolean } => {
  if (!p.dueDate) return { text: '∞', isOverdue: false };

  // Parse total work needed
  const workRemainingMinutes = (p.duration || 0) * ((100 - p.progress) / 100);

  // Parse deadline correctly
  const dueDateStr = p.dueDate.includes('T') ? p.dueDate : `${p.dueDate}T23:59:59`;
  const deadline = new Date(dueDateStr);
  if (isNaN(deadline.getTime())) return { text: 'Error fecha', isOverdue: true };

  const now = new Date();
  let expectedFinish: Date;

  if (p.endDate && p.autoSchedule) {
    const parsedEnd = new Date(p.endDate);
    if (!isNaN(parsedEnd.getTime())) {
      expectedFinish = parsedEnd;
    } else {
      expectedFinish = addWorkingMinutes(now, workRemainingMinutes, rules);
    }
  } else {
    expectedFinish = addWorkingMinutes(now, workRemainingMinutes, rules);
  }

  // Slack is the WORKING time between expectedFinish and deadline
  let slackMinutes = 0;
  let isOverdue = false;

  if (expectedFinish > deadline) {
    isOverdue = true;
    slackMinutes = getWorkingMinutesBetween(deadline, expectedFinish, rules);
  } else {
    slackMinutes = getWorkingMinutesBetween(expectedFinish, deadline, rules);
  }

  const d = Math.floor(slackMinutes / 1440); // Standard days for display if > 24h of labor
  // But usually we prefer hours/minutes for precision
  const h = Math.floor(slackMinutes / 60);
  const m = Math.round(slackMinutes % 60);

  if (isOverdue) {
    if (h > 24) return { text: `Vencido (${Math.floor(h / 8)}d lab.)`, isOverdue: true };
    return { text: `Vencido (${h}h ${m}m)`, isOverdue: true };
  }

  if (h > 48) return { text: `${Math.floor(h / 8)}d laborales`, isOverdue: false };
  if (h > 0) return { text: `${h}h ${m}m`, isOverdue: false };
  return { text: `${m} min`, isOverdue: false };
};



// Helper para obtener fecha local en string ISO para input datetime-local (YYYY-MM-DDTHH:mm)
const getLocalDateTimeString = (isoString: string): string => {
  if (!isoString) return '';
  const d = new Date(isoString);
  const offset = d.getTimezoneOffset() * 60000;
  // Retorna YYYY-MM-DDTHH:mm
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
};

export const runAutoScheduling = (projects: Project[], rules: BusinessRules, events: { nombre: string, startDate: string, endDate: string }[] = []): Project[] => {
  const sortedQueue = getSortedSchedulingQueue(projects);
  const updatedProjects = [...projects];
  const anchors: { id: string, start: number, end: number, label: string }[] = [];

  // Helper local para parsear fechas respetando la zona horaria del usuario
  const parseLocal = (dateStr: string, endOfDay: boolean = false): number => {
    if (!dateStr) return 0;
    // Normalizar: Cambiar espacio por 'T' para que sea interpretable como ISO local si tiene hora
    const normalized = dateStr.replace(' ', 'T');

    if (normalized.includes('T')) {
      const d = new Date(normalized);
      if (!isNaN(d.getTime())) return d.getTime();
    }

    // Fallback: YYYY-MM-DD
    const parts = normalized.split('T')[0].split('-');
    if (parts.length === 3) {
      const [y, m, d] = parts.map(Number);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
        const date = new Date(y, m - 1, d);
        if (endOfDay) {
          date.setHours(23, 59, 59, 999);
        } else {
          date.setHours(0, 0, 0, 0);
        }
        return date.getTime();
      }
    }

    // Last resort
    const fallback = new Date(dateStr);
    return isNaN(fallback.getTime()) ? 0 : fallback.getTime();
  };

  // 1. ANCLAS PRIMORDIALES: Eventos (Piedras inmovibles)
  events.forEach(e => {
    if (e.startDate && e.endDate) {
      anchors.push({
        id: `event-${e.nombre}-${e.startDate}`,
        start: parseLocal(e.startDate),
        end: parseLocal(e.endDate, true),
        label: `Evento: ${e.nombre}`
      });
    }
  });

  // 2. Registrar anclas de Tareas (bloques manuales o completados)
  projects.forEach(p => {
    if (p.status !== 'completed' && !p.autoSchedule) {
      (p.scheduledSlots || []).forEach(s => anchors.push({
        id: p.id,
        start: parseLocal(s.start),
        end: parseLocal(s.end, true),
        label: `Tarea: ${p.projectName}`
      }));
    }
  });

  let currentTime = new Date(); currentTime.setSeconds(0, 0);
  const [startHour, startMin] = rules.workingHoursStart.split(':').map(Number);
  const [endHour, endMin] = rules.workingHoursEnd.split(':').map(Number);

  for (const project of sortedQueue) {
    const idx = updatedProjects.findIndex(up => up.id === project.id);
    if (idx === -1) continue;

    const elasticity = project.elasticity !== undefined ? project.elasticity : 1;
    const isRigid = elasticity === 0;

    // Plazo de entrega robusto
    const projectDueDate = parseLocal(project.dueDate, true) || Number.MAX_SAFE_INTEGER;

    if (!project.autoSchedule) {
      // --- LÓGICA PARA TAREAS MANUALES: Solo comprobamos solapamientos ---
      let conflictDescription = '';
      const slots = project.scheduledSlots || [];

      for (const slot of slots) {
        const sStart = parseLocal(slot.start);
        const sEnd = parseLocal(slot.end, true);

        // Buscar solapamiento con anclas (excluyendo la propia tarea por ID)
        const overlap = anchors.find(a =>
          a.id !== project.id &&
          sStart < a.end && sEnd > a.start
        );

        if (overlap) {
          conflictDescription = `Solapamiento crítico con "${overlap.label}".`;
          break;
        }

        if (sEnd > projectDueDate) {
          conflictDescription = `El horario manual excede la fecha límite (${project.dueDate || ''}).`;
          break;
        }
      }

      updatedProjects[idx] = {
        ...updatedProjects[idx],
        hasConflict: !!conflictDescription,
        conflictDescription
      };

      if (conflictDescription) {
        console.log(`[Scheduler] MANUAL task conflict: ${project.projectName} -> ${conflictDescription}`);
      }

      // Si no tiene conflicto, registrar sus bloques como anclas para las siguientes tareas "Agua"
      if (!conflictDescription) {
        slots.forEach(s => anchors.push({
          id: project.id,
          start: parseLocal(s.start),
          end: parseLocal(s.end, true),
          label: `Tarea: ${project.projectName}`
        }));
      }
      continue;
    }

    // --- LÓGICA PARA TAREAS AUTOMÁTICAS (AGUA) ---
    const remainingRatio = (100 - project.progress) / 100;
    let remainingMinutes = Math.round(project.duration * remainingRatio);
    if (remainingMinutes <= 0) {
      updatedProjects[idx].scheduledSlots = [];
      continue;
    }

    const slots: ScheduledSlot[] = [];
    let searchPointer = new Date(currentTime);
    if (project.startDate) {
      const constraintStart = parseLocal(project.startDate);
      if (constraintStart > searchPointer.getTime()) searchPointer = new Date(constraintStart);
    }

    // Límites de búsqueda
    const maxSearchTime = searchPointer.getTime() + (1000 * 60 * 60 * 24 * 365);
    const softLimitTime = projectDueDate + (1000 * 60 * 60 * 24 * 90);

    while (remainingMinutes > 0 && searchPointer.getTime() < (project.dueDate ? softLimitTime : maxSearchTime)) {
      const h = searchPointer.getHours(); const m = searchPointer.getMinutes();
      const currentMin = h * 60 + m;
      const workStart = startHour * 60 + startMin;
      const workEnd = endHour * 60 + endMin;

      if (currentMin >= workEnd || !rules.workingDays.includes(searchPointer.getDay())) {
        searchPointer.setDate(searchPointer.getDate() + 1);
        searchPointer.setHours(startHour, startMin, 0, 0);
        continue;
      }
      if (currentMin < workStart) {
        searchPointer.setHours(startHour, startMin, 0, 0);
        continue;
      }

      const pointerTime = searchPointer.getTime();
      // Filtrar anclas que NO sean la propia tarea
      const validAnchors = anchors.filter(a => a.id !== project.id);
      const nextAnchor = validAnchors.filter(a => a.end > pointerTime).sort((a, b) => a.start - b.start)[0];
      let gap = 1440;

      if (nextAnchor) {
        if (nextAnchor.start <= pointerTime) {
          searchPointer = new Date(nextAnchor.end);
          continue;
        }
        gap = Math.floor((nextAnchor.start - pointerTime) / (60 * 1000));
      }

      const endOfWork = new Date(searchPointer);
      endOfWork.setHours(endHour, endMin, 0, 0);
      gap = Math.min(gap, Math.floor((endOfWork.getTime() - searchPointer.getTime()) / (60 * 1000)));

      if (gap >= 15) {
        if (isRigid && gap < remainingMinutes) {
          searchPointer = new Date(searchPointer.getTime() + gap * 60 * 1000 + 1000);
          continue;
        }

        const allocated = Math.min(remainingMinutes, gap);
        const slotEnd = new Date(searchPointer.getTime() + allocated * 60 * 1000);
        slots.push({ id: Math.random().toString(36).substr(2, 9), start: searchPointer.toISOString(), end: slotEnd.toISOString(), isFragment: true });

        // Registrar el avance en anclas para la siguiente tarea
        anchors.push({ id: project.id, start: searchPointer.getTime(), end: slotEnd.getTime(), label: `Tarea: ${project.projectName}` });

        remainingMinutes -= allocated;
        searchPointer = new Date(slotEnd);
      } else {
        searchPointer = new Date(searchPointer.getTime() + gap * 60 * 1000 + 1000);
      }
    }

    const calculatedStart = slots.length > 0 ? getLocalDateTimeString(slots[0].start) : project.startDate;
    const calculatedEnd = slots.length > 0 ? getLocalDateTimeString(slots[slots.length - 1].end) : project.endDate;
    const endAfterDue = slots.length > 0 && new Date(slots[slots.length - 1].end).getTime() > projectDueDate;
    const hasConflict = remainingMinutes > 0 || endAfterDue;

    let conflictDescription = '';
    if (hasConflict) {
      const fmtDate = (d: string | number | Date) => {
        try {
          let date: Date;
          if (d instanceof Date) {
            date = d;
          } else if (typeof d === 'number') {
            date = new Date(d);
          } else {
            const dStr = String(d);
            date = new Date(dStr.includes('T') ? dStr : `${dStr}T23:59`);
          }
          const h = date.getHours();
          const h12 = h % 12 || 12;
          const m = date.getMinutes().toString().padStart(2, '0');
          const ampm = h >= 12 ? 'pm' : 'am';
          return `${date.getDate()}/${(date.getMonth() + 1).toString().padStart(2, '0')}, ${h12}:${m} ${ampm}`;
        } catch { return String(d); }
      };

      const fmtMins = (mins: number) => {
        const h = Math.floor(Math.abs(mins) / 60);
        const m = Math.round(Math.abs(mins) % 60);
        return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
      };

      // Determine: did any other task/event actually block us?
      const blockingAnchors = anchors
        .filter(a => a.id !== project.id)
        .filter(a => {
          // Anchors that overlap with our scheduling window (startDate -> dueDate)
          const taskWindowStart = parseLocal(project.startDate) || currentTime.getTime();
          return a.start < projectDueDate && a.end > taskWindowStart;
        });

      // Calculate pure time window available
      const windowStart = parseLocal(project.startDate) || currentTime.getTime();
      const windowMinutes = getWorkingMinutesBetween(new Date(windowStart), new Date(projectDueDate), rules);
      const effortMinutes = Math.round(project.duration * ((100 - project.progress) / 100));

      let displayStart = new Date(windowStart);
      const startOfDay = new Date(displayStart);
      startOfDay.setHours(startHour, startMin, 0, 0);
      if (displayStart < startOfDay) {
        displayStart = startOfDay;
      }

      if (remainingMinutes > 0) {
        // Could not fit all effort
        if (blockingAnchors.length > 0) {
          const blocker = blockingAnchors[0];
          conflictDescription = `🚫 Bloqueado por "${blocker.label}" (${fmtDate(blocker.start)} → ${fmtDate(blocker.end)}).\n\nEsta tarea necesita ${fmtMins(effortMinutes)} de esfuerzo, pero "${blocker.label}" ocupa parte del tiempo disponible antes del deadline.\n\n💡 Soluciones:\n1. Mueve o acorta "${blocker.label}" para liberar espacio.\n2. Extiende la Fecha Límite de esta tarea.\n3. Reduce las horas de esfuerzo.`;
        } else {
          conflictDescription = `⏱️ Ventana insuficiente: Esta tarea necesita ${fmtMins(effortMinutes)} de esfuerzo, pero tu jornada laboral no tiene suficiente tiempo disponible antes del deadline (${fmtDate(project.dueDate)}).\n\n💡 Soluciones:\n1. Extiende la Fecha Límite.\n2. Reduce las horas de esfuerzo.\n3. Amplía tu horario laboral en Configuración.`;
        }
      } else if (endAfterDue) {
        // All effort fits, but finishes after deadline
        const lastSlotEnd = new Date(slots[slots.length - 1].end);
        const overflowMs = lastSlotEnd.getTime() - projectDueDate;
        const overflowMins = Math.ceil(overflowMs / 60000);

        if (blockingAnchors.length > 0 && effortMinutes <= windowMinutes) {
          // There WAS enough raw time window, but a blocker pushed us out
          const blocker = blockingAnchors.sort((a, b) => b.end - a.end)[0];
          conflictDescription = `🚫 Desplazada por "${blocker.label}" (${fmtDate(blocker.start)} → ${fmtDate(blocker.end)}).\n\nLa tarea terminaría a las ${fmtDate(lastSlotEnd.toISOString())}, excediendo tu deadline por ${fmtMins(overflowMins)}.\n\n💡 Soluciones:\n1. Aumenta la prioridad para que pase antes de "${blocker.label}".\n2. Extiende la Fecha Límite.\n3. Mueve o reduce "${blocker.label}".`;
        } else {
          // Pure math: effort doesn't fit in the window
          if (parseLocal(calculatedStart) > projectDueDate) {
            conflictDescription = `⏳ Límite Vencido: Esta tarea no se completó a tiempo. La IA propone empezarla ahora mismo (${fmtDate(calculatedStart)}), pero supera la Fecha Límite original (${fmtDate(project.dueDate)}).\n\nTerminaría a las ${fmtDate(lastSlotEnd.toISOString())}, retrasada por ${fmtMins(overflowMins)}.\n\n💡 Soluciones:\n1. Extiende la Fecha Límite.\n2. Marca progreso si ya la empezaste.`;
          } else {
            conflictDescription = `⏱️ Margen laboral insuficiente: La tarea requiere ${fmtMins(effortMinutes)} de esfuerzo, pero entre su fecha inicial (${fmtDate(displayStart)}) y su límite (${fmtDate(project.dueDate)}) solo cuentas con ${fmtMins(windowMinutes)} laborales.\n\nTerminaría a las ${fmtDate(lastSlotEnd.toISOString())}, excediendo por ${fmtMins(overflowMins)}.\n\n💡 Soluciones:\n1. Extiende la Fecha Límite.\n2. Reduce el esfuerzo estimado.`;
          }
        }
      }
      console.log(`[Scheduler] AUTO task conflict: ${project.projectName} -> ${conflictDescription}`, { remainingMinutes, endAfterDue });
    }

    updatedProjects[idx] = { ...updatedProjects[idx], scheduledSlots: slots, startDate: calculatedStart, endDate: calculatedEnd, hasConflict, conflictDescription };
  }
  return updatedProjects;
};
