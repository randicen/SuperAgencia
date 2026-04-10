import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabaseAdmin: SupabaseClient | null = null;
let supabaseAuth: SupabaseClient | null = null;

const getEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
};

export const getSupabaseUrl = () => getEnv('SUPABASE_URL');
export const getSupabaseAnonKey = () => getEnv('SUPABASE_ANON_KEY');
export const getSupabaseServiceRoleKey = () => getEnv('SUPABASE_SERVICE_ROLE_KEY');

export const getSupabaseAdmin = (): SupabaseClient => {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return supabaseAdmin;
};

export const getSupabaseAuthClient = (): SupabaseClient => {
  if (!supabaseAuth) {
    supabaseAuth = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return supabaseAuth;
};
