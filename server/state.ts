import {
  DEFAULT_PLANNER_STATE,
  type PlannerState,
  type PlannerStateSyncPayload,
  type ScheduleRunRecord,
} from '../src/lib/plannerState.js';
import type { ChatMessage } from '../src/lib/plannerState.js';
import type { CalendarEvent, Dependency, ScheduledTask, Task, WorkWindow } from '../src/lib/solver.js';
import type { AuthenticatedUser } from './auth.js';
import { loadReplanningBundleForUser } from './replanning/store.js';
import { getSupabaseAdmin } from './supabase.js';

type ProfileSettingsRow = {
  timezone: string;
  locale: string;
};

type PlannerStateRow = {
  user_id: string;
  work_window: WorkWindow;
  strategy: PlannerState['strategy'];
  schedule_base_date: string;
  diagnostics: unknown;
  current_revision_id: string | null;
};

type TaskRow = {
  id: string;
  user_id: string;
  name: string;
  duration: number;
  fixed_start: number | null;
  min_start: number | null;
  deadline: number | null;
  priority: Task['priority'];
  elastic: boolean;
  min_chunk_size: number | null;
  progress: number;
  deadline_type: Task['deadlineType'] | null;
};

type DependencyRow = {
  from_task_id: string;
  to_task_id: string;
};

type CalendarEventRow = {
  id: string;
  title: string;
  start_minute: number;
  end_minute: number;
  kind: CalendarEvent['kind'] | null;
  source_provider: CalendarEvent['sourceProvider'] | null;
  external_event_id: string | null;
};

type WorkBlockRow = {
  task_id: string;
  start_minute: number;
  end_minute: number;
};

type ChatMessageRow = {
  role: ChatMessage['role'];
  text: string;
  position: number;
  metadata: ChatMessage['metadata'] | null;
};

type StateRevisionRow = {
  id: string;
  user_id: string;
  revision_number: number;
  snapshot: PlannerState;
  created_at: string;
};

const REVISION_LIMIT = 20;
const plannerWriteQueues = new Map<string, Promise<void>>();

function dedupeByLast<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped.reverse();
}

export const normalizePlannerStateForPersistence = (state: PlannerState): PlannerState => {
  const tasks = dedupeByLast(state.tasks, (task) => task.id);
  const validTaskIds = new Set(tasks.map((task) => task.id));
  const calendarEvents = dedupeByLast(state.calendarEvents, (event) => event.id);
  const dependencies = dedupeByLast(
    state.dependencies.filter(
      (dependency) =>
        validTaskIds.has(dependency.fromId) &&
        validTaskIds.has(dependency.toId) &&
        dependency.fromId !== dependency.toId,
    ),
    (dependency) => `${dependency.fromId}->${dependency.toId}`,
  );
  const schedule = dedupeByLast(
    (state.schedule ?? []).filter((entry) => validTaskIds.has(entry.id)),
    (entry) => `${entry.id}@${entry.start}-${entry.end}`,
  );

  return {
    ...state,
    tasks,
    calendarEvents,
    dependencies,
    schedule,
  };
};

