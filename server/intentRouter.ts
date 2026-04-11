import type { SearchSource } from '../src/lib/plannerState.js';

export type IntentRoute =
  | 'conversation'
  | 'planner_read'
  | 'planner_mutation'
  | 'external_lookup'
  | 'hybrid';

type HistoryMessage = {
  role: 'user' | 'model';
  text: string;
  metadata?: {
    messageType?: 'planner' | 'external_info' | 'hybrid' | 'conversation';
    sources?: SearchSource[];
  };
};

const LEADING_FILLER_PATTERN =
  /^(?:y|e|entonces|ok|vale|bueno|oye|mira|pero|aja|ah|eh)\s+/i;

const READ_ONLY_PATTERNS = [
  /\b(?:que|cuales?)\s+(?:tareas?\s+)?(?:tengo|hay)\b/i,
  /\b(?:tengo|hay)\b.*\b(?:hoy|manana|esta\s+semana|esta\s+tarde|esta\s+noche|para\s+hoy)\b/i,
  /\b(?:hoy|manana|esta\s+semana|esta\s+tarde|esta\s+noche|para\s+hoy)\b.*\b(?:tengo|hay)\b/i,
  /\bque\s+sigue\b/i,
  /\bcomo\s+va\s+mi\s+agenda\b/i,
  /\bmu(?:e|é)strame?\s+mi\s+agenda\b/i,
  /\brevisa\s+mi\s+agenda\b/i,
  /\bresume\s+mi\s+(?:dia|día|agenda|semana)\b/i,
  /\bagenda\s+de\s+esta\s+semana\b/i,
];

const READ_ONLY_QUERY_CUES = [
  /\bque\b/i,
  /\bcuales?\b/i,
  /\bmu(?:e|é)strame?\b/i,
  /\brevisa\b/i,
  /\bresume\b/i,
  /\bcomo\s+va\b/i,
  /\bque\s+sigue\b/i,
];

const PLANNER_NOUN_CUES = [
  /\bagenda\b/i,
  /\btareas?\b/i,
  /\btengo\b/i,
  /\bhay\b/i,
  /\bprogramad[oa]s?\b/i,
];

const TEMPORAL_PLANNER_CUES = [
  /\bhoy\b/i,
  /\bmanana\b/i,
  /\besta\s+semana\b/i,
  /\besta\s+tarde\b/i,
  /\besta\s+noche\b/i,
  /\bpara\s+hoy\b/i,
];

const EXTERNAL_INFO_PATTERNS = [
  /\bproxim[oa]s?\b/i,
  /\bcuando\b/i,
  /\bque\s+dia\b/i,
  /\bfestiv[oa]s?\b/i,
  /\bcalendario\s+tributario\b/i,
  /\bconciert[oa]s?\b/i,
  /\bevento(s)?\b/i,
  /\bnoticias?\b/i,
  /\bprecio(s)?\b/i,
  /\bquien\b/i,
  /\bdonde\b/i,
  /\bhorario(s)?\b/i,
  /\bfecha(s)?\b/i,
  /\bdeclaracion\b/i,
  /\brenta\b/i,
  /\bdian\b/i,
  /\bimpuestos?\b/i,
  /\bvencimient[oa]s?\b/i,
  /\bplazo(s)?\b/i,
  /\bfecha\s+limite\b/i,
  /\bpara\s+cuando\b/i,
  /\bhasta\s+cuando\b/i,
];

const PLANNER_ACTION_PATTERNS = [
  // Agendar / agenda / agendado / agendando
  /\bagend(a|ar|ado|ando|alo|ame|amelo|emos|an)\b/i,
  // Crear tarea/evento/recordatorio
  /\bcrea(r)?\s+(una\s+)?(tarea|evento|recordatorio)\b/i,
  // Añadir / agregar / agrega
  /\banade|agrega(r)?\b/i,
  // Programar / programa / programado
  /\bprograma(r|do|ndo|mos|n)?\b/i,
  // Poner / pon / pongo / pondré
  /\bpon(er|go|dr[eé]|iendo|e|lo|la)?\s/i,
  /\bpon(lo|la)?\s+en\s+mi\s+agenda\b/i,
  // Quitar / eliminar / borrar / remover
  /\b(quita|quitame|quita\s+lo|elimina|eliminar|borra|borrar|remueve|remover)\b/i,
  // Sacar
  /\b(saca|sacame|saca\s+lo)\b/i,
  // Mover / reagendar / cambiar
  /\bmueve|reagenda|cambia(r)?\b/i,
  // Añadir directamente por verbo
  /\b(agrega(r)?|anade|incluye|incorpora)\b/i,
];

const FOLLOW_UP_PATTERNS = [
  /^y\s+/i,
  /^o\s+/i,
  /^entonces\b/i,
  /^ok\b/i,
  /^vale\b/i,
  /^pero\b/i,
  /^no,?\s+/i,
  /\bpara\s+cuando\b/i,
  /\bhasta\s+cuando\b/i,
  /\by\s+eso\b/i,
  /\by\s+cuando\b/i,
  /^hoy\??$/i,
  /^manana\??$/i,
  /^esta\s+semana\??$/i,
];

const CONVERSATION_PATTERNS = [
  /^(hola|holi|buenas|buenos\s+dias|buenas\s+tardes|buenas\s+noches)$/i,
  /^hol+a+$/i,
  /^holi+i*$/i,
  /^buen+a+s+$/i,
  /^(gracias|muchas\s+gracias|ok\s+gracias|vale\s+gracias)$/i,
  /^(como\s+estas|como\s+vas|que\s+tal|todo\s+bien)$/i,
  /^(quien\s+eres|que\s+eres|que\s+puedes\s+hacer|en\s+que\s+me\s+puedes\s+ayudar)$/i,
];

