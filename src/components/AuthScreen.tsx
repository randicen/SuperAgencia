import { SignInButton } from '@clerk/react';
import { CalendarDays, Loader2 } from 'lucide-react';

interface AuthScreenProps {
  isLoading: boolean;
}

export function AuthScreen({ isLoading }: AuthScreenProps) {
  const actionButton = (
    <button
      disabled={isLoading}
      className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-2xl bg-gray-900 text-white font-medium hover:bg-gray-800 disabled:opacity-60 transition-colors"
    >
      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}
      <span>{isLoading ? 'Cargando acceso...' : 'Continuar con Tandeba'}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-3xl border border-gray-200 shadow-sm p-8">
        <div className="flex items-center gap-3 text-blue-600 mb-8">
          <CalendarDays className="w-8 h-8" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Tandeba</h1>
            <p className="text-sm text-gray-500">Planificacion con IA</p>
          </div>
        </div>

        <div className="space-y-3 mb-8">
          <h2 className="text-xl font-semibold text-gray-900">Inicia sesion en Tandeba</h2>
          <p className="text-sm leading-relaxed text-gray-600">
            Puedes entrar con Google o correo. Tu agenda, historial y limites de uso quedaran asociados a tu cuenta.
          </p>
        </div>

        {isLoading ? (
          actionButton
        ) : (
          <SignInButton mode="modal">
            {actionButton}
          </SignInButton>
        )}
      </div>
    </div>
  );
}