export const runPlannerWriteExclusive = async <T>(
  userId: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const previous = plannerWriteQueues.get(userId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(() => undefined, () => undefined);
  plannerWriteQueues.set(userId, tail);

  try {
    return await result;
  } finally {
    if (plannerWriteQueues.get(userId) === tail) {
      plannerWriteQueues.delete(userId);
    }
  }
};

const mapTaskRow = (row: TaskRow): Task => ({
  id: row.id,
  name: row.name,
  duration: row.duration,
  fixedStart: row.fixed_start ?? undefined,
  minStart: row.min_start ?? undefined,
  deadline: row.deadline ?? undefined,
  priority: row.priority ?? 'medium',
  elastic: row.elastic,
  minChunkSize: row.min_chunk_size ?? undefined,
  progress: row.progress ?? 0,
  deadlineType: row.deadline_type ?? undefined,
});

const mapDependencyRow = (row: DependencyRow): Dependency => ({
  fromId: row.from_task_id,
  toId: row.to_task_id,
});

const mapCalendarEventRow = (row: CalendarEventRow): CalendarEvent => ({
  id: row.id,
  title: row.title,
  start: row.start_minute,
  end: row.end_minute,
  kind: row.kind ?? 'blocked',
  sourceProvider: row.source_provider ?? undefined,
  externalEventId: row.external_event_id ?? undefined,
});

const mapWorkBlockRow = (row: WorkBlockRow, taskMap: Map<string, Task>): ScheduledTask | null => {
  const task = taskMap.get(row.task_id);
  if (!task) return null;

  return {
    ...task,
    start: row.start_minute,
    end: row.end_minute,
  };
};

const mapMessageRow = (row: ChatMessageRow): ChatMessage => ({
  role: row.role,
  text: row.text,
  metadata: row.metadata ?? undefined,
});

const serializeTasks = (userId: string, tasks: Task[]) =>
  tasks.map((task) => ({
    id: task.id,
    user_id: userId,
    name: task.name || 'Sin título',
    duration: task.duration,
    fixed_start: task.fixedStart ?? null,
    min_start: task.minStart ?? null,
    deadline: task.deadline ?? null,
    priority: task.priority ?? 'medium',
    elastic: Boolean(task.elastic),
    min_chunk_size: task.minChunkSize ?? null,
    progress: task.progress ?? 0,
    deadline_type: task.deadlineType ?? null,
  }));

const serializeDependencies = (userId: string, dependencies: Dependency[]) =>
  dependencies.map((dependency) => ({
    user_id: userId,
    from_task_id: dependency.fromId,
    to_task_id: dependency.toId,
  }));

const serializeCalendarEvents = (userId: string, calendarEvents: CalendarEvent[]) =>
  calendarEvents.map((event) => ({
    id: event.id,
    user_id: userId,
    title: event.title,
    start_minute: event.start,
    end_minute: event.end,
    kind: event.kind ?? 'blocked',
    source_provider: event.sourceProvider ?? 'manual',
    external_event_id: event.externalEventId ?? null,
  }));

const serializeWorkBlocks = (userId: string, schedule: ScheduledTask[]) =>
  schedule.map((entry) => ({
    user_id: userId,
    task_id: entry.id,
    start_minute: entry.start,
    end_minute: entry.end,
  }));

const serializeMessages = (userId: string, messages: ChatMessage[]) =>
  messages.map((message, index) => ({
    user_id: userId,
    role: message.role,
    text: message.text,
    position: index,
    metadata: message.metadata ?? null,
  }));

const loadProfileSettings = async (userId: string): Promise<ProfileSettingsRow> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('profiles')
    .select('timezone, locale')
    .eq('id', userId)
    .single();

  if (result.error || !result.data) {
    throw result.error ?? new Error('No fue posible cargar la configuración del perfil.');
  }

  return result.data as ProfileSettingsRow;
};

const getPlannerStateRow = async (userId: string): Promise<PlannerStateRow> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('planner_states')
    .select('user_id, work_window, strategy, schedule_base_date, diagnostics, current_revision_id')
    .eq('user_id', userId)
    .single();

  if (result.error || !result.data) {
    throw result.error ?? new Error('No fue posible cargar el planner del usuario.');
  }

  return result.data as PlannerStateRow;
};

const getRevisionRows = async (userId: string): Promise<StateRevisionRow[]> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('state_revisions')
    .select('id, user_id, revision_number, snapshot, created_at')
    .eq('user_id', userId)
    .order('revision_number', { ascending: true });

  if (result.error) throw result.error;
  return (result.data as StateRevisionRow[] | null) ?? [];
};

const withHistory = (
  state: PlannerState,
  revisions: StateRevisionRow[],
  currentRevisionId: string | null,
): PlannerState => {
  const currentIndex = currentRevisionId
    ? revisions.findIndex((revision) => revision.id === currentRevisionId)
    : -1;

  return {
    ...state,
    history: {
      currentRevisionId: currentRevisionId ?? undefined,
      canUndo: currentIndex > 0,
      canRedo: currentIndex >= 0 && currentIndex < revisions.length - 1,
      revisionCount: revisions.length,
    },
  };
};

export const hasPlannerContent = (state: PlannerState): boolean =>
  state.messages.length > 0 ||
  state.tasks.length > 0 ||
  state.calendarEvents.length > 0 ||
  state.dependencies.length > 0 ||
  (state.schedule?.length ?? 0) > 0;

