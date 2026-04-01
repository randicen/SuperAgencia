import type { Space, SpaceEvent, SpaceFolder, SpaceList, SpacesState, SpaceTask, ScheduledSlot, WorkBlock } from '../spacesTypes.ts';

export type TaskPlanningMode = 'none' | 'ai' | 'manual';

const DEFAULT_ESTIMATED_EFFORT_MINUTES = 60;
const DEFAULT_PREFERRED_BLOCK_MINUTES = 90;

const VALID_TASK_STATUSES = new Set(['TODO', 'ACTIVE', 'DONE']);
const VALID_TASK_PRIORITIES = new Set(['ASAP', 'High', 'Medium', 'Low']);
const VALID_DEADLINE_TYPES = new Set(['Hard Deadline', 'Soft Deadline']);

const asString = (value: unknown) => (typeof value === 'string' ? value : '');
const asOptionalString = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);
const asNumber = (value: unknown, fallback: number) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getSortableTimestamp = (value: string) => {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
};

const sortWorkBlocks = (blocks: WorkBlock[]) =>
  [...blocks].sort((left, right) => {
    const leftTimestamp = getSortableTimestamp(left.startAt);
    const rightTimestamp = getSortableTimestamp(right.startAt);

    if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp;
    return left.id.localeCompare(right.id);
  });

const getWorkStyle = (task: SpaceTask) => task.workStyle || (task.elasticity === 0 ? 'deep-work' : 'flexible');

const getEstimatedEffortMinutes = (task: SpaceTask) =>
  task.estimatedEffortMinutes ?? task.duration ?? DEFAULT_ESTIMATED_EFFORT_MINUTES;

const getPreferredBlockMinutes = (task: SpaceTask, estimatedEffortMinutes: number, workStyle: SpaceTask['workStyle']) =>
  task.preferredBlockMinutes ??
  (workStyle === 'deep-work'
    ? estimatedEffortMinutes
    : Math.min(Math.max(30, Math.round(estimatedEffortMinutes / 2)), 120) || DEFAULT_PREFERRED_BLOCK_MINUTES);

const getSchedulableWorkBlocks = (workBlocks: WorkBlock[]) =>
  sortWorkBlocks(workBlocks.filter((block) => block.status !== 'cancelled' && block.startAt && block.endAt));

const buildWorkBlocksFromScheduledSlots = (task: SpaceTask): WorkBlock[] =>
  sortWorkBlocks(
    (task.scheduledSlots || []).map((slot) => ({
      id: slot.id,
      taskId: task.id,
      startAt: slot.start,
      endAt: slot.end,
      source: task.autoSchedule ? 'ai' : 'manual',
      status: 'planned',
      locked: !task.autoSchedule,
    }))
  );

const sanitizeExistingWorkBlocks = (task: SpaceTask): WorkBlock[] =>
  sortWorkBlocks(
    (Array.isArray(task.workBlocks) ? task.workBlocks : []).map((block, index) => ({
      id: block.id || `${task.id}-block-${index + 1}`,
      taskId: block.taskId || task.id,
      startAt: asString(block.startAt),
      endAt: asString(block.endAt),
      source: block.source || 'legacy',
      status: block.status || 'planned',
      locked: block.locked ?? (block.source === 'manual' || !task.autoSchedule),
    }))
  );

const sanitizeScheduledSlots = (task: SpaceTask): ScheduledSlot[] =>
  (Array.isArray(task.scheduledSlots) ? task.scheduledSlots : [])
    .map((slot, index) => ({
      id: asString(slot.id) || `${task.id}-slot-${index + 1}`,
      start: asString(slot.start),
      end: asString(slot.end),
      isFragment: !!slot.isFragment,
    }))
    .filter((slot) => slot.start && slot.end);

