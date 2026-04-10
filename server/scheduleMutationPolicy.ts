import type { CalendarEvent, Dependency, Task } from '../src/lib/solver.js';

function taskKey(task: Task): string {
  return task.id || task.name.trim().toLowerCase();
}

function dependencyKey(dependency: Dependency): string {
  return `${dependency.fromId}->${dependency.toId}`;
}

function calendarEventKey(event: CalendarEvent): string {
  return event.id || `${event.title.trim().toLowerCase()}@${event.start}-${event.end}`;
}

// MVP safety rule: a partial model response must not wipe existing tasks.
export function mergeTasks(
  currentTasks: Task[],
  proposedTasks: Task[],
  removedTaskIds: string[] = [],
): Task[] {
  const merged = new Map<string, Task>();
  const removedKeys = new Set(removedTaskIds.map((id) => id.trim()).filter(Boolean));

  for (const task of currentTasks) {
    const key = taskKey(task);
    if (!removedKeys.has(key) && !removedKeys.has(task.id)) {
      merged.set(key, task);
    }
  }

  for (const task of proposedTasks) {
    const key = taskKey(task);
    if (!removedKeys.has(key) && !removedKeys.has(task.id)) {
      merged.set(key, task);
    }
  }

  return [...merged.values()];
}

export function mergeDependencies(
  currentDependencies: Dependency[],
  proposedDependencies: Dependency[],
  tasks: Task[],
): Dependency[] {
  const taskIds = new Set(tasks.map((task) => task.id));
  const merged = new Map<string, Dependency>();

  for (const dependency of currentDependencies) {
    if (taskIds.has(dependency.fromId) && taskIds.has(dependency.toId)) {
      merged.set(dependencyKey(dependency), dependency);
    }
  }

  for (const dependency of proposedDependencies) {
    if (taskIds.has(dependency.fromId) && taskIds.has(dependency.toId)) {
      merged.set(dependencyKey(dependency), dependency);
    }
  }

  return [...merged.values()];
}

export function mergeCalendarEvents(
  currentEvents: CalendarEvent[],
  proposedEvents: CalendarEvent[],
  removedEventIds: string[] = [],
): CalendarEvent[] {
  const merged = new Map<string, CalendarEvent>();
  const removedKeys = new Set(removedEventIds.map((id) => id.trim()).filter(Boolean));

  for (const event of currentEvents) {
    const key = calendarEventKey(event);
    if (!removedKeys.has(key) && !removedKeys.has(event.id)) {
      merged.set(key, event);
    }
  }

  for (const event of proposedEvents) {
    const key = calendarEventKey(event);
    if (!removedKeys.has(key) && !removedKeys.has(event.id)) {
      merged.set(key, event);
    }
  }

  return [...merged.values()].sort((a, b) => a.start - b.start);
}
