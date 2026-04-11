import { GoogleGenAI, Type } from '@google/genai';
import type { Task, CalendarEvent, Dependency } from '../src/lib/solver.js';

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

### CRITICAL RULES
1. **ALWAYS Return Full State**: In your JSON response, you MUST include the "tasks" and "calendarEvents" arrays.
2. **Read-Only Queries**: If the user asks a question (e.g., "what do I have today?", "hello"), you MUST return the current lists **exactly as they are**. DO NOT empty them.
3. **Modifications**: If the user adds/changes something, output the **COMPLETE** updated list (old items + new items).
4. **Deletions**: Only return empty lists if the user explicitly says "delete everything" or "clear my agenda".
5. **Dates**: Use ISO 8601 (e.g., "2026-04-11T15:00:00").

### OUTPUT FORMAT
Return ONLY valid JSON with this shape:
{
  "text": "Your natural response to the user (in Spanish)",
  "tasks": [ /* FULL list of tasks */ ],
  "calendarEvents": [ /* FULL list of events */ ],
  "dependencies": []
}
`;

export async function runAgent(input: AgentInput): Promise<AgentResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');

  const ai = new GoogleGenAI({ apiKey });
  const systemPrompt = buildSystemPrompt(input.tasks, input.calendarEvents, input.workWindow, input.strategy);
  
  // Map history to Google Content format
  const contents = input.history.map(m => ({
    role: m.role,
    parts: [{ text: m.content }]
  }));
  // Add current message
  contents.push({ role: 'user', parts: [{ text: input.userMessage }] });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      systemInstruction: systemPrompt,
      contents,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1
      }
    });

    const text = response.text;
    if (!text) throw new Error('Empty response from model');

    const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonStr) as AgentResponse;
  } catch (error) {
    console.error('AI Error:', error);
    throw error;
  }
}
