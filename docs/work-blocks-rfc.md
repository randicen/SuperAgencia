# Work Blocks RFC

## Problema

Hoy una tarea en Espacios mezcla dos responsabilidades:

- compromiso de entrega: deadline, prioridad, progreso, cliente
- ocupacion de agenda: `autoSchedule`, `startDate`, `endDate`, `scheduledSlots`

Eso obliga a modelar toda tarea como si siempre supieramos el esfuerzo exacto y como si la tarea misma debiera bloquear calendario.

## Objetivo

Separar:

- `Task`: que hay que lograr
- `WorkBlock`: cuando apartamos tiempo exclusivo para trabajar en esa tarea
- `Event`: tiempo no disponible externo a la tarea

Regla de producto:

- las tareas no bloquean tiempo
- los eventos y work blocks si bloquean tiempo

## Modelo propuesto

### Task

- nombre, prioridad, estado, progreso
- deadline opcional y tipo de deadline
- `earliestStartAt` opcional
- `estimatedEffortMinutes` opcional
- `preferredBlockMinutes` opcional
- `workStyle`: `deep-work` o `flexible`

### WorkBlock

- pertenece a una tarea
- tiene identidad propia
- tiene `startAt`, `endAt`
- puede ser `manual`, `ai` o `legacy`
- puede estar `planned`, `done` o `cancelled`

## Decisión de transición

En esta fase el sistema mantiene compatibilidad con el modelo actual:

- `scheduledSlots` legacy se reflejan como `workBlocks`
- `workBlocks` pueden reflejarse de vuelta como `scheduledSlots`
- `duration` legacy se refleja como `estimatedEffortMinutes`
- `elasticity` legacy se refleja como `workStyle`

## Impacto por capa

### Reducer / estado

- normalizar tareas al cargar `coo_spaces`
- normalizar tareas despues de recalcular scheduling

### UI

El modal de tarea debe migrar de:

- `Planificacion Automatica / Bloqueo Manual`

a:

- `Plazo`
- `Esfuerzo`
- `Bloques de trabajo`

### Scheduling

El scheduler actual debe evolucionar de calendarizar tareas a proponer work blocks.

### IA

Las tools futuras deben separarse:

- `crear_tarea`
- `editar_tarea`
- `crear_bloque_trabajo`
- `mover_bloque_trabajo`
- `replanificar_bloques_tarea`

## Fases

1. Fundaciones de dominio y compatibilidad
2. Nuevo editor de tarea con seccion de work blocks
3. Calendario y gantt centrados en bloques
4. Scheduler que propone bloques en vez de slots de tarea
5. Migracion final fuera de `autoSchedule` y `scheduledSlots`
