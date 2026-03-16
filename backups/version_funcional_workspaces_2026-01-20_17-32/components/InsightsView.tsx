
import React, { useState, useEffect, useRef } from 'react';
import { SeasonalityData, Project } from '../types';
import { analyzeSeasonality } from '../geminiService';

interface InsightsViewProps {
  seasonality: SeasonalityData[];
  projects: Project[];
}

const InsightsView: React.FC<InsightsViewProps> = ({ seasonality, projects }) => {
  const [report, setReport] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const lastRequestData = useRef<string>('');

  useEffect(() => {
    const fetchAnalysis = async () => {
      // Evitar peticiones si los datos son idénticos a la última vez
      const currentDataKey = JSON.stringify({ seasonality, projectCount: projects.length });
      if (currentDataKey === lastRequestData.current && report) return;
      
      setLoading(true);
      try {
        const res = await analyzeSeasonality(seasonality, projects);
        if (res) {
          setReport(res);
          lastRequestData.current = currentDataKey;
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    
    const timeoutId = setTimeout(fetchAnalysis, 500); // Debounce de seguridad
    return () => clearTimeout(timeoutId);
  }, [seasonality, projects, report]);

  return (
    <div className="space-y-8 max-w-5xl mx-auto animate-in fade-in duration-700">
      <div className="text-center">
        <h2 className="text-3xl font-black text-slate-800 tracking-tight">Mapa de Calor & Estrategia</h2>
        <p className="text-slate-500 mt-2 font-medium">Análisis profundo del ritmo de tu negocio</p>
      </div>

      <div className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-xl overflow-hidden relative">
        <div className="absolute top-0 right-0 p-4 opacity-5">
             <i className="fa-solid fa-chart-area text-slate-900 text-[12rem] -rotate-12"></i>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 relative z-10">
          {seasonality.map(s => (
            <div key={s.month} className="flex flex-col gap-2">
              <div 
                className={`aspect-square rounded-3xl flex items-center justify-center shadow-inner transition-all hover:scale-105 group relative border-2 ${
                  s.intensity > 100 ? 'bg-red-500 border-red-400 text-white shadow-red-200' :
                  s.intensity > 80 ? 'bg-orange-400 border-orange-300 text-white shadow-orange-200' :
                  s.intensity > 50 ? 'bg-blue-500 border-blue-400 text-white shadow-blue-200' :
                  'bg-slate-50 border-slate-100 text-slate-400'
                }`}
              >
                <div className="text-center">
                  <span className="text-[10px] font-black opacity-60 uppercase tracking-tighter">{s.month}</span>
                  <div className="text-2xl font-black">{s.intensity}%</div>
                </div>
                {s.intensity > 100 && (
                    <div className="absolute -top-1 -right-1 bg-white p-1.5 rounded-full shadow-lg">
                        <i className="fa-solid fa-fire text-red-500 text-xs"></i>
                    </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-900 text-white p-10 rounded-[2.5rem] shadow-2xl min-h-[450px] border border-white/5 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500"></div>
        <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                <i className="fa-solid fa-wand-magic-sparkles text-blue-400 text-xl"></i>
            </div>
            <div>
                <h3 className="text-xl font-black uppercase tracking-tight">Directivas Estratégicas AI</h3>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Generado en tiempo real</p>
            </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-6">
            <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <div className="space-y-2 text-center">
                <p className="text-blue-400 font-black text-lg animate-pulse">Sincronizando con el cerebro financiero...</p>
                <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Calculando riesgos y oportunidades</p>
            </div>
          </div>
        ) : (
          <div className="prose prose-invert prose-blue max-w-none">
            {report ? report.split('\n').map((para, i) => (
                <p key={i} className="mb-4 leading-relaxed text-slate-300 font-medium">
                    {para}
                </p>
            )) : <p className="text-slate-500 italic">No hay suficiente información para generar un reporte. Registra más proyectos.</p>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-emerald-50 p-8 rounded-3xl border border-emerald-100 group hover:shadow-lg transition-all">
              <div className="flex items-center gap-4 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600">
                    <i className="fa-solid fa-piggy-bank text-xl"></i>
                  </div>
                  <h4 className="font-black text-emerald-900 uppercase text-xs tracking-widest">Fondo de Reserva</h4>
              </div>
              <p className="text-emerald-800 text-sm font-semibold leading-relaxed">
                  Basado en tu estacionalidad, identifica los meses de baja intensidad (Enero/Junio) y prepárate con antelación.
              </p>
          </div>
          <div className="bg-purple-50 p-8 rounded-3xl border border-purple-100 group hover:shadow-lg transition-all">
              <div className="flex items-center gap-4 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-purple-600">
                    <i className="fa-solid fa-bolt-lightning text-xl"></i>
                  </div>
                  <h4 className="font-black text-purple-900 uppercase text-xs tracking-widest">Eficiencia Operativa</h4>
              </div>
              <p className="text-purple-800 text-sm font-semibold leading-relaxed">
                  Filtra tus servicios. La IA detecta cuáles proyectos consumen el 80% de tu tiempo pero solo el 20% de tu caja.
              </p>
          </div>
      </div>
    </div>
  );
};

export default InsightsView;
