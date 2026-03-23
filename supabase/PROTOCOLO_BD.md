# Protocolo de Intervención a Base de Datos — SuperAgencia

## ⚠️ Regla de Oro
**Antes de escribir código que toque Supabase, verificar el esquema real.**
Nunca asumir que una columna existe solo porque el código la menciona.

---

## ✅ Checklist Pre-Intervención (OBLIGATORIO)

### 1. Verificar esquema actual
Ejecutar en Supabase SQL Editor ANTES de cualquier cambio:

```sql
-- Ver todas las columnas de la tabla objetivo
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'NOMBRE_TABLA'
AND table_schema = 'public'
ORDER BY ordinal_position;

-- Ver constraints existentes
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints  
WHERE table_name = 'NOMBRE_TABLA';

-- Ver políticas RLS activas
SELECT policyname, cmd, qual FROM pg_policies
WHERE tablename = 'NOMBRE_TABLA';
```

### 2. Verificar que el código y el esquema coinciden
Antes de deployar código que haga UPSERT/INSERT/SELECT:
- [ ] Cada columna que el código referencia existe en la tabla
- [ ] Los tipos coinciden (UUID, text, jsonb, etc.)
- [ ] Los constraints requeridos por `on_conflict` existen como UNIQUE en la BD
- [ ] Las políticas RLS permiten la operación

### 3. Si hay cambio de esquema → crear migración
- [ ] Crear archivo en `supabase/migrations/YYYYMMDD_descripcion.sql`
- [ ] Incluir siempre el bloque `-- ROLLBACK` comentado
- [ ] Ejecutar la migración ANTES de deployar el código que la requiere
- [ ] Commit del archivo de migración junto con el código que lo usa

---

## 🚨 Errores Comunes y su Causa Real

| Error PostgREST | Causa Real | Fix |
|----------------|------------|-----|
| `PGRST204: Could not find column 'X'` | La columna no existe en la tabla | `ALTER TABLE ADD COLUMN` |
| `PGRST116: No rows updated` | El `on_conflict` apunta a un constraint inexistente | Crear `UNIQUE (col1, col2)` |
| `401 Unauthorized` | RLS activo sin policy que permita la operación | Crear `CREATE POLICY` |
| `409 Conflict` | Violar unique constraint existente | Revisar lógica de `on_conflict` |
| `42P01: relation does not exist` | Table name con mayúsculas sin comillas en SQL | Usar comillas o minúsculas |

---

## 📁 Estructura de Migraciones

```
SuperAgencia/
└── supabase/
    └── migrations/
        ├── YYYYMMDD_descripcion_corta.sql
        └── ...
```

**Reglas:**
1. Un archivo por cambio lógico (no mezclar tablas no relacionadas)
2. Siempre incluir rollback comentado
3. Los archivos son inmutables una vez committeados — si hay que ajustar, crear una nueva migración
4. El orden de ejecución importa — usar timestamp en el nombre

---

## 🔄 Workflow Correcto para Nuevas Features

```
1. Analizar qué datos necesito → diseñar el esquema
2. Escribir el SQL de migración (con rollback)
3. Aplicar la migración en Supabase
4. Verificar con SELECT de information_schema
5. Escribir el código que usa las nuevas columnas
6. Commitear migración + código juntos
7. Push → Vercel deploya automáticamente
```

---

## 💾 Backup Preventivo

Antes de cualquier `ALTER TABLE` destructivo (DROP COLUMN, DROP TABLE, etc.):

```sql
-- Hacer snapshot de la tabla
CREATE TABLE backup_NOMBREORIGINAL_YYYYMMDD AS 
SELECT * FROM NOMBREORIGINAL;

-- Verificar el backup
SELECT COUNT(*) FROM backup_NOMBREORIGINAL_YYYYMMDD;
```

Después de confirmar que todo funcionó, limpiar el backup:
```sql
DROP TABLE IF EXISTS backup_NOMBREORIGINAL_YYYYMMDD;
```
