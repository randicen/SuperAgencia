
import React, { useState, useEffect, useCallback } from 'react';
import { Transaction, BusinessRules, Message, Client, Priority, ChatSession, Note } from './types';
import { TEMPLATE_PROJECTS, TEMPLATE_TRANSACTIONS, DEFAULT_RULES, TEMPLATE_CLIENTS } from './mockData';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import GanttView from './components/GanttView';
import FinanceView from './components/FinanceView';
import AIChat from './components/AIChat';
import Onboarding from './components/Onboarding';
import NotebookView from './components/NotebookView';
import SpacesSidebar from './components/SpacesSidebar';
import SpacesView from './components/SpacesView';
import AgendaView from './components/AgendaView';
import ActiveTaskStrip, { ActiveTaskStripItem } from './components/ActiveTaskStrip';
import PwaUpdateBanner from './components/PwaUpdateBanner';
import { SpacesProvider, getAllTasks } from './contexts/SpacesContext';
import { runAutoScheduling } from './utils/schedulingLogic';
import ActiveWorkspaceName from './components/ActiveWorkspaceName';
import { supabase } from './contexts/AuthContext';
import { uploadRelationalState, downloadRelationalState } from './utils/syncManager';
import { mergeCloudSyncState, normalizeCloudSyncState } from './utils/cloudSyncMerge';
import { useAuth } from './contexts/AuthContext';
import LoginView from './components/LoginView';
import { useAgencyStore } from './stores/useAgencyStore';
import { SpacesState } from './spacesTypes';
import {
  SpacesSyncDiagnostics,
  SPACES_SYNC_CACHE_KEY,
  getLocalPendingSpacesCount,
  getOrCreateSpacesSyncDeviceId,
  getSpacesCloudLastModified,
  getSpacesSyncCacheMetadata,
  getSpacesSyncDiagnostics,
  runSpacesPullCycle,
  runSpacesPushCycle,
} from './utils/spacesSyncService';
import { resolveSpacesSyncExecutionMode, shouldLockSpacesWrites } from './utils/spacesSyncMode';
import {
  claimSyncLeaderLease,
  createSyncLeaderTabId,
  getSyncLeaderStorageKey,
  isSyncLeaderLeaseActive,
  releaseSyncLeaderLease,
} from './utils/syncLeader';

const CLOUD_FALLBACK_POLL_MS = 120000;
const SPACES_FALLBACK_POLL_MS = 120000;
const SYNC_LEADER_HEARTBEAT_MS = 10000;
const SYNC_LEADER_TTL_MS = 30000;

const ACTIVE_TASK_STRIP_VISIBLE_KEY = 'coo_active_task_strip_visible_v1';
const ACTIVE_TASK_FOCUS_KEY = 'coo_active_task_focus_v1';

interface ActiveTaskStripCandidate extends ActiveTaskStripItem {
  dueAt: number | null;
  startedAtValue: number | null;
  workspaceId: string;
}

