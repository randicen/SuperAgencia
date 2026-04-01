import assert from 'node:assert/strict';
import test from 'node:test';
import type { SpacesState, SpaceTask } from '../spacesTypes.ts';
import { normalizeSpacesStateWorkModel, normalizeTaskWorkModel } from './taskWorkBlocks.ts';

const TEST_RULES = {
  baseHourlyRate: 0,
  urgencyThresholdDays: 3,
  urgencyMarkup: 0,
  maxProjectsCapacity: 10,
  workingDays: [1, 2, 3, 4, 5],
  workingHoursStart: '09:00',
  workingHoursEnd: '18:00',
  customRules: '',
  historicalSeasonality: {},
};

const baseTask = (overrides: Partial<SpaceTask> = {}): SpaceTask => ({
  id: 'task-1',
  nombre: 'Redisenar propuesta',
  estado: 'TODO',
  orden: 1,
  progress: 10,
  autoSchedule: true,
  startDate: '2026-04-01T09:00',
  endDate: '2026-04-01T11:00',
  dueDate: '2026-04-10T18:00',
  deadlineType: 'Soft Deadline',
  duration: 120,
  elasticity: 1,
  priority: 'High',
  totalValue: 0,
  ...overrides,
});

test('normalizeTaskWorkModel mirrors legacy scheduled slots into work blocks', () => {
  const task = baseTask({
    scheduledSlots: [
      { id: 'slot-1', start: '2026-04-02T09:00', end: '2026-04-02T10:30', isFragment: true },
      { id: 'slot-2', start: '2026-04-03T14:00', end: '2026-04-03T15:00', isFragment: true },
    ],
  });

  const normalized = normalizeTaskWorkModel(task);

  assert.equal(normalized.workStyle, 'flexible');
  assert.equal(normalized.estimatedEffortMinutes, 120);
  assert.equal(normalized.workBlocks?.length, 2);
  assert.equal(normalized.workBlocks?.[0].taskId, task.id);
  assert.equal(normalized.workBlocks?.[0].source, 'ai');
});

test('normalizeTaskWorkModel rebuilds legacy scheduling fields from work blocks', () => {
  const task = baseTask({
    autoSchedule: false,
    startDate: '',
    endDate: '',
    scheduledSlots: undefined,
    workBlocks: [
      {
        id: 'block-1',
        taskId: 'task-1',
        startAt: '2026-04-05T08:00',
        endAt: '2026-04-05T10:00',
        source: 'manual',
        status: 'planned',
        locked: true,
      },
    ],
  });

  const normalized = normalizeTaskWorkModel(task);

  assert.equal(normalized.scheduledSlots?.length, 1);
  assert.equal(normalized.startDate, '2026-04-05T08:00');
  assert.equal(normalized.endDate, '2026-04-05T10:00');
  assert.equal(normalized.workStyle, 'flexible');
});

test('normalizeSpacesStateWorkModel normalizes nested task trees', () => {
  const state: SpacesState = {
    workspaces: [
      {
        id: 'ws-1',
        nombre: 'WS',
        agendaEvents: [],
        espacios: [
          {
            id: 'space-1',
            nombre: 'Space',
            color: '#000',
            listas: [
              {
                id: 'list-1',
                nombre: 'Lista',
                eventos: [],
                tareas: [
                  baseTask({
                    subtasks: [
                      baseTask({
                        id: 'sub-1',
                        scheduledSlots: [{ id: 'slot-3', start: '2026-04-04T09:00', end: '2026-04-04T10:00', isFragment: false }],
                      }),
                    ],
                  }),
                ],
              },
            ],
            carpetas: [],
          },
        ],
      },
    ],
    activeWorkspaceId: 'ws-1',
    activeSpaceId: 'space-1',
    activeFolderId: null,
    activeListId: 'list-1',
    lastSelectionByWorkspace: {},
    expandedIds: [],
    rules: TEST_RULES,
    gcalEvents: [],
    rulesOverride: null,
  };

  const normalized = normalizeSpacesStateWorkModel(state);
  const nestedSubtask = normalized.workspaces[0].espacios[0].listas[0].tareas[0].subtasks?.[0];

  assert.equal(nestedSubtask?.workBlocks?.length, 1);
  assert.equal(nestedSubtask?.estimatedEffortMinutes, 120);
});
