import type { Space, SpaceFolder, SpaceList, SpacesState, SpaceTask, ScheduledSlot, WorkBlock } from '../spacesTypes.ts';

const sortWorkBlocks = (blocks: WorkBlock[]) =>
  [...blocks].sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());

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
  workBlocks
    .filter((block) => block.status !== 'cancelled')
    .map((block, index) => ({
      id: block.id,
      start: block.startAt,
      end: block.endAt,
      isFragment: task.workStyle === 'flexible' || workBlocks.length > 1 || index > 0,
    }));

const normalizeTaskDatesFromWorkBlocks = (task: SpaceTask, workBlocks: WorkBlock[]) => {
  if (workBlocks.length === 0) {
    return { startDate: task.startDate, endDate: task.endDate };
  }

  return {
    startDate: task.startDate || workBlocks[0].startAt,
    endDate: task.endDate || workBlocks[workBlocks.length - 1].endAt,
  };
};

export const normalizeTaskWorkModel = (task: SpaceTask): SpaceTask => {
  const workStyle = task.workStyle || (task.elasticity === 0 ? 'deep-work' : 'flexible');
  const workBlocks =
    task.scheduledSlots && task.scheduledSlots.length > 0
      ? buildWorkBlocksFromScheduledSlots(task)
      : sanitizeExistingWorkBlocks(task);

  const scheduledSlots =
    task.scheduledSlots && task.scheduledSlots.length > 0
      ? task.scheduledSlots
      : buildScheduledSlotsFromWorkBlocks({ ...task, workStyle }, workBlocks);

  const estimatedEffortMinutes = task.estimatedEffortMinutes ?? task.duration ?? null;
  const preferredBlockMinutes =
    task.preferredBlockMinutes ??
    (workStyle === 'deep-work'
      ? estimatedEffortMinutes
      : estimatedEffortMinutes
        ? Math.min(Math.max(30, Math.round(estimatedEffortMinutes / 2)), 120)
        : 90);

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
