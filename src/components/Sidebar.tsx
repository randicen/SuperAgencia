
import React, { useRef, useState, useEffect } from 'react';

import { useSpaces } from '../contexts/SpacesContext';
import { useAuth } from '../contexts/AuthContext';
import UserProfileMenu from './UserProfileMenu';
import { SpacesSyncDiagnostics } from '../utils/spacesSyncService';

interface SidebarProps {
    activeTab: string;
    setActiveTab: (tab: any) => void;
    onExport: () => void;
    onImport?: (file: File) => void;
    onCloudSync: () => void;
    syncStatus?: 'idle' | 'syncing' | 'synced' | 'error' | 'offline';
    spacesSyncStatus?: 'idle' | 'syncing' | 'synced' | 'error' | 'offline' | 'safe';
    spacesSyncDiagnostics?: SpacesSyncDiagnostics;
    isOnline?: boolean;
    capacity: number;
    mobileOpen?: boolean;
    setMobileOpen?: (open: boolean) => void;
}

type InstallHelpMode = 'android' | 'ios' | 'desktop';

const Sidebar: React.FC<SidebarProps> = ({
    activeTab,
    setActiveTab,
    onExport,
    onImport,
    onCloudSync,
    syncStatus = 'idle',
    spacesSyncStatus = 'idle',
    spacesSyncDiagnostics,
    isOnline = true,
    capacity,
    mobileOpen = false,
    setMobileOpen
}) => {
    const { state: spacesState, dispatch } = useSpaces();
    const { user, signOut } = useAuth();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [showCloudModal, setShowCloudModal] = useState(false);
    const [showInstallHelp, setShowInstallHelp] = useState(false);
    const [installHelpMode, setInstallHelpMode] = useState<InstallHelpMode>('android');

    // Workspace Switching State
    const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
    const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
    const [newWorkspaceName, setNewWorkspaceName] = useState('');
    const [editingWorkspace, setEditingWorkspace] = useState<{ id: string, name: string } | null>(null);
    const [workspaceToDelete, setWorkspaceToDelete] = useState<{ id: string, name: string } | null>(null);

    // Estado para controlar el botón de descarga
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [isAppInstalled, setIsAppInstalled] = useState(false);

    // Detección de entorno profesional
    // @ts-ignore
    const envUrl = import.meta.env.VITE_SUPABASE_URL || '';
    // @ts-ignore
    const envKey = import.meta.env.VITE_SUPABASE_KEY || '';
    const isEnterpriseMode = !!(envUrl && envKey);

    const [supabaseUrl, setSupabaseUrl] = useState('');
    const [supabaseKey, setSupabaseKey] = useState('');

    // Detectar si ya está instalada o es un dispositivo móvil
    useEffect(() => {
        // Chequear si ya está corriendo como standalone (App instalada)
        if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
            setIsAppInstalled(true);
        }

        const handleInstalled = () => {
            setIsAppInstalled(true);
            setDeferredPrompt(null);
        };

        window.addEventListener('appinstalled', handleInstalled);
        return () => window.removeEventListener('appinstalled', handleInstalled);
    }, []);

    // Cargar llaves
    useEffect(() => {
        if (isEnterpriseMode) {
            setSupabaseUrl(envUrl);
            setSupabaseKey(envKey);
            localStorage.setItem('coo_supabase_url', envUrl);
            localStorage.setItem('coo_supabase_key', envKey);
        } else {
            const savedUrl = localStorage.getItem('coo_supabase_url');
            const savedKey = localStorage.getItem('coo_supabase_key');
            if (savedUrl) setSupabaseUrl(savedUrl);
            if (savedKey) setSupabaseKey(savedKey);
        }
    }, [isEnterpriseMode, envUrl, envKey]);

    // Capturar el evento nativo de Chrome/Edge para instalar
    useEffect(() => {
        const handler = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e);
        };
        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const detectInstallHelpMode = (): InstallHelpMode => {
        const ua = navigator.userAgent.toLowerCase();
        const isAndroid = ua.includes('android');
        const isIOS = /iphone|ipad|ipod/.test(ua);
        const isSafari = ua.includes('safari') && !ua.includes('chrome') && !ua.includes('crios') && !ua.includes('edg');

        if (isAndroid) return 'android';
        if (isIOS || isSafari) return 'ios';
        return 'desktop';
    };

    const handleDownloadClick = async () => {
        if (deferredPrompt) {
            // Si el navegador soporta instalación automática (Chrome, Edge, Android)
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                setDeferredPrompt(null);
                setIsAppInstalled(true);
            }
        } else {
            setInstallHelpMode(detectInstallHelpMode());
            setShowInstallHelp(true);
        }
    };

    const installHelpContent: Record<InstallHelpMode, { icon: string; title: string; description: string; step1: string; step2: string; }> = {
        android: {
            icon: 'fa-brands fa-android',
            title: 'Instalar en Android',
            description: 'Si no aparece el aviso automático, puedes instalarla manualmente desde Chrome.',
            step1: 'Toca el menú ⋮ de Chrome (arriba a la derecha).',
            step2: 'Elige "Instalar app" o "Agregar a pantalla principal".'
        },
        ios: {
            icon: 'fa-brands fa-apple',
            title: 'Instalar en iPhone / iPad',
            description: 'En iOS la instalación se hace manualmente desde el menú compartir.',
            step1: 'Toca el botón de Compartir.',
            step2: 'Selecciona "Agregar a pantalla de inicio".'
        },
        desktop: {
            icon: 'fa-solid fa-display',
            title: 'Instalar en computador',
            description: 'Si no salió el popup, instala la app desde el navegador.',
            step1: 'Abre el menú del navegador (Chrome/Edge).',
            step2: 'Haz clic en "Instalar SuperAgencia" o "Apps > Instalar".'
        }
    };

    const handleSaveKeys = () => {
        if (isEnterpriseMode) return;
        if (!supabaseUrl || !supabaseKey) {
            alert("Por favor ingresa ambos datos (URL y Key).");
            return;
        }
        localStorage.setItem('coo_supabase_url', supabaseUrl);
        localStorage.setItem('coo_supabase_key', supabaseKey);
        alert("✅ Llaves guardadas. Ahora puedes probar el botón 'Sincronizar'.");
        setShowCloudModal(false);
        window.location.reload();
    };

    const handleCreateWorkspace = () => {
        if (newWorkspaceName.trim()) {
            dispatch({ type: 'ADD_WORKSPACE', payload: { nombre: newWorkspaceName } });
            setNewWorkspaceName('');
            setIsCreatingWorkspace(false);
        }
    };

    const handleRenameWorkspace = () => {
        if (editingWorkspace && editingWorkspace.name.trim()) {
            dispatch({ type: 'RENAME_WORKSPACE', payload: { workspaceId: editingWorkspace.id, nombre: editingWorkspace.name } });
            setEditingWorkspace(null);
        }
    };

    const handleDeleteWorkspace = (id: string, name: string) => {
        setWorkspaceToDelete({ id, name });
    };

    const confirmDeleteWorkspace = () => {
        if (workspaceToDelete) {
            dispatch({ type: 'DELETE_WORKSPACE', payload: { workspaceId: workspaceToDelete.id } });
            setWorkspaceToDelete(null);
        }
    };

    const activeWorkspace = spacesState.workspaces.find(w => w.id === spacesState.activeWorkspaceId) || spacesState.workspaces[0];
    const formatSyncStamp = (value?: string | null) => {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
    };
    const spacesModeLabel = spacesSyncDiagnostics?.mode === 'live'
        ? 'Row Sync'
        : spacesSyncDiagnostics?.mode === 'migrating'
            ? 'Migrando'
            : 'Modo seguro';

    // Helper to get initials
    const getInitials = (name: string) => name.substring(0, 2).toUpperCase();

    const menuItems = [
        { id: 'dashboard', label: 'Panorama', icon: 'fa-chart-pie' },
        { id: 'spaces', label: 'Espacios', icon: 'fa-layer-group' },
        { id: 'agenda', label: 'Agenda', icon: 'fa-calendar-days' },
        { id: 'chat', label: 'Asistente IA', icon: 'fa-wand-magic-sparkles' },
        { id: 'finance', label: 'Finanzas', icon: 'fa-coins' },
        { id: 'notebook', label: 'Notas', icon: 'fa-book' },
    ];

    const getCapacityColor = (cap: number) => {
        if (cap > 80) return 'bg-red-500';
        if (cap > 50) return 'bg-yellow-500';
        return 'bg-green-500';
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0 && onImport) {
            onImport(e.target.files[0]);
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const sqlBlueprint = `
npx supabase db push

# Migraciones incluidas en el repo:
# - supabase/migrations/20260321_gcal_tables.sql
# - supabase/migrations/20260322_add_user_id_to_app_state_dump.sql
# - supabase/migrations/20260327_normalize_spaces_sync.sql
# - supabase/migrations/20260328_spaces_sync_atomic_fix.sql
  `;
    const workspaceMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(event.target as Node)) {
                setShowWorkspaceMenu(false);
                setIsCreatingWorkspace(false);
                setEditingWorkspace(null);
            }
        };

        if (showWorkspaceMenu) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showWorkspaceMenu]);

    return (
        <>
            {/* Backdrop para cerrar menú en móvil */}
            {mobileOpen && (
                <div
                    className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30 md:hidden"
                    onClick={() => setMobileOpen && setMobileOpen(false)}
                ></div>
            )}

            <aside className={`
        fixed inset-y-0 left-0 z-40 w-[240px] bg-[#0F1117] text-[#94A3B8] flex flex-col border-r border-[#1E293B]
        transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:shrink-0
        ${mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}
    `}>
                {/* WORKSPACE HEADER */}
                <div className="h-16 flex items-center px-4 border-b border-[#1E293B] relative z-50">
                    <div className="flex-1 relative" ref={workspaceMenuRef}>
                        <button
                            onClick={() => setShowWorkspaceMenu(!showWorkspaceMenu)}
                            className="flex items-center gap-3 w-full p-1.5 rounded-lg hover:bg-[#1E293B] transition-colors group"
                        >
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-lg bg-gradient-to-br from-indigo-500 to-purple-600`}>
                                {activeWorkspace ? getInitials(activeWorkspace.nombre) : 'WS'}
                            </div>
                            <div className="flex-1 text-left min-w-0">
                                <span className="block text-sm font-semibold text-white tracking-tight truncate">
                                    {activeWorkspace ? activeWorkspace.nombre : 'Sin Espacios'}
                                </span>
                                <span className="block text-[10px] text-slate-500 font-medium">Click para cambiar</span>
                            </div>
                            <i className="fa-solid fa-chevron-down text-xs text-slate-500 group-hover:text-white transition-colors"></i>
                        </button>

                        {/* WORKSPACE DROPDOWN */}
                        {showWorkspaceMenu && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-[#1A1C23] border border-[#2A2D35] rounded-xl shadow-2xl overflow-hidden animate-in slide-in-from-top-2">
                                <div className="p-2 space-y-1 max-h-[200px] overflow-y-auto custom-scrollbar">
                                    {spacesState.workspaces.map(ws => (
                                        <div key={ws.id} className="group relative flex items-center gap-2 p-2 rounded-lg hover:bg-[#252833] cursor-pointer">
                                            {editingWorkspace && editingWorkspace.id === ws.id ? (
                                                <div className="flex items-center gap-2 w-full">
                                                    <input
                                                        autoFocus
                                                        value={editingWorkspace.name}
                                                        onChange={(e) => setEditingWorkspace({ ...editingWorkspace, name: e.target.value })}
                                                        className="flex-1 bg-black/20 border border-slate-600 rounded px-2 py-1 text-xs text-white outline-none"
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleRenameWorkspace();
                                                            if (e.key === 'Escape') setEditingWorkspace(null);
                                                        }}
                                                    />
                                                    <button onClick={handleRenameWorkspace} className="text-emerald-500 hover:text-emerald-400"><i className="fa-solid fa-check"></i></button>
                                                </div>
                                            ) : (
                                                <div
                                                    className="flex items-center gap-3 flex-1 min-w-0"
                                                    onClick={() => {
                                                        dispatch({ type: 'SET_ACTIVE_WORKSPACE', payload: { workspaceId: ws.id } });
                                                        setShowWorkspaceMenu(false);
                                                    }}
                                                >
                                                    <div className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold ${spacesState.activeWorkspaceId === ws.id ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                                                        {getInitials(ws.nombre)}
                                                    </div>
                                                    <span className={`text-xs truncate ${spacesState.activeWorkspaceId === ws.id ? 'text-white font-bold' : 'text-slate-400'}`}>
                                                        {ws.nombre}
                                                    </span>
                                                </div>
                                            )}

                                            {/* Actions for Workspace (Edit/Delete) - Only show if not editing */}
                                            {!editingWorkspace && (
                                                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button onClick={(e) => { e.stopPropagation(); setEditingWorkspace({ id: ws.id, name: ws.nombre }); }} className="p-1.5 text-slate-500 hover:text-blue-400">
                                                        <i className="fa-solid fa-pen text-[10px]"></i>
                                                    </button>
                                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteWorkspace(ws.id, ws.nombre); }} className="p-1.5 text-slate-500 hover:text-red-400">
                                                        <i className="fa-solid fa-trash text-[10px]"></i>
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <div className="p-2 border-t border-[#2A2D35] bg-[#16181D]">
                                    {isCreatingWorkspace ? (
                                        <div className="flex items-center gap-2">
                                            <input
                                                autoFocus
                                                placeholder="Nombre del Espacio..."
                                                value={newWorkspaceName}
                                                onChange={(e) => setNewWorkspaceName(e.target.value)}
                                                className="flex-1 bg-black/20 border border-slate-600 rounded px-2 py-1.5 text-xs text-white outline-none placeholder:text-slate-600"
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleCreateWorkspace();
                                                    if (e.key === 'Escape') setIsCreatingWorkspace(false);
                                                }}
                                            />
                                            <button onClick={handleCreateWorkspace} className="w-6 h-6 flex items-center justify-center bg-indigo-600 text-white rounded hover:bg-indigo-500">
                                                <i className="fa-solid fa-plus text-xs"></i>
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setIsCreatingWorkspace(true)}
                                            className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg border border-dashed border-slate-600 text-slate-500 hover:text-white hover:border-slate-500 transition-all text-xs font-bold uppercase"
                                        >
                                            <i className="fa-solid fa-plus"></i> Nuevo Espacio
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    {/* Botón cerrar solo visible en móvil (fuera del relativo para que no se oculte con el dropdown) */}
                    <button
                        className="md:hidden text-slate-500 hover:text-white ml-2"
                        onClick={() => setMobileOpen && setMobileOpen(false)}
                    >
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                {/* Navigation */}
                <div className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
                    <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-[#475569] mb-2">Principal</p>
                    {menuItems.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition-all group ${activeTab === item.id
                                ? 'bg-[#3A57E8]/10 text-[#3A57E8]'
                                : 'hover:bg-[#1E293B] hover:text-white'
                                }`}
                        >
                            <i className={`fa-solid ${item.icon} w-4 text-center ${activeTab === item.id ? 'text-[#3A57E8]' : 'text-[#64748B] group-hover:text-white'}`}></i>
                            {item.label}
                        </button>
                    ))}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-[#1E293B] bg-[#0F1117] space-y-4">

                    <div className="flex items-center justify-between px-1">
                        <div className="flex items-center gap-1.5">
                            <div className={`w-1.5 h-1.5 rounded-full ${
                                !supabaseUrl ? 'bg-orange-500' : 
                                !isOnline ? 'bg-slate-500' :
                                syncStatus === 'syncing' ? 'bg-emerald-500 animate-pulse' :
                                syncStatus === 'error' ? 'bg-red-500' : 'bg-emerald-500'
                            }`}></div>
                            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tight">
                                {!supabaseUrl ? 'Modo: Local' : (!isOnline ? 'Modo: Offline' : (syncStatus === 'syncing' ? 'Sincronizando...' : 'Modo: Nube'))}
                            </span>
                        </div>
                    </div>

                    <div className="bg-[#1A1C23] rounded-md p-3 border border-[#2A2D35]">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Carga Operativa</span>
                            <span className="text-[10px] font-mono text-white">{capacity}%</span>
                        </div>
                        <div className="w-full h-1 bg-[#2A2D35] rounded-full overflow-hidden">
                            <div className={`h-full ${getCapacityColor(capacity)} transition-all duration-500`} style={{ width: `${capacity}%` }}></div>
                        </div>
                    </div>

                    {showSpacesSyncNotice && spacesSyncDiagnostics && (
                        <div className={`rounded-md px-3 py-2 border ${
                            spacesSyncDiagnostics.lastError
                                ? 'bg-amber-500/10 border-amber-500/30'
                                : 'bg-sky-500/10 border-sky-500/20'
                        }`}>
                            <div className="flex items-start gap-2">
                                <i className={`fa-solid ${
                                    spacesSyncDiagnostics.lastError ? 'fa-triangle-exclamation text-amber-300' : 'fa-arrows-rotate text-sky-300'
                                } mt-0.5 text-[11px]`}></i>
                                <div className="min-w-0">
                                    <p className="text-[10px] font-black uppercase tracking-wider text-white">Sincronizaci?n de tareas</p>
                                    <p className="text-[10px] leading-relaxed text-slate-300">
                                        {spacesSyncDiagnostics.lastError
                                            ? 'Estamos reparando la sincronizaci?n entre dispositivos.'
                                            : spacesSyncDiagnostics.mode === 'migrating'
                                                ? 'Reorganizando tareas en la nube para estabilizar el guardado.'
                                                : 'La sincronizaci?n qued? en modo seguro temporalmente.'}
                                    </p>
                                    {spacesSyncDiagnostics.lastError && (
                                        <p className="text-[9px] leading-relaxed text-amber-200/90 mt-1 break-words">
                                            {spacesSyncDiagnostics.lastError}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* BOTÓN DE DESCARGA (Estilo ClickUp/Slack) */}
                    {!isAppInstalled && (
                        <button
                            onClick={handleDownloadClick}
                            className="w-full py-2.5 bg-[#1E293B] hover:bg-[#2A2D35] border border-slate-700 rounded-lg text-slate-300 hover:text-white text-[10px] font-bold uppercase transition-all flex items-center justify-center gap-2 group"
                        >
                            <i className="fa-solid fa-download text-blue-500 group-hover:text-blue-400"></i>
                            Descargar App
                        </button>
                    )}

                    {user && (
                        <UserProfileMenu />
                    )}

                    <div className="grid grid-cols-1 gap-2 mt-2">
                        {onImport && (
                            <>
                                <button onClick={() => fileInputRef.current?.click()} className="w-full flex items-center justify-center gap-2 bg-[#1A1C23] hover:bg-indigo-500/20 py-2.5 rounded-md border border-[#2A2D35] hover:border-indigo-500/50 transition-all group">
                                    <i className="fa-solid fa-cloud-arrow-up text-indigo-400 group-hover:text-indigo-300 transition-colors"></i>
                                    <span className="text-[10px] font-bold text-indigo-400 group-hover:text-indigo-300 uppercase tracking-wider">Restaurar Data Antigua</span>
                                </button>
                                <input 
                                    type="file" 
                                    ref={fileInputRef} 
                                    className="hidden" 
                                    accept=".json" 
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file && onImport) {
                                            onImport(file);
                                            e.target.value = ''; // Reset input to allow rapid re-upload if needed
                                        }
                                    }} 
                                />
                            </>
                        )}
                        <button onClick={onExport} className="w-full flex items-center justify-center gap-2 bg-[#1A1C23] hover:bg-[#252833] py-2.5 rounded-md border border-[#2A2D35] transition-colors group">
                            <i className="fa-solid fa-cloud-arrow-down text-slate-500 group-hover:text-white transition-colors"></i>
                            <span className="text-[10px] font-bold text-slate-500 group-hover:text-white uppercase tracking-wider">Descargar Backup .JSON</span>
                        </button>
                    </div>

                    <div className="flex gap-2">
                        {(supabaseUrl && supabaseKey) ? (
                            <>
                                <button 
                                    onClick={onCloudSync} 
                                    disabled={syncStatus === 'syncing'}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-white shadow-lg transition-all group ${
                                        syncStatus === 'syncing' ? 'bg-emerald-700 cursor-wait' : 
                                        syncStatus === 'error' ? 'bg-red-600' : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20'
                                    }`}
                                >
                                    <i className={`fa-solid fa-rotate text-xs ${syncStatus === 'syncing' ? 'animate-spin' : 'group-hover:animate-spin'}`}></i>
                                    <span className="text-[10px] font-black uppercase tracking-wide">
                                        {syncStatus === 'syncing' ? '...' : (syncStatus === 'error' ? 'Retry' : 'Sync')}
                                    </span>
                                </button>
                                <button onClick={() => setShowCloudModal(true)} className="w-10 flex items-center justify-center py-2.5 rounded-lg bg-[#1A1C23] text-slate-400 border border-[#2A2D35] hover:text-white">
                                    <i className="fa-solid fa-gear text-xs"></i>
                                </button>
                            </>
                        ) : (
                            <button onClick={() => setShowCloudModal(true)} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 transition-all group">
                                <i className="fa-solid fa-bolt text-xs animate-pulse"></i>
                                <span className="text-[10px] font-black uppercase tracking-wide">Conectar Nube</span>
                            </button>
                        )}
                    </div>
                </div>
            </aside>

            {/* MODAL DE AYUDA DE INSTALACIÓN */}
            {showInstallHelp && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={() => setShowInstallHelp(false)}>
                    <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl animate-in zoom-in-95 text-center" onClick={e => e.stopPropagation()}>
                        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-600 text-xl">
                            <i className={installHelpContent[installHelpMode].icon}></i>
                        </div>
                        <h3 className="text-lg font-black text-slate-800 mb-2">{installHelpContent[installHelpMode].title}</h3>
                        <p className="text-xs text-slate-500 mb-6 px-4">
                            {installHelpContent[installHelpMode].description}
                        </p>

                        <div className="text-left bg-slate-50 p-4 rounded-xl space-y-3 mb-6">
                            <div className="flex items-center gap-3">
                                <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-bold">1</span>
                                <span className="text-xs font-bold text-slate-700">{installHelpContent[installHelpMode].step1}</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-bold">2</span>
                                <span className="text-xs font-bold text-slate-700">{installHelpContent[installHelpMode].step2}</span>
                            </div>
                        </div>

                        <button onClick={() => setShowInstallHelp(false)} className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold text-xs uppercase">Entendido</button>
                    </div>
                </div>
            )}

            {showCloudModal && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={() => setShowCloudModal(false)}>
                    <div className="bg-white w-full max-w-2xl rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in-95 flex flex-col max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-4 mb-6 shrink-0">
                            <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600 text-xl">
                                <i className="fa-solid fa-database"></i>
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">
                                    {isEnterpriseMode ? 'Conexión Gestionada' : 'Configuración de Nube'}
                                </h3>
                                <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Supabase + Tu App</p>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-6">
                            {isEnterpriseMode ? (
                                <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100 text-center space-y-4">
                                    <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto text-2xl">
                                        <i className="fa-solid fa-shield-halved"></i>
                                    </div>
                                    <div>
                                        <h4 className="font-black text-indigo-900 uppercase">Entorno Seguro Activo</h4>
                                        <p className="text-xs text-indigo-700 mt-2">
                                            Esta aplicación está desplegada profesionalmente. Las credenciales están gestionadas por el servidor.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2 text-slate-800 font-black text-xs uppercase tracking-widest">
                                            <span className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center">1</span>
                                            Preparar la Base de Datos (SQL)
                                        </div>
                                        <div className="relative group ml-8">
                                            <textarea readOnly className="w-full h-24 bg-slate-900 text-slate-300 p-4 rounded-xl text-[10px] font-mono border border-slate-700 outline-none resize-none custom-scrollbar" value={sqlBlueprint} />
                                            <button onClick={() => navigator.clipboard.writeText(sqlBlueprint)} className="absolute bottom-2 right-2 bg-white/10 hover:bg-white/20 text-white px-3 py-1 rounded-lg text-[9px] font-bold backdrop-blur-md transition-all">Copiar SQL</button>
                                        </div>
                                    </div>

                                    <div className="space-y-4 pt-4 border-t border-slate-100">
                                        <div className="flex items-center gap-2 text-slate-800 font-black text-xs uppercase tracking-widest">
                                            <span className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center">2</span>
                                            Credenciales Manuales
                                        </div>

                                        <div className="ml-8 space-y-3">
                                            <div>
                                                <label className="text-[9px] font-black uppercase text-slate-400">Project URL</label>
                                                <input
                                                    value={supabaseUrl}
                                                    onChange={(e) => setSupabaseUrl(e.target.value)}
                                                    placeholder="https://tuproyecto.supabase.co"
                                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 ring-emerald-500/20 outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[9px] font-black uppercase text-slate-400">API Key (anon)</label>
                                                <input
                                                    value={supabaseKey}
                                                    onChange={(e) => setSupabaseKey(e.target.value)}
                                                    placeholder="eyJhbGciOiJIUzI1NiIsInR..."
                                                    type="password"
                                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 ring-emerald-500/20 outline-none"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="pt-6 mt-4 border-t border-slate-100 shrink-0 flex gap-3">
                            <button onClick={() => setShowCloudModal(false)} className="flex-1 py-3 text-slate-400 hover:text-slate-600 font-bold text-xs">Cerrar</button>
                            {!isEnterpriseMode && (
                                <button
                                    onClick={handleSaveKeys}
                                    className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-black text-xs uppercase shadow-xl shadow-emerald-200 hover:bg-emerald-700 transition-all"
                                >
                                    Guardar & Conectar
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL CONFIRMACION ELIMINAR WORKSPACE */}
            {workspaceToDelete && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={() => setWorkspaceToDelete(null)}>
                    <div className="bg-white w-full max-w-md rounded-2xl p-6 shadow-2xl animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                        <div className="flex flex-col items-center text-center space-y-4">
                            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600 text-xl">
                                <i className="fa-solid fa-triangle-exclamation"></i>
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-slate-800">¿Eliminar Espacio?</h3>
                                <p className="text-sm text-slate-500 mt-1">
                                    Estás a punto de eliminar <strong>"{workspaceToDelete.name}"</strong>.
                                    <br />Esta acción eliminará todos los tableros y tareas dentro.
                                </p>
                            </div>
                            <div className="flex items-center gap-3 w-full pt-2">
                                <button
                                    onClick={() => setWorkspaceToDelete(null)}
                                    className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-50 uppercase"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={confirmDeleteWorkspace}
                                    className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-bold text-xs hover:bg-red-700 uppercase shadow-lg shadow-red-200"
                                >
                                    Sí, Eliminar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default Sidebar;
