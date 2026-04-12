import type { SearchSource } from '../src/lib/plannerState.js';
import {
  classifyIntentRoute,
  normalizeLooseText,
} from './intentRouter.js';

type TavilySearchResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    score?: number;
  }>;
};

type SearchDepth = 'basic' | 'advanced';

type SearchPlanStep = {
  query: string;
  depth: SearchDepth;
  progressMessage: string;
};

type ExternalSearchIntent = 'external_lookup' | 'hybrid';

type SearchProgressCallback = (payload: {
  message: string;
  sources: SearchSource[];
}) => void;

type TemporalRelation = 'past' | 'today' | 'future';

type TemporalEvidence = {
  isoDate: string;
  relation: TemporalRelation;
  sourceTitle: string;
};

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
  /\bproximo\b/i,
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
  /\brecuerd(a|ame|amelo)\b/i,
  /\bagend(a|alo|ame|amelo)\b/i,
  /\bcrea(r)?\s+(una\s+)?(tarea|evento|recordatorio)\b/i,
  /\banade\b/i,
  /\bprograma\b/i,
  /\bpon(lo|la)?\s+en\s+mi\s+agenda\b/i,
];

const LOCATION_HINT_PATTERNS = [
  /\ben\s+[A-Z][\p{L}\s-]+/u,
  /\bde\s+[A-Z][\p{L}\s-]+/u,
  /\bcolombia\b/i,
  /\bmedellin\b/i,
  /\bbogota\b/i,
  /\bmexico\b/i,
  /\bespana\b/i,
  /\bargentina\b/i,
  /\bchile\b/i,
  /\bperu\b/i,
];

const LOCATION_SENSITIVE_PATTERNS = [
  /\bfestiv[oa]s?\b/i,
  /\bcalendario\s+tributario\b/i,
  /\bimpuestos?\b/i,
  /\bdeclaracion\b/i,
  /\bvencimient[oa]s?\b/i,
  /\bvacaciones?\b/i,
  /\belecciones?\b/i,
];

const TIME_SENSITIVE_PATTERNS = [
  /\bproxim[oa]s?\b/i,
  /\bcuando\b/i,
  /\bque\s+dia\b/i,
  /\bfecha(s)?\b/i,
  /\bvencimient[oa]s?\b/i,
  /\bplazo(s)?\b/i,
  /\belecciones?\b/i,
  /\bvotaciones?\b/i,
  /\bcalendario\b/i,
  /\bevento(s)?\b/i,
  /\bconciert[oa]s?\b/i,
];

const MONTH_MAP: Record<string, string> = {
  enero: '01',
  febrero: '02',
  marzo: '03',
  abril: '04',
  mayo: '05',
  junio: '06',
  julio: '07',
  agosto: '08',
  septiembre: '09',
  setiembre: '09',
  octubre: '10',
  noviembre: '11',
  diciembre: '12',
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

const CONCERT_PATTERNS = [
  /\bconciert[oa]s?\b/i,
  /\bgira\b/i,
  /\btour\b/i,
  /\bentradas?\b/i,
  /\btickets?\b/i,
  /\bshow\b/i,
  /\bpresentaci[oó]n\b/i,
];

const normalizeDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const trimSnippet = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
};

const dedupeSources = (sources: SearchSource[]): SearchSource[] => {
  const seen = new Set<string>();
  const merged: SearchSource[] = [];

  for (const source of sources) {
    const key = source.url.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(source);
  }

  return merged;
};

const normalizeIsoDate = (year: string, month: string, day: string): string =>
  `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

const extractIsoCandidates = (text: string): string[] => {
  const results = new Set<string>();

  for (const match of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    results.add(normalizeIsoDate(match[1], match[2], match[3]));
  }

  for (const match of text.matchAll(/\b(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(20\d{2})\b/gi)) {
    const month = MONTH_MAP[normalizeLooseText(match[2])];
    if (month) {
      results.add(normalizeIsoDate(match[3], month, match[1]));
    }
  }

  for (const match of text.matchAll(/\b([a-záéíóúñ]+)\s+(\d{1,2}),?\s+(20\d{2})\b/gi)) {
    const month = MONTH_MAP[normalizeLooseText(match[1])];
    if (month) {
      results.add(normalizeIsoDate(match[3], month, match[2]));
    }
  }

  return [...results];
};

const compareIsoDate = (isoDate: string, todayIso: string): TemporalRelation => {
  if (isoDate === todayIso) return 'today';
  return isoDate < todayIso ? 'past' : 'future';
};

const buildTemporalEvidence = (sources: SearchSource[], todayIso: string): TemporalEvidence[] => {
  const evidence: TemporalEvidence[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const haystack = `${source.title} ${source.snippet ?? ''}`;
    for (const isoDate of extractIsoCandidates(haystack)) {
      const key = `${isoDate}|${source.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push({
        isoDate,
        relation: compareIsoDate(isoDate, todayIso),
        sourceTitle: source.title,
      });
    }
  }

  return evidence.sort((a, b) => a.isoDate.localeCompare(b.isoDate)).slice(0, 8);
};

