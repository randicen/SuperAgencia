
import React, { useState, useEffect, useCallback } from 'react';
import { Project, Transaction, BusinessRules, Message, Client, Priority, ChatSession, Note } from './types';
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
import PwaUpdateBanner from './components/PwaUpdateBanner';
import { SpacesProvider } from './contexts/SpacesContext';
import { runAutoScheduling } from './utils/schedulingLogic';
import ActiveWorkspaceName from './components/ActiveWorkspaceName';
import { supabase } from './contexts/AuthContext';
import { uploadRelationalState, downloadRelationalState } from './utils/syncManager';
import { mergeCloudSyncState, normalizeCloudSyncState, rehydrateSpacesLocalState, sanitizeSpacesForCloud } from './utils/cloudSyncMerge';
import { useAuth } from './contexts/AuthContext';
import LoginView from './components/LoginView';
import { useAgencyStore } from './stores/useAgencyStore';

const App: React.FC = () => {
  const { session, isLoading: isAuthLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'chat' | 'spaces' | 'agenda' | 'finance' | 'notebook'>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSpacesSidebarOpen, setIsSpacesSidebarOpen] = useState(false);

  // Estado para el Briefing (Reporte de Situación)
  const [showBriefing, setShowBriefing] = useState(false);
  const [briefingData, setBriefingData] = useState<{ overdue: Project[], upcoming: Project[], income: number } | null>(null);

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
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [hasCheckedCloud, setHasCheckedCloud] = useState(false); // Bloqueo de seguridad
  const [spacesSyncTrigger, setSpacesSyncTrigger] = useState(0);
  const [debugMsg, setDebugMsg] = useState<string | null>(null); // DEBUG HUD
  const isInternalUpdate = React.useRef(false); // Ref para evitar bucles de subida tras descarga
  const lastUploadedState = React.useRef<string>(''); // Reflete el último estado guardado/descargado para evitar uploads redundantes



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
    // Comunicar a otras pestañas que NO deben re-subir este estado específico
    localStorage.setItem('coo_last_sync_fingerprint', payload);
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'coo_last_sync_fingerprint',
      newValue: payload
    }));
  };

  const getCloudLastModified = useCallback(async (userId: string): Promise<number> => {
    const [
      projectsRes,
      clientsRes,
      transactionsRes,
      notesRes,
      chatSessionsRes,
      rulesRes,
      spacesRes
    ] = await Promise.all([
      supabase.from('projects').select('updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(1),
      supabase.from('clients').select('updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(1),
      supabase.from('transactions').select('updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(1),
      supabase.from('notes').select('updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(1),
      supabase.from('chat_sessions').select('updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(1),
      supabase.from('business_rules').select('updated_at').eq('user_id', userId).maybeSingle(),
      supabase.from('spaces_store').select('updated_at').eq('user_id', userId).maybeSingle()
    ]);

    const firstError = [
      projectsRes.error,
      clientsRes.error,
      transactionsRes.error,
      notesRes.error,
      chatSessionsRes.error,
      rulesRes.error,
      spacesRes.error
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
      toMs(rulesRes.data),
      toMs(spacesRes.data)
    );
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
      console.log("ℹ️ Saltando subida: El cambio es una actualización interna (descarga).");
      return;
    }

    setSyncStatus('syncing');

    try {
      // --- SEGURIDAD: NO SUBIR SI NO HEMOS DESCARGADO PRIMERO ---
      if (!hasCheckedCloud) {
        console.warn("Sincronización bloqueada: Aún no se ha verificado la nube. Verificando...");
        await handleInitialDownload(true);
        setSyncStatus('idle'); // REPARADO: No se queda pegado
        return;
      }

      // --- SEGURIDAD: PREVISIÓN DE SOBRESCRITURA (Conflict Resolution) ---
      // Calculamos el lastModified real revisando todas las tablas sincronizadas.
      const rawSpaces = localStorage.getItem('coo_spaces');
      const currentLocalSpaces = rawSpaces ? JSON.parse(rawSpaces) : {};
      const currentLocalState = normalizeCloudSyncState({
        projects: projects || [],
        clients: clients || [],
        transactions: transactions || [],
        rules: rules || DEFAULT_RULES,
        notes: notes || [],
        chatSessions: chatSessions || [],
        spaces: sanitizeSpacesForCloud(currentLocalSpaces)
      });
      const lastSeenCloud = parseInt(localStorage.getItem('coo_last_cloud_mod') || '0');
      const currentCloudModified = await getCloudLastModified(session.user.id);
      const baseSnapshotRaw = localStorage.getItem('coo_last_cloud_state_snapshot');
      const baseSnapshot = baseSnapshotRaw ? JSON.parse(baseSnapshotRaw) : null;
      const shouldMergeRemoteChanges = currentCloudModified > lastSeenCloud;
      const syncState = shouldMergeRemoteChanges
        ? mergeCloudSyncState(
            baseSnapshot,
            currentLocalState,
            normalizeCloudSyncState(await downloadRelationalState(session.user.id))
          )
        : currentLocalState;

      // --- SEGURIDAD ANTI-PING PONG: COMPARACIÓN PROFUNDA (Ignorando ruido temporal) ---
      // Ignoramos campos auto-generados que cambian cada minuto por el setInterval(runAutoScheduling)
      const compareString = buildComparableStateString(syncState);
      if (compareString === lastUploadedState.current) {
        console.log("ℹ️ Saltando subida: Los datos locales base no han cambiado.");
        localStorage.setItem('coo_has_unsynced_local', '0');
        localStorage.setItem('coo_has_unsynced_local_v2', '0');
        localStorage.setItem('coo_has_unsynced_local_v3', '0');
        setSyncStatus('synced');
        return;
      }

      const lastFingerprint = localStorage.getItem('coo_last_sync_fingerprint');
      if (compareString === lastFingerprint) {
        lastUploadedState.current = compareString;
        localStorage.setItem('coo_has_unsynced_local', '0');
        localStorage.setItem('coo_has_unsynced_local_v2', '0');
        localStorage.setItem('coo_has_unsynced_local_v3', '0');
        setSyncStatus('synced');
        return;
      }

      const hasUnsyncedLocal = localStorage.getItem('coo_has_unsynced_local_v3') === '1';
      if (!hasUnsyncedLocal) {
        lastUploadedState.current = compareString;
        setSyncStatus('synced');
        return;
      }

      if (document.hidden) {
        console.log("ℹ️ Saltando subida: La pestaña está en segundo plano.");
        return;
      }

      console.log("Intentando UPSERT relacional en Supabase...");

      // ── FASE 2: Subida a tablas relacionales (reemplaza app_state_dump) ──
      await uploadRelationalState(
        session!.user!.id,
        syncState.projects,
        syncState.clients,
        syncState.transactions,
        syncState.rules || DEFAULT_RULES,
        syncState.notes,
        syncState.chatSessions,
        syncState.spaces
      );

      console.log("✅ CONFIRMADO: Estado sincronizado a tablas relacionales.");
      lastUploadedState.current = compareString;
      replicateToOtherTabs(compareString);
      if (shouldMergeRemoteChanges) {
        isInternalUpdate.current = true;
        setProjects(syncState.projects);
        setClients(syncState.clients);
        setTransactions(syncState.transactions);
        setRules(syncState.rules as any);
        setNotes(syncState.notes);
        setChatSessions(syncState.chatSessions);
        localStorage.setItem('coo_spaces', JSON.stringify(rehydrateSpacesLocalState(syncState.spaces, currentLocalSpaces)));
        window.dispatchEvent(new Event('coo_cloud_data_received'));
        setTimeout(() => { isInternalUpdate.current = false; }, 2500);
      }
      const lastMod = Date.now();
      localStorage.setItem('coo_last_local_mod', lastMod.toString());
      localStorage.setItem('coo_has_unsynced_local', '0');
      localStorage.setItem('coo_has_unsynced_local_v2', '0');
      localStorage.setItem('coo_has_unsynced_local_v3', '0');
      persistCloudSnapshot(syncState);
      const cloudLastModified = await getCloudLastModified(session.user.id);
      localStorage.setItem('coo_last_cloud_mod', cloudLastModified.toString());
      localStorage.setItem('coo_last_user_id', session.user.id);
      setSyncStatus('synced');

    } catch (err: any) {
      console.error("Sync Catch Error:", err);
      setSyncStatus('error');
    }
  }, [projects, clients, transactions, rules, notes, chatSessions, spacesSyncTrigger, session, getCloudLastModified, hasCheckedCloud]);

  // --- CLOUD DOWNLOAD LOGIC (INITIAL LOAD) ---
  const handleInitialDownload = useCallback(async (isSilent = false) => {
    if (!session?.user?.id) {
      setIsLoadingCloud(false);
      return;
    }

    try {
      // ── FASE 1: Descarga desde tablas relacionales (reemplaza app_state_dump) ──
      const cloudState = await downloadRelationalState(session.user.id);
      const normalizedCloudState = normalizeCloudSyncState(cloudState);
      const cloudLastModified = await getCloudLastModified(session.user.id);
      const lastKnownUser = localStorage.getItem('coo_last_user_id');
      const switchedUser = !!lastKnownUser && lastKnownUser !== session.user.id;
      const hasUnsyncedLocal = localStorage.getItem('coo_has_unsynced_local_v3') === '1';
      const keepLocalAsSource = hasUnsyncedLocal && !switchedUser;
      localStorage.setItem('coo_last_cloud_mod', cloudLastModified.toString());

      if (!cloudState.isEmpty && !keepLocalAsSource) {
        isInternalUpdate.current = true; // Bloqueamos subidas temporales

        setProjects(normalizedCloudState.projects);
        setClients(normalizedCloudState.clients);
        setTransactions(normalizedCloudState.transactions);
        setRules(normalizedCloudState.rules as any);
        setNotes(normalizedCloudState.notes);
        setChatSessions(normalizedCloudState.chatSessions);
        if (cloudState.spaces) {
          const currentLocalSpacesRaw = localStorage.getItem('coo_spaces');
          const currentLocalSpaces = currentLocalSpacesRaw ? JSON.parse(currentLocalSpacesRaw) : null;
          localStorage.setItem('coo_spaces', JSON.stringify(rehydrateSpacesLocalState(normalizedCloudState.spaces, currentLocalSpaces)));
          window.dispatchEvent(new Event('coo_cloud_data_received'));
        } else {
          localStorage.removeItem('coo_spaces');
          window.dispatchEvent(new Event('coo_cloud_data_received'));
        }

        if (!isSilent) console.log("✅ Datos sincronizados desde tablas relacionales.");

        // Actualizar el estado fantasma de comparación ignorando el ruido temporal
        lastUploadedState.current = buildComparableStateString(normalizedCloudState);
        localStorage.setItem('coo_last_sync_fingerprint', lastUploadedState.current);
        localStorage.setItem('coo_last_local_mod', Date.now().toString());
        localStorage.setItem('coo_has_unsynced_local', '0');
        localStorage.setItem('coo_has_unsynced_local_v2', '0');
        localStorage.setItem('coo_has_unsynced_local_v3', '0');
        persistCloudSnapshot(normalizedCloudState);
        localStorage.setItem('coo_last_user_id', session.user.id);

        // Liberamos el bloqueo tras un safety delay mayor que el debounce (1500ms)
        setTimeout(() => { isInternalUpdate.current = false; }, 2500);

      } else if (keepLocalAsSource) {
        if (!isSilent) console.log("ℹ️ Hay cambios locales pendientes: conservando estado local y subiendo.");
        localStorage.setItem('coo_last_user_id', session.user.id);
        setSpacesSyncTrigger(prev => prev + 1);
      } else {
        if (!isSilent) console.log("⚠️ Usuario sin datos en la nube: limpiando caché local de seguridad...");
        setProjects([]);
        setClients([]);
        setTransactions([]);
        setNotes([]);
        setChatSessions([{ id: 'default', title: 'Nuevo Chat', messages: [], lastModified: Date.now() }]);
        localStorage.removeItem('coo_spaces');
        window.dispatchEvent(new Event('coo_cloud_data_received'));
        localStorage.setItem('coo_last_local_mod', Date.now().toString());
        localStorage.setItem('coo_has_unsynced_local', '0');
        localStorage.setItem('coo_has_unsynced_local_v2', '0');
        localStorage.setItem('coo_has_unsynced_local_v3', '0');
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
  }, [session, getCloudLastModified]); // CRITICAL: session MUST be here or the function will always see null

  useEffect(() => {
    handleInitialDownload();
  }, [handleInitialDownload]); // Re-run when session changes (which recreates handleInitialDownload)

  // Monitorear conexión y suscripción Real-time
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setSyncStatus('syncing');
      handleCloudSync(); // Sync inmediato al volver
    };
    const handleOffline = () => { setIsOnline(false); setSyncStatus('offline'); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // --- REAL-TIME LISTENER ---
    let channel: any;
    let secondaryChannel: any;
    let refreshTimer: number | null = null;
    let fallbackPollTimer: number | null = null;

    const scheduleCloudRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => handleInitialDownload(true), 350);
    };
    if (session?.user?.id) {
      // Escuchar cambios en tablas relacionales (cualquier cambio del usuario en otro dispositivo)
      channel = supabase
        .channel(`relational-db-changes-${session.user.id}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'projects', filter: `user_id=eq.${session.user.id}` },
          () => {
            console.log("☁️ Cambio en projects detectado en otro dispositivo, descargando...");
            scheduleCloudRefresh();
          }
        )
        .subscribe();

      const extraTables = ['clients', 'transactions', 'notes', 'chat_sessions', 'business_rules', 'spaces_store'];
      secondaryChannel = supabase.channel(`relational-db-changes-extra-${session.user.id}`);
      extraTables.forEach((tableName) => {
        secondaryChannel = secondaryChannel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: tableName, filter: `user_id=eq.${session.user.id}` },
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
          const cloudLastModified = await getCloudLastModified(session.user.id);
          const lastSeenCloud = parseInt(localStorage.getItem('coo_last_cloud_mod') || '0');
          if (cloudLastModified > lastSeenCloud) {
            console.log('Fallback polling detectó cambios remotos, refrescando...');
            handleInitialDownload(true);
          }
        } catch (error) {
          console.warn('Polling de fallback falló:', error);
        }
      }, 15000);
    }

    const handleFingerprintSync = (e: StorageEvent) => {
      if (e.key === 'coo_last_sync_fingerprint' && e.newValue) {
        console.log("📑 Sincronizando fingerprint con otra pestaña activa...");
        lastUploadedState.current = e.newValue;
      }
    };
    window.addEventListener('storage', handleFingerprintSync);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('storage', handleFingerprintSync);
      if (refreshTimer) window.clearTimeout(refreshTimer);
      if (fallbackPollTimer) window.clearInterval(fallbackPollTimer);
      if (channel) channel.unsubscribe();
      if (secondaryChannel) secondaryChannel.unsubscribe();
    };
  }, [handleCloudSync, handleInitialDownload, getCloudLastModified, session]);

  // Sincronización automática debounced
  useEffect(() => {
    const handleTriggerSync = () => {
      if (isInternalUpdate.current) return;
      console.log("🔔 Cambio detectado en Espacios, actualizando timestamp local...");
      updateLastMod(); // CRÍTICO: El timestamp debe ser lo primero en cambiar
      setSpacesSyncTrigger(prev => prev + 1);
    };
    window.addEventListener('coo_spaces_updated', handleTriggerSync);

    const timer = setTimeout(() => {
      if (isOnline) {
        console.log("📡 Iniciando auto-sincronización...");
        handleCloudSync();
      }
    }, 1500); // 1.5 segundos de inactividad

    // Seguro: Sincronizar si el usuario cambia de pestaña o cierra la app
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isOnline) {
        handleCloudSync();
      }
    };
    window.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('coo_spaces_updated', handleTriggerSync);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      clearTimeout(timer);
    };
  }, [projects, clients, transactions, rules, notes, chatSessions, isOnline, handleCloudSync]);

  // --- HEARTBEAT & SYNC: LATIDO OPERATIVO ---
  useEffect(() => {
    // 2. Detectar si hay diferencias críticas para el Briefing
    const sessionKey = sessionStorage.getItem('coo_session_active');

    if (!sessionKey) {
      // Trigger one immediate scheduling run for accurate briefing using FRESH state
      useAgencyStore.getState().tickAutoScheduling();
      const currentProjects = useAgencyStore.getState().projects;

      const now = new Date();
      const overdue = currentProjects.filter(p => {
        const dueDate = new Date(p.dueDate.includes('T') ? p.dueDate : p.dueDate + 'T23:59:59');
        return dueDate < now && p.status !== 'completed';
      });

      const upcoming = currentProjects.filter(p => {
        const dueDate = new Date(p.dueDate.includes('T') ? p.dueDate : p.dueDate + 'T23:59:59');
        const diffTime = Math.abs(dueDate.getTime() - now.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays <= 2 && dueDate >= now && p.status !== 'completed';
      });

      // Calculate pending income from tasks in spaces
      let pendingIncome = 0;
      try {
        const rawSpaces = localStorage.getItem('coo_spaces');
        if (rawSpaces) {
          const spacesData = JSON.parse(rawSpaces);
          const extractInstallments = (tasks: any[]) => {
            tasks?.forEach((t: any) => {
              t.installments?.forEach((i: any) => { if (i.status === 'PENDIENTE') pendingIncome += i.amount; });
              if (t.subtasks) extractInstallments(t.subtasks);
            });
          };
          spacesData.workspaces?.forEach((ws: any) => {
            ws.espacios?.forEach((s: any) => {
              s.listas?.forEach((l: any) => extractInstallments(l.tareas || []));
              s.carpetas?.forEach((f: any) => f.listas?.forEach((l: any) => extractInstallments(l.tareas || [])));
            });
          });
        }
      } catch (e) { /* ignore parse errors */ }

      if (overdue.length > 0 || upcoming.length > 0) {
        setBriefingData({ overdue, upcoming, income: pendingIncome });
        setShowBriefing(true);
      }

      sessionStorage.setItem('coo_session_active', 'true');
    }

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

        // --- SANITIZACIÓN Y MIGRACIÓN DE DATOS (AUTO-HEALING) ---
        // Esto asegura que backups viejos funcionen en versiones nuevas rellenando datos faltantes

        if (rawData.projects) {
          const migratedProjects = rawData.projects.map((p: any) => ({
            ...p,
            // Rellenar campos que podrían no existir en backups viejos
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

        // Forzamos sincronización a la nube de todos los datos restaurados
        updateLastMod();
        setSpacesSyncTrigger(prev => prev + 1);

        alert('✅ Datos restaurados y guardados en la nube.');
      } catch (error) {
        console.error(error);
        alert('❌ Error al leer el archivo de respaldo. Asegúrate que sea un .json válido.');
      }
    };
    reader.readAsText(file);
  };

  // Acciones globales migradas centralmente al stores/useAgencyStore

  const activeMessages = chatSessions.find(s => s.id === currentChatId)?.messages || [];

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
    // Al cerrar sesión, limpiamos la memoria pero JAMÁS usando .clear() global,
    // ya que eso destruye la persistencia necesaria para conectarse a Vercel/Supabase
    ['coo_spaces', 'coo_last_local_mod', 'coo_last_sync_fingerprint', 'coo_last_user_id', 'coo_last_cloud_mod', 'coo_last_cloud_state_snapshot', 'coo_has_unsynced_local', 'coo_has_unsynced_local_v2', 'coo_has_unsynced_local_v3'].forEach(k => localStorage.removeItem(k));
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
          onCloudSync={handleCloudSync}
          syncStatus={syncStatus}
          isOnline={isOnline}
          capacity={Math.min(Math.round((projects.filter(p => p.status === 'active').length / rules.maxProjectsCapacity) * 100), 100)}
          mobileOpen={isMobileMenuOpen}
          setMobileOpen={setIsMobileMenuOpen}
        />

        <main className="flex-1 flex flex-col h-full overflow-hidden relative">
          {/* Topbar estilo App Nativa */}
          <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-6 shrink-0 z-20">
            <div className="flex items-center gap-2 md:gap-3 text-slate-500 text-sm font-medium">
              {/* Botón Hamburguesa Móvil */}
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

          {/* Área de Contenido Principal */}
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
              <SpacesView onOpenTree={() => setIsSpacesSidebarOpen(true)} />
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

        {/* MODAL DE BRIEFING (REPORTE DE SITUACIÓN) */}
        {showBriefing && briefingData && (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[200] flex items-center justify-center p-4" onClick={() => setShowBriefing(false)}>
            <div className="bg-white w-full max-w-lg rounded-[2rem] p-8 shadow-2xl animate-in zoom-in-95 flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-4 mb-6">
                <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center text-white text-2xl shadow-lg shadow-slate-500/20">
                  <i className="fa-solid fa-mug-hot"></i>
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Reporte de Situación</h3>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Resumen de tu ausencia</p>
                </div>
              </div>

              <div className="space-y-4 mb-8">
                {briefingData.overdue.length > 0 ? (
                  <div className="bg-red-50 p-4 rounded-2xl border border-red-100 flex items-start gap-3">
                    <i className="fa-solid fa-triangle-exclamation text-red-500 mt-1"></i>
                    <div>
                      <h4 className="font-black text-red-900 text-sm uppercase">Atención Requerida</h4>
                      <p className="text-xs text-red-700 leading-relaxed">
                        {briefingData.overdue.length} tarea(s) vencieron mientras no estabas.
                        <br />
                        <span className="font-bold opacity-80">{briefingData.overdue.map(p => p.projectName).join(', ')}</span>
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-green-50 p-4 rounded-2xl border border-green-100 flex items-center gap-3">
                    <i className="fa-solid fa-check-circle text-green-500"></i>
                    <span className="text-xs font-bold text-green-800">Nada vencido. Buen trabajo.</span>
                  </div>
                )}

                {briefingData.upcoming.length > 0 && (
                  <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 flex items-start gap-3">
                    <i className="fa-solid fa-clock text-blue-500 mt-1"></i>
                    <div>
                      <h4 className="font-black text-blue-900 text-sm uppercase">Próximos Vencimientos (48h)</h4>
                      <p className="text-xs text-blue-700">
                        {briefingData.upcoming.map(p => p.projectName).join(', ')}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <span className="text-xs font-black text-slate-500 uppercase">Flujo Pendiente</span>
                  <span className="text-lg font-black text-slate-800">${briefingData.income.toLocaleString()}</span>
                </div>
              </div>

              <button onClick={() => setShowBriefing(false)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase shadow-xl hover:bg-slate-800 transition-all">
                Entendido, A Trabajar
              </button>
            </div>
          </div>
        )}

      </div>
      <PwaUpdateBanner />
    </SpacesProvider >
  );
};

export default App;
