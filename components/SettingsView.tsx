
import React, { useState } from 'react';
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

    const [icalUrlInput, setIcalUrlInput] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState<boolean | null>(null);

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

    const handleSaveGCalUrl = async () => {
        if (!icalUrlInput.trim()) return;
        setIsSaving(true);
        setSaveSuccess(null);
        const ok = await gcal.saveIcalUrl(icalUrlInput.trim());
        setIsSaving(false);
        setSaveSuccess(ok);
        if (ok) {
            // Dispatch events to scheduling engine
            if (gcal.events.length > 0) {
                dispatch({ type: 'SET_GCAL_EVENTS', payload: { events: gcal.events } });
            }
        }
        setTimeout(() => setSaveSuccess(null), 4000);
    };

    // When gcal events change, push to scheduler
    React.useEffect(() => {
        if (gcal.events.length > 0) {
            dispatch({ type: 'SET_GCAL_EVENTS', payload: { events: gcal.events } });
        }
    }, [gcal.events]);

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
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
                                    className="w-full p-3 bg-slate-50 border-none rounded-2xl font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 transition-all"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-black text-slate-400 uppercase mb-2 block">Fin</label>
                                <input
                                    type="time"
                                    value={rules.workingHoursEnd}
                                    onChange={(e) => updateRules({ ...rules, workingHoursEnd: e.target.value })}
                                    className="w-full p-3 bg-slate-50 border-none rounded-2xl font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 transition-all"
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
                                className="w-full p-3 bg-slate-50 border-none rounded-2xl font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 transition-all"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-black text-slate-400 uppercase mb-2 block">Límite de Proyectos Simultáneos</label>
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

                {/* GOOGLE CALENDAR SENSOR */}
                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col justify-between md:col-span-2">
                    <div>
                        <div className="flex items-center gap-4 mb-2">
                            <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-600 shadow-sm">
                                <i className="fa-brands fa-google text-xl"></i>
                            </div>
                            <div className="flex-1">
                                <h3 className="font-bold text-slate-800 uppercase tracking-wider text-sm">Google Calendar Sensor</h3>
                                <p className="text-xs text-slate-400">Sensor de disponibilidad pasivo (server-side)</p>
                            </div>
                            {gcal.events.length > 0 && (
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-xl border border-emerald-100">
                                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                                    <span className="text-[9px] font-black text-emerald-700 uppercase">{gcal.events.length} eventos activos</span>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 mt-6">
                            <div className="relative">
                                <input
                                    type="url"
                                    placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                                    value={icalUrlInput}
                                    onChange={(e) => setIcalUrlInput(e.target.value)}
                                    className="w-full p-4 pr-12 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-700 text-xs focus:ring-4 focus:ring-rose-500/10 focus:border-rose-200 transition-all outline-none"
                                />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300">
                                    <i className="fa-solid fa-link text-xs"></i>
                                </div>
                            </div>
                            <button
                                onClick={handleSaveGCalUrl}
                                disabled={isSaving || !icalUrlInput.trim()}
                                className={`px-8 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all shadow-lg ${
                                    isSaving 
                                        ? 'bg-slate-200 text-slate-400 cursor-wait' 
                                        : saveSuccess === true
                                            ? 'bg-emerald-600 text-white shadow-emerald-200'
                                            : saveSuccess === false
                                                ? 'bg-red-600 text-white shadow-red-200'
                                                : 'bg-rose-600 text-white hover:bg-rose-700 shadow-rose-200 hover:shadow-rose-300'
                                }`}
                            >
                                {isSaving ? (
                                    <><i className="fa-solid fa-spinner fa-spin mr-2"></i>Conectando...</>
                                ) : saveSuccess === true ? (
                                    <><i className="fa-solid fa-check mr-2"></i>Conectado</>
                                ) : saveSuccess === false ? (
                                    <><i className="fa-solid fa-xmark mr-2"></i>Error</>
                                ) : (
                                    <><i className="fa-solid fa-satellite-dish mr-2"></i>Conectar Sensor</>
                                )}
                            </button>
                        </div>

                        {gcal.lastSynced && (
                            <div className="mt-3 flex items-center gap-2 text-[9px] text-slate-400">
                                <i className="fa-solid fa-clock"></i>
                                <span>Última sincronización: {new Date(gcal.lastSynced).toLocaleString()}</span>
                                {gcal.fromCache && <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-500 font-bold">CACHE</span>}
                                <button onClick={gcal.refresh} className="ml-auto text-rose-500 hover:text-rose-700 transition-colors">
                                    <i className="fa-solid fa-arrows-rotate"></i> Refrescar
                                </button>
                            </div>
                        )}

                        {gcal.error && (
                            <div className="mt-3 p-3 bg-red-50 rounded-xl border border-red-100 text-[10px] text-red-700 font-medium flex items-center gap-2">
                                <i className="fa-solid fa-triangle-exclamation"></i> {gcal.error}
                            </div>
                        )}
                    </div>

                    <div className="mt-6 p-4 bg-rose-50 rounded-2xl border border-rose-100/50">
                        <div className="flex gap-3">
                            <i className="fa-solid fa-shield-halved text-rose-500 mt-0.5"></i>
                            <div className="space-y-2">
                                <p className="text-[10px] leading-relaxed text-rose-900 font-medium">
                                    Tu URL secreta se almacena <b>encriptada en el servidor</b>, nunca en tu navegador. La IA leerá tus eventos para <b>no agendar tareas encima de ellos</b>.
                                </p>
                                <a 
                                    href="https://support.google.com/calendar/answer/37648?hl=es#zippy=%2Cver-la-direcci%C3%B3n-secreta" 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-[9px] font-black uppercase text-rose-600 hover:text-rose-700 flex items-center gap-1 transition-colors"
                                >
                                    ¿Cómo obtener mi URL secreta? <i className="fa-solid fa-arrow-up-right-from-square text-[8px]"></i>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* INFO PANEL */}
            <div className="bg-blue-900 text-white p-8 rounded-[2.5rem] shadow-xl overflow-hidden relative">
                <div className="relative z-10 flex flex-col md:flex-row items-center gap-6">
                    <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center text-3xl backdrop-blur-md">
                        <i className="fa-solid fa-wand-magic-sparkles text-blue-300"></i>
                    </div>
                    <div>
                        <h4 className="text-xl font-bold mb-1">Algoritmo de Auto-Agendamiento</h4>
                        <p className="text-blue-200 text-sm max-w-xl">
                            Cualquier cambio que realices aquí recalculará instantáneamente todos tus proyectos activos en las vistas de Espacios, Gantt y Calendario.
                            El sistema priorizará ASAP y Hard Deadlines dentro de tus nuevos límites.
                        </p>
                    </div>
                </div>
                {/* Decorative circle */}
                <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-blue-500/20 rounded-full blur-3xl"></div>
            </div>
        </div>
    );
};


export default SettingsView;
