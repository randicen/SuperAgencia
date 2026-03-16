
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

// Mock Project (Task)
const initialTask: Project = {
    id: 'test-1',
    projectName: 'Test Task',
    clientId: '',
    clientName: '',
    status: 'todo',
    progress: 0,
    priority: Priority.MEDIUM,
    duration: 120, // 2 hours
    elasticity: 1,
    deadlineType: 'Soft Deadline',
    autoSchedule: true,
    startDate: '2026-01-26', // Min Start
    dueDate: '2026-01-30',   // Deadline
    totalValue: 0,
    paidValue: 0,
    scheduledSlots: [],
    hasConflict: false,
    endDate: '2026-01-30' // Initial Value (matches due date usually)
};

console.log('--- INITIAL STATE ---');
console.log('StartDate (Constraint):', initialTask.startDate);
console.log('DueDate (Deadline):', initialTask.dueDate);
console.log('EndDate (Previous):', initialTask.endDate);

// Run Scheduler
console.log('\n--- RUNNING SCHEDULER ---');
const results = runAutoScheduling([initialTask], rules);
const result = results[0];

console.log('\n--- RESULT STATE ---');
console.log('StartDate (Calculated):', result.startDate);
console.log('DueDate (Preserved?):', result.dueDate);
console.log('EndDate (Calculated):', result.endDate);
console.log('Slots Found:', result.scheduledSlots.length);
if (result.scheduledSlots.length > 0) {
    console.log('First Slot:', result.scheduledSlots[0].start);
    console.log('Last Slot:', result.scheduledSlots[result.scheduledSlots.length - 1].end);
}

// Validation
if (result.dueDate !== initialTask.dueDate) {
    console.error('FAIL: User Deadline (dueDate) was modified!');
} else {
    console.log('SUCCESS: User Deadline preserved.');
}

if (result.startDate !== initialTask.startDate) {
    console.warn('NOTE: Min Start Date was overwritten by Actual Start Date. This implies loss of constraint persistence if saved back to input.');
}
