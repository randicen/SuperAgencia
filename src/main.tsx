import { ClerkProvider } from '@clerk/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!clerkPublishableKey) {
  console.error('[tandeba] Missing VITE_CLERK_PUBLISHABLE_KEY. Clerk will not initialize.');
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-3xl border border-red-200 shadow-sm p-8 text-center">
          <h1 className="text-xl font-bold text-red-600 mb-4">Configuración pendiente</h1>
          <p className="text-sm text-gray-600 mb-4">La clave de Clerk (VITE_CLERK_PUBLISHABLE_KEY) no está configurada en este entorno.</p>
          <p className="text-xs text-gray-400">Configure la variable en Railway o verifique el .env.local local.</p>
        </div>
      </div>
    </StrictMode>,
  );
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ClerkProvider publishableKey={clerkPublishableKey}>
        <App />
      </ClerkProvider>
    </StrictMode>,
  );
}
