import React, { useState } from 'react';
import { supabase, isUsingDummyKeys } from '../contexts/AuthContext';

interface LoginViewProps {
  onLoginSuccess: () => void;
}

const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        if (password !== confirmPassword) {
            throw new Error('Las contraseñas no coinciden.');
        }
        if (password.length < 6) {
            throw new Error('La contraseña debe tener al menos 6 caracteres.');
        }
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        else alert('Revisa tu correo para confirmar tu cuenta (si tienes habilitada la confirmación por email en Supabase).');
      }
    } catch (error: any) {
      setErrorMsg(error.message || 'Error durante la autenticación');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        }
      });
      if (error) throw error;
    } catch (error: any) {
      setErrorMsg(error.message || 'Error con Google Auth');
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#0F172A] text-white font-sans overflow-hidden">
      {/* Decorative Left Side */}
      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-indigo-900 to-slate-900 p-12 relative flex-col justify-between">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
        <div className="absolute inset-0 bg-indigo-500 blur-[150px] opacity-20 rounded-full w-[80%] h-[80%] top-10 left-10"></div>
        
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center text-xl shadow-lg shadow-indigo-500/30">
              <i className="fa-solid fa-rocket text-white"></i>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white">SuperAgencia</h1>
          </div>
          <h2 className="text-5xl font-black leading-tight mt-12 mb-6">
            Gestiona tu<br/>
            Agencia con<br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">Inteligencia</span>
          </h2>
          <p className="text-slate-400 text-lg max-w-md font-medium leading-relaxed">
            Plataforma centralizada con autoprogramación de tareas, gestión financiera y contexto inteligente.
          </p>
        </div>
        
        <div className="relative z-10 flex items-center gap-4 text-sm text-slate-500 font-medium">
          <i className="fa-solid fa-shield-check"></i>
          Acceso seguro encriptado
        </div>
      </div>

      {/* Login Right Side */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 lg:p-24 relative overflow-auto">
        
        <div className="w-full max-w-md space-y-8 relative z-10">
          <div className="text-center lg:text-left">
            <h2 className="text-3xl font-black text-white mb-2 tracking-tight">
              {isLogin ? 'Bienvenido de vuelta' : 'Crea tu cuenta'}
            </h2>
            <p className="text-slate-400 text-sm font-medium">
              {isLogin ? 'Ingresa tus credenciales para continuar.' : 'Comienza a gestionar tu agencia ahora.'}
            </p>
          </div>

          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2">
              <i className="fa-solid fa-circle-exclamation shrink-0"></i>
              <p>{errorMsg}</p>
            </div>
          )}

          {isUsingDummyKeys && (
              <div className="bg-orange-500/10 border-2 border-orange-500/50 text-orange-400 px-4 py-4 rounded-xl text-sm font-bold flex flex-col gap-2 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-orange-500"></div>
                  <div className="flex items-center gap-2 text-orange-500">
                    <i className="fa-solid fa-triangle-exclamation text-lg"></i>
                    <h3 className="uppercase tracking-widest text-xs">Variables Vercel Faltantes</h3>
                  </div>
                  <p className="text-slate-300 font-medium">
                      El servidor no cargó las llaves `VITE_SUPABASE_URL` ni `KEY`. Por seguridad, el login ha sido bloqueado.
                  </p>
                  <p className="text-xs text-orange-300 font-medium mt-1">
                      (Si acabas de ponerlas en Vercel, recuerda darle al botón de <strong>Redeploy</strong> y recargar esta página).
                  </p>
              </div>
          )}

          <div className={`space-y-4 ${isUsingDummyKeys ? 'opacity-30 pointer-events-none grayscale' : ''}`}>
            <button 
              onClick={handleGoogleAuth}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-100 text-slate-800 font-bold py-3 px-4 rounded-xl transition-all shadow-sm disabled:opacity-50"
            >
              <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
              Continuar con Google
            </button>

            <div className="flex items-center gap-4 py-2">
              <div className="h-[1px] bg-slate-800 flex-1"></div>
              <span className="text-slate-500 text-xs font-bold uppercase tracking-widest">O con email</span>
              <div className="h-[1px] bg-slate-800 flex-1"></div>
            </div>

            <form onSubmit={handleEmailAuth} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400 ml-1">Correo Electrónico</label>
                <input 
                  type="email" 
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#1E293B] border border-slate-700 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-600"
                  placeholder="tu@correo.com"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400 ml-1">Contraseña</label>
                <input 
                  type="password" 
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#1E293B] border border-slate-700 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-600"
                  placeholder="••••••••"
                />
              </div>

              {!isLogin && (
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-slate-400 ml-1">Confirmar Contraseña</label>
                    <input 
                      type="password" 
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full bg-[#1E293B] border border-slate-700 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-600"
                      placeholder="••••••••"
                    />
                  </div>
              )}

              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-wider py-3 px-4 rounded-xl transition-all shadow-lg shadow-indigo-600/20 mt-4 disabled:opacity-50 flex items-center justify-center h-12"
              >
                {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : (isLogin ? 'Iniciar Sesión' : 'Registrarse')}
              </button>
            </form>
          </div>

          <div className="text-center pt-4">
            <button 
              onClick={() => { setIsLogin(!isLogin); setErrorMsg(''); setConfirmPassword(''); }}
              className="text-slate-400 hover:text-white text-sm font-medium transition-colors"
            >
              {isLogin ? '¿No tienes cuenta? Regístrate aquí' : '¿Ya tienes cuenta? Inicia sesión'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginView;