const isTimeSensitiveQuery = (message: string): boolean => {
  const normalized = normalizeLooseText(message);
  return TIME_SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized));
};

const hasExplicitLocation = (message: string): boolean => {
  const normalized = normalizeLooseText(message);
  return LOCATION_HINT_PATTERNS.some((pattern) => pattern.test(normalized));
};
export const classifyExternalIntent = (
  message: string,
  history?: Array<{
    role: 'user' | 'model';
    text: string;
    metadata?: { messageType?: 'planner' | 'external_info' | 'hybrid'; sources?: SearchSource[] };
  }>,
): ExternalSearchIntent => {
  const route = classifyIntentRoute(message, history);
  return route === 'hybrid' ? 'hybrid' : 'external_lookup';
};

export const shouldAskForGeography = (message: string, sources: SearchSource[]): boolean => {
  if (hasExplicitLocation(message)) return false;
  if (!LOCATION_SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalizeLooseText(message)))) return false;
  if (sources.length === 0) return true;
  return true;
};

const needsAdvancedSearch = (
  message: string,
  sources: SearchSource[],
  topScore?: number,
): boolean => {
  if (sources.length < 3) return true;
  if (typeof topScore === 'number' && topScore < 0.55) return true;
  return LOCATION_SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalizeLooseText(message))) && !hasExplicitLocation(message);
};

const extractConcertSubject = (message: string): string | null => {
  const raw = message.trim();
  const directMatch =
    raw.match(/\bconciert[oa]s?(?:\s+(?:más|mas)\s+cercan[oa]|pr[oó]xim[oa])?\s+de\s+(.+)$/i) ??
    raw.match(/\bentradas?\s+de\s+(.+)$/i) ??
    raw.match(/\btickets?\s+de\s+(.+)$/i) ??
    raw.match(/\bgira\s+de\s+(.+)$/i) ??
    raw.match(/\btour\s+de\s+(.+)$/i);

  const subject = directMatch?.[1]?.trim();
  if (!subject) return null;
  return subject.replace(/[?.!,;:]+$/g, '').trim() || null;
};

const buildSearchPlan = (message: string, mode: ExternalSearchIntent): SearchPlanStep[] => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const nextYear = currentYear + 1;
  const todayIso = now.toISOString().slice(0, 10);
  const baseQuery = buildTavilyQuery(message, mode) || message;
  const normalized = normalizeLooseText(message);

  if (CONCERT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    const subject = extractConcertSubject(message) ?? message;
    return [
      {
        query: `${subject} artista biografia wikipedia actualidad`,
        depth: 'basic',
        progressMessage: 'Contextualizando el artista y la consulta...',
      },
      {
        query: `${subject} proximos conciertos gira tour fechas ${currentYear} ${nextYear}`,
        depth: 'basic',
        progressMessage: 'Buscando fechas y eventos próximos...',
      },
      {
        query: `${subject} official site tour dates tickets concert schedule`,
        depth: 'advanced',
        progressMessage: 'Verificando si hay eventos confirmados en fuentes fiables...',
      },
      {
        query: `${subject} fallecio murio obituario estado actual`,
        depth: 'basic',
        progressMessage: 'Contrastando contexto relevante del artista...',
      },
    ];
  }

  const plan = [
    {
      query: `${baseQuery} contexto oficial`,
      depth: 'basic' as const,
      progressMessage: 'Buscando contexto fiable sobre tu consulta...',
    },
    {
      query: baseQuery,
      depth: 'basic' as const,
      progressMessage: 'Buscando la información principal...',
    },
    {
      query: `${baseQuery} sitio oficial fuente oficial verificacion`,
      depth: 'advanced' as const,
      progressMessage: 'Contrastando y verificando la información encontrada...',
    },
  ];

  if (isTimeSensitiveQuery(message)) {
    plan.push({
      query: `${baseQuery} despues de ${todayIso} siguiente proximo vigente`,
      depth: 'advanced' as const,
      progressMessage: 'Verificando si la fecha encontrada sigue vigente frente a hoy...',
    });
  }

  return plan;
};

