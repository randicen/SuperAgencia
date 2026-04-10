export interface WorkWindow {
  startHour: number; // 0-24
  endHour: number; // 0-24
  workDays: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
}

export interface Task {
  id: string;
  name: string;
  duration: number; // minutes
  fixedStart?: number; // absolute minutes from reference (Day 0, 00:00)
  minStart?: number; // absolute minutes
  deadline?: number; // absolute minutes
  priority?: 'ASAP' | 'high' | 'medium' | 'low';
  elastic?: boolean;
  minChunkSize?: number; // minutes
  originalId?: string; // used internally for chunking
  progress?: number; // 0-100
  deadlineType?: 'Hard Deadline' | 'Soft Deadline';
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: number; // absolute minutes
  end: number; // absolute minutes
  kind?: 'meeting' | 'personal' | 'focus' | 'blocked';
  sourceProvider?: 'google' | 'outlook' | 'manual';
  externalEventId?: string;
}

export interface Dependency {
  fromId: string;
  toId: string;
}

export interface ScheduledTask extends Task {
  start: number; // absolute minutes
  end: number; // absolute minutes
}

export interface SolveResult {
  schedule: ScheduledTask[] | null;
  score: number;
  diagnostics?: {
    error: string;
    conflicts: Record<string, string[]>;
    status: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'TIMEOUT' | 'INVALID_INPUT';
  };
}

function getSlack(t: Task, now: number): number {
  if (t.deadline === undefined) return Infinity;
  const progress = t.progress || 0;
  const workRemaining = t.duration * ((100 - progress) / 100);
  return (t.deadline - now) - workRemaining;
}

function getPriorityWeight(p?: string): number {
  if (p === 'ASAP') return 4;
  if (p === 'high') return 3;
  if (p === 'medium') return 2;
  if (p === 'low') return 1;
  return 0;
}

function compareSuperAgencia(a: Task, b: Task, now: number): number {
  const slackA = getSlack(a, now);
  const slackB = getSlack(b, now);

  // 1. ASAP
  const isAsapA = a.priority === 'ASAP';
  const isAsapB = b.priority === 'ASAP';
  if (isAsapA && !isAsapB) return -1;
  if (!isAsapA && isAsapB) return 1;

  // 2. Hard Deadline crítico (slack < 24h = 1440 mins)
  const isCritA = a.deadlineType === 'Hard Deadline' && slackA < 1440;
  const isCritB = b.deadlineType === 'Hard Deadline' && slackB < 1440;
  if (isCritA && !isCritB) return -1;
  if (!isCritA && isCritB) return 1;
  if (isCritA && isCritB) {
    if (slackA !== slackB) return slackA - slackB;
  }

  // 3. Peso de prioridad
  const wA = getPriorityWeight(a.priority);
  const wB = getPriorityWeight(b.priority);
  if (wA !== wB) return wB - wA;

  // 4. Rigidez del deadline
  const isHardA = a.deadlineType === 'Hard Deadline';
  const isHardB = b.deadlineType === 'Hard Deadline';
  if (isHardA && !isHardB) return -1;
  if (!isHardA && isHardB) return 1;

  // 5. Menor slack (margen de 1 min para evitar oscilaciones tontas)
  if (Math.abs(slackA - slackB) > 1) {
    return slackA - slackB;
  }

  // 6. Due date más temprana
  const deadA = a.deadline ?? Infinity;
  const deadB = b.deadline ?? Infinity;
  return deadA - deadB;
}

export interface IntelligentStrategyConfig {
  energyPenaltyHighPriorityAfternoon: number;
  energyPenaltyLowPriorityMorning: number;
  adjacencyBonus: number;
  criticalSlackThreshold: number;
}

export const DEFAULT_INTELLIGENT_CONFIG: IntelligentStrategyConfig = {
  energyPenaltyHighPriorityAfternoon: 120, // +2 horas virtuales
  energyPenaltyLowPriorityMorning: 60,   // +1 hora virtual
  adjacencyBonus: 45,                    // -45 mins virtuales
  criticalSlackThreshold: 1440,          // 24 horas
};

