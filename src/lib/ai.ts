import { GoogleGenAI, Type } from '@google/genai';
import { differenceInMinutes, parseISO, startOfDay } from 'date-fns';
import type { CalendarEvent, Dependency, ScheduledTask, Task, WorkWindow } from './solver';
import { solveSchedule } from './solver';

const updateScheduleTool = {
  name: 'updateSchedule',
  description:
    "Updates tasks, calendar events, and dependencies based on the user's request.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      tasks: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            name: { type: Type.STRING },
            duration: { type: Type.NUMBER },
            fixedStartDateTime: { type: Type.STRING },
            minStartDateTime: { type: Type.STRING },
            deadlineDateTime: { type: Type.STRING },
            priority: { type: Type.STRING, enum: ['ASAP', 'high', 'medium', 'low'] },
            elastic: { type: Type.BOOLEAN },
            minChunkSize: { type: Type.NUMBER },
            progress: { type: Type.NUMBER },
            deadlineType: { type: Type.STRING, enum: ['Hard Deadline', 'Soft Deadline'] },
          },
          required: ['id', 'name', 'duration'],
        },
      },
      dependencies: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            fromId: { type: Type.STRING },
            toId: { type: Type.STRING },
          },
          required: ['fromId', 'toId'],
        },
      },
      calendarEvents: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            title: { type: Type.STRING },
            startDateTime: { type: Type.STRING },
            endDateTime: { type: Type.STRING },
            kind: { type: Type.STRING, enum: ['meeting', 'personal', 'focus', 'blocked'] },
          },
          required: ['id', 'title', 'startDateTime', 'endDateTime'],
        },
      },
    },
    required: ['tasks', 'dependencies', 'calendarEvents'],
  },
};

export async function chatWithSolver(
  userMessage: string,
  history: { role: 'user' | 'model'; text: string }[],
  currentTasks: Task[],
  currentCalendarEvents: CalendarEvent[],
  currentDependencies: Dependency[],
  workWindow: WorkWindow,
  strategy: 'balanced' | 'survival' | 'intelligent',
  currentSchedule?: ScheduledTask[],
): Promise<{
  text: string;
  newTasks?: Task[];
  newCalendarEvents?: CalendarEvent[];
  newDependencies?: Dependency[];
  newSchedule?: ScheduledTask[] | null;
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is missing.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const now = new Date();
  const baseDate = startOfDay(now);
  const contents = [
    ...history.map((msg) => ({ role: msg.role, parts: [{ text: msg.text }] })),
    { role: 'user' as const, parts: [{ text: userMessage }] },
  ];

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite-preview',
    contents,
    config: {
      systemInstruction: `Responde en español y usa updateSchedule para proponer cambios sobre tareas, eventos y dependencias.
Tareas actuales: ${JSON.stringify(currentTasks)}
Eventos actuales: ${JSON.stringify(currentCalendarEvents)}
Dependencias actuales: ${JSON.stringify(currentDependencies)}`,
      tools: [{ functionDeclarations: [updateScheduleTool] }],
      temperature: 0.2,
    },
  });

  let newTasks: Task[] | undefined;
  let newCalendarEvents: CalendarEvent[] | undefined;
  let newDependencies: Dependency[] | undefined;
  let newSchedule: ScheduledTask[] | null | undefined;

  const call = response.functionCalls?.[0];
  if (call?.name === 'updateSchedule') {
    const rawTasks = (call.args.tasks || []) as any[];
    const rawEvents = (call.args.calendarEvents || []) as any[];
    const proposedDependencies = (call.args.dependencies || []) as Dependency[];

    newTasks = rawTasks.map((task) => ({
      id: task.id,
      name: task.name,
      duration: task.duration,
      fixedStart: task.fixedStartDateTime
        ? differenceInMinutes(parseISO(task.fixedStartDateTime), baseDate)
        : undefined,
      minStart: task.minStartDateTime
        ? differenceInMinutes(parseISO(task.minStartDateTime), baseDate)
        : undefined,
      deadline: task.deadlineDateTime
        ? differenceInMinutes(parseISO(task.deadlineDateTime), baseDate)
        : undefined,
      priority: task.priority,
      elastic: task.elastic,
      minChunkSize: task.minChunkSize,
      progress: task.progress,
      deadlineType: task.deadlineType,
    }));

    newCalendarEvents = rawEvents.map((event) => ({
      id: event.id,
      title: event.title,
      start: differenceInMinutes(parseISO(event.startDateTime), baseDate),
      end: differenceInMinutes(parseISO(event.endDateTime), baseDate),
      kind: event.kind,
    }));

    newDependencies = proposedDependencies;
    const validation = solveSchedule(
      newTasks,
      newDependencies,
      newCalendarEvents,
      workWindow,
      strategy,
      now.getHours() * 60 + now.getMinutes(),
      7,
      15,
      currentSchedule,
    );
    newSchedule = validation.schedule;
  }

  return {
    text: response.text || 'He actualizado la agenda.',
    newTasks,
    newCalendarEvents,
    newDependencies,
    newSchedule,
  };
}
