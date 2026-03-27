-- Migration: 20260322_add_user_id_to_app_state_dump
-- Descripción: El código usaba on_conflict=(id,user_id) pero user_id no existía en la tabla.
-- Causa del error: PGRST204 - columna no encontrada en schema cache de PostgREST.
-- Aplicado el: 2026-03-22 en producción vía Supabase SQL Editor.

-- 1. Agregar columna user_id
ALTER TABLE public.app_state_dump 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Rellenar el user_id en filas existentes
UPDATE public.app_state_dump 
SET user_id = auth.uid()
WHERE user_id IS NULL;

-- 3. Constraint NOT NULL
ALTER TABLE public.app_state_dump 
ALTER COLUMN user_id SET NOT NULL;

-- 4. Constraint UNIQUE compuesto requerido por el código
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_state_dump_id_user_id_key'
  ) THEN
    ALTER TABLE public.app_state_dump
    ADD CONSTRAINT app_state_dump_id_user_id_key UNIQUE (id, user_id);
  END IF;
END $$;

-- 5. Activar RLS
ALTER TABLE public.app_state_dump ENABLE ROW LEVEL SECURITY;

-- 6. Policy de seguridad por usuario
DROP POLICY IF EXISTS "Users manage own state" ON public.app_state_dump;
CREATE POLICY "Users manage own state" ON public.app_state_dump
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ROLLBACK (en caso de necesitar revertir):
-- ALTER TABLE public.app_state_dump DROP COLUMN user_id;
-- DROP CONSTRAINT app_state_dump_id_user_id_key;