const findLatestNonEmptyRevision = (revisions: StateRevisionRow[]): StateRevisionRow | null => {
  for (let index = revisions.length - 1; index >= 0; index -= 1) {
    const revision = revisions[index];
    if (hasPlannerContent(revision.snapshot)) {
      return revision;
    }
  }

  return null;
};

export const isSuspiciousEmptyOverwrite = (
  currentState: PlannerState,
  nextState: PlannerState,
  allowEmptyReset = false,
): boolean => hasPlannerContent(currentState) && !hasPlannerContent(nextState) && !allowEmptyReset;

const normalizePlannerState = async (
  user: AuthenticatedUser,
  state: PlannerState,
): Promise<PlannerState> => {
  const [settings, replanning] = await Promise.all([
    loadProfileSettings(user.id),
    loadReplanningBundleForUser(user.id),
  ]);

  return {
    ...DEFAULT_PLANNER_STATE,
    ...state,
    id: user.id,
    profileId: user.id,
    timezone: settings.timezone,
    locale: settings.locale,
    replanning,
  };
};

const writeLiveState = async (
  user: AuthenticatedUser,
  payload: PlannerState,
  currentRevisionId: string | null,
): Promise<PlannerState> => {
  const supabase = getSupabaseAdmin();
  const schedule = payload.schedule ?? [];
  const baseDate = payload.scheduleBaseDate ?? new Date().toISOString();

  const plannerStateUpsert = await supabase.from('planner_states').upsert(
    {
      user_id: user.id,
      work_window: payload.workWindow,
      strategy: payload.strategy,
      schedule_base_date: baseDate,
      diagnostics: payload.diagnostics ?? null,
      current_revision_id: currentRevisionId,
    },
    { onConflict: 'user_id' },
  );

  if (plannerStateUpsert.error) throw plannerStateUpsert.error;

  const clearResults = await Promise.all([
    supabase.from('chat_messages').delete().eq('user_id', user.id),
    supabase.from('task_dependencies').delete().eq('user_id', user.id),
    supabase.from('calendar_events').delete().eq('user_id', user.id),
    supabase.from('work_blocks').delete().eq('user_id', user.id),
    supabase.from('tasks').delete().eq('user_id', user.id),
  ]);

  clearResults.forEach((result) => {
    if (result.error) throw result.error;
  });

  const taskRows = serializeTasks(user.id, payload.tasks);
  if (taskRows.length > 0) {
    const taskInsert = await supabase.from('tasks').insert(taskRows);
    if (taskInsert.error) throw taskInsert.error;
  }

  const dependencyRows = serializeDependencies(user.id, payload.dependencies);
  if (dependencyRows.length > 0) {
    const dependencyInsert = await supabase.from('task_dependencies').insert(dependencyRows);
    if (dependencyInsert.error) throw dependencyInsert.error;
  }

  const calendarEventRows = serializeCalendarEvents(user.id, payload.calendarEvents);
  if (calendarEventRows.length > 0) {
    const calendarInsert = await supabase.from('calendar_events').insert(calendarEventRows);
    if (calendarInsert.error) throw calendarInsert.error;
  }

  const blockRows = serializeWorkBlocks(user.id, schedule);
  if (blockRows.length > 0) {
    const blockInsert = await supabase.from('work_blocks').insert(blockRows);
    if (blockInsert.error) throw blockInsert.error;
  }

  const messageRows = serializeMessages(user.id, payload.messages);
  if (messageRows.length > 0) {
    const messageInsert = await supabase.from('chat_messages').insert(messageRows);
    if (messageInsert.error) throw messageInsert.error;
  }

  return normalizePlannerState(user, {
    ...DEFAULT_PLANNER_STATE,
    ...payload,
    id: user.id,
    schedule,
    scheduleBaseDate: baseDate,
  });
};

