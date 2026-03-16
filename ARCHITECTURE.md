# 🏗️ Arquitectura Técnica: COO/CFO in a Box

Este documento define la infraestructura, lógica de negocio y protocolos de comunicación del sistema. Está diseñado para servir como referencia única de "Estado de la Verdad" para desarrolladores e ingenieros de IA.

## 1. Visión del Sistema
"COO/CFO in a Box" es un sistema experto diseñado para eliminar la carga administrativa de agencias unipersonales. A diferencia de un ERP tradicional, este sistema es **proactivo**: utiliza IA para agendar tareas basadas en esfuerzo real y proyectar flujo de caja predictivo.

---

## 2. Stack Tecnológico
- **Core:** React 19 (ESM) + TypeScript.
- **Runtime:** Vite (HMR ultra-rápido).
- **Estilos:** Tailwind CSS (Sistema de diseño "Executive Dark/Glass").
- **IA:** Google Gemini 2.0/3.0 (Modelos Flash para latencia y Pro para razonamiento).
- **Gráficos:** Recharts (Renderizado de SVG para finanzas).
- **Persistencia:** Persistencia Híbrida (LocalStorage + Supabase JSONB Dumps).

---

## 3. Arquitectura de Datos (Modelos)

### 3.1 Proyectos (Operativa)
- **Auto-Schedule:** Tareas donde la IA decide el bloque de tiempo basado en restricciones.
- **Fixed-Schedule:** Eventos con anclaje temporal inamovible (reuniones, deadlines).
- **Elasticidad:** `0` (Indivisible/Rígido) o `1` (Divisible/Flexible). Permite que el algoritmo fragmente tareas largas en huecos pequeños de la agenda.

### 3.2 Finanzas (CRM)
- **Estructura:** `Cliente` -> `Servicios` -> `Cuotas (Installments)`.
- **Vinculación:** Cada servicio puede estar ligado a un `ProjectID` para cruzar rentabilidad vs. esfuerzo real.

---

## 4. El Cerebro: Gemini Intelligence Layer

### 4.1 Context Engineering
En cada llamada a la API (`geminiService.ts`), el sistema inyecta un "Snapshot Operativo":
- Carga de trabajo actual (%).
- Próxima fecha de disponibilidad estimada.
- Resumen de clientes y proyectos críticos.
- Reglas de negocio personalizadas (tarifarios en lenguaje natural).

### 4.2 Function Calling (Tooling)
La IA no solo conversa; opera el sistema mediante:
- `crear_proyecto`: Transforma lenguaje natural ("Tengo una tesis de 3 días para el lunes") en minutos de esfuerzo y fechas de constraint.
- `registrar_transaccion`: Actualiza el flujo de caja.
- `abrir_calculadora`: Interacción directa con la UI.

---

## 5. Algoritmo de Agendamiento (Heartbeat)

El archivo `utils/schedulingLogic.ts` implementa un motor de búsqueda de huecos (Gap Search):

1. **Priorización (The Queue):**
   - 1º: Proyectos con prioridad `ASAP`.
   - 2º: Proyectos con `Hard Deadline` y poco "Slack" (margen de maniobra).
   - 3º: Peso de prioridad (`High` > `Medium` > `Low`).
   - 4º: Orden cronológico de `DueDate`.

2. **Cálculo de Slack (Margen):**
   `Slack = (Fecha Límite - Ahora) - Tiempo de Trabajo Restante`
   Un Slack negativo indica que el proyecto es físicamente imposible de terminar a tiempo sin trabajar horas extra.

3. **Gap Search Algorithm:**
   - Itera por los días laborales definidos en `BusinessRules`.
   - Identifica "Anclas" (Bloques fijos o manuales).
   - Busca huecos entre anclas.
   - Si la tarea es `Elasticity: 1`, rellena cualquier hueco > 15 min.
   - Si es `Elasticity: 0`, busca un hueco continuo igual al 100% de la duración.

---

## 6. Flujo de Caja Predictivo (CFO Logic)
El Dashboard no muestra solo el pasado. Calcula el balance futuro sumando:
- Balance en cuenta actual.
- `(+)` Cuotas pendientes de cobrar (`status: PENDIENTE`) basadas en su `dueDate`.
- `(-)` Gastos fijos o proyectados.
Esto genera una línea de tendencia que alerta sobre "valles de liquidez" antes de que ocurran.

---

## 7. Infraestructura PWA y Cloud
- **Offline First:** Toda la lógica corre en el cliente. La IA requiere conexión, pero la visualización y edición son locales.
- **PWA:** Manifest configurado para modo `standalone`. Iconos dinámicos y tema oscuro profundo.
- **Cloud Sync:** No usa SQL relacional tradicional para evitar migraciones. Exporta el estado completo como `jsonb` a Supabase, permitiendo que la estructura de datos evolucione sin romper la base de datos.

---

## 8. Principios de UX/UI
- **Aesthetics:** Basado en la interfaz de "Plane" y "ClickUp". Bordes redondeados (`2.5rem`), tipografía Inter, y fondos Slate/Zinc.
- **Feedback:** La IA usa "Thinking states" y el sistema detecta vencimientos al inicio de cada sesión (Briefing Modal).
- **Safety:** "Modo Admin" obligatorio para eliminaciones destructivas, evitando errores accidentales en movilidad.

---
*Documento actualizado: 2024-05-20*