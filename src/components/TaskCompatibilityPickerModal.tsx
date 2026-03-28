import React from 'react';

interface TaskCompatibilityPickerOption {
  id: string;
  nombre: string;
  clientName?: string;
}

interface TaskCompatibilityPickerModalProps {
  taskName: string;
  options: TaskCompatibilityPickerOption[];
  selectedIds: string[];
  onToggle: (taskId: string) => void;
  onClose: () => void;
}

const TaskCompatibilityPickerModal: React.FC<TaskCompatibilityPickerModalProps> = ({
  taskName,
  options,
  selectedIds,
  onToggle,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-[72] flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="bg-white w-full max-w-2xl rounded-[2.5rem] p-8 shadow-2xl space-y-6 animate-in zoom-in-95 max-h-[85vh] overflow-y-auto">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-sky-100 text-sky-600 flex items-center justify-center shrink-0">
            <i className="fa-solid fa-link-slash"></i>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-sky-500 mb-2">Selección manual</p>
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">Incompatibilidades temporales</h3>
            <p className="text-sm text-slate-500 mt-2">
              Para <span className="font-bold text-slate-700">{taskName || 'esta tarea'}</span>, marca solo las tareas que de verdad no deberían convivir en el mismo bloque de tiempo.
            </p>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-[11px] font-bold text-slate-600 leading-relaxed">
            Por defecto esta tarea sigue siendo compatible con las demás. La IA todavía revisará el contexto al guardar y podrá sugerir exclusiones adicionales para que tú las confirmes.
          </p>
        </div>

        <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
          {options.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
              <p className="text-sm font-bold text-slate-500">No hay otras tareas activas disponibles en este workspace.</p>
            </div>
          ) : options.map((option) => {
            const selected = selectedIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onToggle(option.id)}
                className={`w-full text-left rounded-2xl border px-4 py-4 transition-all ${
                  selected
                    ? 'border-sky-300 bg-sky-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center ${selected ? 'bg-sky-600 border-sky-600 text-white' : 'border-slate-300 text-transparent'}`}>
                    <i className="fa-solid fa-check text-[10px]"></i>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900">{option.nombre}</p>
                    {option.clientName && <p className="text-xs text-slate-500 mt-1">{option.clientName}</p>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex justify-between items-center gap-4 pt-2">
          <p className="text-xs font-bold text-slate-500">
            Seleccionadas: <span className="text-slate-800">{selectedIds.length}</span>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-3 rounded-2xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest shadow-xl hover:bg-slate-800 transition-all"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
};

export default TaskCompatibilityPickerModal;
