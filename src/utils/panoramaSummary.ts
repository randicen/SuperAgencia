import { getAllTasks } from '../contexts/SpacesContext';
import { SpacesState, SpaceEvent, TaskPriority } from '../spacesTypes';

export interface PanoramaTaskItem {
  id: string;
  nombre: string;
  clientName?: string;
  workspaceId: string;
  workspaceName: string;
  dueDate: string | null;
  dueAt: number | null;
  priority: TaskPriority;
  progress: number;
}

export interface PanoramaCommitmentItem {
  id: string;
  nombre: string;
  startDate: string;
  startAt: number;
  endDate: string;
  workspaceName: string;
  sourceLabel: string;
}

export interface PanoramaOperationalSummary {
  overdueTasks: PanoramaTaskItem[];
  upcomingTasks: PanoramaTaskItem[];
  focusTasks: PanoramaTaskItem[];
  upcomingCommitments: PanoramaCommitmentItem[];
  pendingIncome: number;
  overdueCount: number;
  upcomingCount: number;
  commitmentCount: number;
  activeCount: number;
  todoCount: number;
  doneCount: number;
  activeWorkspaceName: string | null;
}

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  ASAP: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

const parseDate = (value?: string | null, endOfDay = false): number | null => {
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

const resolveTaskDueAt = (task: { dueDate?: string; endDate?: string; startDate?: string }) =>
  parseDate(task.dueDate, true) ?? parseDate(task.endDate, true) ?? parseDate(task.startDate);

const collectWorkspaceEvents = (state: SpacesState, workspaceId: string | null) => {
  const activeWorkspace = state.workspaces.find((workspace) => workspace.id === workspaceId) || state.workspaces[0];
  if (!activeWorkspace) return [];

  const events: PanoramaCommitmentItem[] = [];
  const pushEvent = (event: SpaceEvent, sourceLabel: string) => {
    const startAt = parseDate(event.startDate);
    if (!startAt) return;

    events.push({
      id: event.id,
      nombre: event.nombre,
      startDate: event.startDate,
      startAt,
      endDate: event.endDate,
      workspaceName: activeWorkspace.nombre,
      sourceLabel,
    });
  };

  (activeWorkspace.agendaEvents || []).forEach((event) => pushEvent(event, 'Agenda'));
  activeWorkspace.espacios.forEach((space) => {
    space.listas.forEach((list) => (list.eventos || []).forEach((event) => pushEvent(event, `Lista · ${list.nombre}`)));
    space.carpetas.forEach((folder) => {
      folder.listas.forEach((list) => (list.eventos || []).forEach((event) => pushEvent(event, `Lista · ${list.nombre}`)));
    });
  });
  (state.gcalEvents || []).forEach((event) => pushEvent(event, 'Google Calendar'));

  return events.sort((left, right) => left.startAt - right.startAt);
};

export const buildPanoramaOperationalSummary = (
  state: SpacesState,
  now = new Date()
): PanoramaOperationalSummary => {
  const nowMs = now.getTime();
  const next48h = nowMs + 48 * 60 * 60 * 1000;
  const allTasks = getAllTasks(state);
  const workspaceNames = new Map(state.workspaces.map((workspace) => [workspace.id, workspace.nombre]));

  const taskItems: PanoramaTaskItem[] = allTasks.map(({ task, workspaceId }) => ({
    id: task.id,
    nombre: task.nombre,
    clientName: task.clientName,
    workspaceId,
    workspaceName: workspaceNames.get(workspaceId) || 'Workspace',
    dueDate: task.dueDate || task.endDate || task.startDate || null,
    dueAt: resolveTaskDueAt(task),
    priority: task.priority,
    progress: task.progress,
  }));

  let pendingIncome = 0;
  allTasks.forEach(({ task }) => {
    (task.installments || []).forEach((installment) => {
      if (installment.status === 'PENDIENTE') pendingIncome += installment.amount;
    });
  });

  const actionableTasks = taskItems.filter((task, index) => allTasks[index]?.task.estado !== 'DONE');
  const overdueTasks = actionableTasks
    .filter((task) => !!task.dueAt && task.dueAt < nowMs)
    .sort((left, right) => (left.dueAt || 0) - (right.dueAt || 0));

  const upcomingTasks = actionableTasks
    .filter((task) => !!task.dueAt && task.dueAt >= nowMs && task.dueAt <= next48h)
    .sort((left, right) => (left.dueAt || Number.MAX_SAFE_INTEGER) - (right.dueAt || Number.MAX_SAFE_INTEGER));

  const focusTasks = actionableTasks
    .slice()
    .sort((left, right) =>
      PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
      || (left.dueAt || Number.MAX_SAFE_INTEGER) - (right.dueAt || Number.MAX_SAFE_INTEGER)
      || left.nombre.localeCompare(right.nombre)
    )
    .slice(0, 6);

  const upcomingCommitments = collectWorkspaceEvents(state, state.activeWorkspaceId)
    .filter((event) => event.startAt >= nowMs)
    .slice(0, 5);

  return {
    overdueTasks,
    upcomingTasks,
    focusTasks,
    upcomingCommitments,
    pendingIncome,
    overdueCount: overdueTasks.length,
    upcomingCount: upcomingTasks.length,
    commitmentCount: upcomingCommitments.length,
    activeCount: allTasks.filter(({ task }) => task.estado === 'ACTIVE').length,
    todoCount: allTasks.filter(({ task }) => task.estado === 'TODO').length,
    doneCount: allTasks.filter(({ task }) => task.estado === 'DONE').length,
    activeWorkspaceName: state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId)?.nombre || state.workspaces[0]?.nombre || null,
  };
};
