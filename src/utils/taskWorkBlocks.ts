import type { Space, SpaceFolder, SpaceList, SpacesState, SpaceTask, ScheduledSlot, WorkBlock } from '../spacesTypes.ts';

export type TaskPlanningMode = 'none' | 'ai' | 'manual';

const DEFAULT_ESTIMATED_EFFORT_MINUTES = 60;
const DEFAULT_PREFERRED_BLOCK_MINUTES = 90;

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
    (task.workBlocks || []).map((block, index) => ({
      id: block.id || `${task.id}-block-${index + 1}`,
      taskId: block.taskId || task.id,
      startAt: block.startAt,
      endAt: block.endAt,
      source: block.source || 'legacy',
      status: block.status || 'planned',
      locked: block.locked ?? (block.source === 'manual' || !task.autoSchedule),
    }))
  );

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
  const workStyle = getWorkStyle(task);
  const workBlocks =
    task.scheduledSlots && task.scheduledSlots.length > 0
      ? buildWorkBlocksFromScheduledSlots(task)
      : sanitizeExistingWorkBlocks(task);

  const scheduledSlots =
    task.scheduledSlots && task.scheduledSlots.length > 0
      ? task.scheduledSlots
      : buildScheduledSlotsFromWorkBlocks({ ...task, workStyle }, workBlocks);

  const estimatedEffortMinutes = task.estimatedEffortMinutes ?? task.duration ?? null;
  const preferredBlockMinutes = getPreferredBlockMinutes(
    task,
    estimatedEffortMinutes ?? DEFAULT_ESTIMATED_EFFORT_MINUTES,
    workStyle
  );

  const mirroredDates = normalizeTaskDatesFromWorkBlocks(task, workBlocks);

  return {
    ...task,
    earliestStartAt: task.earliestStartAt ?? (task.autoSchedule ? (task.startDate || workBlocks[0]?.startAt || null) : null),
    estimatedEffortMinutes,
    preferredBlockMinutes,
    workStyle,
    workBlocks: workBlocks.length > 0 ? workBlocks : undefined,
    scheduledSlots: scheduledSlots.length > 0 ? scheduledSlots : undefined,
    startDate: mirroredDates.startDate,
    endDate: mirroredDates.endDate,
    subtasks: task.subtasks?.map(normalizeTaskWorkModel),
  };
};

const normalizeSpaceList = (list: SpaceList): SpaceList => ({
  ...list,
  tareas: (list.tareas || []).map(normalizeTaskWorkModel),
});

const normalizeSpaceFolder = (folder: SpaceFolder): SpaceFolder => ({
  ...folder,
  listas: (folder.listas || []).map(normalizeSpaceList),
});

const normalizeSpace = (space: Space): Space => ({
  ...space,
  listas: (space.listas || []).map(normalizeSpaceList),
  carpetas: (space.carpetas || []).map(normalizeSpaceFolder),
});

export const normalizeSpacesStateWorkModel = (state: SpacesState): SpacesState => ({
  ...state,
  workspaces: (state.workspaces || []).map((workspace) => ({
    ...workspace,
    espacios: (workspace.espacios || []).map(normalizeSpace),
  })),
});
