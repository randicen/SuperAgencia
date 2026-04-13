import { useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';

const ADMIN_EMAILS = ['japabontorres@gmail.com', 'joseorantes@gmail.com'];

interface UserUsage {
  user_id: string;
  voice_seconds_used_period: number;
  text_requests_used_period: number;
  text_requests_used_lifetime: number;
  web_searches_used_period: number;
  period_start: string;
  period_end: string;
  profiles?: {
    email: string;
    full_name: string;
  };
}

export function AdminPanel() {
  const { user } = useUser();
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? null;
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [usage, setUsage] = useState<UserUsage | null>(null);
  const [allUsage, setAllUsage] = useState<UserUsage[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const { getToken } = useAuth();

  const isAdmin = ADMIN_EMAILS.includes(userEmail ?? '');

  if (!isAdmin) return null;

  const fetchUserUsage = async () => {
    if (!email) return;
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/usage?email=${encodeURIComponent(email)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.usage) {
        setUsage(data.usage);
      }
      setMessage('');
    } catch {
      setMessage('Error al cargar datos');
    }
    setLoading(false);
  };

  const fetchAllUsage = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/usage', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.usage) {
        setAllUsage(data.usage);
      }
      setMessage('');
    } catch {
      setMessage('Error al cargar datos');
    }
    setLoading(false);
  };

  const updateUsage = async (action: 'reset' | 'set' | 'add', field: string, value?: number) => {
    if (!email) return;
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/usage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ email, action, field, value })
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`✓ ${data.message}`);
        fetchUserUsage();
      } else {
        setMessage(`✗ ${data.error}`);
      }
    } catch {
      setMessage('Error al actualizar');
    }
    setLoading(false);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 bg-purple-600 text-white px-4 py-2 rounded-lg shadow-lg hover:bg-purple-700 text-sm font-medium z-50"
      >
        Admin
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-900">Panel Admin - Gestión de Saldo</h2>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email del usuario
            </label>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@email.com"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              <button
                onClick={fetchUserUsage}
                disabled={loading}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Buscar
              </button>
              <button
                onClick={fetchAllUsage}
                disabled={loading}
                className="bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
              >
                Todos
              </button>
            </div>
          </div>

          {message && (
            <div className={`mb-4 p-3 rounded-lg text-sm ${message.startsWith('✓') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {message}
            </div>
          )}

          {usage && (
            <div className="mb-6 bg-gray-50 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Saldo actual de {email}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-3 rounded border">
                  <div className="text-xs text-gray-500">Voz usada (segundos)</div>
                  <div className="text-lg font-bold text-gray-900">{usage.voice_seconds_used_period}</div>
                </div>
                <div className="bg-white p-3 rounded border">
                  <div className="text-xs text-gray-500">Textos período</div>
                  <div className="text-lg font-bold text-gray-900">{usage.text_requests_used_period}</div>
                </div>
                <div className="bg-white p-3 rounded border">
                  <div className="text-xs text-gray-500">Textos total</div>
                  <div className="text-lg font-bold text-gray-900">{usage.text_requests_used_lifetime}</div>
                </div>
                <div className="bg-white p-3 rounded border">
                  <div className="text-xs text-gray-500">Búsquedas</div>
                  <div className="text-lg font-bold text-gray-900">{usage.web_searches_used_period}</div>
                </div>
              </div>

              <div className="mt-4 flex gap-2 flex-wrap">
                <button
                  onClick={() => updateUsage('reset', 'voice_seconds_used_period')}
                  disabled={loading}
                  className="bg-green-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  Resetear Voz
                </button>
                <button
                  onClick={() => updateUsage('reset', 'text_requests_used_period')}
                  disabled={loading}
                  className="bg-green-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  Resetear Textos
                </button>
                <button
                  onClick={() => updateUsage('reset', 'web_searches_used_period')}
                  disabled={loading}
                  className="bg-green-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  Resetear Búsquedas
                </button>
              </div>
            </div>
          )}

          {allUsage.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Todos los usuarios ({allUsage.length})</h3>
              <div className="space-y-2 max-h-48 overflow-auto">
                {allUsage.map((u) => (
                  <div key={u.user_id} className="bg-white p-3 rounded border text-sm">
                    <div className="font-medium">{u.profiles?.email || u.user_id}</div>
                    <div className="text-gray-500">
                      Voz: {Math.floor(u.voice_seconds_used_period / 60)}min | Textos: {u.text_requests_used_period} | Búsquedas: {u.web_searches_used_period}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
