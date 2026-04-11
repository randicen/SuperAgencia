import { differenceInMinutes, parseISO, startOfDay } from 'date-fns';
import type { CalendarEvent, Task, Dependency, ScheduledTask, WorkWindow } from '../src/lib/solver.js';

// Types for the AI response (Structured JSON)
type AgentResponse = {
  text: string; // Message to the user
  tasks: Task[]; // Full updated task list
  calendarEvents: CalendarEvent[]; // Full updated event list
  dependencies: Dependency[]; // Full updated dependencies
};

type AgentInput = {
  userMessage: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  tasks: Task[];
  calendarEvents: CalendarEvent[];
  dependencies: Dependency[];
  schedule?: ScheduledTask[];
  workWindow: WorkWindow;
  strategy: string;
};

const buildSystemPrompt = (tasks: Task[], events: CalendarEvent[], workWindow: WorkWindow, strategy: string) => `
You are Tandeba, an elite scheduling assistant.
Your goal is to manage the user's agenda based on their requests.

### CURRENT STATE
**Tasks:** ${JSON.stringify(tasks)}
**Events:** ${JSON.stringify(events)}
**Work Window:** ${workWindow.startHour}:00 to ${workWindow.endHour}:00
**Strategy:** ${strategy}

### INSTRUCTIONS
1. **Understand the Request**: The user will send a message. It might be a chat question or a scheduling command.
2. **Update State**: 
   - If the user wants to ADD/MODIFY tasks or events, you must output the **COMPLETE** updated list of 'tasks' and 'calendarEvents'.
   - If the user wants to DELETE, remove the item from the list.
   - Dates MUST be ISO 8601 (e.g., "2026-04-11T15:00:00"). Use "today" as reference for relative times.
   - If a task is scheduled at a specific time, set 'fixedStart'. If it's flexible, leave it null.
3. **Response**: 
   - Provide a natural, concise response in Spanish ('text').
   - Confirm what you did (e.g., "He agendado tu reunión a las 3 PM").
   - If you cannot do something, explain why politely.

### OUTPUT FORMAT
Return ONLY valid JSON with this shape:
{
  "text": "Your message to the user",
  "tasks": [ /* full task list */ ],
  "calendarEvents": [ /* full event list */ ],
  "dependencies": []
}
`;

export async function runAgent(input: AgentInput): Promise<AgentResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY missing');

  const systemPrompt = buildSystemPrompt(input.tasks, input.calendarEvents, input.workWindow, input.strategy);
  
  const messages = [
    { role: 'system', content: systemPrompt },
    ...input.history.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    })),
    { role: 'user', content: input.userMessage }
  ];

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.PUBLIC_APP_URL || 'https://tandeba.com',
        'X-Title': 'Tandeba'
      },
      body: JSON.stringify({
        model: 'google/gemma-3-12b-it', // DeepInfra via OpenRouter
        messages,
        response_format: { type: 'json_object' } // Force JSON
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from model');

    // Parse JSON safely
    const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return parsed as AgentResponse;
  } catch (error) {
    console.error('AI Error:', error);
    throw error;
  }
}
