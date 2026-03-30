
import { Project, Priority } from '../types';
import { SpaceTask } from '../spacesTypes';
import { parseLocalDate } from './dateUtils';

// Helper to calculate business days between two dates
export const getBusinessDays = (startDate: Date, endDate: Date): number => {
    let count = 0;
    const curDate = new Date(startDate.getTime());
    while (curDate <= endDate) {
        const dayOfWeek = curDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) count++;
        curDate.setDate(curDate.getDate() + 1);
    }
    return count;
};

// Helper to format slack (margin) text
// We accept both Project (from Gantt) and SpaceTask (from Spaces) if they have compatible fields
// For SpaceTask we might need to adapt or ensure fields exist.
// Assuming SpaceTask has: dueDate, duration (minutes), startDate (optional), endDate (optional)

export const getFormattedSlack = (task: { dueDate: string; duration: number; }): { text: string; isOverdue: boolean; days: number } => {
    const now = new Date();

    if (!task.dueDate) return { text: 'Sin Fecha', isOverdue: false, days: 999 };

    const dueMs = parseLocalDate(task.dueDate, true);
    if (!dueMs) return { text: 'Error Fecha', isOverdue: false, days: 0 };
    const due = new Date(dueMs);

    const timeDiffMs = due.getTime() - now.getTime();
    
    // Effort in ms
    const durationMs = (task.duration || 0) * 60 * 1000;
    
    // Slack = Time until deadline - Time needed to complete
    const slackMs = timeDiffMs - durationMs;
    const slackDays = slackMs / (1000 * 3600 * 24);
    
    const isOverdue = slackMs < 0;
    const absSlackMs = Math.abs(slackMs);
    
    const d = Math.floor(absSlackMs / (1000 * 3600 * 24));
    const h = Math.floor((absSlackMs % (1000 * 3600 * 24)) / (1000 * 3600));
    const m = Math.floor((absSlackMs % (1000 * 3600)) / (1000 * 60));

    let textStr = '';
    if (d > 0) {
        textStr = h > 0 ? `${d}d ${h}h` : `${d}d`;
    } else if (h > 0) {
        textStr = m > 0 ? `${h}h ${m}m` : `${h}h`;
    } else {
        textStr = m > 0 ? `${m}m` : '0m';
    }

    return { 
        text: isOverdue ? `${textStr} Venc.` : `${textStr} Margen`, 
        isOverdue, 
        days: slackDays // Keep float so sorting by days still works
    };
};

export const getPriorityColor = (priority: string | Priority) => {
    switch (priority) {
        case 'ASAP':
        case Priority.ASAP: return 'bg-purple-100 text-purple-700 border-purple-300';
        case 'High':
        case Priority.HIGH: return 'bg-red-100 text-red-700 border-red-300';
        case 'Medium':
        case Priority.MEDIUM: return 'bg-orange-100 text-orange-700 border-orange-300';
        case 'Low':
        case Priority.LOW: return 'bg-emerald-100 text-emerald-700 border-emerald-300';
        default: return 'bg-slate-100 text-slate-700 border-slate-300';
    }
};

export const getPriorityBadgeStyle = (priority: string | Priority) => {
    switch (priority) {
        case 'ASAP':
        case Priority.ASAP: return 'bg-purple-600 text-white';
        case 'High':
        case Priority.HIGH: return 'bg-red-600 text-white';
        case 'Medium':
        case Priority.MEDIUM: return 'bg-orange-500 text-white';
        case 'Low':
        case Priority.LOW: return 'bg-emerald-600 text-white';
        default: return 'bg-slate-600 text-white';
    }
};
