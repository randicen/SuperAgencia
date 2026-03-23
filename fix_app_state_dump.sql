-- 1. Agregar columna user_id que falta en app_state_dump
ALTER TABLE public.app_state_dump 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Llenar user_id con el dueño actual de los datos existentes
-- (Reemplaza el UUID de abajo con el ID de tu usuario de Supabase)
UPDATE public.app_state_dump 
SET user_id = '44eb4dce-f193-40c2-a235-e05d9eebdec0'
WHERE user_id IS NULL;

-- 3. Refrescar el schema cache de PostgREST  
NOTIFY pgrst, 'reload schema';
