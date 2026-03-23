-- ==============================================================================
-- 1. CREACIÓN DE TABLAS RELACIONALES PARA REEMPLAZAR EL JSON DUMP
-- ==============================================================================

-- Habilitar extensión UUID (si no está disponible)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- PROYECTOS
CREATE TABLE IF NOT EXISTS public.projects (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    client_name TEXT NOT NULL,
    project_name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    priority TEXT NOT NULL,
    progress NUMERIC DEFAULT 0,
    total_value NUMERIC DEFAULT 0,
    paid_value NUMERIC DEFAULT 0,
    status TEXT NOT NULL,
    duration NUMERIC NOT NULL,
    deadline_type TEXT NOT NULL,
    auto_schedule BOOLEAN DEFAULT TRUE,
    elasticity NUMERIC DEFAULT 1,
    scheduled_slots JSONB DEFAULT '[]'::jsonb,
    has_conflict BOOLEAN DEFAULT FALSE,
    conflict_description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CLIENTES
CREATE TABLE IF NOT EXISTS public.clients (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- TRANSACCIONES
CREATE TABLE IF NOT EXISTS public.transactions (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    is_predictive BOOLEAN DEFAULT FALSE,
    project_id TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- NOTAS
CREATE TABLE IF NOT EXISTS public.notes (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT,
    last_modified NUMERIC NOT NULL,
    tags JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- BUSINESS RULES (Singular, 1 por usuario)
CREATE TABLE IF NOT EXISTS public.business_rules (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    base_hourly_rate NUMERIC,
    urgency_threshold_days NUMERIC,
    urgency_markup NUMERIC,
    max_projects_capacity NUMERIC,
    working_days JSONB,
    working_hours_start TEXT,
    working_hours_end TEXT,
    gcal_ical_url TEXT,
    custom_rules TEXT,
    historical_seasonality JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CHAT SESSIONS
CREATE TABLE IF NOT EXISTS public.chat_sessions (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    messages JSONB DEFAULT '[]'::jsonb,
    last_modified NUMERIC NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- SPACES (Estructura jerárquica compleja, mantenemos temporalmente un JSON por usuario hasta su propia refactorización)
CREATE TABLE IF NOT EXISTS public.spaces_store (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    spaces_data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- ==============================================================================
-- 2. POLÍTICAS DE SEGURIDAD (ROW LEVEL SECURITY)
-- Asegura que ningún inquilino (tenant) pueda leer o escribir datos de otros.
-- ==============================================================================

-- Habilitar RLS en todas las tablas
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces_store ENABLE ROW LEVEL SECURITY;

-- Crear políticas (Policies) que limitan acceso según el auth.uid()
CREATE POLICY "Users can only access their own projects" ON public.projects FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can only access their own clients" ON public.clients FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can only access their own transactions" ON public.transactions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can only access their own notes" ON public.notes FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can only access their own rules" ON public.business_rules FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can only access their own chats" ON public.chat_sessions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can only access their own spaces" ON public.spaces_store FOR ALL USING (auth.uid() = user_id);