const sanitizeTaskShape = (task: SpaceTask): SpaceTask => ({
  ...task,
  id: asString(task.id),
  nombre: asString(task.nombre),
  estado: VALID_TASK_STATUSES.has(task.estado) ? task.estado : 'TODO',
  orden: asNumber(task.orden, Date.now()),
  progress: Math.max(0, Math.min(100, asNumber(task.progress, 0))),
  startedAt: asOptionalString(task.startedAt),
  earliestStartAt: task.earliestStartAt == null ? null : asString(task.earliestStartAt),
  dueDate: asString(task.dueDate),
  deadlineType: VALID_DEADLINE_TYPES.has(task.deadlineType) ? task.deadlineType : 'Soft Deadline',
  estimatedEffortMinutes: task.estimatedEffortMinutes == null ? null : asNumber(task.estimatedEffortMinutes, DEFAULT_ESTIMATED_EFFORT_MINUTES),
  preferredBlockMinutes: task.preferredBlockMinutes == null ? null : asNumber(task.preferredBlockMinutes, DEFAULT_PREFERRED_BLOCK_MINUTES),
  workStyle: task.workStyle === 'deep-work' || task.workStyle === 'flexible' ? task.workStyle : undefined,
  autoSchedule: !!task.autoSchedule,
  startDate: asString(task.startDate),
  endDate: asString(task.endDate),
  duration: Math.max(0, asNumber(task.duration, DEFAULT_ESTIMATED_EFFORT_MINUTES)),
  elasticity: asNumber(task.elasticity, 1) === 0 ? 0 : 1,
  priority: VALID_TASK_PRIORITIES.has(task.priority) ? task.priority : 'Medium',
  totalValue: Math.max(0, asNumber(task.totalValue, 0)),
  clientName: asOptionalString(task.clientName),
  clientId: asOptionalString(task.clientId),
  installments: Array.isArray(task.installments) ? task.installments : undefined,
  hasConflict: !!task.hasConflict,
  conflictDescription: asOptionalString(task.conflictDescription),
  description: asOptionalString(task.description),
  subtasks: Array.isArray(task.subtasks) ? task.subtasks : undefined,
  scheduledSlots: sanitizeScheduledSlots(task),
  workBlocks: sanitizeExistingWorkBlocks(task),
});

const sanitizeEvent = (event: SpaceEvent): SpaceEvent => ({
  ...event,
  id: asString(event.id),
  nombre: asString(event.nombre),
  startDate: asString(event.startDate),
  endDate: asString(event.endDate),
  description: asOptionalString(event.description),
});

const buildScheduledSlotsFromWorkBlocks = (task: SpaceTask, workBlocks: WorkBlock[]): ScheduledSlot[] =>
  getSchedulableWorkBlocks(workBlocks)
    .map((block, index) => ({
      id: block.id,
      start: block.startAt,
      end: block.endAt,
      isFragment: task.workStyle === 'flexible' || workBlocks.length > 1 || index > 0,
    }));

const normalizeTaskDatesFromWorkBlocks = (task: SpaceTask, workBlocks: WorkBlock[]) => {
  const schedulableBlocks = getSchedulableWorkBlocks(workBlocks);

  if (schedulableBlocks.length === 0) {
    return { startDate: task.startDate, endDate: task.endDate };
  }

  return {
    startDate: task.startDate || schedulableBlocks[0].startAt,
    endDate: task.endDate || schedulableBlocks[schedulableBlocks.length - 1].endAt,
  };
};

export const getTaskPlanningMode = (task: SpaceTask): TaskPlanningMode => {
  if (task.autoSchedule) return 'ai';

  const workBlocks = sanitizeExistingWorkBlocks(task);
  if (workBlocks.length > 0) return 'manual';
  if (task.startDate && task.endDate) return 'manual';

  return 'none';
};

export const getTaskWorkBlocks = (task: SpaceTask): WorkBlock[] => {
  if (task.workBlocks && task.workBlocks.length > 0) {
    return sanitizeExistingWorkBlocks(task);
  }

  if (task.scheduledSlots && task.scheduledSlots.length > 0) {
    return buildWorkBlocksFromScheduledSlots(task);
  }

  return [];
};

export const createTaskWorkBlock = (taskId: string, index = 0): WorkBlock => ({
  id: `${taskId || 'task'}-block-${Date.now()}-${index + 1}`,
  taskId,
  startAt: '',
  endAt: '',
  source: 'manual',
  status: 'planned',
  locked: true,
});

