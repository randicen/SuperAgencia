import type { TaskPriority } from '../spacesTypes.ts';
import { parseLocalDate } from './dateTime.ts';

type TaskWithDue = {
  dueDate?: string | null;
  endDate?: string | null;
  startDate?: string | null;
  priority: TaskPriority;
  nombre: string;
};

const PRIORITY_SCORE: Record<TaskPriority, number> = {
  ASAP: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

const getTaskDueDate = (task: TaskWithDue) =>
  parseLocalDate(task.dueDate, true) ||
  parseLocalDate(task.endDate, true) ||
  parseLocalDate(task.startDate, true);

export const getTaskUrgencyMeta = (task: TaskWithDue, now = new Date()) => {
  const dueDate = getTaskDueDate(task);
  if (!dueDate) {
    return {
      dueDate: null,
      dueAt: Number.MAX_SAFE_INTEGER,
      bucket: 3 as const,
      hoursLeft: Number.POSITIVE_INFINITY,
      priorityScore: PRIORITY_SCORE[task.priority] ?? 0,
    };
  }

  const dueAt = dueDate.getTime();
  const hoursLeft = (dueAt - now.getTime()) / (1000 * 60 * 60);
  const bucket = dueAt < now.getTime() ? 0 : hoursLeft <= 24 ? 1 : hoursLeft <= 72 ? 2 : 3;

  return {
    dueDate,
    dueAt,
    bucket,
    hoursLeft,
    priorityScore: PRIORITY_SCORE[task.priority] ?? 0,
  };
};

export const compareTaskUrgency = (a: TaskWithDue, b: TaskWithDue, now = new Date()) => {
  const metaA = getTaskUrgencyMeta(a, now);
  const metaB = getTaskUrgencyMeta(b, now);

  if (metaA.bucket !== metaB.bucket) return metaA.bucket - metaB.bucket;
  if (metaA.priorityScore !== metaB.priorityScore) return metaB.priorityScore - metaA.priorityScore;
  if (metaA.dueAt !== metaB.dueAt) return metaA.dueAt - metaB.dueAt;
  const nameA = typeof a.nombre === 'string' ? a.nombre : '';
  const nameB = typeof b.nombre === 'string' ? b.nombre : '';
  return nameA.localeCompare(nameB, 'es');
};

export const formatTaskDueDateTime = (value?: string | null) => {
  const isDateOnly = !!value && (/^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value));
  const date = parseLocalDate(value || null, isDateOnly);
  if (!date) return 'Sin fecha';
  return date.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).toLowerCase();
};

export const formatTaskCountdown = (dueDate: string | null | undefined, now = new Date()) => {
  const parsed = parseLocalDate(dueDate || null, true);
  if (!parsed) return 'Sin plazo';

  const diffMs = parsed.getTime() - now.getTime();
  const isOverdue = diffMs < 0;
  const absDiff = Math.abs(diffMs);
  const daysLeft = Math.floor(absDiff / (1000 * 3600 * 24));
  const hoursLeft = Math.floor((absDiff % (1000 * 3600 * 24)) / (1000 * 3600));
  const minsLeft = Math.floor((absDiff % (1000 * 3600)) / (1000 * 60));

  let label = '';
  if (daysLeft > 0) label = `${daysLeft}d ${hoursLeft}h`;
  else if (hoursLeft > 0) label = `${hoursLeft}h ${minsLeft}m`;
  else label = `${minsLeft}m`;

  return isOverdue ? `-${label}` : label;
};

export const formatTaskDeadline = (dueDate?: string | null) => {
  return formatTaskDueDateTime(dueDate);
};
