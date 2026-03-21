import React from 'react';
import { useSpaces } from '../contexts/SpacesContext';
import { useGCalSensor } from '../hooks/useGCalSensor';

const DAYS = [
    { id: 1, label: 'L' },
    { id: 2, label: 'M' },
    { id: 3, label: 'X' },
    { id: 4, label: 'J' },
    { id: 5, label: 'V' },
    { id: 6, label: 'S' },
    { id: 0, label: 'D' },
];

const SettingsView: React.FC = () => {
    const { state, dispatch } = useSpaces();
    const { rules } = state;
    const gcal = useGCalSensor();

    const updateRules = (newRules: typeof rules) => {
        dispatch({ type: 'UPDATE_RULES', payload: newRules });
    };

    const toggleDay = (dayId: number) => {
        const isRemoving = rules.workingDays.includes(dayId);
        if (isRemoving && rules.workingDays.length === 1) return;

        const newDays = isRemoving
            ? rules.workingDays.filter(d => d !== dayId)
            : [...rules.workingDays, dayId].sort();
        updateRules({ ...rules, workingDays: newDays });
    };

    // When gcal events change, push to scheduler
    React.useEffect(() => {
        if (gcal.events.length > 0) {
            dispatch({ type: 'SET_GCAL_EVENTS', payload: { events: gcal.events } });
        }
    }, [gcal.events, dispatch]);

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            <header>
                <h2 className="text-3xl font-black text-slate-800 tracking-tight">CONFIGURACIÓN</h2>
                <p className="text-slate-500 font-medium">Define los límites de tu motor de agendamiento</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* JORNADA LABORAL */}
                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 space-y-6">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 shadow-sm">
                            <i className="fa-solid fa-calendar-day text-xl"></i>
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800 uppercase tracking-wider text-sm">Jornada Laboral</h3>
                            <p className="text-xs text-slate-400">Días y horas disponibles</p>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div>
                            <label className="text-xs font-black text-slate-400 uppercase mb-3 block">Días Activos</label>
                            <div className="flex gap-2">
                                {DAYS.map(day => (
                                    <button
                                        key={day.id}
                                        onClick={() => toggleDay(day.id)}
                                        className={`w-10 h-10 rounded-xl font-bold text-sm transition-all duration-300 ${rules.workingDays.includes(day.id)
                                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 scale-105'
                                            : 'bg-slate-50 text-slate-400 hover:bg-slate-100'
                                            }`}
                                    >
                                        {day.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">Inicio</label>
                                <input
                                    type="time"
                                    value={rules.workingHoursStart}
                                    onChange={(e) => updateRules({ ...rules, workingHoursStart: e.target.value })}
                                    className="w-full p-3 bg-slate-50 border-none rounded-2xl font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 transition-all font-mono"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">Fin</label>
                                <input
                                    type="time"
                                    value={rules.workingHoursEnd}
                                    onChange={(e) => updateRules({ ...rules, workingHoursEnd: e.target.value })}
                                    className="w-full p-3 bg-slate-50 border-none rounded-2xl font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 transition-all font-mono"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* CAPACITY RULES */}
                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 space-y-6">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 shadow-sm">
                            <i className="fa-solid fa-bolt text-xl"></i>
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800 uppercase tracking-wider text-sm">Capacidad y Tarifas</h3>
                            <p className="text-xs text-slate-400">Parámetros del motor</p>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div>
                            <label className="text-xs font-black text-slate-400 uppercase mb-2 block">Tasa Horaria Base ($)</label>
                            <input
                                type="number"
                                value={rules.baseHourlyRate}
                                onChange={(e) => updateRules({ ...rules, baseHourlyRate: Number(e.target.value) })}
                                className="w-full p-3 bg-slate-50 border-none rounded-2xl font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 transition-all font-mono"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-black text-slate-400 uppercase mb-2 block">Proyectos Simultáneos</label>
                            <div className="flex items-center gap-4">
                                <input
                                    type="range"
                                    min="1"
                                    max="20"
                                    value={rules.maxProjectsCapacity}
                                    onChange={(e) => updateRules({ ...rules, maxProjectsCapacity: Number(e.target.value) })}
                                    className="flex-1 accent-indigo-600"
                                />
                                <span className="font-black text-indigo-600 w-8">{rules.maxProjectsCapacity}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* GOOGLE CALENDAR SENSOR (PREMIUM OAUTH) */}
                <div className="md:col-span-2">
                    <div className="bg-gradient-to-br from-white to-slate-50/50 p-10 rounded-[3rem] border border-slate-100 shadow-xl shadow-slate-200/50 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-8 opacity-[0.03] scale-[4] pointer-events-none group-hover:scale-[4.5] transition-transform duration-700">
                            <i className="fa-brands fa-google"></i>
                        </div>
                        
                        <div className="relative z-10">
                            <div className="flex items-center gap-6 mb-8">
                                <div className="w-16 h-16 bg-white rounded-3xl flex items-center justify-center text-rose-600 shadow-xl border border-rose-50/50 rotate-3 group-hover:rotate-0 transition-transform">
                                    <i className="fa-brands fa-google text-3xl"></i>
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Sincronización Inteligente</h3>
                                    <p className="text-sm text-slate-500 font-medium tracking-tight">Vínculo directo con tu cuenta de Google.</p>
                                </div>
                            </div>

                            <div className="">
                                {gcal.lastSynced ? (
                                    <div className="flex flex-col md:flex-row items-center gap-8 bg-white/60 backdrop-blur-sm p-8 rounded-[2.5rem] border border-emerald-100 shadow-sm">
                                        <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center shadow-inner border-4 border-white">
                                            <i className="fa-solid fa-calendar-check text-4xl"></i>
                                        </div>
                                        <div className="flex-1 text-center md:text-left">
                                            <h4 className="font-bold text-slate-800 text-lg uppercase tracking-tight">Calendario Conectado</h4>
                                            <p className="text-sm text-slate-400">Todo en orden. {gcal.events.length} bloqueos detectados próximamente.</p>
                                            <div className="mt-5 flex flex-wrap justify-center md:justify-start gap-3">
                                                <button onClick={gcal.refresh} disabled={gcal.isLoading} className="px-6 py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50">
                                                    {gcal.isLoading ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-rotate"></i>} 
                                                    Refrescar Eventos
                                                </button>
                                                <button onClick={gcal.connectOAuth} className="px-6 py-3 bg-white text-rose-600 border border-rose-100 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-50 transition-all active:scale-95">
                                                    Cambiar Cuenta
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="bg-white/80 p-10 rounded-[2.5rem] border border-slate-100 text-center shadow-sm">
                                        <h4 className="text-lg font-bold text-slate-800 uppercase mb-3">Conexión de un solo clic</h4>
                                        <p className="text-slate-500 text-sm max-w-xl mx-auto mb-8 leading-relaxed">
                                            Nuestro algoritmo analizará tus espacios ocupados para que la IA nunca agende tareas sobre tus reuniones o compromisos personales.
                                        </p>
                                        
                                        <button
                                            onClick={gcal.connectOAuth}
                                            disabled={gcal.isLoading}
                                            className="inline-flex items-center gap-4 px-12 py-5 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-[11px] shadow-2xl shadow-rose-200 transition-all hover:-translate-y-1 active:scale-95 disabled:opacity-50"
                                        >
                                            {gcal.isLoading ? (
                                                <i className="fa-solid fa-circle-notch fa-spin text-lg"></i>
                                            ) : (
                                                <i className="fa-brands fa-google text-lg"></i>
                                            )}
                                            Vincular mi Google Calendar
                                        </button>
                                    </div>
                                )}

                                {gcal.error && (
                                    <div className="mt-4 p-4 bg-red-50 rounded-2xl border border-red-100 text-xs text-red-700 font-bold flex items-center gap-3">
                                        <i className="fa-solid fa-triangle-exclamation text-lg"></i>
                                        {gcal.error}
                                    </div>
                                )}
                            </div>
                            
                            <div className="mt-8 flex items-center gap-3 px-6 py-3 bg-blue-50/50 rounded-2xl w-fit">
                                <i className="fa-solid fa-shield-halved text-blue-500"></i>
                                <span className="text-[10px] font-black text-blue-800 uppercase tracking-widest opacity-60">Seguridad vía Google OAuth 2.0</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* INFO PANEL */}
                <div className="bg-slate-900 text-white p-10 rounded-[3rem] shadow-2xl overflow-hidden relative group md:col-span-2">
                    <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
                        <div className="w-20 h-20 bg-blue-500 text-white rounded-[2.5rem] flex items-center justify-center text-4xl shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform">
                            <i className="fa-solid fa-wand-magic-sparkles"></i>
                        </div>
                        <div>
                            <h4 className="text-2xl font-black uppercase tracking-tight mb-2">Algoritmo de Auto-Agendamiento</h4>
                            <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
                                Cualquier cambio aquí recalculará <b>instantáneamente</b> tu Panorama. 
                                Priorizamos tareas ASAP y deadlines críticos dentro de tu disponibilidad real.
                            </p>
                        </div>
                    </div>
                    <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-blue-500/10 rounded-full blur-[100px]"></div>
                </div>
            </div>
        </div>
    );
};

export default SettingsView;
