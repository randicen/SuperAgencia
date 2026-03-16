
import React, { useState } from 'react';
import { BusinessRules } from '../types';

interface OnboardingProps {
  rules: BusinessRules;
  setRules: (rules: BusinessRules) => void;
  onClose: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ rules, setRules, onClose }) => {
  const [formData, setFormData] = useState<BusinessRules>(rules);

  const handleSave = () => {
    setRules(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-300">
        <div className="p-8 border-b border-slate-100 bg-slate-50">
          <h2 className="text-2xl font-black text-slate-800">Reglas del Freelancer</h2>
          <p className="text-slate-500">Define tu capacidad y horarios para el algoritmo de agendamiento.</p>
        </div>
        
        <div className="p-8 space-y-6 overflow-y-auto max-h-[70vh] custom-scrollbar">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Valor Hora ($)</label>
              <input type="number" value={formData.baseHourlyRate} onChange={e => setFormData({...formData, baseHourlyRate: Number(e.target.value)})} className="w-full p-3 bg-slate-50 border rounded-xl font-bold" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Capacidad Máx.</label>
              <input type="number" value={formData.maxProjectsCapacity} onChange={e => setFormData({...formData, maxProjectsCapacity: Number(e.target.value)})} className="w-full p-3 bg-slate-50 border rounded-xl font-bold" title="Número de proyectos simultáneos" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Markup Urg. (%)</label>
              <input type="number" value={formData.urgencyMarkup} onChange={e => setFormData({...formData, urgencyMarkup: Number(e.target.value)})} className="w-full p-3 bg-slate-50 border rounded-xl font-bold" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Inicio Jornada</label>
              <input type="time" value={formData.workingHoursStart} onChange={e => setFormData({...formData, workingHoursStart: e.target.value})} className="w-full p-3 bg-slate-50 border rounded-xl font-bold" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fin Jornada</label>
              <input type="time" value={formData.workingHoursEnd} onChange={e => setFormData({...formData, workingHoursEnd: e.target.value})} className="w-full p-3 bg-slate-50 border rounded-xl font-bold" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tarifario y Reglas (Lenguaje Natural)</label>
            <textarea 
              rows={4}
              value={formData.customRules}
              onChange={e => setFormData({...formData, customRules: e.target.value})}
              placeholder="Ej: Cobrar $1.000 por Tesis. Si es urgente cobrar 50% extra. No trabajo festivos."
              className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 ring-blue-500/20 focus:outline-none text-sm leading-relaxed"
            />
          </div>
        </div>

        <div className="p-8 bg-slate-50 border-t flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-3 font-bold text-slate-500">Cancelar</button>
          <button onClick={handleSave} className="px-8 py-3 bg-slate-900 text-white font-bold rounded-xl shadow-xl">Guardar Todo</button>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
