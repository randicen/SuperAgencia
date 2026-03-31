import React, { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

interface PwaUpdateBannerProps {
  onNeedRefreshChange?: (value: boolean) => void;
  writeLockReason?: string | null;
}

const PwaUpdateBanner: React.FC<PwaUpdateBannerProps> = ({ onNeedRefreshChange, writeLockReason }) => {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    onNeedRefreshChange?.(needRefresh);
  }, [needRefresh, onNeedRefreshChange]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const checkForUpdates = async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
      } catch (error) {
        console.warn('No se pudo verificar actualizacion PWA:', error);
      }
    };

    const checkOnVisible = () => {
      if (document.visibilityState === 'visible') {
        checkForUpdates();
      }
    };

    checkForUpdates();
    const intervalId = window.setInterval(checkForUpdates, 60 * 1000);
    window.addEventListener('focus', checkForUpdates);
    window.addEventListener('pageshow', checkForUpdates);
    document.addEventListener('visibilitychange', checkOnVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', checkForUpdates);
      window.removeEventListener('pageshow', checkForUpdates);
      document.removeEventListener('visibilitychange', checkOnVisible);
    };
  }, []);

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[300] w-[92%] max-w-md -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
      <p className="text-sm font-semibold text-slate-800">
        Hay una actualizacion de la app disponible.
      </p>
      <p className="mt-2 text-xs text-slate-500">
        {writeLockReason || 'Actualiza la app para volver a editar tareas con seguridad.'}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => updateServiceWorker(true)}
          className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-blue-700"
        >
          Actualizar ahora
        </button>
      </div>
    </div>
  );
};

export default PwaUpdateBanner;