const saveRevisionSnapshot = async (
  userId: string,
  state: PlannerState,
  previousRevisionId: string | null,
): Promise<string> => {
  const supabase = getSupabaseAdmin();

  if (previousRevisionId) {
    const revisions = await getRevisionRows(userId);
    const previous = revisions.find((revision) => revision.id === previousRevisionId);
    if (previous) {
      const futureIds = revisions
        .filter((revision) => revision.revision_number > previous.revision_number)
        .map((revision) => revision.id);

      if (futureIds.length > 0) {
        const deleteFuture = await supabase.from('state_revisions').delete().in('id', futureIds);
        if (deleteFuture.error) throw deleteFuture.error;
      }
    }
  }

  const insertResult = await supabase
    .from('state_revisions')
    .insert({
      user_id: userId,
      snapshot: state,
    })
    .select('id')
    .single();

  if (insertResult.error || !insertResult.data) {
    throw insertResult.error ?? new Error('No fue posible guardar la revisión.');
  }

  const revisionId = insertResult.data.id as string;
  const revisions = await getRevisionRows(userId);
  const excess = revisions.slice(0, Math.max(0, revisions.length - REVISION_LIMIT)).map((revision) => revision.id);

  if (excess.length > 0) {
    const deleteOld = await supabase.from('state_revisions').delete().in('id', excess);
    if (deleteOld.error) throw deleteOld.error;
  }

  const updateCurrent = await supabase
    .from('planner_states')
    .update({ current_revision_id: revisionId })
    .eq('user_id', userId);

  if (updateCurrent.error) throw updateCurrent.error;
  return revisionId;
};