export const setTaskPlanningMode = (task: SpaceTask, mode: TaskPlanningMode): SpaceTask => {
  if (mode === 'ai') {
    return {
      ...task,
      autoSchedule: true,
      startDate: task.earliestStartAt || task.startDate || '',
      endDate: '',
      workBlocks: undefined,
      scheduledSlots: undefined,
    };
  }

  if (mode === 'manual') {
    const manualBlocks = getTaskWorkBlocks(task).filter((block) => block.status !== 'cancelled');

    return {
      ...task,
      autoSchedule: false,
      workBlocks: manualBlocks.length > 0
        ? manualBlocks.map((block) => ({
            ...block,
            taskId: task.id,
            source: 'manual',
            locked: true,
          }))
        : undefined,
      scheduledSlots: undefined,
    };
  }

  return {
    ...task,
    autoSchedule: false,
    startDate: '',
    endDate: '',
    workBlocks: undefined,
    scheduledSlots: undefined,
  };
};

export const setTaskManualWorkBlocks = (task: SpaceTask, workBlocks: WorkBlock[]): SpaceTask => ({
  ...task,
  autoSchedule: false,
  workBlocks: sortWorkBlocks(
    workBlocks.map((block, index) => ({
      ...block,
      id: block.id || `${task.id || 'task'}-block-${index + 1}`,
      taskId: task.id,
      source: 'manual',
      status: block.status || 'planned',
      locked: true,
    }))
  ),
  scheduledSlots: undefined,
});

export const validateTaskPlanning = (task: SpaceTask): string | null => {
  const planningMode = getTaskPlanningMode(task);
  if (planningMode !== 'manual') return null;

  const workBlocks = getTaskWorkBlocks(task);
  if (workBlocks.length === 0) {
    return 'Agrega al menos un bloque de trabajo manual o cambia la tarea a Sin bloques.';
  }

  for (const block of workBlocks) {
    if (!block.startAt || !block.endAt) {
      return 'Cada bloque manual debe tener inicio y fin.';
    }

    if (getSortableTimestamp(block.endAt) <= getSortableTimestamp(block.startAt)) {
      return 'Cada bloque manual debe terminar después de su inicio.';
    }
  }

  return null;
};

export const syncTaskPlanningFields = (task: SpaceTask): SpaceTask => {
  const planningMode = getTaskPlanningMode(task);
  const workStyle = getWorkStyle(task);
  const estimatedEffortMinutes = getEstimatedEffortMinutes(task);
  const preferredBlockMinutes = getPreferredBlockMinutes(task, estimatedEffortMinutes, workStyle);

  if (planningMode === 'ai') {
    return normalizeTaskWorkModel({
      ...task,
      autoSchedule: true,
      startDate: task.earliestStartAt || task.startDate || '',
      endDate: '',
      duration: estimatedEffortMinutes,
      elasticity: workStyle === 'deep-work' ? 0 : 1,
      estimatedEffortMinutes,
      preferredBlockMinutes,
      workStyle,
      workBlocks: undefined,
    });
  }

  if (planningMode === 'manual') {
    const workBlocks = getTaskWorkBlocks(task)
      .filter((block) => block.status !== 'cancelled')
      .map((block) => ({
        ...block,
        taskId: task.id,
        source: 'manual' as const,
        locked: true,
      }));
    const schedulableBlocks = getSchedulableWorkBlocks(workBlocks);
    const derivedStart = schedulableBlocks[0]?.startAt || '';
    const derivedEnd = schedulableBlocks[schedulableBlocks.length - 1]?.endAt || '';

    return normalizeTaskWorkModel({
      ...task,
      autoSchedule: false,
      startDate: derivedStart,
      endDate: derivedEnd,
      duration: estimatedEffortMinutes,
      elasticity: workStyle === 'deep-work' ? 0 : 1,
      estimatedEffortMinutes,
      preferredBlockMinutes,
      workStyle,
      workBlocks: workBlocks.length > 0 ? workBlocks : undefined,
      scheduledSlots: undefined,
    });
  }

  return normalizeTaskWorkModel({
    ...task,
    autoSchedule: false,
    startDate: '',
    endDate: '',
    duration: estimatedEffortMinutes,
    elasticity: workStyle === 'deep-work' ? 0 : 1,
    estimatedEffortMinutes,
    preferredBlockMinutes,
    workStyle,
    workBlocks: undefined,
    scheduledSlots: undefined,
  });
};

