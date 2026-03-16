
import React from 'react';
import { useSpaces } from '../contexts/SpacesContext';

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

    const updateRules = (newRules: typeof rules) => {
        dispatch({ type: 'UPDATE_RULES', payload: newRules });
    };

    const toggleDay = (dayId: number) => {
        const isRemoving = rules.workingDays.includes(dayId);
        if (isRemoving && rules.workingDays.length === 1) return; // Forzar al menos un día productivo

        const newDays = isRemoving
            ? rules.workingDays.filter(d => d !== dayId)
            : [...rules.workingDays, dayId].sort();
        updateRules({ ...rules, workingDays: newDays });
    };

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
