import React, { useEffect, useRef, useState } from 'react';
import { useAuth, useClerk } from '@clerk/react';
import { Chat } from './components/Chat';
import { DocumentLibrary } from './components/DocumentLibrary';
import { Gantt } from './components/Gantt';
import { AuthScreen } from './components/AuthScreen';
import { CalendarEvent, Task, Dependency, ScheduledTask, WorkWindow } from './lib/solver';
import type {
  AttachedLibraryDocument,
  DocumentListResponse,
  DocumentRecord,
} from './lib/documents';
import { MAX_DOCUMENTS_PER_QUERY } from './lib/documents';
import {
  DEFAULT_PLANNER_STATE,
  type ChatMessage,
  type ReplanningSettings,
  type PlannerState,
  type PlannerStateSyncPayload,
  type SearchSource,
  type UsageAccessSummary,
  type ViewerProfile,
} from './lib/plannerState';
import { LiveAgent } from './lib/live';
import { BookOpen, CalendarDays, LogOut, Redo2, Settings, Sparkles, Undo2 } from 'lucide-react';

function getFriendlyServerErrorMessage(error: unknown): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);

  if (rawMessage.includes('503') || rawMessage.includes('UNAVAILABLE')) {
    return 'El asistente está temporalmente saturado. Intenta de nuevo en unos momentos.';
  }

  if (rawMessage.includes('429') || rawMessage.includes('RESOURCE_EXHAUSTED')) {
    return 'Se alcanzó temporalmente el límite de peticiones. Espera un momento y vuelve a intentarlo.';
  }

  if (
    rawMessage.includes('OpenRouter devolvió una respuesta no estructurada') ||
    rawMessage.includes("Cannot read properties of undefined")
  ) {
    return 'No pude interpretar correctamente esa solicitud. Inténtala de nuevo o reformúlala de forma más directa.';
  }

  if (rawMessage.toLowerCase().includes('network error')) {
    return 'Hubo un problema temporal de red entre la app y el servidor. Intenta de nuevo.';
  }

  if (
    rawMessage.includes('chat_request_in_progress') ||
    rawMessage.includes('sigue cerrándose') ||
    rawMessage.includes('llegó incompleta')
  ) {
    return 'Tandeba se estaba actualizando o cerrando una solicitud anterior. Inténtalo de nuevo en unos segundos.';
  }

  if (rawMessage && !rawMessage.startsWith('{')) {
    return rawMessage;
  }

  return 'No pude procesar tu solicitud en este momento. Intenta de nuevo.';
}

const createChatRequestId = () => crypto.randomUUID();

const STREAM_PHASE_MESSAGES: Record<string, string> = {
  routing: 'Clasificando tu solicitud...',
  thinking: 'Procesando tu solicitud...',
  searching: 'Buscando información relevante...',
  planning: 'Preparando la actualización...',
  saving: 'Guardando la actualización...',
};

const isRetryableChatError = (error: unknown): boolean => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);

  const normalized = message.toLowerCase();
  return (
    normalized.includes('networkerror') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('fetch failed') ||
    normalized.includes('network error') ||
    normalized.includes('chat_request_in_progress') ||
    normalized.includes('sigue cerrándose') ||
    normalized.includes('respuesta del chat llegó incompleta')
  );
};

function buildUsageCaption(access: UsageAccessSummary | null): string | null {
  if (!access) return null;

  if (access.planCode === 'free') {
    if (access.remainingTextLifetime === null) return 'Plan free';
    return `${access.remainingTextLifetime} mensajes de texto disponibles`;
  }

  const textPart =
    access.remainingTextPeriod === null ? 'texto ilimitado' : `${access.remainingTextPeriod} textos`;
  const voicePart =
    access.remainingVoiceSeconds === null
      ? 'voz ilimitada'
      : `${Math.max(0, Math.floor(access.remainingVoiceSeconds / 60))} min de voz`;
  return `${textPart} y ${voicePart} en este ciclo`;
}