export const normalizeTaskWorkModel = (task: SpaceTask): SpaceTask => {
  const sanitizedTask = sanitizeTaskShape(task);
  const workStyle = getWorkStyle(sanitizedTask);
  const workBlocks =
    sanitizedTask.scheduledSlots && sanitizedTask.scheduledSlots.length > 0
      ? buildWorkBlocksFromScheduledSlots(sanitizedTask)
      : sanitizeExistingWorkBlocks(sanitizedTask);

  const scheduledSlots =
    sanitizedTask.scheduledSlots && sanitizedTask.scheduledSlots.length > 0
      ? sanitizedTask.scheduledSlots
      : buildScheduledSlotsFromWorkBlocks({ ...sanitizedTask, workStyle }, workBlocks);

  const estimatedEffortMinutes = sanitizedTask.estimatedEffortMinutes ?? sanitizedTask.duration ?? null;
  const preferredBlockMinutes = getPreferredBlockMinutes(
    sanitizedTask,
    estimatedEffortMinutes ?? DEFAULT_ESTIMATED_EFFORT_MINUTES,
    workStyle
  );

  const mirroredDates = normalizeTaskDatesFromWorkBlocks(sanitizedTask, workBlocks);

  return {
    ...sanitizedTask,
    earliestStartAt: sanitizedTask.earliestStartAt ?? (sanitizedTask.autoSchedule ? (sanitizedTask.startDate || workBlocks[0]?.startAt || null) : null),
    estimatedEffortMinutes,
    preferredBlockMinutes,
    workStyle,
    workBlocks: workBlocks.length > 0 ? workBlocks : undefined,
    scheduledSlots: scheduledSlots.length > 0 ? scheduledSlots : undefined,
    startDate: mirroredDates.startDate,
    endDate: mirroredDates.endDate,
    subtasks: sanitizedTask.subtasks?.map(normalizeTaskWorkModel),
  };
};

const normalizeSpaceList = (list: SpaceList): SpaceList => ({
  ...list,
  id: asString(list.id),
  nombre: asString(list.nombre),
  tareas: (Array.isArray(list.tareas) ? list.tareas : []).map(normalizeTaskWorkModel),
  eventos: (Array.isArray(list.eventos) ? list.eventos : []).map(sanitizeEvent),
});

const normalizeSpaceFolder = (folder: SpaceFolder): SpaceFolder => ({
  ...folder,
  id: asString(folder.id),
  nombre: asString(folder.nombre),
  listas: (Array.isArray(folder.listas) ? folder.listas : []).map(normalizeSpaceList),
});

const normalizeSpace = (space: Space): Space => ({
  ...space,
  id: asString(space.id),
  nombre: asString(space.nombre),
  color: asString(space.color),
  listas: (Array.isArray(space.listas) ? space.listas : []).map(normalizeSpaceList),
  carpetas: (Array.isArray(space.carpetas) ? space.carpetas : []).map(normalizeSpaceFolder),
});

export const normalizeSpacesStateWorkModel = (state: SpacesState): SpacesState => ({
  ...state,
  workspaces: (Array.isArray(state.workspaces) ? state.workspaces : []).map((workspace) => ({
    ...workspace,
    id: asString(workspace.id),
    nombre: asString(workspace.nombre),
    agendaEvents: (Array.isArray(workspace.agendaEvents) ? workspace.agendaEvents : []).map(sanitizeEvent),
    espacios: (Array.isArray(workspace.espacios) ? workspace.espacios : []).map(normalizeSpace),
  })),
});
