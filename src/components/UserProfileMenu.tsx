import React from 'react';
import { Popover, Transition } from '@headlessui/react';
import { useAuth } from '../contexts/AuthContext';

const UserProfileMenu: React.FC = () => {
    const { user, signOut } = useAuth();

    if (!user) return null;

    const initials = user.email ? user.email.charAt(0).toUpperCase() : '?';

    const handleSafeLogout = async () => {
        // Limpiamos la caché del usuario actual sin afectar las llaves del sistema (Supabase Vercel Config)
        ['coo_spaces', 'coo_last_local_mod', 'coo_last_sync_fingerprint', 'coo_last_cloud_mod', 'coo_has_unsynced_local', 'coo_has_unsynced_local_v2', 'coo_has_unsynced_local_v3'].forEach(k => localStorage.removeItem(k));
        
        await signOut();
        window.location.reload();
    };

    return (
        <Popover className="relative w-full mt-2 mb-2">
            {({ open }) => (
                <>
                    <Popover.Button className={`
                        w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left outline-none
                        ${open ? 'bg-[#1E293B] border-indigo-500/50 shadow-md shadow-indigo-500/10' : 'bg-[#1A1C23] border-[#2A2D35] hover:bg-[#1E293B]'}
                    `}>
                        <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-xs ring-2 ring-indigo-500/30 flex-shrink-0">
                            {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-white font-bold truncate">{user.email || 'Miembro Fundador'}</p>
                            <p className="text-[9px] text-emerald-500 font-bold uppercase tracking-wider flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                Conectado a la Nube
                            </p>
                        </div>
                        <i className={`fa-solid fa-chevron-up text-[10px] text-slate-500 transition-transform duration-200 ${open ? '' : 'rotate-180'}`}></i>
                    </Popover.Button>

                    <Transition
                        as={React.Fragment}
                        enter="transition ease-out duration-200"
                        enterFrom="opacity-0 translate-y-2 scale-95"
                        enterTo="opacity-100 translate-y-0 scale-100"
                        leave="transition ease-in duration-150"
                        leaveFrom="opacity-100 translate-y-0 scale-100"
                        leaveTo="opacity-0 translate-y-2 scale-95"
                    >
                        <Popover.Panel className="absolute z-50 bottom-full left-0 w-full mb-2 bg-[#1A1C23] border border-[#2A2D35] rounded-xl shadow-2xl p-2 outline-none">
                            <div className="px-3 py-2 mb-2 bg-[#0F1117] rounded-lg border border-[#1E293B]">
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide mb-1">Membresía</p>
                                <div className="flex items-center gap-2">
                                    <i className="fa-solid fa-crown text-yellow-500 text-xs"></i>
                                    <span className="text-xs text-white font-bold">Plan Enterprise SaaS</span>
                                </div>
                            </div>
                            
                            <div className="space-y-1">
                                <button
                                    onClick={() => alert("Módulo de Facturación Aislado en Vercel próximamente")}
                                    className="w-full text-left px-3 py-2.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-[#252833] transition-colors flex items-center gap-3 group"
                                >
                                    <i className="fa-solid fa-file-invoice-dollar w-4 text-slate-500 group-hover:text-white transition-colors"></i>
                                    Facturación y Plan
                                </button>
                                
                                <div className="h-[1px] bg-[#2A2D35] my-2 w-full"></div>

                                <button
                                    onClick={handleSafeLogout}
                                    className="w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold text-red-400 hover:text-white hover:bg-red-500/20 transition-colors flex items-center gap-3 group"
                                >
                                    <i className="fa-solid fa-right-from-bracket w-4 text-red-400 group-hover:text-white transition-colors"></i>
                                    Cerrar Sesión Segura
                                </button>
                            </div>
                        </Popover.Panel>
                    </Transition>
                </>
            )}
        </Popover>
    );
};

export default UserProfileMenu;