export default function App() {
  const { isLoaded: authLoaded, isSignedIn, userId, getToken } = useAuth();
  const { signOut } = useClerk();

  // Timeout guard: if Clerk doesn't load within 10s, show error UI
  const [clerkLoadTimedOut, setClerkLoadTimedOut] = useState(false);
  useEffect(() => {
    if (authLoaded) return;
    const timer = window.setTimeout(() => {
      if (!authLoaded) {
        console.error('[tandeba] Clerk SDK failed to initialize within 10 seconds. Possible causes: wrong publishable key, domain not configured in Clerk dashboard, or network block.');
        setClerkLoadTimedOut(true);
      }
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [authLoaded]);

  const [viewer, setViewer] = useState<ViewerProfile | null>(null);
  const [access, setAccess] = useState<UsageAccessSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [schedule, setSchedule] = useState<ScheduledTask[] | null>([]);
  const [scheduleBaseDate, setScheduleBaseDate] = useState<Date>(new Date());
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [history, setHistory] = useState(
    DEFAULT_PLANNER_STATE.history ?? { canUndo: false, canRedo: false, revisionCount: 0 },
  );
  const [pendingSearch, setPendingSearch] = useState<{ message: string; sources: SearchSource[] } | null>(null);
  const [pendingAssistantMessage, setPendingAssistantMessage] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [documentQuery, setDocumentQuery] = useState('');
  const [selectedDocuments, setSelectedDocuments] = useState<AttachedLibraryDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [workWindow, setWorkWindow] = useState<WorkWindow>(DEFAULT_PLANNER_STATE.workWindow);
  const [strategy, setStrategy] = useState<'balanced' | 'survival' | 'intelligent'>(
    DEFAULT_PLANNER_STATE.strategy,
  );
  const [showSettings, setShowSettings] = useState(false);
  const [replanningSettings, setReplanningSettings] = useState<ReplanningSettings>(
    DEFAULT_PLANNER_STATE.replanning?.settings ?? {
      mode: 'semi_automatic',
      googleCalendarEnabled: false,
      outlookCalendarEnabled: false,
      internalRiskDetectionEnabled: true,
      emailNotificationsEnabled: true,
      connections: [],
    },
  );
  const [liveStatus, setLiveStatus] = useState<'disconnected' | 'connecting' | 'connected'>(
    'disconnected',
  );
  const [availableBuildId, setAvailableBuildId] = useState<string | null>(null);
  const [availableBuildDeployedAt, setAvailableBuildDeployedAt] = useState<string | null>(null);

  const liveAgentRef = useRef<LiveAgent | null>(null);
  const hasHydratedRef = useRef(false);
  const hasStateLoadedRef = useRef(false);
  const skipNextPersistRef = useRef(false);
  const loadedUserIdRef = useRef<string | null>(null);
  const baselineBuildIdRef = useRef<string | null>(null);
  const reloadTimeoutRef = useRef<number | null>(null);
  const authLoading = !authLoaded;

  const markBuildAsCurrent = (buildId: string, deployedAt?: string | null) => {
    if (!buildId) return;

    if (!baselineBuildIdRef.current) {
      baselineBuildIdRef.current = buildId;
      setAvailableBuildId(null);
      setAvailableBuildDeployedAt(null);
      return;
    }

    if (baselineBuildIdRef.current !== buildId) {
      setAvailableBuildId(buildId);
      setAvailableBuildDeployedAt(deployedAt ?? null);
    }
  };

  const syncBuildFromResponse = (response: Response) => {
    const buildId = response.headers.get('X-Tandeba-Build-Id');
    if (buildId) {
      markBuildAsCurrent(buildId);
    }
  };


  const resetPlannerState = () => {
    setViewer(null);
    setAccess(null);
    setMessages([]);
    setTasks([]);
    setCalendarEvents([]);
    setDependencies([]);
    setSchedule([]);
    setDiagnostics(null);
    setWorkWindow(DEFAULT_PLANNER_STATE.workWindow);
    setStrategy(DEFAULT_PLANNER_STATE.strategy);
    setScheduleBaseDate(new Date());
    setHistory(DEFAULT_PLANNER_STATE.history ?? { canUndo: false, canRedo: false, revisionCount: 0 });
    setPendingSearch(null);
    setPendingAssistantMessage(null);
    setVoiceError(null);
    setDocuments([]);
    setDocumentQuery('');
    setSelectedDocuments([]);
    setDocumentsLoading(false);
    setShowDocuments(false);
    setReplanningSettings(
      DEFAULT_PLANNER_STATE.replanning?.settings ?? {
        mode: 'semi_automatic',
        googleCalendarEnabled: false,
        outlookCalendarEnabled: false,
        internalRiskDetectionEnabled: true,
        emailNotificationsEnabled: true,
        connections: [],
      },
    );
  };

  const applyPlannerState = (state: PlannerState, preserveServerSnapshot = false) => {
    if (preserveServerSnapshot) {
      skipNextPersistRef.current = true;
    }

    setViewer(state.viewer ?? null);
    setAccess(state.access ?? null);
    setMessages(state.messages ?? []);
    setTasks(state.tasks ?? []);
    setCalendarEvents(state.calendarEvents ?? []);
    setDependencies(state.dependencies ?? []);
    setWorkWindow(state.workWindow ?? DEFAULT_PLANNER_STATE.workWindow);
    setStrategy(state.strategy ?? DEFAULT_PLANNER_STATE.strategy);
    setSchedule(state.schedule ?? []);
    setDiagnostics(state.diagnostics ?? null);
    setScheduleBaseDate(state.scheduleBaseDate ? new Date(state.scheduleBaseDate) : new Date());
    setHistory(state.history ?? DEFAULT_PLANNER_STATE.history ?? { canUndo: false, canRedo: false, revisionCount: 0 });
    setReplanningSettings(
      state.replanning?.settings ??
        DEFAULT_PLANNER_STATE.replanning?.settings ?? {
          mode: 'semi_automatic',
          googleCalendarEnabled: false,
          outlookCalendarEnabled: false,
          internalRiskDetectionEnabled: true,
          emailNotificationsEnabled: true,
          connections: [],
        },
    );
  };

  const getAccessToken = async (): Promise<string | null> => {
    const token = await getToken();
    return token ?? null;
  };

  const authorizedFetch = async (input: string, init?: RequestInit) => {
    const token = await getAccessToken();
    if (!token) {
      throw new Error('Tu sesión expiró o ya no es válida. Vuelve a iniciar sesión.');
    }

    const headers = new Headers(init?.headers ?? {});
    headers.set('Authorization', `Bearer ${token}`);
    if (!headers.has('Content-Type') && init?.body && !(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(input, {
      ...init,
      headers,
    });
    syncBuildFromResponse(response);

    if (response.status === 401) {
      await signOut();
    }

    return response;
  };

  const checkForNewDeployment = async () => {
    try {
      const response = await fetch('/api/version', {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return;
      }

      syncBuildFromResponse(response);
      const payload = (await response.json()) as { buildId?: string; deployedAt?: string | null };
      if (payload.buildId) {
        markBuildAsCurrent(payload.buildId, payload.deployedAt ?? null);
      }
    } catch (error) {
      console.error('Failed to check deployment version:', error);
    }
  };

  const loadDocuments = async (query?: string) => {
    if (!isSignedIn) return;

    setDocumentsLoading(true);
    try {
      const searchParams = new URLSearchParams();
      if (query?.trim()) {
        searchParams.set('q', query.trim());
      }

      const response = await authorizedFetch(
        searchParams.toString() ? `/api/documents?${searchParams.toString()}` : '/api/documents',
      );
      const payload = (await response.json()) as DocumentListResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'No se pudo cargar la biblioteca documental.');
      }

      setDocuments(payload.documents ?? []);
    } finally {
      setDocumentsLoading(false);
    }
  };

  const refreshPlannerState = async () => {
    const response = await authorizedFetch('/api/state');
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'No se pudo cargar el estado de la cuenta.');
    }
    applyPlannerState((payload.state ?? DEFAULT_PLANNER_STATE) as PlannerState, true);
  };

  useEffect(() => {
    if (!isSignedIn || !userId) {
      hasStateLoadedRef.current = false;
      hasHydratedRef.current = false;
      loadedUserIdRef.current = null;
      setIsBootstrapping(false);
      resetPlannerState();
      liveAgentRef.current?.disconnect();
      return;
    }

    if (loadedUserIdRef.current === userId && hasStateLoadedRef.current) {
      return;
    }

    const loadState = async () => {
      setIsBootstrapping(true);
      try {
        const response = await authorizedFetch('/api/state');
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || 'No se pudo cargar el estado de la cuenta.');
        }
        setVoiceError(null);
        applyPlannerState((payload.state ?? DEFAULT_PLANNER_STATE) as PlannerState, true);
        loadedUserIdRef.current = userId;
      } catch (error) {
        console.error('Failed to bootstrap planner state:', error);
        setVoiceError(getFriendlyServerErrorMessage(error));
      } finally {
        hasStateLoadedRef.current = true;
        hasHydratedRef.current = true;
        setIsBootstrapping(false);
      }
    };

    loadState();
  }, [isSignedIn, userId]);

  useEffect(() => {
    if (!isSignedIn) {
      setDocuments([]);
      setSelectedDocuments([]);
      setDocumentQuery('');
      setShowDocuments(false);
      return;
    }

    loadDocuments().catch((error) => {
      console.error('Failed to load documents:', error);
    });
  }, [isSignedIn]);

  useEffect(() => {
    if (!isSignedIn || !showDocuments) return;

    const timeoutId = window.setTimeout(() => {
      loadDocuments(documentQuery.trim() || undefined).catch((error) => {
        console.error('Failed to refresh document list:', error);
      });
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [isSignedIn, showDocuments, documentQuery]);

  useEffect(() => {
    if (!isSignedIn) {
      baselineBuildIdRef.current = null;
      setAvailableBuildId(null);
      setAvailableBuildDeployedAt(null);
      return;
    }

    checkForNewDeployment();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        checkForNewDeployment();
      }
    }, 30000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkForNewDeployment();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isSignedIn]);

  useEffect(() => {
    const agent = new LiveAgent(
      (state) => {
        setVoiceError(null);
        applyPlannerState(state, true);
      },
      (status) => {
        setLiveStatus(status);
        if (status === 'connecting' || status === 'connected') {
          setVoiceError(null);
        }
      },
      getAccessToken,
      {
        messages,
        tasks,
        calendarEvents,
        dependencies,
        workWindow,
        strategy,
        currentSchedule: schedule,
      },
      (progress) => {
        setVoiceError(null);
        setPendingSearch(progress);
      },
      (message) => {
        setPendingSearch(null);
        setPendingAssistantMessage(null);
        setVoiceError(message);
      },
    );

    liveAgentRef.current = agent;
    return () => agent.disconnect();
  }, []);

  useEffect(() => {
    liveAgentRef.current?.updateContext(
      messages,
      tasks,
      calendarEvents,
      dependencies,
      workWindow,
      strategy,
      schedule,
    );
  }, [messages, tasks, calendarEvents, dependencies, workWindow, strategy, schedule]);

  const handleUploadDocuments = async (files: File[]) => {
    if (!isSignedIn || files.length === 0) return [] as DocumentRecord[];

    setDocumentsLoading(true);
    try {
      const body = new FormData();
      files.forEach((file) => body.append('documents', file, file.name));

      const response = await authorizedFetch('/api/documents/upload', {
        method: 'POST',
        body,
      });
      const payload = (await response.json()) as { documents?: DocumentRecord[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'No se pudieron subir los documentos.');
      }

      const created = payload.documents ?? [];
      setDocuments((current) => {
        const next = [...created, ...current.filter((document) => !created.some((item) => item.id === document.id))];
        return next.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      });
      return created;
    } catch (error) {
      console.error('Failed to upload documents:', error);
      setVoiceError(getFriendlyServerErrorMessage(error));
      throw error;
    } finally {
      setDocumentsLoading(false);
    }
  };

  const handleSaveAttachmentToLibrary = async (file: File) => {
    const created = await handleUploadDocuments([file]);
    if (!created.length) {
      throw new Error('No se pudo guardar el archivo en tu biblioteca.');
    }

    return created[0];
  };

  const handleUseDocument = (document: DocumentRecord) => {
    if (document.status !== 'ready') return;

    setSelectedDocuments((current) => {
      const exists = current.some((item) => item.id === document.id);
      if (exists) {
        return current.filter((item) => item.id !== document.id);
      }

      if (current.length >= MAX_DOCUMENTS_PER_QUERY) {
        setVoiceError(`Solo puedes consultar hasta ${MAX_DOCUMENTS_PER_QUERY} documentos al mismo tiempo.`);
        return current;
      }

      setVoiceError(null);
      return [...current, { id: document.id, name: document.name, status: document.status }];
    });
  };

  const handleOpenDocument = async (documentId: string) => {
    try {
      const response = await authorizedFetch(`/api/documents/${documentId}/download-url`, {
        method: 'POST',
      });
      const payload = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || 'No se pudo abrir el documento.');
      }

      window.open(payload.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('Failed to open document:', error);
      setVoiceError(getFriendlyServerErrorMessage(error));
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    try {
      const response = await authorizedFetch(`/api/documents/${documentId}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'No se pudo borrar el documento.');
      }

      setDocuments((current) => current.filter((document) => document.id !== documentId));
      setSelectedDocuments((current) => current.filter((document) => document.id !== documentId));
    } catch (error) {
      console.error('Failed to delete document:', error);
      setVoiceError(getFriendlyServerErrorMessage(error));
    }
  };

  const persistReplanningSettings = async (patch: Partial<ReplanningSettings>) => {
    try {
      const response = await authorizedFetch('/api/settings/replanning', {
        method: 'PUT',
        body: JSON.stringify({
          mode: patch.mode,
          googleCalendarEnabled: patch.googleCalendarEnabled,
          outlookCalendarEnabled: patch.outlookCalendarEnabled,
          internalRiskDetectionEnabled: patch.internalRiskDetectionEnabled,
          emailNotificationsEnabled: patch.emailNotificationsEnabled,
        }),
      });
      const payload = (await response.json()) as { settings?: ReplanningSettings; error?: string };
      if (!response.ok || !payload.settings) {
        throw new Error(payload.error || 'No se pudo actualizar la configuración de replanificación.');
      }
      setReplanningSettings(payload.settings);
    } catch (error) {
      console.error('Failed to update replanning settings:', error);
      setVoiceError(getFriendlyServerErrorMessage(error));
    }
  };

  const handleCalendarConnect = async (provider: 'google' | 'outlook') => {
    try {
      const response = await authorizedFetch(`/api/calendar/${provider}/connect`);
      const payload = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || 'No se pudo iniciar la conexión con el calendario.');
      }
      window.location.assign(payload.url);
    } catch (error) {
      console.error('Failed to start calendar connect:', error);
      setVoiceError(getFriendlyServerErrorMessage(error));
    }
  };

  const handleCalendarDisconnect = async (provider: 'google' | 'outlook') => {
    try {
      const response = await authorizedFetch(`/api/calendar/${provider}/disconnect`, {
        method: 'POST',
      });
      const payload = (await response.json()) as { settings?: ReplanningSettings; error?: string };
      if (!response.ok || !payload.settings) {
        throw new Error(payload.error || 'No se pudo desconectar el calendario.');
      }
      setReplanningSettings(payload.settings);
      await refreshPlannerState();
    } catch (error) {
      console.error('Failed to disconnect calendar:', error);
      setVoiceError(getFriendlyServerErrorMessage(error));
    }
  };

  const handleCalendarSync = async (provider: 'google' | 'outlook') => {
    try {
      const response = await authorizedFetch(`/api/calendar/${provider}/sync`, {
        method: 'POST',
      });
      const payload = (await response.json()) as { state?: PlannerState; error?: string };
      if (!response.ok || !payload.state) {
        throw new Error(payload.error || 'No se pudo sincronizar el calendario.');
      }
      applyPlannerState(payload.state, true);
    } catch (error) {
      console.error('Failed to sync calendar:', error);
      setVoiceError(getFriendlyServerErrorMessage(error));
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setShowSettings(false);
  };

  const handleToggleLive = () => {
    if (access && !access.voiceAllowed && liveStatus === 'disconnected') {
      return;
    }

    if (liveStatus === 'disconnected') {
      setPendingSearch(null);
      setPendingAssistantMessage(null);
      setVoiceError(null);
      liveAgentRef.current?.connect();
      return;
    }

    setPendingSearch(null);
    setPendingAssistantMessage(null);
    setVoiceError(null);
    liveAgentRef.current?.disconnect();
  };

  useEffect(() => {
    if (liveStatus === 'disconnected') {
      setPendingSearch(null);
      setPendingAssistantMessage(null);
      setVoiceError(null);
    }
  }, [liveStatus]);

  useEffect(() => {
    if (!availableBuildId || isLoading || liveStatus !== 'disconnected') {
      if (reloadTimeoutRef.current !== null) {
        window.clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
      return;
    }

    reloadTimeoutRef.current = window.setTimeout(() => {
      window.location.reload();
    }, 2500);

    return () => {
      if (reloadTimeoutRef.current !== null) {
        window.clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
    };
  }, [availableBuildId, isLoading, liveStatus]);

  useEffect(() => {
    if (!isSignedIn || !hasHydratedRef.current || !hasStateLoadedRef.current) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      const clientNow = new Date();
      const clientDayStart = new Date(
        clientNow.getFullYear(),
        clientNow.getMonth(),
        clientNow.getDate(),
        0,
        0,
        0,
        0,
      );

      const payload: PlannerStateSyncPayload = {
        messages,
        tasks,
        calendarEvents,
        dependencies,
        workWindow,
        strategy,
        schedule,
        diagnostics,
        scheduleBaseDate: scheduleBaseDate.toISOString(),
        clientDayStartIso: clientDayStart.toISOString(),
        clientNowMinutes: clientNow.getHours() * 60 + clientNow.getMinutes(),
        clientWeekday: clientNow.getDay(),
      };

      try {
        await authorizedFetch('/api/state', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      } catch (error) {
        console.error('Failed to persist planner settings:', error);
      }
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [isSignedIn, workWindow, strategy]);

  const handleSendMessage = async (
    text: string,
    attachments: File[],
    attachedDocuments: AttachedLibraryDocument[],
  ) => {
    if (!isSignedIn) return;

    const normalizedText = text.trim();
    const attachmentSummary =
      attachments.length > 0 ? `\n\nAdjuntos: ${attachments.map((attachment) => attachment.name).join(', ')}` : '';
    const documentSummary =
      attachedDocuments.length > 0
        ? `\n\nDocumentos: ${attachedDocuments.map((document) => document.name).join(', ')}`
        : '';
    setVoiceError(null);
    const displayText =
      normalizedText || attachments.length > 0 || attachedDocuments.length > 0
        ? `${normalizedText || 'Usa los materiales adjuntos para ayudarme.'}${attachmentSummary}${documentSummary}`
        : '';
    const effectiveMessage =
      normalizedText ||
      (attachments.length > 0
        ? 'Analiza los archivos adjuntos y ayúdame a planificar en base a su contenido.'
        : attachedDocuments.length > 0
          ? 'Usa los documentos seleccionados para responder y ayudarme con base en su contenido.'
          : '');
    const newMessages = [...messages, { role: 'user' as const, text: displayText }];
    setMessages(newMessages);
    setIsLoading(true);
    setPendingSearch(null);

    try {
      const requestId = createChatRequestId();
      const buildChatBody = () => {
        const clientNow = new Date();
        const clientDayStart = new Date(
          clientNow.getFullYear(),
          clientNow.getMonth(),
          clientNow.getDate(),
          0,
          0,
          0,
          0,
        );
        const body = new FormData();
        body.append('requestId', requestId);
        body.append('message', effectiveMessage);
        body.append('displayMessage', displayText);
        body.append('history', JSON.stringify(messages));
        body.append('tasks', JSON.stringify(tasks));
        body.append('calendarEvents', JSON.stringify(calendarEvents));
        body.append('dependencies', JSON.stringify(dependencies));
        body.append('workWindow', JSON.stringify(workWindow));
        body.append('strategy', JSON.stringify(strategy));
        body.append('currentSchedule', JSON.stringify(schedule));
        body.append('scheduleBaseDate', scheduleBaseDate.toISOString());
        body.append('clientDayStartIso', clientDayStart.toISOString());
        body.append('clientNowMinutes', String(clientNow.getHours() * 60 + clientNow.getMinutes()));
        body.append('clientWeekday', String(clientNow.getDay()));
        body.append(
          'selectedDocumentIds',
          JSON.stringify(attachedDocuments.map((document) => document.id)),
        );
        attachments.forEach((attachment) => {
          body.append('attachments', attachment, attachment.name);
        });
        return body;
      };

      const executeChatAttempt = async () => {
        const response = await authorizedFetch('/api/chat', {
          method: 'POST',
          body: buildChatBody(),
          headers: {
            'X-Tandeba-Stream': '1',
          },
        });
        const contentType = response.headers.get('content-type') ?? '';

        if (!response.ok && !contentType.includes('application/x-ndjson')) {
          const payload = await response.json();
          const message = payload.code
            ? `${payload.code}: ${payload.error || 'Chat request failed.'}`
            : payload.error || 'Chat request failed.';
          throw new Error(message);
        }

        if (contentType.includes('application/x-ndjson') && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let finalState: PlannerState | null = null;

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (!line.trim()) continue;

              const event = JSON.parse(line) as
                | { type: 'status'; phase?: string; message?: string; sources?: SearchSource[] }
                | { type: 'result'; state: PlannerState }
                | { type: 'error'; error: string };

              if (event.type === 'status') {
                const phaseMessage = (event.phase && STREAM_PHASE_MESSAGES[event.phase]) || event.message || 'Procesando tu solicitud...';
                setPendingAssistantMessage(phaseMessage);
                if (event.phase === 'searching') {
                  setPendingSearch({
                    message: event.message ?? 'Buscando en fuentes externas...',
                    sources: event.sources ?? [],
                  });
                } else {
                  setPendingSearch(null);
                }
                continue;
              }

              if (event.type === 'error') {
                throw new Error(event.error || 'Chat request failed.');
              }

              if (event.type === 'result') {
                finalState = event.state;
              }
            }
          }

          if (!finalState) {
            throw new Error('La respuesta del chat llegó incompleta.');
          }

          applyPlannerState(finalState, true);
          setPendingAssistantMessage(null);
          return;
        }

        const payload = await response.json();
        if (!response.ok) {
          const message = payload.code
            ? `${payload.code}: ${payload.error || 'Chat request failed.'}`
            : payload.error || 'Chat request failed.';
          throw new Error(message);
        }

        const state = payload.state as PlannerState;
        applyPlannerState(
          {
            ...state,
            messages: state.messages ?? [...newMessages, { role: 'model', text: payload.reply }],
          },
          true,
        );
        setPendingAssistantMessage(null);
      };

      let lastError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          if (attempt > 0) {
            setPendingAssistantMessage('Tandeba se actualizó. Reintentando tu mensaje...');
            setPendingSearch(null);
            await new Promise((resolve) => window.setTimeout(resolve, 1200));
          }
          await executeChatAttempt();
          lastError = null;
          break;
        } catch (error) {
          await checkForNewDeployment();
          lastError = error;
          if (attempt === 1 || !isRetryableChatError(error)) {
            throw error;
          }
        }
      }

      if (lastError) {
        throw lastError;
      }
    } catch (error) {
      console.error('Error calling backend:', error);
      const fallbackMessage = availableBuildId
        ? 'Tandeba se actualizó mientras procesaba tu solicitud. Recargaré la app para continuar con una sesión estable.'
        : getFriendlyServerErrorMessage(error);
      setMessages([...newMessages, { role: 'model', text: fallbackMessage }]);
    } finally {
      setPendingSearch(null);
      setPendingAssistantMessage(null);
      setIsLoading(false);
    }
  };

  const handleHistoryAction = async (direction: 'undo' | 'redo') => {
    if (!isSignedIn) return;

    setIsLoading(true);
    try {
      const response = await authorizedFetch(`/api/history/${direction}`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `History ${direction} failed.`);
      }

      applyPlannerState(payload.state as PlannerState, true);
    } catch (error) {
      console.error(`Failed to ${direction} planner state:`, error);
    } finally {
      setIsLoading(false);
    }
  };

  if (authLoading) {
    if (clerkLoadTimedOut) {
      return (
        <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-white rounded-3xl border border-red-200 shadow-sm p-8 text-center">
            <h1 className="text-xl font-bold text-red-600 mb-4">Clerk no disponible</h1>
            <p className="text-sm text-gray-600 mb-4">No se pudo conectar con el servicio de autenticación de Clerk después de 10 segundos.</p>
            <p className="text-xs text-gray-400 mb-2">Posibles causas:</p>
            <ul className="text-xs text-gray-400 text-left space-y-1 mb-4">
              <li>• El dominio de esta app no está configurado en el dashboard de Clerk</li>
              <li>• La VITE_CLERK_PUBLISHABLE_KEY es incorrecta o ha expirado</li>
              <li>• Bloqueo de red o firewall impidiendo la conexión</li>
            </ul>
            <p className="text-xs text-gray-500">Dominio actual: {window.location.hostname}</p>
          </div>
        </div>
      );
    }
    return <AuthScreen isLoading={true} />;
  }

  if (!isSignedIn) {
    return <AuthScreen isLoading={false} />;
  }

  const usageCaption = buildUsageCaption(access);
  // In Tandeba 2.0, text and voice are always enabled (single model, no quotas)
  const canUseText = true;
  const canUseVoice = true;
  const showUpdateBanner = Boolean(availableBuildId);

  return (
    <div className="relative h-screen bg-[#F8FAFC] flex flex-col font-sans text-gray-900 overflow-hidden">
      <header className="h-16 bg-white border-b border-gray-200 flex items-center px-6 shrink-0 z-10">
        <div className="flex items-center gap-2 text-blue-600">
          <CalendarDays className="w-6 h-6" />
          <h1 className="text-xl font-bold tracking-tight text-gray-900">Tandeba</h1>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleHistoryAction('undo')}
              disabled={!history.canUndo || isLoading || isBootstrapping}
              className="p-2 rounded-full transition-colors text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
              title="Deshacer"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleHistoryAction('redo')}
              disabled={!history.canRedo || isLoading || isBootstrapping}
              className="p-2 rounded-full transition-colors text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
              title="Rehacer"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setShowDocuments(true)}
            className="p-2 rounded-full text-gray-500 hover:bg-gray-100 transition-colors"
            title="Documentos"
          >
            <BookOpen className="w-5 h-5" />
          </button>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-full transition-colors ${showSettings ? 'bg-blue-100 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}
            title="Configuración del motor"
          >
            <Settings className="w-5 h-5" />
          </button>

          <div className="hidden md:flex items-center gap-2 text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span>{viewer?.tier === 'premium' ? 'Premium' : 'Free'}</span>
          </div>

          {viewer ? (
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2">
                {viewer.avatarUrl ? (
                  <img src={viewer.avatarUrl} alt={viewer.fullName} className="w-8 h-8 rounded-full" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold">
                    {viewer.fullName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="text-right">
                  <div className="text-sm font-medium text-gray-900">{viewer.fullName}</div>
                  <div className="text-[11px] text-gray-500">{viewer.email}</div>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                className="p-2 rounded-full text-gray-500 hover:bg-gray-100 transition-colors"
                title="Cerrar sesión"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {showUpdateBanner ? (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Hay una nueva versión de Tandeba lista.
              </p>
              <p className="text-xs text-amber-800">
                {isLoading || liveStatus !== 'disconnected'
                  ? 'Terminando tu operación actual antes de recargar.'
                  : 'Recargando automáticamente para mantener la sesión estable.'}
                {availableBuildDeployedAt
                  ? ` Despliegue detectado: ${new Date(availableBuildDeployedAt).toLocaleTimeString()}.`
                  : ''}
              </p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="rounded-full bg-amber-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-950"
            >
              Recargar ahora
            </button>
          </div>
        </div>
      ) : null}

      {showSettings && (
        <div className="bg-white border-b border-gray-200 p-4 px-6 shadow-sm z-20 space-y-5">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700">Inicio de jornada:</label>
              <select
                className="border border-gray-300 rounded-md text-sm p-1"
                value={workWindow.startHour}
                onChange={(e) => setWorkWindow({ ...workWindow, startHour: parseInt(e.target.value, 10) })}
              >
                {[...Array(24)].map((_, i) => (
                  <option key={i} value={i}>
                    {i === 0 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i - 12}:00 PM`}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700">Fin de jornada:</label>
              <select
                className="border border-gray-300 rounded-md text-sm p-1"
                value={workWindow.endHour}
                onChange={(e) => setWorkWindow({ ...workWindow, endHour: parseInt(e.target.value, 10) })}
              >
                {[...Array(24)].map((_, i) => (
                  <option key={i} value={i}>
                    {i === 0 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i - 12}:00 PM`}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700">Días laborales:</label>
              <div className="flex gap-1">
                {['D', 'L', 'M', 'X', 'J', 'V', 'S'].map((day, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      const newDays = workWindow.workDays.includes(idx)
                        ? workWindow.workDays.filter((d) => d !== idx)
                        : [...workWindow.workDays, idx].sort();
                      setWorkWindow({ ...workWindow, workDays: newDays });
                    }}
                    className={`w-7 h-7 rounded-full text-xs font-medium flex items-center justify-center transition-colors ${
                      workWindow.workDays.includes(idx)
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <section className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Cómo organiza Tandeba</h3>
                <p className="text-xs text-slate-600 mt-1">
                  Define cómo prioriza tu plan y cuánta autonomía tiene para reajustarlo cuando algo cambia.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <label className="text-sm font-medium text-slate-900">Estilo de planificación</label>
                  <p className="text-xs text-slate-500 mt-1">
                    Cambia cuánto protege Tandeba tu estructura actual frente a urgencias y conflictos.
                  </p>
                  <select
                    className="mt-3 w-full border border-gray-300 rounded-md text-sm p-2 bg-white"
                    value={strategy}
                    onChange={(e) => setStrategy(e.target.value as 'balanced' | 'survival' | 'intelligent')}
                  >
                    <option value="intelligent">Protección inteligente</option>
                    <option value="balanced">Balanceada</option>
                    <option value="survival">Supervivencia</option>
                  </select>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <label className="text-sm font-medium text-slate-900">Nivel de autonomía</label>
                  <p className="text-xs text-slate-500 mt-1">
                    Decide si Tandeba solo propone cambios o si puede aplicarlos sin confirmación.
                  </p>
                  <select
                    className="mt-3 w-full border border-gray-300 rounded-md text-sm p-2 bg-white"
                    value={replanningSettings.mode}
                    onChange={(e) =>
                      persistReplanningSettings({
                        ...replanningSettings,
                        mode: e.target.value as ReplanningSettings['mode'],
                      })
                    }
                  >
                    <option value="suggest_only">Solo sugerir</option>
                    <option value="semi_automatic">Semi-automática</option>
                    <option value="automatic">Automática</option>
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                {(() => {
                  const connection = replanningSettings.connections.find((item) => item.provider === 'google');
                  const enabled = replanningSettings.googleCalendarEnabled;

                  return (
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-slate-900">Google Calendar</div>
                          <div className="text-xs text-slate-500 mt-1">
                            {connection?.connected
                              ? `Conectado${connection.externalEmail ? ` como ${connection.externalEmail}` : ''}`
                              : 'No conectado'}
                          </div>
                          {connection?.lastError ? (
                            <div className="text-xs text-red-600 mt-1">{connection.lastError}</div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {connection?.connected ? (
                            <>
                              <button
                                onClick={() => handleCalendarSync('google')}
                                className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50"
                              >
                                Sincronizar
                              </button>
                              <button
                                onClick={() => handleCalendarDisconnect('google')}
                                className="px-3 py-1.5 rounded-lg border border-red-200 text-sm text-red-600 hover:bg-red-50"
                              >
                                Desconectar
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => handleCalendarConnect('google')}
                              className="px-3 py-1.5 rounded-lg bg-blue-600 text-sm text-white hover:bg-blue-700"
                            >
                              Conectar
                            </button>
                          )}
                          <button
                            onClick={() =>
                              persistReplanningSettings({
                                ...replanningSettings,
                                googleCalendarEnabled: !replanningSettings.googleCalendarEnabled,
                              })
                            }
                            className={`px-3 py-1.5 rounded-lg border text-sm ${
                              enabled
                                ? 'border-blue-200 text-blue-700 bg-blue-50'
                                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            {enabled ? 'Activo' : 'Inactivo'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">Outlook Calendar</div>
                      <div className="text-xs text-slate-500 mt-1">Pronto.</div>
                    </div>
                    <span className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-400">
                      Pronto
                    </span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-[1800px] w-full mx-auto p-4 md:p-6 flex flex-col md:flex-row gap-6 min-h-0">
        <div className="w-full md:w-[400px] lg:w-[450px] h-[45%] md:h-full shrink-0 flex flex-col min-h-0">
          <Chat
            messages={messages}
            onSendMessage={handleSendMessage}
            onSaveAttachmentToLibrary={handleSaveAttachmentToLibrary}
            isLoading={isLoading || isBootstrapping}
            pendingSearch={pendingSearch}
            pendingAssistantMessage={pendingAssistantMessage}
            liveStatus={liveStatus}
            onToggleLive={handleToggleLive}
            canUseText={canUseText}
            canUseVoice={canUseVoice}
            usageCaption={usageCaption}
            voiceError={voiceError}
            selectedDocuments={selectedDocuments}
            onRemoveSelectedDocument={(documentId) =>
              setSelectedDocuments((current) => current.filter((document) => document.id !== documentId))
            }
            onOpenDocumentLibrary={() => setShowDocuments(true)}
          />
        </div>

        <div className="w-full h-[55%] md:h-full flex-1 flex flex-col min-w-0">
          <Gantt
            schedule={schedule}
            tasks={tasks}
            calendarEvents={calendarEvents}
            workWindow={workWindow}
            diagnostics={diagnostics}
            baseDate={scheduleBaseDate}
          />
        </div>
      </main>

      <DocumentLibrary
        isOpen={showDocuments}
        documents={documents}
        query={documentQuery}
        isLoading={documentsLoading}
        selectedDocuments={selectedDocuments}
        onClose={() => setShowDocuments(false)}
        onQueryChange={setDocumentQuery}
        onUpload={handleUploadDocuments}
        onUseDocument={handleUseDocument}
        onOpenDocument={handleOpenDocument}
        onDeleteDocument={handleDeleteDocument}
      />
    </div>
  );
}