export const normalizeLooseText = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bq\b/g, 'que')
    .replace(/\bxq\b/g, 'por que')
    .replace(/\s+/g, ' ')
    .trim();

const simplifyConversationalText = (value: string): string =>
  value
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const stripLeadingFillers = (value: string): string => {
  let current = value;
  while (LEADING_FILLER_PATTERN.test(current)) {
    current = current.replace(LEADING_FILLER_PATTERN, '').trim();
  }
  return current;
};

const hasPattern = (patterns: RegExp[], message: string): boolean =>
  patterns.some((pattern) => pattern.test(message));

const MUTATION_PENDING_PATTERNS = [
  /\b(a\s+que\s+hora|a\s+que\s+hora\b)/i,
  /\b(para\s+cuando|hasta\s+cuando|que\s+dia)\b/i,
  /\b(confirma|confirmame|quieres\s+que|quieres\s+hacer)\b/i,
  /\b(dime|necesito)\b.*\?/i,
  /\?$/,
];

const hasPendingPlannerQuestion = (message: string): boolean => hasPattern(MUTATION_PENDING_PATTERNS, message);

const inferIntentFromHistory = (history?: HistoryMessage[]): IntentRoute | null => {
  if (!history?.length) return null;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    const messageType = message.metadata?.messageType;
    if (message.role !== 'model' || !messageType) continue;
    if (messageType === 'external_info') return 'external_lookup';
    if (messageType === 'hybrid') {
      return hasPendingPlannerQuestion(message.text) ? 'hybrid' : 'external_lookup';
    }
    if (messageType === 'planner') {
      return hasPendingPlannerQuestion(message.text) ? 'planner_mutation' : 'planner_read';
    }
    if (messageType === 'conversation') return 'conversation';
  }

  return null;
};

const isShortFollowUp = (message: string): boolean => {
  if (!message) return false;
  const wordCount = message.split(/\s+/).filter(Boolean).length;
  return wordCount <= 8 && hasPattern(FOLLOW_UP_PATTERNS, message);
};

const isReadOnlyPlannerQuestion = (message: string): boolean => {
  const normalized = stripLeadingFillers(normalizeLooseText(message));
  if (!normalized) return false;
  if (hasPattern(READ_ONLY_PATTERNS, normalized)) return true;

  const queryCue = hasPattern(READ_ONLY_QUERY_CUES, normalized);
  const plannerCue = hasPattern(PLANNER_NOUN_CUES, normalized);
  const temporalCue = hasPattern(TEMPORAL_PLANNER_CUES, normalized);

  if (queryCue && plannerCue && temporalCue) return true;
  if (queryCue && plannerCue && !hasPattern(PLANNER_ACTION_PATTERNS, normalized)) return true;
  return false;
};

const hasExternalIntent = (message: string): boolean => {
  const normalized = stripLeadingFillers(normalizeLooseText(message));
  return hasPattern(EXTERNAL_INFO_PATTERNS, normalized);
};

const hasPlannerAction = (message: string): boolean => {
  const normalized = stripLeadingFillers(normalizeLooseText(message));
  return hasPattern(PLANNER_ACTION_PATTERNS, normalized);
};

const isConversationOnly = (message: string): boolean => {
  const normalized = stripLeadingFillers(normalizeLooseText(message));
  const simplified = simplifyConversationalText(normalized);
  if (!normalized) return false;
  if (hasPattern(CONVERSATION_PATTERNS, normalized) || hasPattern(CONVERSATION_PATTERNS, simplified)) return true;

  const wordCount = simplified.split(/\s+/).filter(Boolean).length;
  if (wordCount > 5) return false;

  const hasPlannerCue = hasPattern(PLANNER_NOUN_CUES, normalized) || hasPattern(TEMPORAL_PLANNER_CUES, normalized);
  if (hasPlannerCue) return false;
  if (hasPlannerAction(normalized)) return false;
  if (hasExternalIntent(normalized)) return false;
  if (/^(hola+|holi+|buenas+)(?:\s+[a-z])?$/i.test(simplified)) return true;

  return /^(hola+|holi+|buenas+|gracias|ok|vale|dale|listo|perfecto|genial)$/i.test(simplified);
};

export const classifyIntentRoute = (
  message: string,
  history?: HistoryMessage[],
): IntentRoute => {
  const normalized = stripLeadingFillers(normalizeLooseText(message));

  if (isReadOnlyPlannerQuestion(normalized)) {
    return 'planner_read';
  }

  if (isConversationOnly(normalized)) {
    return 'conversation';
  }

  const plannerAction = hasPlannerAction(normalized);
  const externalIntent = hasExternalIntent(normalized);

  if (externalIntent) {
    return plannerAction ? 'hybrid' : 'external_lookup';
  }

  if (plannerAction) {
    return 'planner_mutation';
  }

  if (isShortFollowUp(normalized)) {
    return (
      inferIntentFromHistory(history) ??
      (hasPattern(TEMPORAL_PLANNER_CUES, normalized) || hasPattern(PLANNER_NOUN_CUES, normalized)
        ? 'planner_read'
        : 'conversation')
    );
  }

  if (hasPattern(TEMPORAL_PLANNER_CUES, normalized) || hasPattern(PLANNER_NOUN_CUES, normalized)) {
    return 'planner_read';
  }

  return 'conversation';
};

export const __intentRouter = {
  normalizeLooseText,
  isReadOnlyPlannerQuestion,
  isConversationOnly,
  classifyIntentRoute,
};
