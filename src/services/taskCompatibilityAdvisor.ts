import OpenAI from 'openai';
import { SpaceTask } from '../spacesTypes';

const MODEL = 'openai/gpt-oss-120b';
const GROQ_KEYS = [
  // @ts-ignore
  import.meta.env.VITE_GROQ_API_KEY || '',
  // @ts-ignore
  import.meta.env.VITE_GROQ_API_KEY_BACKUP || '',
].filter(Boolean);

export interface TaskCompatibilityCandidate {
  id: string;
  nombre: string;
  clientName?: string;
  autoSchedule: boolean;
  startDate?: string;
  endDate?: string;
  dueDate?: string;
  priority?: string;
  description?: string;
}

export interface TaskCompatibilitySuggestion {
  taskId: string;
  taskName: string;
  reason: string;
}

const createClient = (apiKey: string) => new OpenAI({
  apiKey,
  baseURL: 'https://api.groq.com/openai/v1',
  dangerouslyAllowBrowser: true,
});

const buildCompactTask = (task: TaskCompatibilityCandidate) => ({
  id: task.id,
  nombre: task.nombre,
  cliente: task.clientName || '',
  modo: task.autoSchedule ? 'auto' : 'manual',
  inicio: task.startDate || '',
  fin: task.endDate || '',
  limite: task.dueDate || '',
  prioridad: task.priority || '',
  descripcion: task.description || '',
});

const fallbackSuggestions = (
  candidate: TaskCompatibilityCandidate,
  existingTasks: TaskCompatibilityCandidate[]
): TaskCompatibilitySuggestion[] => {
  const candidateText = `${candidate.nombre} ${candidate.description || ''}`.toLowerCase();
  const socialKeywords = ['fiesta', 'salir', 'viaje', 'reunión', 'cita', 'parque', 'evento'];
  const careKeywords = ['cuidar', 'niño', 'niña', 'sobrino', 'sobrina', 'hijo', 'bebé'];
  const focusKeywords = ['estudiar', 'repasar', 'tesis', 'escribir', 'examen', 'investigar'];

  return existingTasks.flatMap((task) => {
    const currentText = `${task.nombre} ${task.description || ''}`.toLowerCase();
    const socialVsCare = socialKeywords.some((keyword) => candidateText.includes(keyword)) && careKeywords.some((keyword) => currentText.includes(keyword));
    const careVsSocial = careKeywords.some((keyword) => candidateText.includes(keyword)) && socialKeywords.some((keyword) => currentText.includes(keyword));
    const focusVsSocial = focusKeywords.some((keyword) => candidateText.includes(keyword)) && socialKeywords.some((keyword) => currentText.includes(keyword));
    const socialVsFocus = socialKeywords.some((keyword) => candidateText.includes(keyword)) && focusKeywords.some((keyword) => currentText.includes(keyword));

    if (!(socialVsCare || careVsSocial || focusVsSocial || socialVsFocus)) return [];

    return [{
      taskId: task.id,
      taskName: task.nombre,
      reason: 'Parece difícil hacer ambas al mismo tiempo por tipo de atención o contexto.',
    }];
  }).slice(0, 4);
};

export const suggestTemporalExclusions = async (
  candidate: TaskCompatibilityCandidate,
  existingTasks: TaskCompatibilityCandidate[]
): Promise<TaskCompatibilitySuggestion[]> => {
  if (!candidate.nombre.trim() || existingTasks.length === 0) return [];

  const trimmedTasks = existingTasks
    .filter((task) => task.id !== candidate.id)
    .slice(0, 12);

  if (trimmedTasks.length === 0) return [];

  if (GROQ_KEYS.length === 0) {
    return fallbackSuggestions(candidate, trimmedTasks);
  }

  const prompt = [
    'Analiza compatibilidad temporal entre tareas.',
    'Debes sugerir exclusiones SOLO si es bastante probable que dos tareas no puedan convivir en la misma franja.',
    'Si hay duda, responde vacío.',
    'No evalúes por fechas; evalúa por intención, tipo de atención, contexto y compatibilidad práctica.',
    'Devuelve JSON con esta forma exacta: {"suggestions":[{"taskId":"...","taskName":"...","reason":"..."}]}.',
    'No inventes taskId. Solo usa ids existentes.',
    'Máximo 4 sugerencias.',
  ].join(' ');

  const userPayload = JSON.stringify({
    candidate: buildCompactTask(candidate),
    existingTasks: trimmedTasks.map(buildCompactTask),
  });

  try {
    const ai = createClient(GROQ_KEYS[0]);
    const response = await ai.chat.completions.create({
      model: MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userPayload },
      ],
    });

    const rawText = response.choices[0]?.message?.content || '{"suggestions":[]}';
    const parsed = JSON.parse(rawText);
    const validIds = new Set(trimmedTasks.map((task) => task.id));

    return Array.isArray(parsed?.suggestions)
      ? parsed.suggestions
        .filter((item: any) => validIds.has(item?.taskId) && typeof item?.taskName === 'string' && typeof item?.reason === 'string')
        .slice(0, 4)
      : [];
  } catch (error) {
    console.warn('Task compatibility advisor fallback:', error);
    return fallbackSuggestions(candidate, trimmedTasks);
  }
};

export const extractTaskCompatibilityCandidates = (tasks: SpaceTask[]) => tasks.map((task) => ({
  id: task.id,
  nombre: task.nombre,
  clientName: task.clientName,
  autoSchedule: task.autoSchedule,
  startDate: task.startDate,
  endDate: task.endDate,
  dueDate: task.dueDate,
  priority: task.priority,
  description: task.description,
}));
