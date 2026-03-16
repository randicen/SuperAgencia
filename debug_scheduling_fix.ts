
import { runAutoScheduling } from './utils/schedulingLogic';
import { Project, Priority, BusinessRules } from './types';

// Mock Rules
const rules: BusinessRules = {
    workingDays: [1, 2, 3, 4, 5],
    workingHoursStart: '09:00',
    workingHoursEnd: '17:00',
    maxProjectsCapacity: 10,
    blockedSlots: []
};

// Mock Project (Task with Empty Deadline)
const taskEmptyDeadline: Project = {
    id: 'test-empty-deadline',
    projectName: 'Task No Deadline',
    clientId: '',
    clientName: '',
    status: 'todo',
    progress: 0,
    priority: Priority.MEDIUM,
    duration: 120, // 2 hours
    elasticity: 1,
    deadlineType: 'Soft Deadline',
    autoSchedule: true,
    startDate: '',
    dueDate: '',   // EMPTY
    endDate: '',
    totalValue: 0,
    paidValue: 0,
    scheduledSlots: [],
    hasConflict: false
};

console.log('--- TEST: EMPTY DEADLINE ---');
const resultsMax = runAutoScheduling([taskEmptyDeadline], rules);
const resMax = resultsMax[0];
console.log('Scheduled:', resMax.scheduledSlots.length > 0 ? 'YES' : 'NO');
console.log('Slots:', resMax.scheduledSlots.length);
if (resMax.scheduledSlots.length > 0) {
    console.log('Start:', resMax.startDate);
    console.log('End:', resMax.endDate);
}

// Validation
if (resMax.scheduledSlots.length === 0) {
    console.error('FAIL: Task with empty deadline was NOT scheduled.');
} else {
    console.log('SUCCESS: Task with empty deadline was scheduled (using infinite window).');
}
