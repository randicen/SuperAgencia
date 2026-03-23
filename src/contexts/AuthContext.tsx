import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { createClient, User, Session, SupabaseClient } from '@supabase/supabase-js';

// Inicializar cliente
const envUrl = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('coo_supabase_url') || 'https://kpauvbelnstbprvnnbaz.supabase.co';
const envKey = import.meta.env.VITE_SUPABASE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('coo_supabase_key') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwYXV2YmVsbnN0YnBydm5uYmF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MDQ0MTUsImV4cCI6MjA4OTI4MDQxNX0.wmrs6PWhlzBCtros7xOoNWH7ZYMD-HnA5QAGPM8IpIA';

export const isUsingDummyKeys = false;

// Cliente oficial permanentemente conectado con tu anon key
export const supabase: SupabaseClient = createClient(envUrl, envKey);

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isLoading: true,
  signOut: async () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 1. Obtener la sesión actual al cargar la app
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    // 2. Escuchar cambios de sesión (Login/Logout automático)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