export const loadPlannerState = async (user: AuthenticatedUser): Promise<PlannerState> => {
  const supabase = getSupabaseAdmin();
  const [plannerState, revisions] = await Promise.all([
    getPlannerStateRow(user.id),
    getRevisionRows(user.id),
  ]);

  const [tasksResult, dependenciesResult, calendarEventsResult, workBlocksResult, messagesResult] = await Promise.all([
    supabase.from('tasks').select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
    supabase
      .from('task_dependencies')
      .select('from_task_id, to_task_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('calendar_events')
      .select('id, title, start_minute, end_minute, kind, source_provider, external_event_id')
      .eq('user_id', user.id)
      .order('start_minute', { ascending: true }),
    supabase
      .from('work_blocks')
      .select('task_id, start_minute, end_minute')
      .eq('user_id', user.id)
      .order('start_minute', { ascending: true }),
    supabase
      .from('chat_messages')
      .select('role, text, position, metadata')
      .eq('user_id', user.id)
      .order('position', { ascending: true }),
  ]);

  if (tasksResult.error) throw tasksResult.error;
  if (dependenciesResult.error) throw dependenciesResult.error;
  if (calendarEventsResult.error) throw calendarEventsResult.error;
  if (workBlocksResult.error) throw workBlocksResult.error;
  if (messagesResult.error) throw messagesResult.error;

  const tasks = ((tasksResult.data as TaskRow[] | null) ?? []).map(mapTaskRow);
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const schedule = ((workBlocksResult.data as WorkBlockRow[] | null) ?? [])
    .map((row) => mapWorkBlockRow(row, taskMap))
    .filter(Boolean) as ScheduledTask[];

  const state = await normalizePlannerState(user, {
    ...DEFAULT_PLANNER_STATE,
    id: user.id,
    messages: ((messagesResult.data as ChatMessageRow[] | null) ?? []).map(mapMessageRow),
    tasks,
    calendarEvents: ((calendarEventsResult.data as CalendarEventRow[] | null) ?? []).map(mapCalendarEventRow),
    dependencies: ((dependenciesResult.data as DependencyRow[] | null) ?? []).map(mapDependencyRow),
    workWindow: plannerState.work_window ?? DEFAULT_PLANNER_STATE.workWindow,
    strategy: plannerState.strategy ?? DEFAULT_PLANNER_STATE.strategy,
    schedule,
    diagnostics: plannerState.diagnostics ?? null,
    scheduleBaseDate: plannerState.schedule_base_date,
  });

  if (!hasPlannerContent(state)) {
    const fallbackRevision = findLatestNonEmptyRevision(revisions);
    if (fallbackRevision) {
      const recoveredState = normalizePlannerStateForPersistence(
        await normalizePlannerState(user, fallbackRevision.snapshot),
      );
      const restored = await writeLiveState(user, recoveredState, fallbackRevision.id);
      return withHistory(restored, revisions, fallbackRevision.id);
    }
  }

  return withHistory(state, revisions, plannerState.current_revision_id);
};

export const savePlannerState = async (
  user: AuthenticatedUser,
  payload: PlannerStateSyncPayload | PlannerState,
): Promise<PlannerState> => {
  return runPlannerWriteExclusive(user.id, async () => {
    const plannerState = await getPlannerStateRow(user.id);
    const existingRevisions = await getRevisionRows(user.id);
    const currentLiveState = await loadPlannerState(user);
    let previousRevisionId = plannerState.current_revision_id;

    if (existingRevisions.length === 0) {
      if (hasPlannerContent(currentLiveState)) {
        previousRevisionId = await saveRevisionSnapshot(user.id, currentLiveState, null);
      }
    }

    const normalized = normalizePlannerStateForPersistence(
      await normalizePlannerState(user, {
        ...DEFAULT_PLANNER_STATE,
        ...payload,
        id: user.id,
        schedule: payload.schedule ?? [],
        scheduleBaseDate: payload.scheduleBaseDate ?? new Date().toISOString(),
      }),
    );

    const allowEmptyReset =
      'allowEmptyReset' in payload && payload.allowEmptyReset === true;

    if (isSuspiciousEmptyOverwrite(currentLiveState, normalized, allowEmptyReset)) {
      throw new Error('Refusing to overwrite a non-empty planner state with an empty payload.');
    }

    const savedState = await writeLiveState(user, normalized, previousRevisionId);
    const currentRevisionId = await saveRevisionSnapshot(user.id, savedState, previousRevisionId);
    const revisions = await getRevisionRows(user.id);
    return withHistory(savedState, revisions, currentRevisionId);
  });
};

export const appendChatMessage = async (
  user: AuthenticatedUser,
  userText: string,
  modelText: string,
): Promise<PlannerState> => {
  return runPlannerWriteExclusive(user.id, async () => {
    const currentState = await loadPlannerState(user);
    const supabase = getSupabaseAdmin();
    
    // Simple append: add two messages to the end
    const nextPosition = currentState.messages.length;
    const messagesToWrite = [
      { user_id: user.id, role: 'user', text: userText, position: nextPosition },
      { user_id: user.id, role: 'model', text: modelText, position: nextPosition + 1 }
    ];

    const messageInsert = await supabase.from('chat_messages').insert(messagesToWrite);
    if (messageInsert.error) throw messageInsert.error;

    return {
      ...currentState,
      messages: [...currentState.messages, 
        { role: 'user', text: userText } as any, 
        { role: 'model', text: modelText } as any
      ]
    };
  });
};

export const undoPlannerState = async (user: AuthenticatedUser): Promise<PlannerState> => {
  return runPlannerWriteExclusive(user.id, async () => {
    const plannerState = await getPlannerStateRow(user.id);
    const revisions = await getRevisionRows(user.id);
    const currentIndex = revisions.findIndex((revision) => revision.id === plannerState.current_revision_id);

    if (currentIndex <= 0) {
      return loadPlannerState(user);
    }

    const targetRevision = revisions[currentIndex - 1];
    const targetState = normalizePlannerStateForPersistence(await normalizePlannerState(user, targetRevision.snapshot));
    const restored = await writeLiveState(user, targetState, targetRevision.id);
    return withHistory(restored, revisions, targetRevision.id);
  });
};

export const redoPlannerState = async (user: AuthenticatedUser): Promise<PlannerState> => {
  return runPlannerWriteExclusive(user.id, async () => {
    const plannerState = await getPlannerStateRow(user.id);
    const revisions = await getRevisionRows(user.id);
    const currentIndex = revisions.findIndex((revision) => revision.id === plannerState.current_revision_id);

    if (currentIndex === -1 || currentIndex >= revisions.length - 1) {
      return loadPlannerState(user);
    }

    const targetRevision = revisions[currentIndex + 1];
    const targetState = normalizePlannerStateForPersistence(await normalizePlannerState(user, targetRevision.snapshot));
    const restored = await writeLiveState(user, targetState, targetRevision.id);
    return withHistory(restored, revisions, targetRevision.id);
  });
};

export const recordScheduleRun = async (user: AuthenticatedUser, run: ScheduleRunRecord): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase.from('schedule_runs').insert({
    user_id: user.id,
    strategy: run.strategy,
    task_count: run.taskCount,
    score: run.score,
    status: run.status,
    diagnostics: run.diagnostics ?? null,
    schedule: run.schedule ?? null,
    config_used: run.configUsed ?? {},
  });

  if (result.error) throw result.error;
};