const buildTavilyQuery = (message: string, mode: ExternalSearchIntent): string => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const nextYear = currentYear + 1;
  const normalizedBase = normalizeLooseText(message);
  const normalized =
    mode === 'hybrid'
      ? normalizedBase
          .replace(/\brecuerd(a|ame|amelo)\b/gi, '')
          .replace(/\bagend(a|alo|ame|amelo)\b/gi, '')
          .replace(/\bcrea(r)?\s+(una\s+)?(tarea|evento|recordatorio)\b/gi, '')
          .replace(/\bpon(lo|la)?\s+en\s+mi\s+agenda\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim()
      : normalizedBase;

  if (/\b(proxim[oa]s?|cuando|que dia|fecha|para cuando|hasta cuando)\b/i.test(normalized) && !/\b20\d{2}\b/.test(normalized)) {
    return `${normalized} ${currentYear} ${nextYear}`.trim();
  }

  return normalized;
};

const runTavilySearch = async (
  query: string,
  searchDepth: SearchDepth,
): Promise<{ sources: SearchSource[]; topScore?: number }> => {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY environment variable is missing.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        topic: 'general',
        search_depth: searchDepth,
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error('Tavily search timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const payload = (await response.json()) as TavilySearchResponse & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `Tavily search failed with status ${response.status}`);
  }

  const results = payload.results ?? [];
  const sources = results
    .filter((result) => result.title && result.url)
    .map((result) => ({
      title: result.title!.trim(),
      url: result.url!.trim(),
      domain: normalizeDomain(result.url!.trim()),
      snippet: trimSnippet(result.content),
    }));

  return {
    sources,
    topScore: results[0]?.score,
  };
};

export const searchExternalInfo = async (
  message: string,
  mode: ExternalSearchIntent,
  onProgress?: SearchProgressCallback,
): Promise<{
  query: string;
  sources: SearchSource[];
  shouldAskGeography: boolean;
}> => {
  const query = buildTavilyQuery(message, mode) || message;
  const plan = buildSearchPlan(message, mode);
  let collectedSources: SearchSource[] = [];
  let topScore: number | undefined;

  for (const step of plan) {
    onProgress?.({
      message: step.progressMessage,
      sources: collectedSources,
    });

    const result = await runTavilySearch(step.query, step.depth);
    collectedSources = dedupeSources([...collectedSources, ...result.sources]).slice(0, 10);
    if (typeof result.topScore === 'number') {
      topScore = typeof topScore === 'number' ? Math.max(topScore, result.topScore) : result.topScore;
    }
  }

  if (needsAdvancedSearch(message, collectedSources, topScore)) {
    onProgress?.({
      message: 'Haciendo una verificación adicional para confirmar la respuesta...',
      sources: collectedSources,
    });
    const fallbackResult = await runTavilySearch(query, 'advanced');
    collectedSources = dedupeSources([...collectedSources, ...fallbackResult.sources]).slice(0, 10);
    if (typeof fallbackResult.topScore === 'number') {
      topScore =
        typeof topScore === 'number' ? Math.max(topScore, fallbackResult.topScore) : fallbackResult.topScore;
    }
  }

  return {
    query,
    sources: collectedSources,
    shouldAskGeography: shouldAskForGeography(message, collectedSources),
  };
};

export const buildSourcesContext = (
  sources: SearchSource[],
  geographyIsAmbiguous: boolean,
): string => {
  const todayIso = new Date().toISOString().slice(0, 10);
  if (sources.length === 0) {
    return 'No se encontraron fuentes suficientes en la busqueda web.';
  }

  const temporalEvidence = buildTemporalEvidence(sources, todayIso);

  const sourceLines = sources.map(
    (source, index) =>
      `[FUENTE ${index + 1}] titulo="${source.title}" dominio="${source.domain}" url="${source.url}"${
        source.snippet ? ` snippet="${source.snippet}"` : ''
      }`,
  );

  return [
    'CONTEXTO WEB VERIFICADO:',
    `Hoy es ${todayIso}.`,
    'La búsqueda se hizo en múltiples pasos: contextualización, búsqueda principal y verificación.',
    geographyIsAmbiguous
      ? 'La consulta es geograficamente ambigua. No asumas pais o ciudad; si la respuesta depende del lugar, responde con lo encontrado y pide precision geografica.'
      : 'Usa estas fuentes para responder con precision. No inventes datos fuera de las fuentes.',
    'Si una página solo parece ser un listado general o una ficha del artista sin confirmar explícitamente fecha y lugar, no la uses para afirmar que existe un próximo evento confirmado.',
    temporalEvidence.length > 0
      ? 'EVIDENCIA TEMPORAL DETECTADA:\n' +
        temporalEvidence
          .map(
            (item, index) =>
              `[TIEMPO ${index + 1}] fecha="${item.isoDate}" relacion="${item.relation}" fuente="${item.sourceTitle}"`,
          )
          .join('\n')
      : 'EVIDENCIA TEMPORAL DETECTADA:\nNo se detectaron fechas explícitas en las fuentes recuperadas.',
    ...sourceLines,
  ].join('\n');
};

export const __webSearchModel = {
  buildSearchPlan,
  extractConcertSubject,
  buildSourcesContext,
};