const parseTaskDate = (value?: string | null, endOfDay = false) => {
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

const resolveTaskDeadline = (task: { dueDate?: string; endDate?: string; startDate?: string }) =>
  parseTaskDate(task.dueDate, true) ?? parseTaskDate(task.endDate, true) ?? parseTaskDate(task.startDate);

const buildActiveTaskStripItems = (rawState: any): ActiveTaskStripCandidate[] => {
  if (!rawState || !Array.isArray(rawState.workspaces)) return [];

  const state = rawState as SpacesState;
  const workspaceNames = new Map(state.workspaces.map((workspace) => [workspace.id, workspace.nombre]));

  return getAllTasks(state)
    .filter(({ task }) => task.estado === 'ACTIVE')
    .map(({ task, workspaceId }) => ({
      id: task.id,
      nombre: task.nombre,
      clientName: task.clientName,
      workspaceName: workspaceNames.get(workspaceId) || 'Workspace',
      progress: task.progress,
      dueDate: task.dueDate || task.endDate || task.startDate || null,
      dueAt: resolveTaskDeadline(task),
      startedAtValue: parseTaskDate(task.startedAt),
      workspaceId,
    }))
    .sort((left, right) => {
      const rightActiveWorkspace = Number(right.workspaceId === state.activeWorkspaceId);
      const leftActiveWorkspace = Number(left.workspaceId === state.activeWorkspaceId);
      if (rightActiveWorkspace !== leftActiveWorkspace) return rightActiveWorkspace - leftActiveWorkspace;

      const leftDue = left.dueAt ?? Number.MAX_SAFE_INTEGER;
      const rightDue = right.dueAt ?? Number.MAX_SAFE_INTEGER;
      if (leftDue !== rightDue) return leftDue - rightDue;

      const rightStarted = right.startedAtValue ?? 0;
      const leftStarted = left.startedAtValue ?? 0;
      if (rightStarted !== leftStarted) return rightStarted - leftStarted;

      return left.nombre.localeCompare(right.nombre);
    });
};

const App: React.FC = () => {
  const { session, isLoading: isAuthLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'chat' | 'spaces' | 'agenda' | 'finance' | 'notebook'>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSpacesSidebarOpen, setIsSpacesSidebarOpen] = useState(false);
  const {
    projects, setProjects,
    transactions, setTransactions,
    clients, setClients,
    rules, setRules,
    notes, setNotes,
    chatSessions, setChatSessions,
    currentChatId, setCurrentChatId,
    updateLastMod,
    handleAddProject, handleUpdateProject, handleDeleteProject,
    handleAddTransaction, handleDeleteTransaction,
    handleUpdateClients, handleDeleteClient,
    handleSaveNote, handleDeleteNote,
    handleSetMessages, handleNewChat, handleDeleteChat,
    tickAutoScheduling
  } = useAgencyStore();

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error' | 'offline'>('idle');
  const [spacesSyncStatus, setSpacesSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error' | 'offline' | 'safe'>('idle');
  const [spacesSyncDiagnostics, setSpacesSyncDiagnostics] = useState<SpacesSyncDiagnostics>(() => ({
    ...getSpacesSyncDiagnostics(),
    deviceId: getOrCreateSpacesSyncDeviceId(),
  }));
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [hasCheckedCloud, setHasCheckedCloud] = useState(false); // Bloqueo de seguridad
  const [debugMsg, setDebugMsg] = useState<string | null>(null); // DEBUG HUD
  const [currentBuildId] = useState(() => __APP_BUILD_ID__);
  const [cachedBuildId, setCachedBuildId] = useState<string | null>(() => getSpacesSyncCacheMetadata().buildId);
  const [hasHydratedSpacesThisSession, setHasHydratedSpacesThisSession] = useState(false);
  const [hasPendingPwaRefresh, setHasPendingPwaRefresh] = useState(false);
  const [spacesWritesLocked, setSpacesWritesLocked] = useState(true);
  const [isSyncLeader, setIsSyncLeader] = useState(false);
  const lastUploadedState = React.useRef('');
  const isInternalUpdate = React.useRef(false); // Ref para evitar bucles de subida tras descarga core
  const isRunningSpacesSync = React.useRef(false);
  const rerunSpacesSync = React.useRef(false);
  const spacesRefreshTimer = React.useRef<number | null>(null);
  const syncLeaderTabId = React.useRef(createSyncLeaderTabId());
  const handleCloudSyncRef = React.useRef<(() => Promise<void>) | null>(null);
  const handleInitialDownloadRef = React.useRef<((isSilent?: boolean) => Promise<void>) | null>(null);
  const getCloudLastModifiedRef = React.useRef<((userId: string) => Promise<number>) | null>(null);
  const handleSpacesSyncRef = React.useRef<((reason?: 'manual' | 'local-change' | 'remote-change' | 'online' | 'bootstrap') => Promise<void>) | null>(null);
  const spacesDiagnosticsRef = React.useRef(spacesSyncDiagnostics);
  const preHydrationBackupSaved = React.useRef(false);



  const buildComparableStateString = (state: ReturnType<typeof normalizeCloudSyncState>) => JSON.stringify({
    ...state,
    projects: (state.projects || []).map((project: any) => ({
      ...project,
      scheduledSlots: [],
      startDate: project.autoSchedule ? '' : project.startDate,
      endDate: project.autoSchedule ? '' : project.endDate,
      hasConflict: false,
      conflictDescription: ''
    })),
    lastModified: 0
  });

  const persistCloudSnapshot = (state: ReturnType<typeof normalizeCloudSyncState>) => {
    localStorage.setItem('coo_last_cloud_state_snapshot', JSON.stringify(normalizeCloudSyncState(state)));
  };

  const replicateToOtherTabs = (payload: string) => {
    // Comunicar a otras pestaÃƒÆ’Ã‚Â±as que NO deben re-subir este estado especÃƒÆ’Ã‚Â­fico
    localStorage.setItem('coo_last_sync_fingerprint', payload);
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'coo_last_sync_fingerprint',
      newValue: payload
    }));
  };

  const readLocalSpacesState = () => {
    try {
      const raw = localStorage.getItem('coo_spaces');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  };

  const [showActiveTaskStrip, setShowActiveTaskStrip] = useState(() => localStorage.getItem(ACTIVE_TASK_STRIP_VISIBLE_KEY) !== '0');
  const [focusedActiveTaskId, setFocusedActiveTaskId] = useState<string | null>(() => localStorage.getItem(ACTIVE_TASK_FOCUS_KEY));
  const [activeTaskStripItems, setActiveTaskStripItems] = useState<ActiveTaskStripCandidate[]>(() => buildActiveTaskStripItems(readLocalSpacesState()));

  const spacesBuildChangedSinceLastSnapshot = !!cachedBuildId && cachedBuildId !== currentBuildId;

  const getSpacesWriteLockReason = useCallback(() => {
    if (hasPendingPwaRefresh) return 'Actualiza la app instalada para volver a sincronizar tareas con seguridad.';
    if (!hasHydratedSpacesThisSession && spacesBuildChangedSinceLastSnapshot) {
      return 'Actualizando tareas tras una nueva versión antes de permitir cambios.';
    }
    if (!hasHydratedSpacesThisSession) return 'Sincronizando tareas con la nube antes de permitir cambios.';
    return null;
  }, [hasHydratedSpacesThisSession, hasPendingPwaRefresh, spacesBuildChangedSinceLastSnapshot]);

  const setUnsyncedLocalFlags = (hasUnsynced: boolean) => {
    const value = hasUnsynced ? '1' : '0';
    localStorage.setItem('coo_has_unsynced_local', value);
    localStorage.setItem('coo_has_unsynced_local_v2', value);
    localStorage.setItem('coo_has_unsynced_local_v3', value);
  };

  const refreshActiveTaskStrip = useCallback(() => {
    setActiveTaskStripItems(buildActiveTaskStripItems(readLocalSpacesState()));
  }, []);

  const cycleFocusedActiveTask = useCallback(() => {
    if (activeTaskStripItems.length <= 1) return;

    const currentIndex = activeTaskStripItems.findIndex((item) => item.id === focusedActiveTaskId);
    const nextIndex = currentIndex >= 0
      ? (currentIndex + 1) % activeTaskStripItems.length
      : 0;

    setFocusedActiveTaskId(activeTaskStripItems[nextIndex].id);
    setShowActiveTaskStrip(true);
  }, [activeTaskStripItems, focusedActiveTaskId]);

  useEffect(() => {
    const leaderKey = getSyncLeaderStorageKey();

    const updateLeadership = () => {
      const now = Date.now();
      const visible = document.visibilityState === 'visible';

      if (!visible) {
        releaseSyncLeaderLease(syncLeaderTabId.current);
        setIsSyncLeader(false);
        return;
      }

      const lease = claimSyncLeaderLease(syncLeaderTabId.current, SYNC_LEADER_TTL_MS, now);
      setIsSyncLeader(lease.tabId === syncLeaderTabId.current && isSyncLeaderLeaseActive(lease, now));
    };

    updateLeadership();

    const heartbeat = window.setInterval(updateLeadership, SYNC_LEADER_HEARTBEAT_MS);

    const handleVisibilityChange = () => {
      updateLeadership();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== leaderKey) return;
      updateLeadership();
    };

    const handleUnload = () => {
      releaseSyncLeaderLease(syncLeaderTabId.current);
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('beforeunload', handleUnload);
      releaseSyncLeaderLease(syncLeaderTabId.current);
    };
  }, []);

  useEffect(() => {
    setSpacesWritesLocked(shouldLockSpacesWrites({
      hasHydratedSpacesThisSession,
      hasPendingPwaRefresh,
    }));
  }, [hasHydratedSpacesThisSession, hasPendingPwaRefresh]);

  useEffect(() => {
    refreshActiveTaskStrip();

    const handleStorageSync = (event: StorageEvent) => {
      if (!event.key || event.key === 'coo_spaces') {
        refreshActiveTaskStrip();
      }
    };

    window.addEventListener('coo_spaces_updated', refreshActiveTaskStrip);
    window.addEventListener('coo_cloud_data_received', refreshActiveTaskStrip);
    window.addEventListener('storage', handleStorageSync);

    return () => {
      window.removeEventListener('coo_spaces_updated', refreshActiveTaskStrip);
      window.removeEventListener('coo_cloud_data_received', refreshActiveTaskStrip);
      window.removeEventListener('storage', handleStorageSync);
    };
  }, [refreshActiveTaskStrip]);

  useEffect(() => {
    if (activeTaskStripItems.length === 0) {
      setFocusedActiveTaskId(null);
      return;
    }

    if (!focusedActiveTaskId || !activeTaskStripItems.some((item) => item.id === focusedActiveTaskId)) {
      setFocusedActiveTaskId(activeTaskStripItems[0].id);
    }
  }, [activeTaskStripItems, focusedActiveTaskId]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_TASK_STRIP_VISIBLE_KEY, showActiveTaskStrip ? '1' : '0');
  }, [showActiveTaskStrip]);

  useEffect(() => {
    if (focusedActiveTaskId) {
      localStorage.setItem(ACTIVE_TASK_FOCUS_KEY, focusedActiveTaskId);
      return;
    }

    localStorage.removeItem(ACTIVE_TASK_FOCUS_KEY);
  }, [focusedActiveTaskId]);

  useEffect(() => {
    window.__COO_SPACES_WRITES_LOCKED__ = spacesWritesLocked;
    return () => {
      window.__COO_SPACES_WRITES_LOCKED__ = false;
    };
  }, [spacesWritesLocked]);

  useEffect(() => {
    setCachedBuildId(getSpacesSyncCacheMetadata().buildId);
  }, [hasHydratedSpacesThisSession]);

  useEffect(() => {
    if (session?.user?.id) return;
    setHasHydratedSpacesThisSession(false);
    setHasPendingPwaRefresh(false);
    setCachedBuildId(null);
    setSpacesWritesLocked(true);
    preHydrationBackupSaved.current = false;
  }, [session?.user?.id]);

  const buildCurrentLocalCloudState = () => {
    return {
      currentLocalState: normalizeCloudSyncState({
        projects: projects || [],
        clients: clients || [],
        transactions: transactions || [],
        rules: rules || DEFAULT_RULES,
        notes: notes || [],
        chatSessions: chatSessions || []
      })
    };
  };

  const applyDownloadedCloudState = (nextState: ReturnType<typeof normalizeCloudSyncState>) => {
    setProjects(nextState.projects);
    setClients(nextState.clients);
    setTransactions(nextState.transactions);
    setRules(nextState.rules as any);
    setNotes(nextState.notes);
    setChatSessions(nextState.chatSessions);
  };

  const getCloudLastModified = useCallback(async (userId: string): Promise<number> => {
    const [
      projectsRes,
      clientsRes,
      transactionsRes,
      notesRes,
      chatSessionsRes,
      rulesRes
    ] = await Promise.all([
      supabase.from('projects').select('updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(1),
      supabase.from('clients').select('updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(1),
      supabase.from('transactions').select('updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(1),
      supabase.from('notes').select('updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(1),
      supabase.from('chat_sessions').select('updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(1),
      supabase.from('business_rules').select('updated_at').eq('user_id', userId).maybeSingle()
    ]);

    const firstError = [
      projectsRes.error,
      clientsRes.error,
      transactionsRes.error,
      notesRes.error,
      chatSessionsRes.error,
      rulesRes.error
    ].find(Boolean);

    if (firstError) {
      throw new Error(`[cloud sync] refresh check failed: ${(firstError as any).message}`);
    }

    const toMs = (row: any) => row?.updated_at ? new Date(row.updated_at).getTime() : 0;

    return Math.max(
      toMs(projectsRes.data?.[0]),
      toMs(clientsRes.data?.[0]),
      toMs(transactionsRes.data?.[0]),
      toMs(notesRes.data?.[0]),
      toMs(chatSessionsRes.data?.[0]),
      toMs(rulesRes.data)
    );
  }, []);

  const applyDownloadedSpacesState = useCallback((nextSpacesState: any) => {
    localStorage.setItem('coo_spaces', JSON.stringify(nextSpacesState));
    window.dispatchEvent(new Event('coo_cloud_data_received'));
  }, []);

  // --- CLOUD SYNC LOGIC (SUPABASE) ---
  const handleCloudSync = useCallback(async () => {
    if (!navigator.onLine) {
      setSyncStatus('offline');
      return;
    }

    if (!session?.user?.id) return;

    // --- SEGURIDAD: NO SUBIR SI EL CAMBIO VINO DE LA NUBE ---
    if (isInternalUpdate.current) {
      console.log("ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¹ÃƒÂ¯Ã‚Â¸Ã‚Â Saltando subida: El cambio es una actualizaciÃƒÆ’Ã‚Â³n interna (descarga).");
      return;
    }

    setSyncStatus('syncing');

    try {
      // --- SEGURIDAD: NO SUBIR SI NO HEMOS DESCARGADO PRIMERO ---
      if (!hasCheckedCloud) {
        console.warn("SincronizaciÃƒÆ’Ã‚Â³n bloqueada: AÃƒÆ’Ã‚Âºn no se ha verificado la nube. Verificando...");
        await handleInitialDownload(true);
        setSyncStatus('idle'); // REPARADO: No se queda pegado
        return;
      }

      // --- SEGURIDAD: PREVISIÃƒÆ’Ã¢â‚¬Å“N DE SOBRESCRITURA (Conflict Resolution) ---
      // Calculamos el lastModified real revisando todas las tablas sincronizadas.
      const { currentLocalState } = buildCurrentLocalCloudState();
      const lastSeenCloud = parseInt(localStorage.getItem('coo_last_cloud_mod') || '0');
      const currentCloudModified = await getCloudLastModified(session.user.id);
      const baseSnapshotRaw = localStorage.getItem('coo_last_cloud_state_snapshot');
      const baseSnapshot = normalizeCloudSyncState(baseSnapshotRaw ? JSON.parse(baseSnapshotRaw) : null);
      const localComparable = buildComparableStateString(currentLocalState);
      const baseComparable = buildComparableStateString(baseSnapshot);
      const localHasMeaningfulChanges = localComparable !== baseComparable;
      const shouldMergeRemoteChanges = currentCloudModified > lastSeenCloud;
      const syncState = shouldMergeRemoteChanges
        ? mergeCloudSyncState(
            baseSnapshot,
            currentLocalState,
            normalizeCloudSyncState(await downloadRelationalState(session.user.id))
          )
        : currentLocalState;

      // --- SEGURIDAD ANTI-PING PONG: COMPARACIÃƒÆ’Ã¢â‚¬Å“N PROFUNDA (Ignorando ruido temporal) ---
      // Ignoramos campos auto-generados que cambian cada minuto por el setInterval(runAutoScheduling)
      const compareString = buildComparableStateString(syncState);
      if (compareString === lastUploadedState.current) {
        console.log("ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¹ÃƒÂ¯Ã‚Â¸Ã‚Â Saltando subida: Los datos locales base no han cambiado.");
        setUnsyncedLocalFlags(false);
        setSyncStatus('synced');
        return;
      }

      const lastFingerprint = localStorage.getItem('coo_last_sync_fingerprint');
      if (compareString === lastFingerprint) {
        lastUploadedState.current = compareString;
        setUnsyncedLocalFlags(false);
        setSyncStatus('synced');
        return;
      }

      if (!localHasMeaningfulChanges) {
        lastUploadedState.current = compareString;
        setUnsyncedLocalFlags(false);
        setSyncStatus('synced');
        return;
      }

      const hasUnsyncedLocal = localStorage.getItem('coo_has_unsynced_local_v3') === '1' || localHasMeaningfulChanges;
      if (!hasUnsyncedLocal) {
        lastUploadedState.current = compareString;
        setSyncStatus('synced');
        return;
      }

      console.log("Intentando UPSERT relacional en Supabase...");

      // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ FASE 2: Subida a tablas relacionales (reemplaza app_state_dump) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
      await uploadRelationalState(
        session!.user!.id,
        syncState.projects,
        syncState.clients,
        syncState.transactions,
        syncState.rules || DEFAULT_RULES,
        syncState.notes,
        syncState.chatSessions
      );

      console.log("ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ CONFIRMADO: Estado sincronizado a tablas relacionales.");
      lastUploadedState.current = compareString;
      replicateToOtherTabs(compareString);
      if (shouldMergeRemoteChanges) {
        isInternalUpdate.current = true;
        applyDownloadedCloudState(syncState);
        setTimeout(() => { isInternalUpdate.current = false; }, 2500);
      }
      const lastMod = Date.now();
      localStorage.setItem('coo_last_local_mod', lastMod.toString());
      setUnsyncedLocalFlags(false);
      persistCloudSnapshot(syncState);
      const cloudLastModified = await getCloudLastModified(session.user.id);
      localStorage.setItem('coo_last_cloud_mod', cloudLastModified.toString());
      localStorage.setItem('coo_last_user_id', session.user.id);
      setSyncStatus('synced');

    } catch (err: any) {
      console.error("Sync Catch Error:", err);
      setSyncStatus('error');
    }
  }, [projects, clients, transactions, rules, notes, chatSessions, session, getCloudLastModified, hasCheckedCloud]);

  const handleSpacesSync = useCallback(async (reason: 'manual' | 'local-change' | 'remote-change' | 'online' | 'bootstrap' = 'manual') => {
    if (!session?.user?.id) return;

    const deviceId = getOrCreateSpacesSyncDeviceId();
    const currentLocalSpaces = readLocalSpacesState();
    const executionMode = resolveSpacesSyncExecutionMode({
      reason,
      hasHydratedSpacesThisSession,
      spacesWritesLocked,
      hasPendingPwaRefresh,
    });

    if (!navigator.onLine) {
      setSpacesSyncStatus('offline');
      setSpacesSyncDiagnostics((prev) => ({
        ...prev,
        deviceId,
        mode: prev.mode === 'live' ? 'live' : 'safe',
        pending: getLocalPendingSpacesCount(session.user.id, currentLocalSpaces),
      }));
      return;
    }

    if (isRunningSpacesSync.current) {
      rerunSpacesSync.current = true;
      return;
    }

    isRunningSpacesSync.current = true;
    setSpacesSyncStatus('syncing');

    try {
      if (!hasHydratedSpacesThisSession && !preHydrationBackupSaved.current) {
        localStorage.setItem('coo_spaces_pre_hydration_backup_v1', JSON.stringify(currentLocalSpaces || {}));
        preHydrationBackupSaved.current = true;
      }

      const result = executionMode === 'push'
        ? await runSpacesPushCycle({
            userId: session.user.id,
            currentLocalSpaces,
            currentBuildId,
            reason,
          })
        : await runSpacesPullCycle({
            userId: session.user.id,
            currentLocalSpaces,
            currentBuildId,
          });

      applyDownloadedSpacesState(result.nextSpacesState);
      setSpacesSyncDiagnostics({
        ...result.diagnostics,
        deviceId,
      });
      const didHydrateFromRemote = result.diagnostics.mode !== 'safe' && !!result.diagnostics.lastPull;
      setHasHydratedSpacesThisSession((previous) => previous || didHydrateFromRemote);
      if (didHydrateFromRemote) {
        setCachedBuildId(getSpacesSyncCacheMetadata().buildId);
      }
      setSpacesSyncStatus(result.diagnostics.mode === 'safe' ? 'safe' : 'synced');
      if (reason !== 'remote-change') {
        setDebugMsg(`Spaces sync ${executionMode === 'push' && result.didUpload ? 'push+pull' : 'pull'} - ${deviceId}`);
      }
    } catch (error: any) {
      console.error('Spaces sync error:', error);
      setSpacesSyncStatus('error');
      setSpacesSyncDiagnostics((prev) => ({
        ...prev,
        deviceId,
        mode: 'safe',
        pending: getLocalPendingSpacesCount(session.user.id, currentLocalSpaces),
        lastError: error?.message || 'No se pudo sincronizar Espacios.',
      }));
    } finally {
      isRunningSpacesSync.current = false;
      if (rerunSpacesSync.current) {
        rerunSpacesSync.current = false;
        window.setTimeout(() => {
          handleSpacesSync(hasHydratedSpacesThisSession ? 'local-change' : 'bootstrap');
        }, 150);
      }
    }
  }, [applyDownloadedSpacesState, currentBuildId, hasHydratedSpacesThisSession, hasPendingPwaRefresh, session, spacesWritesLocked]);

  // --- CLOUD DOWNLOAD LOGIC (INITIAL LOAD) ---
  const handleInitialDownload = useCallback(async (isSilent = false) => {
    if (!session?.user?.id) {
      setIsLoadingCloud(false);
      return;
    }

    try {
      // ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ FASE 1: Descarga desde tablas relacionales (reemplaza app_state_dump) ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬
      const cloudState = await downloadRelationalState(session.user.id);
      const normalizedCloudState = normalizeCloudSyncState(cloudState);
      const cloudLastModified = await getCloudLastModified(session.user.id);
      const lastKnownUser = localStorage.getItem('coo_last_user_id');
      const switchedUser = !!lastKnownUser && lastKnownUser !== session.user.id;
      const lastSeenCloud = parseInt(localStorage.getItem('coo_last_cloud_mod') || '0');
      const baseSnapshotRaw = localStorage.getItem('coo_last_cloud_state_snapshot');
      const baseSnapshot = normalizeCloudSyncState(baseSnapshotRaw ? JSON.parse(baseSnapshotRaw) : null);
      const { currentLocalState } = buildCurrentLocalCloudState();
      const localComparable = buildComparableStateString(currentLocalState);
      const baseComparable = buildComparableStateString(baseSnapshot);
      const remoteComparable = buildComparableStateString(normalizedCloudState);
      const localHasMeaningfulChanges = localComparable !== baseComparable && localComparable !== remoteComparable;
      const cloudChangedSinceLastSeen = cloudLastModified > lastSeenCloud;
      localStorage.setItem('coo_last_cloud_mod', cloudLastModified.toString());

      if (!cloudState.isEmpty && !switchedUser && cloudChangedSinceLastSeen && localHasMeaningfulChanges) {
        const mergedState = mergeCloudSyncState(baseSnapshot, currentLocalState, normalizedCloudState);
        const mergedComparable = buildComparableStateString(mergedState);
        const mergedNeedsUpload = mergedComparable !== remoteComparable;

        isInternalUpdate.current = true;
        applyDownloadedCloudState(mergedState);

        if (!isSilent) console.log("ÃƒÆ’Ã‚Â¢Ãƒâ€¹Ã…â€œÃƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â Cambios remotos fusionados con cambios locales pendientes.");

        lastUploadedState.current = remoteComparable;
        localStorage.setItem('coo_last_local_mod', Date.now().toString());
        persistCloudSnapshot(mergedState);
        localStorage.setItem('coo_last_user_id', session.user.id);
        setUnsyncedLocalFlags(mergedNeedsUpload);

        setTimeout(() => {
          isInternalUpdate.current = false;
          if (mergedNeedsUpload) {
            handleCloudSync();
          }
        }, 2500);
      } else if (!cloudState.isEmpty && (!localHasMeaningfulChanges || switchedUser)) {
        isInternalUpdate.current = true; // Bloqueamos subidas temporales

        applyDownloadedCloudState(normalizedCloudState);

        if (!isSilent) console.log("ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Datos sincronizados desde tablas relacionales.");

        // Actualizar el estado fantasma de comparaciÃƒÆ’Ã‚Â³n ignorando el ruido temporal
        lastUploadedState.current = remoteComparable;
        localStorage.setItem('coo_last_sync_fingerprint', lastUploadedState.current);
        localStorage.setItem('coo_last_local_mod', Date.now().toString());
        setUnsyncedLocalFlags(false);
        persistCloudSnapshot(normalizedCloudState);
        localStorage.setItem('coo_last_user_id', session.user.id);

        // Liberamos el bloqueo tras un safety delay mayor que el debounce (1500ms)
        setTimeout(() => { isInternalUpdate.current = false; }, 2500);

      } else if (localHasMeaningfulChanges && !switchedUser) {
        if (!isSilent) console.log("ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¹ÃƒÂ¯Ã‚Â¸Ã‚Â Hay cambios locales pendientes: conservando estado local y subiendo.");
        localStorage.setItem('coo_last_user_id', session.user.id);
        setUnsyncedLocalFlags(true);
      } else {
        if (!isSilent) console.log("ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Usuario sin datos core en la nube: limpiando cachÃƒÆ’Ã‚Â© core de seguridad...");
        setProjects([]);
        setClients([]);
        setTransactions([]);
        setNotes([]);
        setChatSessions([{ id: 'default', title: 'Nuevo Chat', messages: [], lastModified: Date.now() }]);
        localStorage.setItem('coo_last_local_mod', Date.now().toString());
        setUnsyncedLocalFlags(false);
        persistCloudSnapshot(normalizedCloudState);
        localStorage.setItem('coo_last_user_id', session.user.id);
        isInternalUpdate.current = true;
        setTimeout(() => isInternalUpdate.current = false, 1500);
      }

      setHasCheckedCloud(true);
    } catch (err) {
      if (!isSilent) console.error("Download Error:", err);
    } finally {
      if (!isSilent) setIsLoadingCloud(false);
      setHasCheckedCloud(true);
    }
  }, [session, getCloudLastModified, projects, clients, transactions, rules, notes, chatSessions, handleCloudSync]); // CRITICAL: session MUST be here or the function will always see null

  useEffect(() => {
    handleCloudSyncRef.current = handleCloudSync;
  }, [handleCloudSync]);

  useEffect(() => {
    handleInitialDownloadRef.current = handleInitialDownload;
  }, [handleInitialDownload]);

  useEffect(() => {
    getCloudLastModifiedRef.current = getCloudLastModified;
  }, [getCloudLastModified]);

  useEffect(() => {
    handleSpacesSyncRef.current = handleSpacesSync;
  }, [handleSpacesSync]);

  useEffect(() => {
    spacesDiagnosticsRef.current = spacesSyncDiagnostics;
  }, [spacesSyncDiagnostics]);

  useEffect(() => {
    handleInitialDownload();
  }, [handleInitialDownload]); // Re-run when session changes (which recreates handleInitialDownload)

  useEffect(() => {
    if (!session?.user?.id) return;
    handleSpacesSync('bootstrap');
  }, [handleSpacesSync, session?.user?.id]);

  // Monitorear conexiÃƒÆ’Ã‚Â³n y suscripciÃƒÆ’Ã‚Â³n Real-time
  useEffect(() => {
    const userId = session?.user?.id;

    const handleOnline = () => {
      setIsOnline(true);
      setSyncStatus('syncing');
      setSpacesSyncStatus('syncing');
      const syncCloud = handleCloudSyncRef.current;
      const syncSpaces = handleSpacesSyncRef.current;
      if (syncCloud) void syncCloud();
      if (syncSpaces) void syncSpaces('online');
    };
    const handleOffline = () => {
      setIsOnline(false);
      setSyncStatus('offline');
      setSpacesSyncStatus('offline');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // --- REAL-TIME LISTENER ---
    let channel: any;
    let secondaryChannel: any;
    let refreshTimer: number | null = null;
    let fallbackPollTimer: number | null = null;

    const scheduleCloudRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        const download = handleInitialDownloadRef.current;
        if (download) void download(true);
      }, 350);
    };
    if (userId && isSyncLeader) {
      // Escuchar cambios en tablas relacionales (cualquier cambio del usuario en otro dispositivo)
      channel = supabase
        .channel(`relational-db-changes-${userId}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'projects', filter: `user_id=eq.${userId}` },
          () => {
            console.log("ÃƒÂ¢Ã‹Å“Ã‚ÂÃƒÂ¯Ã‚Â¸Ã‚Â Cambio en projects detectado en otro dispositivo, descargando...");
            scheduleCloudRefresh();
          }
        )
        .subscribe();

      const extraTables = ['clients', 'transactions', 'notes', 'chat_sessions', 'business_rules'];
      secondaryChannel = supabase.channel(`relational-db-changes-extra-${userId}`);
      extraTables.forEach((tableName) => {
        secondaryChannel = secondaryChannel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: tableName, filter: `user_id=eq.${userId}` },
          () => {
            console.log(`Cambio en ${tableName} detectado, descargando...`);
            scheduleCloudRefresh();
          }
        );
      });
      secondaryChannel.subscribe();

      fallbackPollTimer = window.setInterval(async () => {
        if (document.visibilityState !== 'visible' || !navigator.onLine || isInternalUpdate.current) return;
        try {
          const getCloudLastModified = getCloudLastModifiedRef.current;
          if (!getCloudLastModified) return;
          const cloudLastModified = await getCloudLastModified(userId);
          const lastSeenCloud = parseInt(localStorage.getItem('coo_last_cloud_mod') || '0');
          if (cloudLastModified > lastSeenCloud) {
            console.log('Fallback polling detectÃƒÆ’Ã‚Â³ cambios remotos, refrescando...');
            const download = handleInitialDownloadRef.current;
            if (download) void download(true);
          }
        } catch (error) {
          console.warn('Polling de fallback fallÃƒÆ’Ã‚Â³:', error);
        }
      }, CLOUD_FALLBACK_POLL_MS);
    }

    const handleFingerprintSync = (e: StorageEvent) => {
      if (e.key === 'coo_last_sync_fingerprint' && e.newValue) {
        console.log("ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã¢â‚¬Ëœ Sincronizando fingerprint con otra pestaÃƒÆ’Ã‚Â±a activa...");
        lastUploadedState.current = e.newValue;
      }
    };
    window.addEventListener('storage', handleFingerprintSync);

    const handleSharedSyncState = (e: StorageEvent) => {
      if (e.key === 'coo_last_cloud_state_snapshot' && e.newValue && session?.user?.id) {
        try {
          const nextCloudState = normalizeCloudSyncState(JSON.parse(e.newValue));
          const { currentLocalState } = buildCurrentLocalCloudState();
          const currentBaseSnapshotRaw = localStorage.getItem('coo_last_cloud_state_snapshot');
          const currentBaseSnapshot = normalizeCloudSyncState(currentBaseSnapshotRaw ? JSON.parse(currentBaseSnapshotRaw) : null);
          const localHasMeaningfulChanges =
            buildComparableStateString(currentLocalState) !== buildComparableStateString(currentBaseSnapshot);

          if (!localHasMeaningfulChanges) {
            isInternalUpdate.current = true;
            applyDownloadedCloudState(nextCloudState);
            lastUploadedState.current = buildComparableStateString(nextCloudState);
            window.setTimeout(() => {
              isInternalUpdate.current = false;
            }, 1200);
          }
        } catch (error) {
          console.warn('No se pudo aplicar snapshot compartido entre pestañas:', error);
        }
        return;
      }

      if ((e.key === 'coo_spaces' || e.key === SPACES_SYNC_CACHE_KEY) && session?.user?.id) {
        const currentLocalSpaces = readLocalSpacesState();
        const pending = getLocalPendingSpacesCount(session.user.id, currentLocalSpaces);

        setSpacesSyncDiagnostics({
          ...getSpacesSyncDiagnostics(),
          deviceId: getOrCreateSpacesSyncDeviceId(),
          pending,
        });
        setCachedBuildId(getSpacesSyncCacheMetadata().buildId);

        if (e.key === 'coo_spaces' && e.newValue && pending === 0) {
          window.dispatchEvent(new Event('coo_cloud_data_received'));
        }
      }
    };
    window.addEventListener('storage', handleSharedSyncState);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('storage', handleFingerprintSync);
      window.removeEventListener('storage', handleSharedSyncState);
      if (refreshTimer) window.clearTimeout(refreshTimer);
      if (fallbackPollTimer) window.clearInterval(fallbackPollTimer);
      if (channel) channel.unsubscribe();
      if (secondaryChannel) secondaryChannel.unsubscribe();
    };
  }, [isSyncLeader, session?.user?.id]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || !isSyncLeader) return;

    let spacesChannel: any;
    let spacesPollTimer: number | null = null;
    let spacesRealtimeTimer: number | null = null;

    const scheduleSpacesRefresh = () => {
      if (spacesRealtimeTimer) window.clearTimeout(spacesRealtimeTimer);
      spacesRealtimeTimer = window.setTimeout(() => {
        const syncSpaces = handleSpacesSyncRef.current;
        if (syncSpaces) void syncSpaces('remote-change');
      }, 350);
    };

    spacesChannel = supabase
      .channel(`spaces-sync-meta-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'spaces_sync_meta', filter: `user_id=eq.${userId}` },
        () => {
          scheduleSpacesRefresh();
        }
      )
      .subscribe();

    spacesPollTimer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      try {
        const remoteStamp = await getSpacesCloudLastModified(userId);
        const knownStamp = spacesDiagnosticsRef.current.lastRemote ? new Date(spacesDiagnosticsRef.current.lastRemote).getTime() : 0;
        if (remoteStamp > knownStamp) {
          const syncSpaces = handleSpacesSyncRef.current;
          if (syncSpaces) void syncSpaces('remote-change');
        }
      } catch (error) {
        console.warn('Polling de Espacios fallÃƒÆ’Ã‚Â³:', error);
      }
    }, SPACES_FALLBACK_POLL_MS);

    return () => {
      if (spacesRealtimeTimer) window.clearTimeout(spacesRealtimeTimer);
      if (spacesPollTimer) window.clearInterval(spacesPollTimer);
      if (spacesChannel) spacesChannel.unsubscribe();
    };
  }, [isSyncLeader, session?.user?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (isOnline) {
        handleCloudSync();
      }
    }, 1500);

    const handleVisibilityChange = () => {
      const hasPendingCloudUpload = localStorage.getItem('coo_has_unsynced_local_v3') === '1';
      if (document.visibilityState === 'hidden' && isOnline && hasPendingCloudUpload) {
        handleCloudSync();
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearTimeout(timer);
    };
  }, [projects, clients, transactions, rules, notes, chatSessions, isOnline, handleCloudSync]);

  // SincronizaciÃƒÆ’Ã‚Â³n automÃƒÆ’Ã‚Â¡tica debounced
  useEffect(() => {
    const handleTriggerSync = () => {
      const currentLocalSpaces = readLocalSpacesState();
      if (session?.user?.id) {
        setSpacesSyncDiagnostics((prev) => ({
          ...prev,
          deviceId: getOrCreateSpacesSyncDeviceId(),
          pending: getLocalPendingSpacesCount(session.user.id, currentLocalSpaces),
          lastError: null,
        }));
      }

      if (spacesRefreshTimer.current) {
        window.clearTimeout(spacesRefreshTimer.current);
      }

      if (!isOnline || !session?.user?.id) {
        setSpacesSyncStatus(isOnline ? 'safe' : 'offline');
        return;
      }

      spacesRefreshTimer.current = window.setTimeout(() => {
        handleSpacesSync('local-change');
      }, 1200);
    };
    window.addEventListener('coo_spaces_updated', handleTriggerSync);

    // Seguro: Sincronizar si el usuario cambia de pestaÃƒÆ’Ã‚Â±a o cierra la app
    const handleVisibilityChange = () => {
      const hasPendingSpacesSync = session?.user?.id
        ? getLocalPendingSpacesCount(session.user.id, readLocalSpacesState()) > 0
        : false;
      if (document.visibilityState === 'hidden' && isOnline && hasPendingSpacesSync) {
        handleSpacesSync('manual');
      }
    };
    window.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('coo_spaces_updated', handleTriggerSync);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      if (spacesRefreshTimer.current) {
        window.clearTimeout(spacesRefreshTimer.current);
        spacesRefreshTimer.current = null;
      }
    };
  }, [handleSpacesSync, isOnline, session?.user?.id]);

  // --- HEARTBEAT & SYNC: LATIDO OPERATIVO ---
  useEffect(() => {
    useAgencyStore.getState().tickAutoScheduling();

    const interval = setInterval(() => {
      useAgencyStore.getState().tickAutoScheduling();
    }, 60000);

    return () => clearInterval(interval);
  }, []);


  // Persistencia Local manejada enteramente por Zustand (useAgencyStore)


  // --- DATA PORTABILITY (BACKUP & RESTORE) ---
  const handleExportData = () => {
    const rawSpaces = localStorage.getItem('coo_spaces');
    const spacesData = rawSpaces ? JSON.parse(rawSpaces) : {};

    const data = {
      projects,
      clients,
      transactions,
      rules,
      notes,
      chatSessions,
      spaces: spacesData,
      version: "1.0",
      timestamp: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CFO_Backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportData = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let rawData = JSON.parse(e.target?.result as string);

        // --- COMPATIBILIDAD CON BACKUPS ANTIGUOS DIRECTOS DE SUPABASE ---
        // Si el usuario sube el backup_app_state_dump.json original (que es un array de registros SQL)
        if (Array.isArray(rawData)) {
          const v2_record = rawData.find((r: any) => r.id === 'coo_master_state_v2') || rawData[0];
          if (v2_record && v2_record.data) {
            rawData = v2_record.data;
          }
        }

        // --- SANITIZACIÃƒÆ’Ã¢â‚¬Å“N Y MIGRACIÃƒÆ’Ã¢â‚¬Å“N DE DATOS (AUTO-HEALING) ---
        // Esto asegura que backups viejos funcionen en versiones nuevas rellenando datos faltantes

        if (rawData.projects) {
          const migratedProjects = rawData.projects.map((p: any) => ({
            ...p,
            // Rellenar campos que podrÃƒÆ’Ã‚Â­an no existir en backups viejos
            elasticity: p.elasticity !== undefined ? p.elasticity : 1, // Default Flexible
            autoSchedule: p.autoSchedule !== undefined ? p.autoSchedule : true, // Default Auto
            deadlineType: p.deadlineType || 'Soft Deadline',
            scheduledSlots: p.scheduledSlots || []
          }));
          setProjects(migratedProjects);
        }

        if (rawData.clients) setClients(rawData.clients);
        if (rawData.transactions) setTransactions(rawData.transactions);
        if (rawData.rules) setRules({ ...DEFAULT_RULES, ...rawData.rules }); // Merge con default para asegurar nuevos campos
        if (rawData.notes) setNotes(rawData.notes);
        if (rawData.chatSessions) setChatSessions(rawData.chatSessions);
        if (rawData.spaces) {
          localStorage.setItem('coo_spaces', JSON.stringify(rawData.spaces));
          window.dispatchEvent(new Event('coo_cloud_data_received'));
        }

        // Forzamos sincronizaciÃƒÆ’Ã‚Â³n a la nube de todos los datos restaurados
        updateLastMod();
        handleCloudSync();
        handleSpacesSync('manual');

        alert('✅ Datos restaurados y guardados en la nube.');
      } catch (error) {
        console.error(error);
        alert('❌ Error al leer el archivo de respaldo. Asegúrate de que sea un .json válido.');
      }
    };
    reader.readAsText(file);
  };

  const handleFullCloudSync = useCallback(async () => {
    await handleCloudSync();
    await handleSpacesSync('manual');
  }, [handleCloudSync, handleSpacesSync]);

  // Acciones globales migradas centralmente al stores/useAgencyStore

  const activeMessages = chatSessions.find(s => s.id === currentChatId)?.messages || [];
  const spacesWriteLockReason = getSpacesWriteLockReason();

  if (isLoadingCloud || isAuthLoading) {
    return (
      <div className="h-screen w-screen bg-[#F4F5F8] flex flex-col items-center justify-center font-sans">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-slate-600 font-black uppercase tracking-widest text-xs animate-pulse">
          {isAuthLoading ? 'Autenticando...' : 'Sincronizando con la nube...'}
        </p>
      </div>
    );
  }

  const handleSignOutWrapper = async () => {
    // Al cerrar sesiÃƒÆ’Ã‚Â³n, limpiamos la memoria pero JAMÃƒÆ’Ã‚ÂS usando .clear() global,
    // ya que eso destruye la persistencia necesaria para conectarse a Vercel/Supabase
    [
      'coo_spaces',
      'coo_last_local_mod',
      'coo_last_sync_fingerprint',
      'coo_last_user_id',
      'coo_last_cloud_mod',
      'coo_last_cloud_state_snapshot',
      'coo_has_unsynced_local',
      'coo_has_unsynced_local_v2',
      'coo_has_unsynced_local_v3',
      'coo_spaces_sync_device_id',
      'coo_spaces_sync_cache_v1',
      'coo_spaces_backup_local_pre_row_sync_v1',
      'coo_spaces_backup_legacy_remote_pre_row_sync_v1'
    ].forEach(k => localStorage.removeItem(k));
    location.reload();
  };

  if (!session) {
    return <LoginView onLoginSuccess={() => { }} />;
  }

  return (
    <SpacesProvider>

      <div className="flex w-full h-full bg-[#F4F5F8]">
        <Sidebar
          activeTab={activeTab}
          setActiveTab={(t) => { setActiveTab(t); setIsMobileMenuOpen(false); setIsSpacesSidebarOpen(false); }}
          onExport={handleExportData}
          onImport={handleImportData}
          onCloudSync={handleFullCloudSync}
          syncStatus={syncStatus}
          spacesSyncStatus={spacesSyncStatus}
          spacesSyncDiagnostics={spacesSyncDiagnostics}
          isOnline={isOnline}
          capacity={Math.min(Math.round((projects.filter(p => p.status === 'active').length / rules.maxProjectsCapacity) * 100), 100)}
          mobileOpen={isMobileMenuOpen}
          setMobileOpen={setIsMobileMenuOpen}
        />

        <main className="flex-1 flex flex-col h-full overflow-hidden relative">
          {/* Topbar estilo App Nativa */}
          <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-6 shrink-0 z-20">
            <div className="flex items-center gap-2 md:gap-3 text-slate-500 text-sm font-medium">
              {/* BotÃƒÆ’Ã‚Â³n Hamburguesa MÃƒÆ’Ã‚Â³vil */}
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                className="md:hidden w-8 h-8 flex items-center justify-center text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                <i className="fa-solid fa-bars"></i>
              </button>



              <ActiveWorkspaceName />
              <i className="hidden md:inline fa-solid fa-chevron-right text-[10px]"></i>
              <span className="text-slate-800 font-semibold">{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</span>
            </div>
            <div className="flex items-center gap-3 md:gap-4">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-md border border-gray-200 cursor-pointer hover:border-gray-300 transition-colors">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <span className="text-xs font-semibold text-slate-600 hidden md:inline">En línea</span>
              </div>
              <button className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-gray-100 rounded-md transition-all">
                <i className="fa-regular fa-bell"></i>
              </button>
            </div>
          </header>

          <ActiveTaskStrip
            items={activeTaskStripItems}
            currentTaskId={focusedActiveTaskId}
            isVisible={showActiveTaskStrip}
            onShow={() => setShowActiveTaskStrip(true)}
            onHide={() => setShowActiveTaskStrip(false)}
            onNext={cycleFocusedActiveTask}
            onOpenSpaces={() => {
              setActiveTab('spaces');
              setIsMobileMenuOpen(false);
            }}
          />

          {/* ÃƒÆ’Ã‚Ârea de Contenido Principal */}
          {activeTab === 'spaces' ? (
            <div className="flex-1 flex overflow-hidden relative">
              <div className="hidden md:block h-full">
                <SpacesSidebar />
              </div>
              {isSpacesSidebarOpen && (
                <div
                  className="md:hidden fixed inset-0 bg-black/50 z-30"
                  onClick={() => setIsSpacesSidebarOpen(false)}
                ></div>
              )}
              <div className={`md:hidden fixed inset-y-0 left-0 z-40 transition-transform duration-300 ${isSpacesSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <SpacesSidebar onNavigate={() => setIsSpacesSidebarOpen(false)} />
              </div>
              <SpacesView
                onOpenTree={() => setIsSpacesSidebarOpen(true)}
                writesLocked={spacesWritesLocked}
                writeLockReason={spacesWriteLockReason}
                isHydrating={!hasHydratedSpacesThisSession}
              />
            </div>
          ) : activeTab === 'agenda' ? (
            <div className="flex-1 overflow-hidden p-4 md:p-6 relative">
              <AgendaView onGoToSpaces={() => setActiveTab('spaces')} />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 relative">
              {activeTab === 'dashboard' && <Dashboard projects={projects} transactions={transactions} clients={clients} seasonality={[]} setActiveTab={setActiveTab} />}
              {activeTab === 'chat' && <AIChat
                messages={activeMessages}
                setMessages={handleSetMessages}
                projects={projects}
                clients={clients}
                transactions={transactions}
                rules={rules}
                onAddProject={handleAddProject}
                onUpdateProject={handleUpdateProject}
                onAddTransaction={handleAddTransaction}
                onDeleteTransaction={handleDeleteTransaction}
                onUpdateClients={handleUpdateClients}
                onDeleteProject={handleDeleteProject}
                onDeleteClient={handleDeleteClient}
                chatSessions={chatSessions}
                currentChatId={currentChatId}
                onNewChat={handleNewChat}
                onSelectChat={setCurrentChatId}
                onDeleteChat={handleDeleteChat}
                notes={notes}
                onSaveNote={handleSaveNote}
                onDeleteNote={handleDeleteNote}
              />}
              {activeTab === 'finance' && <FinanceView clients={clients} onUpdateClients={handleUpdateClients} onAddClient={(c) => handleUpdateClients([...clients, c])} onDeleteClient={handleDeleteClient} />}
              {activeTab === 'notebook' && <NotebookView notes={notes} onSaveNote={handleSaveNote} onDeleteNote={handleDeleteNote} onDiscussNote={() => { }} />}
            </div>
          )}
        </main>
      </div>
      <PwaUpdateBanner
        onNeedRefreshChange={setHasPendingPwaRefresh}
        writeLockReason={spacesWriteLockReason}
      />
    </SpacesProvider>
  );
};

export default App;


