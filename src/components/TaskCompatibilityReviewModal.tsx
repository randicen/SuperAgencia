import React from 'react';
import { TaskCompatibilitySuggestion } from '../services/taskCompatibilityAdvisor';

interface TaskCompatibilityReviewModalProps {
  taskName: string;
  suggestions: TaskCompatibilitySuggestion[];
  selectedIds: string[];
  isLoading: boolean;
  onToggle: (taskId: string) => void;
  onSkip: () => void;
  onConfirm: () => void;
}

const TaskCompatibilityReviewModal: React.FC<TaskCompatibilityReviewModalProps> = ({
  taskName,
  suggestions,
  selectedIds,
  isLoading,
  onToggle,
  onSkip,
  onConfirm,
}) => {
  if (suggestions.length === 0) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-[70] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-xl rounded-[2.5rem] p-8 shadow-2xl space-y-6 animate-in zoom-in-95">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-violet-100 text-violet-600 flex items-center justify-center shrink-0">
            <i className="fa-solid fa-brain"></i>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-violet-500 mb-2">Hipótesis de compatibilidad</p>
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">La IA detectó posibles choques temporales</h3>
            <p className="text-sm text-slate-500 mt-2">
              Para <span className="font-bold text-slate-700">{taskName}</span>, estas tareas podrían requerir atención incompatible al mismo tiempo. Confirma solo las que quieras marcar como excluyentes.
            </p>
          </div>
        </div>

        <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
          {suggestions.map((suggestion) => {
            const selected = selectedIds.includes(suggestion.taskId);
            return (
              <button
                key={suggestion.taskId}
                type="button"
                onClick={() => onToggle(suggestion.taskId)}
                className={`w-full text-left rounded-2xl border px-4 py-4 transition-all ${
                  selected
                    ? 'border-violet-300 bg-violet-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center ${selected ? 'bg-violet-600 border-violet-600 text-white' : 'border-slate-300 text-transparent'}`}>
                    <i className="fa-solid fa-check text-[10px]"></i>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900">{suggestion.taskName}</p>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{suggestion.reason}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onSkip}
            disabled={isLoading}
            className="flex-1 py-3 rounded-2xl border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all"
          >
            Guardar sin exclusiones
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 py-3 rounded-2xl bg-violet-600 text-white text-[10px] font-black uppercase tracking-widest shadow-xl hover:bg-violet-700 transition-all"
          >
            Confirmar selección
          </button>
        </div>
      </div>
    </div>
  );
};

export default TaskCompatibilityReviewModal;