export function solveSchedule(
  tasks: Task[],
  dependencies: Dependency[],
  calendarEvents: CalendarEvent[],
  workWindow: WorkWindow,
  strategy: 'balanced' | 'survival' | 'intelligent' = 'intelligent',
  nowMinutes: number = 0,
  horizonDays: number = 7,
  step: number = 15, // 15-minute intervals
  previousSchedule?: ScheduledTask[], // For disruption minimization
  intelligentConfig: IntelligentStrategyConfig = DEFAULT_INTELLIGENT_CONFIG,
  referenceDayOfWeek: number = new Date().getDay()
): SolveResult {
  if (tasks.length === 0) return { schedule: [], score: 0, diagnostics: { error: '', conflicts: {}, status: 'OPTIMAL' } };

  // 0. Domain Contracts & Input Validation
  for (const t of tasks) {
    if (t.duration <= 0) {
      return { schedule: null, score: -Infinity, diagnostics: { error: `Invalid task duration for '${t.name}': ${t.duration} mins. Duration must be > 0.`, conflicts: {}, status: 'INVALID_INPUT' } };
    }
    if (t.duration % step !== 0 && !t.elastic) {
      // We could strictly reject, but for now we just warn or let it be handled by the step logic.
      // Actually, strict domain contract: duration should ideally be a multiple of step, but we'll enforce > 0 as the critical one.
    }
  }

  for (const event of calendarEvents) {
    if (event.end <= event.start) {
      return {
        schedule: null,
        score: -Infinity,
        diagnostics: {
          error: `Invalid calendar event for '${event.title}': end must be greater than start.`,
          conflicts: {},
          status: 'INVALID_INPUT',
        },
      };
    }
  }

  // 1. Pre-processing: Chunking (Elasticity)
  const processedTasks: Task[] = [];
  const processedDeps: Dependency[] = [...dependencies];

  for (const t of tasks) {
    if (t.elastic && t.minChunkSize && t.duration > t.minChunkSize) {
      let remaining = t.duration;
      let partIdx = 1;
      let prevId: string | null = null;
      while (remaining > 0) {
        const chunkDur = Math.min(remaining, t.minChunkSize);
        const chunkId = `${t.id}_part${partIdx}`;
        processedTasks.push({ 
          ...t, 
          id: chunkId, 
          name: `${t.name} (P${partIdx})`, 
          duration: chunkDur, 
          originalId: t.id 
        });
        if (prevId) {
          processedDeps.push({ fromId: prevId, toId: chunkId });
        }
        prevId = chunkId;
        remaining -= chunkDur;
        partIdx++;
      }
    } else {
      processedTasks.push(t);
    }
  }

  // 2. Generación de Dominios (Multi-día)
  const initialDomains = new Map<string, number[]>();
  const todayDayOfWeek = referenceDayOfWeek;
  
  for (const task of processedTasks) {
    const validStarts: number[] = [];
    
    if (task.fixedStart !== undefined) {
      // CRITICAL FIX: Enforce workWindow even for fixedStart tasks
      const startDay = Math.floor(task.fixedStart / 1440);
      const currentDayOfWeek = (todayDayOfWeek + startDay) % 7;
      const dayStartMin = startDay * 1440 + workWindow.startHour * 60;
      const dayEndMin = startDay * 1440 + workWindow.endHour * 60;
      const end = task.fixedStart + task.duration;

      if (workWindow.workDays.includes(currentDayOfWeek) && 
          task.fixedStart >= dayStartMin && 
          end <= dayEndMin) {
        validStarts.push(task.fixedStart);
      }
    } else {
      const startMin = task.minStart !== undefined ? task.minStart : 0;
      const isHardDeadline = task.deadlineType !== 'Soft Deadline';
      const limit = (task.deadline !== undefined && isHardDeadline) ? task.deadline - task.duration : horizonDays * 1440 - task.duration;

      for (let day = 0; day < horizonDays; day++) {
        // Check if this day is a work day
        const currentDayOfWeek = (todayDayOfWeek + day) % 7;
        if (!workWindow.workDays.includes(currentDayOfWeek)) continue;

        const dayStartMin = day * 1440 + workWindow.startHour * 60;
        const dayEndMin = day * 1440 + workWindow.endHour * 60;

        // CRITICAL: Prevent Time Travel. Start must be >= nowMinutes
        const effectiveStart = Math.max(startMin, dayStartMin, nowMinutes);
        const effectiveEnd = Math.min(limit, dayEndMin - task.duration);

        for (let t = effectiveStart; t <= effectiveEnd; t += step) {
          validStarts.push(t);
        }
      }
    }

    const availableStarts = validStarts.filter((candidateStart) => {
      const candidateEnd = candidateStart + task.duration;
      return !calendarEvents.some((event) => candidateStart < event.end && candidateEnd > event.start);
    });

    if (availableStarts.length === 0) {
      let reason = "Fuera del horario laboral configurado.";
      const workWindowDuration = (workWindow.endHour - workWindow.startHour) * 60;
      
      if (task.duration > workWindowDuration) {
        reason = "La duración de la tarea excede la ventana laboral diaria.";
      } else if (task.deadline !== undefined && task.deadlineType !== 'Soft Deadline') {
        if (task.deadline <= nowMinutes) {
          reason = "El límite de tiempo (deadline) ya ha pasado.";
        } else {
          reason = "No hay tiempo suficiente en el horario laboral antes del límite.";
        }
      }

      return { 
        schedule: null, 
        score: -Infinity, 
        diagnostics: { error: "Infeasible Constraints", conflicts: { [task.name]: [reason] }, status: 'INFEASIBLE' } 
      };
    }
    initialDomains.set(task.id, availableStarts);
  }

  // 3. COP: Branch and Bound Variables
  let bestScore = -Infinity;
  let bestSchedule: ScheduledTask[] | null = null;
  const startTimeMs = Date.now();
  const TIME_LIMIT_MS = 1000; // 1 second max search time
  let searchStatus: 'OPTIMAL' | 'FEASIBLE' | 'TIMEOUT' | 'INFEASIBLE' = 'OPTIMAL';
  const conflictLog: Record<string, Set<string>> = {};

  function calculateScore(schedule: ScheduledTask[]): number {
    let score = 0;
    
    // Weights
    const W_LATENESS = 1.0;
    const W_PRIORITY = 2.0;
    const W_FRAGMENTATION = 50.0;
    const W_DISRUPTION = 100.0; // High penalty for moving existing tasks

    for (const t of schedule) {
      // 1. Lateness / Compactness (prefer earlier starts)
      score -= (t.start * W_LATENESS); 
      
      // 2. Priority weighting (ASAP and High priorities get stronger pull to the left)
      if (t.priority === 'ASAP') score -= (t.start * W_PRIORITY * 4);
      if (t.priority === 'high') score -= (t.start * W_PRIORITY * 2);
      if (t.priority === 'low') score += (t.start * W_PRIORITY * 0.5);

      // 3. Fragmentation Penalty (Reward contiguous chunks)
      if (t.originalId) {
        const prevChunk = schedule.find(s => s.originalId === t.originalId && s.end === t.start);
        if (prevChunk) score += W_FRAGMENTATION; 
      }

      // 4. Disruption Minimization (Stability)
      if (previousSchedule) {
        const prevTask = previousSchedule.find(s => s.id === t.id);
        if (prevTask) {
          // Penalize deviation from previous schedule
          const deviation = Math.abs(t.start - prevTask.start);
          score -= (deviation * W_DISRUPTION);
        }
      }

      // 5. Soft Deadline Penalty
      if (t.deadline !== undefined && t.deadlineType === 'Soft Deadline') {
        if (t.end > t.deadline) {
          const lateness = t.end - t.deadline;
          score -= (lateness * W_LATENESS * 50); // Heavy penalty to try to meet it if possible
        }
      }
    }
    return score;
  }

  // 4. Backtracking con MRV Dinámico / SuperAgencia y Forward Checking
  function backtrack(
    currentSchedule: ScheduledTask[],
    domains: Map<string, number[]>
  ) {
    if (Date.now() - startTimeMs > TIME_LIMIT_MS) {
      searchStatus = bestSchedule ? 'TIMEOUT' : 'INFEASIBLE';
      return; // Timeout
    }

    const unassigned = processedTasks.filter(t => !currentSchedule.find(s => s.id === t.id));
    
    if (unassigned.length === 0) {
      const currentScore = calculateScore(currentSchedule);
      if (currentScore > bestScore) {
        bestScore = currentScore;
        bestSchedule = [...currentSchedule];
        searchStatus = 'FEASIBLE'; // Found at least one solution
      }
      return;
    }

    // Variable Ordering: Estrategia Balanceada (MRV) vs Supervivencia (SuperAgencia) vs Inteligente
    if (strategy === 'survival') {
      unassigned.sort((a, b) => {
        const diff = compareSuperAgencia(a, b, nowMinutes);
        if (diff !== 0) return diff;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); // Strict determinism tie-breaker
      });
    } else if (strategy === 'intelligent') {
      // Fase 1: Tareas Críticas (ASAP o Hard Deadline < Threshold)
      const criticalTasks = unassigned.filter(t => {
        const slack = getSlack(t, nowMinutes);
        return t.priority === 'ASAP' || (t.deadlineType === 'Hard Deadline' && slack < intelligentConfig.criticalSlackThreshold);
      });

      if (criticalTasks.length > 0) {
        criticalTasks.sort((a, b) => {
          const diff = compareSuperAgencia(a, b, nowMinutes);
          if (diff !== 0) return diff;
          return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); // Strict determinism tie-breaker
        });
        const topCritical = criticalTasks[0];
        unassigned.splice(unassigned.indexOf(topCritical), 1);
        unassigned.unshift(topCritical);
      } else {
        // Fase 2: Empaquetado Ponderado (MRV + Prioridad)
        unassigned.sort((a, b) => {
          const domainA = domains.get(a.id)!.length;
          const domainB = domains.get(b.id)!.length;
          const weightA = getPriorityWeight(a.priority);
          const weightB = getPriorityWeight(b.priority);
          
          // Modificador matemático: Reducimos el dominio aparente basado en la prioridad
          // Prioridad alta reduce el dominio a 1/3. Prioridad baja lo deja igual.
          const scoreA = domainA / weightA;
          const scoreB = domainB / weightB;
          
          if (scoreA !== scoreB) return scoreA - scoreB;
          return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); // Strict determinism tie-breaker
        });
      }
    } else {
      unassigned.sort((a, b) => {
        const diff = domains.get(a.id)!.length - domains.get(b.id)!.length;
        if (diff !== 0) return diff;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); // Strict determinism tie-breaker
      });
    }
    
    const task = unassigned[0];
    let taskDomain = domains.get(task.id) || [];

    // Value Ordering: Probar los valores más tempranos primero, o el valor anterior si existe
    taskDomain = [...taskDomain].sort((a, b) => {
      if (previousSchedule) {
        const prevTask = previousSchedule.find(s => s.id === task.id);
        if (prevTask) {
          // Strongly prefer the previous start time
          if (a === prevTask.start) return -1;
          if (b === prevTask.start) return 1;
        }
      }

      // Scoring Multiobjetivo para el modo Inteligente (Energía y Anti-Fragmentación)
      if (strategy === 'intelligent') {
        const scoreSlot = (start: number) => {
          let score = start; // Base: más temprano es mejor (menor score)

          // 1. Gestión de Energía (Mañana vs Tarde)
          const hour = Math.floor((start % 1440) / 60);
          const isMorning = hour >= 8 && hour < 13;
          const isHighPriority = task.priority === 'high' || task.priority === 'ASAP';
          
          if (isHighPriority && !isMorning) score += intelligentConfig.energyPenaltyHighPriorityAfternoon;
          if (!isHighPriority && isMorning) score += intelligentConfig.energyPenaltyLowPriorityMorning;

          // 2. Anti-Fragmentación (Adyacencia)
          const end = start + task.duration;
          let isAdjacent = false;
          for (const s of currentSchedule) {
            if (s.end === start || s.start === end) {
              isAdjacent = true;
              break;
            }
          }
          if (isAdjacent) score -= intelligentConfig.adjacencyBonus;

          return score;
        };

        const diff = scoreSlot(a) - scoreSlot(b);
        if (diff !== 0) return diff;
        return a - b; // Determinism tie-breaker for slots
      }

      return a - b;
    });

    for (const start of taskDomain) {
      const end = start + task.duration;
      if (calendarEvents.some((event) => start < event.end && end > event.start)) {
        continue;
      }
      const nextDomains = new Map<string, number[]>();
      let domainWipeout = false;

      for (const otherTask of unassigned) {
        if (otherTask.id === task.id) continue;
        
        let otherDomain = domains.get(otherTask.id)!;

        // No-Overlap
        otherDomain = otherDomain.filter(otherStart => {
          const otherEnd = otherStart + otherTask.duration;
          return !(start < otherEnd && end > otherStart);
        });

        otherDomain = otherDomain.filter(otherStart => {
          const otherEnd = otherStart + otherTask.duration;
          return !calendarEvents.some((event) => otherStart < event.end && otherEnd > event.start);
        });

        // Dependencies
        const dependsOnCurrent = processedDeps.some(d => d.fromId === task.id && d.toId === otherTask.id);
        if (dependsOnCurrent) {
          otherDomain = otherDomain.filter(otherStart => otherStart >= end);
        }

        const currentDependsOnOther = processedDeps.some(d => d.fromId === otherTask.id && d.toId === task.id);
        if (currentDependsOnOther) {
          otherDomain = otherDomain.filter(otherStart => otherStart + otherTask.duration <= start);
        }

        if (otherDomain.length === 0) {
          domainWipeout = true;
          if (!conflictLog[otherTask.name]) conflictLog[otherTask.name] = new Set();
          conflictLog[otherTask.name].add(task.name);
          break;
        }
        nextDomains.set(otherTask.id, otherDomain);
      }

      if (!domainWipeout) {
        backtrack([...currentSchedule, { ...task, start, end }], nextDomains);
      }
    }
  }

  backtrack([], initialDomains);

  if (!bestSchedule) {
    const formattedConflicts: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(conflictLog)) {
      formattedConflicts[k] = Array.from(v);
    }
    
    // Enhance diagnostics: identify the most problematic task
    let mostProblematic = '';
    let maxConflicts = 0;
    for (const [k, v] of Object.entries(formattedConflicts)) {
      if (v.length > maxConflicts) {
        maxConflicts = v.length;
        mostProblematic = k;
      }
    }
    
    const errorMsg = mostProblematic 
      ? `No feasible schedule found. Task '${mostProblematic}' caused the most domain wipeouts (${maxConflicts} conflicts). Try extending deadlines or reducing duration.`
      : "No feasible schedule found. Constraints are too tight.";

    return { 
      schedule: null, 
      score: -Infinity, 
      diagnostics: { error: errorMsg, conflicts: formattedConflicts, status: searchStatus === 'OPTIMAL' ? 'INFEASIBLE' : searchStatus as any } 
    };
  }

  // If we didn't timeout, and we found a schedule, it's optimal (within our search space)
  if ((searchStatus as string) !== 'TIMEOUT') searchStatus = 'OPTIMAL';

  return { 
    schedule: bestSchedule, 
    score: bestScore,
    diagnostics: { error: '', conflicts: {}, status: searchStatus }
  };
}
