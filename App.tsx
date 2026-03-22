
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
import { SpacesProvider } from './contexts/SpacesContext';
import { runAutoScheduling } from './utils/schedulingLogic';
import ActiveWorkspaceName from './components/ActiveWorkspaceName';
import { supabase } from './contexts/AuthContext';
import { useAuth } from './contexts/AuthContext';
import LoginView from './components/LoginView';
import { useAgencyStore } from './stores/useAgencyStore';

const App: React.FC = () => {
  const { session, isLoading: isAuthLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'chat' | 'spaces' | 'finance' | 'notebook'>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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



  const replicateToOtherTabs = (payload: string) => {
    // Comunicar a otras pestañas que NO deben re-subir este estado específico
    localStorage.setItem('coo_last_sync_fingerprint', payload);
    window.dispatchEvent(new StorageEvent('storage', {
        key: 'coo_last_sync_fingerprint',
        newValue: payload
    }));
  };

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
      const { data: cloudRecord } = await supabase
        .from('app_state_dump')
        .select('data')
        .eq('id', 'coo_master_state_v2')
        .eq('user_id', session?.user?.id)
        .maybeSingle();
      
      const localLastSync = parseInt(localStorage.getItem('coo_last_local_mod') || '0');
      const cloudLastModified = (cloudRecord?.data as any)?.lastModified || 0;

      if (Number(cloudLastModified) > localLastSync) {
          setDebugMsg(`REVERT_CLOUD_SYNC: Cloud(${cloudLastModified}) > Local(${localLastSync})`);
          console.log("⚠️ Hay datos más nuevos en la nube. Descargando automáticamente...");
          await handleInitialDownload(true);
          setSyncStatus('synced');
          return;
      }

      const rawSpaces = localStorage.getItem('coo_spaces');
      const spacesData = rawSpaces ? JSON.parse(rawSpaces) : {};
      
      const lastMod = Date.now();
      const fullState = {
        projects: projects || [],
        clients: clients || [],
        transactions: transactions || [],
        rules: rules || {},
        notes: notes || [],
        chatSessions: chatSessions || [],
        spaces: spacesData,
        lastModified: lastMod
      };

      // --- SEGURIDAD ANTI-PING PONG: COMPARACIÓN PROFUNDA (Ignorando ruido temporal) ---
      // Ignoramos campos auto-generados que cambian cada minuto por el setInterval(runAutoScheduling)
      const stateForCompare = {
          ...fullState,
          lastModified: 0,
          projects: fullState.projects.map(p => ({
              ...p,
              scheduledSlots: [],
              startDate: p.autoSchedule ? '' : p.startDate,
              endDate: p.autoSchedule ? '' : p.endDate,
              hasConflict: false,
              conflictDescription: ''
          }))
      };

      const compareString = JSON.stringify(stateForCompare);
      if (compareString === lastUploadedState.current) {
          console.log("ℹ️ Saltando subida: Los datos locales base no han cambiado.");
          setSyncStatus('synced');
          return;
      }
      
      const lastFingerprint = localStorage.getItem('coo_last_sync_fingerprint');
      if (compareString === lastFingerprint) {
          console.log("ℹ️ Saltando subida: Otra pestaña ya sincronizó este estado.");
          lastUploadedState.current = compareString;
          setSyncStatus('synced');
          return;
      }

      if (document.hidden) {
          console.log("ℹ️ Saltando subida: La pestaña está en segundo plano.");
          return;
      }

      console.log("Intentando UPSERT en Supabase...");

      // CRITICAL FIX: Update the local timestamp BEFORE the network call
      // so if the realtime listener fires instantly, localLastSync is already up-to-date.
      localStorage.setItem('coo_last_local_mod', lastMod.toString());

      const { data: returnData, error } = await supabase
        .from('app_state_dump')
        .upsert(
          { 
            id: 'coo_master_state_v2', 
            user_id: session?.user?.id,
            data: fullState,
            updated_at: new Date().toISOString()
          }, 
          { onConflict: 'id,user_id' }
        )
        .select();

      if (error) {
          console.error("Supabase Error Detallado:", error);
          throw error;
      }
      
      if (returnData && returnData.length > 0) {
          console.log("✅ CONFIRMADO POR SUPABASE:", returnData);
          lastUploadedState.current = compareString;
          replicateToOtherTabs(compareString);
          setSyncStatus('synced');
      } else {
          console.error("⚠️ Supabase no devolvió datos tras el upsert.");
          setSyncStatus('error');
      }

    } catch (err: any) {
      console.error("Sync Catch Error:", err);
      setSyncStatus('error');
    }
  }, [projects, clients, transactions, rules, notes, chatSessions, spacesSyncTrigger, session]);

  // --- CLOUD DOWNLOAD LOGIC (INITIAL LOAD) ---
  const handleInitialDownload = useCallback(async (isSilent = false) => {
    if (!session?.user?.id) {
      setIsLoadingCloud(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('app_state_dump')
        .select('data')
        .eq('id', 'coo_master_state_v2')
        .eq('user_id', session?.user?.id)
        .maybeSingle();

      if (data && data.data) {
        const cloudState = data.data;
        const localLastSync = parseInt(localStorage.getItem('coo_last_local_mod') || '0');
        
        // Solo descargar si la nube es estrictamente más nueva
        if (!cloudState.lastModified || cloudState.lastModified > localLastSync) {
          if (cloudState.lastModified && localLastSync > 0) {
              setDebugMsg(`REVERT_REALTIME: Cloud(${cloudState.lastModified}) > Local(${localLastSync})`);
          }
          isInternalUpdate.current = true; // Bloqueamos subidas temporales
          
          if (cloudState.projects) setProjects(cloudState.projects);

          if (cloudState.clients) setClients(cloudState.clients);
          if (cloudState.transactions) setTransactions(cloudState.transactions);
          if (cloudState.rules) setRules(cloudState.rules);
          if (cloudState.notes) setNotes(cloudState.notes);
          if (cloudState.chatSessions) setChatSessions(cloudState.chatSessions);
          if (cloudState.spaces) {
            localStorage.setItem('coo_spaces', JSON.stringify(cloudState.spaces));
            window.dispatchEvent(new Event('coo_cloud_data_received'));
          }
          if (!isSilent) console.log("✅ Datos sincronizados desde la nube.");
          
          // Actualizar el estado fantasma de comparación ignorando el ruido temporal
          const cloudStateForCompare = {
              ...cloudState,
              lastModified: 0,
              projects: (cloudState.projects || []).map((p: any) => ({
                  ...p,
                  scheduledSlots: [],
                  startDate: p.autoSchedule ? '' : p.startDate,
                  endDate: p.autoSchedule ? '' : p.endDate,
                  hasConflict: false,
                  conflictDescription: ''
              }))
          };
          lastUploadedState.current = JSON.stringify(cloudStateForCompare);
          localStorage.setItem('coo_last_sync_fingerprint', lastUploadedState.current);

          // Importante: Actualizar el timestamp local para evitar un re-upload inmediato
          localStorage.setItem('coo_last_local_mod', (cloudState.lastModified || Date.now()).toString());
          
          // Liberamos el bloqueo tras un safety delay mayor que el debounce (1500ms)
          setTimeout(() => {
              isInternalUpdate.current = false;
          }, 2500);
        } else {
            if (!isSilent) console.log("ℹ️ El estado local es igual o más nuevo que la nube.");
        }
      } else {
          // BUGFIX: Si el usuario es nuevo y la nube está vacía, debemos LIMPIAR el estado local persistente
          // para que no vea los datos del perfil anterior cacheado en el navegador.
          if (!isSilent) console.log("⚠️ Nuevo usuario detectado: limpiando caché local...");
          setProjects([]);
          setClients([]);
          setTransactions([]);
          setNotes([]);
          setChatSessions([{ id: 'default', title: 'Nuevo Chat', messages: [], lastModified: Date.now() }]);
          localStorage.removeItem('coo_spaces');
          window.dispatchEvent(new Event('coo_cloud_data_received')); // Esto disparará que SpacesContext se reinicie
          localStorage.setItem('coo_last_local_mod', Date.now().toString());
          isInternalUpdate.current = true;
          setTimeout(() => isInternalUpdate.current = false, 1500);
      }
      setHasCheckedCloud(true);
    } catch (err) {
      if (!isSilent) console.error("Download Error:", err);
    } finally {
      if (!isSilent) setIsLoadingCloud(false);
      setHasCheckedCloud(true); 
      // Si este download fue provocado por un sync manual, el status se resetea en handleCloudSync
    }
  }, []); // Remove all state dependencies to avoid infinite loops and reversion

  useEffect(() => {
    handleInitialDownload();
  }, []); // Run ONLY on mount

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
    if (session?.user?.id) {
        channel = supabase
            .channel('schema-db-changes')
            .on('postgres_changes', 
                { event: '*', schema: 'public', table: 'app_state_dump', filter: `id=eq.coo_master_state_v2` },
                () => {
                    console.log("☁️ Cambio detectado en otro dispositivo, descargando...");
                    handleInitialDownload(true);
                }
            )
            .subscribe();
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
      if (channel) channel.unsubscribe();
    };
  }, [handleCloudSync, handleInitialDownload]);

  // Sincronización automática debounced
  useEffect(() => {
    const handleTriggerSync = () => { 
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
    // 1. Calcular el estado actual basado en el tiempo real
    const updatedProjects = runAutoScheduling(projects, rules);

    // 2. Detectar si hay diferencias críticas para el Briefing
    const sessionKey = sessionStorage.getItem('coo_session_active');

    if (!sessionKey) {
      const now = new Date();
      const overdue = updatedProjects.filter(p => {
        const dueDate = new Date(p.dueDate.includes('T') ? p.dueDate : p.dueDate + 'T23:59:59');
        return dueDate < now && p.status !== 'completed';
      });

      const upcoming = updatedProjects.filter(p => {
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
      } catch(e) { /* ignore parse errors */ }

      if (overdue.length > 0 || upcoming.length > 0) {
        setBriefingData({ overdue, upcoming, income: pendingIncome });
        setShowBriefing(true);
      }

      sessionStorage.setItem('coo_session_active', 'true');
    }

    setProjects(updatedProjects);

    const interval = setInterval(tickAutoScheduling, 60000);

    return () => clearInterval(interval);
  }, [rules]);


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
    ['coo_spaces', 'coo_last_local_mod', 'coo_last_sync_fingerprint'].forEach(k => localStorage.removeItem(k));
    location.reload(); 
  };

  if (!session) {
    return <LoginView onLoginSuccess={() => {}} />;
  }

  return (
    <SpacesProvider>

      <div className="flex w-full h-full bg-[#F4F5F8]">
        <Sidebar
          activeTab={activeTab}
          setActiveTab={(t) => { setActiveTab(t); setIsMobileMenuOpen(false); }}
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
            <div className="flex-1 flex overflow-hidden">
              <SpacesSidebar />
              <SpacesView />
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
    </SpacesProvider >
  );
};

export default App;
