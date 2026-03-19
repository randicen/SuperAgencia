import { runAutoScheduling } from './utils/schedulingLogic';

const projects: any[] = [
  { id: '1', projectName: 'Carlos Tesis', priority: 'High', progress: 0, duration: 180, autoSchedule: true, elasticity: 1, status: 'todo', dueDate: '2026-03-24T12:00' },
  { id: '2', projectName: 'Katherine Tesis', priority: 'High', progress: 0, duration: 180, autoSchedule: true, elasticity: 1, status: 'todo', dueDate: '2026-03-20T19:00' }
];

const rules = {
  workingDays: [1, 2, 3, 4, 5],
  workingHoursStart: '08:00',
  workingHoursEnd: '18:00',
  strictSequential: false
};

const result = runAutoScheduling(projects, rules as any);

result.forEach(p => {
  console.log(`${p.projectName}: ${console.log(p.scheduledSlots)}`);
});
