import React from 'react';

export interface ActiveTaskStripItem {
  id: string;
  nombre: string;
  clientName?: string;
  workspaceName: string;
  progress: number;
  dueDate?: string | null;
}

interface ActiveTaskStripProps {
  items: ActiveTaskStripItem[];
  currentTaskId: string | null;
  isVisible: boolean;
  onShow: () => void;
  onHide: () => void;
  onNext: () => void;
  onOpenSpaces: () => void;
}

const formatDueDate = (value?: string | null) => {
  if (!value) return 'Sin límite';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Sin límite';
  return parsed.toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).toLowerCase();
};

const ActiveTaskStrip: React.FC<ActiveTaskStripProps> = ({
  items,
  currentTaskId,
  isVisible,
  onShow,
  onHide,
  onNext,
  onOpenSpaces,
}) => {
  if (items.length === 0) return null;

  const currentTask = items.find((item) => item.id === currentTaskId) || items[0];
  const hasMoreThanOne = items.length > 1;

  if (!isVisible) {
    return (
      <div className="px-4 md:px-6 pt-3">
        <button
          type="button"
          onClick={onShow}
          className="inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-blue-700 shadow-sm transition-all hover:bg-blue-50"
        >
          <i className="fa-solid fa-bullseye"></i>
          Mostrar foco
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] text-blue-700">{items.length}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-6 pt-3">
      <div className="rounded-[1.75rem] border border-blue-100 bg-gradient-to-r from-blue-50 via-white to-indigo-50 px-4 py-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-500/20">
              <i className="fa-solid fa-bolt"></i>
            </div>
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-600">Bloque activo</span>
                <span className="rounded-full bg-white px-2 py-1 text-[9px] font-black uppercase tracking-wide text-slate-500 border border-slate-200">
                  {items.length} en curso
                </span>
              </div>
              <p className="truncate text-base font-black tracking-tight text-slate-900">{currentTask.nombre}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <span>{currentTask.clientName || 'Sin cliente'}</span>
                <span>•</span>
                <span>{currentTask.workspaceName}</span>
                <span>•</span>
                <span>Límite {formatDueDate(currentTask.dueDate)}</span>
              </div>
              <div className="mt-3 max-w-sm">
                <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-wide text-slate-400">
                  <span>Progreso</span>
                  <span className="text-blue-600">{currentTask.progress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white border border-blue-100">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-500"
                    style={{ width: `${Math.max(0, Math.min(100, currentTask.progress))}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasMoreThanOne && (
              <button
                type="button"
                onClick={onNext}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-wide text-slate-700 transition-all hover:border-blue-200 hover:text-blue-700 hover:bg-blue-50"
              >
                <i className="fa-solid fa-shuffle"></i>
                Cambiar foco
              </button>
            )}
            <button
              type="button"
              onClick={onOpenSpaces}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-[10px] font-black uppercase tracking-wide text-white transition-all hover:bg-slate-800"
            >
              <i className="fa-solid fa-arrow-up-right-from-square"></i>
              Ver en espacios
            </button>
            <button
              type="button"
              onClick={onHide}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-wide text-slate-500 transition-all hover:text-slate-700 hover:bg-slate-50"
            >
              <i className="fa-solid fa-eye-slash"></i>
              Ocultar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActiveTaskStrip;
