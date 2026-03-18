
import React, { useState, useEffect, useCallback } from 'react';
import { Project, Transaction, BusinessRules, Message, Client, Priority, Service, ChatSession, Note } from './types';
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
import { createClient } from '@supabase/supabase-js';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'chat' | 'spaces' | 'finance' | 'notebook'>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Estado para el Briefing (Reporte de Situación)
  const [showBriefing, setShowBriefing] = useState(false);
  const [briefingData, setBriefingData] = useState<{ overdue: Project[], upcoming: Project[], income: number } | null>(null);

  const [projects, setProjects] = useState<Project[]>(() => {
    const saved = localStorage.getItem('coo_projects');
    return saved ? JSON.parse(saved) : TEMPLATE_PROJECTS;
  });

  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem('coo_transactions');
    return saved ? JSON.parse(saved) : TEMPLATE_TRANSACTIONS;
  });

  const [clients, setClients] = useState<Client[]>(() => {
    const saved = localStorage.getItem('coo_clients');
    return saved ? JSON.parse(saved) : TEMPLATE_CLIENTS;
  });

  const [rules, setRules] = useState<BusinessRules>(() => {
    const saved = localStorage.getItem('coo_rules');
    return saved ? JSON.parse(saved) : DEFAULT_RULES;
  });

  const [notes, setNotes] = useState<Note[]>(() => {
    const saved = localStorage.getItem('coo_notes');
    return saved ? JSON.parse(saved) : [];
  });

  const [chatSessions, setChatSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem('coo_chat_sessions');
    if (saved) return JSON.parse(saved);
    return [{ id: 'default', title: 'Nuevo Chat', messages: [], lastModified: Date.now() }];
  });

  const [currentChatId, setCurrentChatId] = useState<string>(() => {
    const saved = localStorage.getItem('coo_current_chat_id');
    return saved || 'default';
  });

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error' | 'offline'>('idle');
  const [isLoadingCloud, setIsLoadingCloud] = useState(false); // Start as false to avoid white screen
  // Estado para disparar sync cuando cambian los espacios
  const [spacesSyncTrigger, setSpacesSyncTrigger] = useState(0);

  // --- CLOUD DOWNLOAD LOGIC (INITIAL LOAD) ---
  const handleInitialDownload = useCallback(async (isSilent = false) => {
    const envUrl = import.meta.env.VITE_SUPABASE_URL;
    const envKey = import.meta.env.VITE_SUPABASE_KEY;
    const supabaseUrl = envUrl || localStorage.getItem('coo_supabase_url');
    const supabaseKey = envKey || localStorage.getItem('coo_supabase_key');

    if (!supabaseUrl || !supabaseKey) {
      setIsLoadingCloud(false);
      return;
    }

    try {
      const client = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await client
        .from('app_state_dump')
        .select('data')
        .eq('id', 'coo_master_state')
        .single();

      if (data && data.data) {
        const cloudState = data.data;
        const localLastSync = parseInt(localStorage.getItem('coo_last_local_mod') || '0');
        
        // Solo descargar si la nube es estrictamente más nueva
        if (!cloudState.lastModified || cloudState.lastModified > localLastSync) {
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
        }
      }
    } catch (err) {
      if (!isSilent) console.error("Download Error:", err);
    } finally {
      if (!isSilent) setIsLoadingCloud(false);
    }
  }, [projects, clients, transactions, rules, notes, chatSessions]);

  useEffect(() => {
    handleInitialDownload();
  }, []); // Solo al montar

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
    const envUrl = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('coo_supabase_url');
    const envKey = import.meta.env.VITE_SUPABASE_KEY || localStorage.getItem('coo_supabase_key');
    
    let channel: any;
    if (envUrl && envKey) {
        const client = createClient(envUrl, envKey);
        channel = client
            .channel('schema-db-changes')
            .on('postgres_changes', 
                { event: 'UPDATE', schema: 'public', table: 'app_state_dump', filter: 'id=eq.coo_master_state' },
                () => {
                    console.log("☁️ Cambio detectado en otro dispositivo, descargando...");
                    handleInitialDownload(true);
                }
            )
            .subscribe();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (channel) channel.unsubscribe();
    };
  }, [handleCloudSync, handleInitialDownload]);

  // --- CLOUD SYNC LOGIC (SUPABASE) ---
  const handleCloudSync = useCallback(async () => {
    if (!navigator.onLine) {
        setSyncStatus('offline');
        return;
    }

    const envUrl = import.meta.env.VITE_SUPABASE_URL;
    const envKey = import.meta.env.VITE_SUPABASE_KEY;
    const supabaseUrl = envUrl || localStorage.getItem('coo_supabase_url');
    const supabaseKey = envKey || localStorage.getItem('coo_supabase_key');

    if (!supabaseUrl || !supabaseKey) return;

    setSyncStatus('syncing');
    const client = createClient(supabaseUrl, supabaseKey);

    try {
      const rawSpaces = localStorage.getItem('coo_spaces');
      const spacesData = rawSpaces ? JSON.parse(rawSpaces) : {};
      
      const fullState = {
        projects: projects || [],
        clients: clients || [],
        transactions: transactions || [],
        rules: rules || {},
        notes: notes || [],
        chatSessions: chatSessions || [],
        spaces: spacesData,
        lastModified: Date.now()
      };

      console.log("Intentando UPSERT en Supabase...", fullState);

      const { data: returnData, error } = await client
        .from('app_state_dump')
        .upsert(
          { 
            id: 'coo_master_state', 
            data: fullState,
            updated_at: new Date().toISOString()
          }, 
          { onConflict: 'id' }
        )
        .select();

      if (error) {
          console.error("Supabase Error Detallado:", error);
          alert("❌ ERROR REAL: " + error.message);
          throw error;
      }
      
      if (returnData && returnData.length > 0) {
          console.log("✅ CONFIRMADO POR SUPABASE:", returnData);
          setSyncStatus('synced');
      } else {
          console.error("⚠️ Supabase no devolvió datos tras el upsert.");
          setSyncStatus('error');
      }
    } catch (err: any) {
      console.error("Sync Catch Error:", err);
      setSyncStatus('error');
    }
  }, [projects, clients, transactions, rules, notes, chatSessions, spacesSyncTrigger]);

  // Sincronización automática debounced
  useEffect(() => {
    const handleTriggerSync = () => { 
        console.log("🔔 Cambio detectado en Espacios, programando sync...");
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

      const pendingIncome = clients.reduce((acc, client) => {
        return acc + client.services.reduce((sAcc, s) => sAcc + s.installments.filter(i => i.status === 'PENDIENTE').reduce((iAcc, i) => iAcc + i.amount, 0), 0);
      }, 0);

      if (overdue.length > 0 || upcoming.length > 0) {
        setBriefingData({ overdue, upcoming, income: pendingIncome });
        setShowBriefing(true);
      }

      sessionStorage.setItem('coo_session_active', 'true');
    }

    setProjects(updatedProjects);

    const interval = setInterval(() => {
      setProjects(prev => {
        const hasActiveProjects = prev.some(p => p.status !== 'completed');
        if (hasActiveProjects) {
          return runAutoScheduling(prev, rules);
        }
        return prev;
      });
    }, 60000);

    return () => clearInterval(interval);
  }, [rules]); 

  // Persistencia Local (LA BASE DE TODO)
  useEffect(() => {
    localStorage.setItem('coo_projects', JSON.stringify(projects));
    localStorage.setItem('coo_last_local_mod', Date.now().toString());
  }, [projects]);
  
  useEffect(() => {
    localStorage.setItem('coo_transactions', JSON.stringify(transactions));
    localStorage.setItem('coo_last_local_mod', Date.now().toString());
  }, [transactions]);
  
  useEffect(() => {
    localStorage.setItem('coo_clients', JSON.stringify(clients));
    localStorage.setItem('coo_last_local_mod', Date.now().toString());
  }, [clients]);
  
  useEffect(() => {
    localStorage.setItem('coo_rules', JSON.stringify(rules));
    localStorage.setItem('coo_last_local_mod', Date.now().toString());
  }, [rules]);
  
  useEffect(() => {
    localStorage.setItem('coo_chat_sessions', JSON.stringify(chatSessions));
    localStorage.setItem('coo_last_local_mod', Date.now().toString());
  }, [chatSessions]);
  
  useEffect(() => {
    localStorage.setItem('coo_current_chat_id', currentChatId);
  }, [currentChatId]);
  
  useEffect(() => {
    localStorage.setItem('coo_notes', JSON.stringify(notes));
    localStorage.setItem('coo_last_local_mod', Date.now().toString());
  }, [notes]);


  // --- DATA PORTABILITY (BACKUP & RESTORE) ---
  const handleExportData = () => {
    const data = {
      projects,
      clients,
      transactions,
      rules,
      notes,
      chatSessions,
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
        const rawData = JSON.parse(e.target?.result as string);

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

        alert('✅ Datos restaurados y actualizados a la versión actual.');
      } catch (error) {
        console.error(error);
        alert('❌ Error al leer el archivo de respaldo. Asegúrate que sea un .json válido.');
      }
    };
    reader.readAsText(file);
  };

  const handleUpdateProject = (updatedProject: Project) => {
    let updatedList = projects.map(p => p.id === updatedProject.id ? updatedProject : p);
    if (updatedProject.autoSchedule) { updatedList = runAutoScheduling(updatedList, rules); }
    setProjects(updatedList);
  };

  const handleAddProject = (newProject: Project) => {
    let updatedList = [...projects, newProject];
    if (newProject.autoSchedule) { updatedList = runAutoScheduling(updatedList, rules); }
    setProjects(updatedList);
  };

  const handleDeleteProject = (projectId: string) => {
    setProjects(prev => {
      const filtered = prev.filter(p => p.id !== projectId);
      return runAutoScheduling(filtered, rules);
    });
    setClients(prev => prev.map(c => ({
      ...c,
      services: c.services.filter(s => s.projectId !== projectId)
    })));
  };

  const handleDeleteClient = (clientId: string) => {
    setClients(prev => prev.filter(c => c.id !== clientId));
    setProjects(prev => {
      const filtered = prev.filter(p => p.clientId !== clientId);
      return runAutoScheduling(filtered, rules);
    });
  };

  const handleSetMessages = (action: React.SetStateAction<Message[]>) => {
    setChatSessions(prev => {
      const index = prev.findIndex(s => s.id === currentChatId);
      if (index === -1) return prev;

      const session = prev[index];
      const newMessages = typeof action === 'function' ? action(session.messages) : action;

      const updatedSessions = [...prev];
      updatedSessions[index] = { ...session, messages: newMessages, lastModified: Date.now() };
      return updatedSessions;
    });
  };

  const handleNewChat = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    setChatSessions(prev => [{ id: newId, title: 'Nuevo Chat', messages: [], lastModified: Date.now() }, ...prev]);
    setCurrentChatId(newId);
  };

  const handleDeleteChat = (id: string) => {
    const newSessions = chatSessions.filter(s => s.id !== id);
    if (newSessions.length === 0) {
      const newId = 'default';
      setChatSessions([{ id: newId, title: 'Nuevo Chat', messages: [], lastModified: Date.now() }]);
      setCurrentChatId(newId);
    } else {
      setChatSessions(newSessions);
      if (currentChatId === id) {
        setCurrentChatId(newSessions[0].id);
      }
    }
  };

  const activeMessages = chatSessions.find(s => s.id === currentChatId)?.messages || [];

  if (isLoadingCloud) {
    return (
      <div className="h-screen w-screen bg-[#F4F5F8] flex flex-col items-center justify-center font-sans">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-slate-600 font-black uppercase tracking-widest text-xs animate-pulse">Sincronizando con la nube...</p>
      </div>
    );
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
                rules={rules}
                onAddProject={handleAddProject}
                onUpdateProject={handleUpdateProject}
                onAddTransaction={(t) => setTransactions(prev => [...prev, t])}
                onUpdateClients={setClients}
                onDeleteProject={handleDeleteProject}
                onDeleteClient={handleDeleteClient}
                chatSessions={chatSessions}
                currentChatId={currentChatId}
                onNewChat={handleNewChat}
                onSelectChat={setCurrentChatId}
                onDeleteChat={handleDeleteChat}
                notes={notes}
                onSaveNote={(n) => setNotes(prev => [...prev, n])}
              />}
              {activeTab === 'finance' && <FinanceView clients={clients} onUpdateSingleClient={(c) => setClients(prev => prev.map(cl => cl.id === c.id ? c : cl))} onAddProject={handleAddProject} onAddClient={(c) => setClients(prev => [...prev, c])} onDeleteService={(cId, sId, pId) => { if (pId) handleDeleteProject(pId); }} onDeleteClient={handleDeleteClient} />}
              {activeTab === 'notebook' && <NotebookView notes={notes} onSaveNote={(n) => setNotes(prev => [...prev, n])} onDeleteNote={(id) => setNotes(prev => prev.filter(n => n.id !== id))} onDiscussNote={() => { }} />}
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
