
import { Project, Priority } from '../types';
import { SpaceTask } from '../spacesTypes';

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
    const today = new Date();
    // today.setHours(0, 0, 0, 0); // Keep time for more precision? Or just strip it.
    // Logic below seems day-based. Let's keep it consistent but safe.
    today.setHours(0, 0, 0, 0);

    // Parse dueDate safely
    if (!task.dueDate) return { text: 'Sin Fecha', isOverdue: false, days: 999 };

    const due = new Date(task.dueDate);
    if (isNaN(due.getTime())) return { text: 'Error Fecha', isOverdue: false, days: 0 };

    // If input was just YYYY-MM-DD, set to end of that day
    if (!task.dueDate.includes('T')) {
        due.setHours(23, 59, 59);
    } else {
        // If it has time, stick with it? Or normalize to EOD for margin calc?
        // Original logic forced EOD. Let's respect time if present, relative to 'now'.
        // But the original code compared against today-start-of-day.
        // Let's stick to simple day diff for consistency with "Days Margin".
        // Or better: calculate precise hours if less than a day?
        // The return type is "Xd Margen".
    }

    const timeDiff = due.getTime() - today.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));

    // Calculate effort in days (approx 8h/day)
    // Fallback duration to 0 if NaN/undefined
    const duration = task.duration || 0;
    const effortDays = Math.ceil((duration / 60) / 8);

    // Slack = Days until deadline - Days needed to complete
    const slackDays = daysDiff - effortDays;

    if (isNaN(slackDays)) return { text: 'NaN', isOverdue: false, days: 0 }; // Should not happen now

    if (slackDays < 0) {
        return { text: `${Math.abs(slackDays)}d Vencido`, isOverdue: true, days: slackDays };
    } else {
        return { text: `${slackDays}d Margen`, isOverdue: false, days: slackDays };
    }
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
