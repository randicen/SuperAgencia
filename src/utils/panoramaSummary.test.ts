import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPanoramaOperationalSummary } from './panoramaSummary.ts';

const baseTask = (overrides: Record<string, any> = {}) => ({
  id: 'task-1',
  nombre: 'Tarea base',
  estado: 'TODO',
  orden: 1,
  progress: 0,
  autoSchedule: false,
  startDate: '2026-03-30T08:00:00-05:00',
  endDate: '2026-03-30T10:00:00-05:00',
  dueDate: '2026-03-30T10:00:00-05:00',
  deadlineType: 'Soft Deadline',
  duration: 120,
  elasticity: 1,
  priority: 'Medium',
  totalValue: 0,
  installments: [],
  ...overrides,
});

test('panorama summary only counts the active workspace', () => {
  const state = {
    workspaces: [
      {
        id: 'ws-active',
        nombre: 'Activa',
        espacios: [
          {
            id: 'space-active',
            nombre: 'Espacio activo',
            color: '#111',
            carpetas: [],
            listas: [
              {
                id: 'list-active',
                nombre: 'Lista activa',
                tareas: [
                  baseTask({ id: 'task-due', estado: 'TODO', dueDate: '2026-03-29T10:00:00-05:00', priority: 'ASAP' }),
                  baseTask({ id: 'task-active', estado: 'ACTIVE', dueDate: '2026-03-30T12:00:00-05:00', priority: 'High' }),
                ],
                eventos: [],
              },
            ],
          },
        ],
        agendaEvents: [
          {
            id: 'agenda-active',
            nombre: 'Evento activo',
            startDate: '2026-03-30T12:00:00-05:00',
            endDate: '2026-03-30T13:00:00-05:00',
          },
        ],
      },
      {
        id: 'ws-other',
        nombre: 'Otra',
        espacios: [
          {
            id: 'space-other',
            nombre: 'Espacio otro',
            color: '#222',
            carpetas: [],
            listas: [
              {
                id: 'list-other',
                nombre: 'Lista otra',
                tareas: [
                  baseTask({ id: 'task-other', estado: 'TODO', dueDate: '2026-03-28T10:00:00-05:00', priority: 'ASAP' }),
                ],
                eventos: [],
              },
            ],
          },
        ],
        agendaEvents: [],
      },
    ],
    activeWorkspaceId: 'ws-active',
    activeSpaceId: 'space-active',
    activeFolderId: null,
    activeListId: 'list-active',
    lastSelectionByWorkspace: {},
    expandedIds: [],
    rules: {} as any,
    gcalEvents: [],
    rulesOverride: null,
  };

  const summary = buildPanoramaOperationalSummary(state as any, new Date('2026-03-30T09:00:00-05:00'));

  assert.equal(summary.todoCount, 1);
  assert.equal(summary.activeCount, 1);
  assert.equal(summary.doneCount, 0);
  assert.equal(summary.overdueCount, 1);
  assert.equal(summary.upcomingCount, 1);
  assert.equal(summary.commitmentCount, 1);
  assert.equal(summary.activeWorkspaceName, 'Activa');
});
