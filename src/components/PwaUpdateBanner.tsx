import React, { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const PwaUpdateBanner: React.FC = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker
  } = useRegisterSW();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const checkForUpdates = async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    };

    const intervalId = window.setInterval(checkForUpdates, 5 * 60 * 1000);
    window.addEventListener('focus', checkForUpdates);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', checkForUpdates);
    };
  }, []);

  if (!needRefresh && !offlineReady) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[300] w-[92%] max-w-md -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
      <p className="text-sm font-semibold text-slate-800">
        {needRefresh
          ? 'Hay una actualización de la app disponible.'
          : 'App lista para abrir sin internet. La sincronización con Supabase sigue activa cuando hay conexión.'}
      </p>
      <div className="mt-3 flex items-center gap-2">
        {needRefresh ? (
          <>
            <button
              onClick={() => updateServiceWorker(true)}
              className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-blue-700"
            >
              Actualizar ahora
            </button>
            <button
              onClick={() => setNeedRefresh(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-50"
            >
              Luego
            </button>
          </>
        ) : (
          <button
            onClick={() => setOfflineReady(false)}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-50"
          >
            Entendido
          </button>
        )}
      </div>
    </div>
  );
};

export default PwaUpdateBanner;
