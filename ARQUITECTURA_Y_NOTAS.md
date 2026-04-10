# OptiSchedule AI - Arquitectura y Notas Internas

Este documento describe la arquitectura fundamental y los refinamientos clave que hacen que OptiSchedule AI funcione de manera precisa, predecible y conversacional.

## 1. La Filosofía Fundamental: Separación de Responsabilidades

El mayor logro de esta aplicación es haber resuelto el problema clásico de los LLMs intentando hacer matemáticas complejas. La arquitectura se basa en una regla de oro:

**El LLM NO resuelve la agenda. El LLM es solo un traductor.**

*   **El Cerebro Matemático (El Motor):** Un motor determinista basado en Problemas de Optimización con Restricciones (COP). Es el único que decide a qué hora va cada tarea.
*   **La Interfaz (El Asistente IA):** Traduce el lenguaje natural del usuario ("Pon una reunión después de comer") a reglas estrictas de datos (Tareas, Duraciones, Dependencias, Deadlines).

## 2. El Motor Matemático (`solver.ts`)

El núcleo de la aplicación utiliza un algoritmo de **Branch and Bound** con **Forward Checking** y heurísticas dinámicas.

### Características Clave:
*   **Ventanas de Trabajo (Work Windows):** Respeta horarios laborales (ej. 8:00 a 18:00) y días de la semana (Lunes a Viernes). El motor calcula dinámicamente los "dominios" (franjas de tiempo válidas) saltándose las noches y los fines de semana.
*   **Tareas Elásticas (Chunking):** Si una tarea es muy grande (ej. "Programar por 4 horas"), el motor la divide automáticamente en bloques más pequeños (P1, P2) que encajen en los huecos disponibles.
*   **Minimización de Interrupciones (Disruption Minimization):** Al recalcular la agenda, el motor recibe la agenda anterior y penaliza fuertemente mover tareas que ya estaban agendadas, dando una sensación de estabilidad visual en el diagrama de Gantt.
*   **Estrategias de Resolución:** Permite cambiar entre una estrategia "Balanceada" (MRV - Minimum Remaining Values) y una de "Supervivencia" (Cola de prioridad estricta).

## 3. Los Asistentes de IA (Texto y Voz)

Ambos asistentes (en `ai.ts` y `live.ts`) comparten el mismo System Prompt y la misma herramienta (`updateSchedule`). 

### El Flujo de Trabajo (Feedback Loop)
Este es el refinamiento más importante que logramos. Evita que la IA alucine que hizo un cambio cuando matemáticamente es imposible:

1.  **Petición:** El usuario pide un cambio (ej. "Agrega una reunión de 2 horas a las 5 PM").
2.  **Propuesta:** La IA usa la herramienta `updateSchedule` proponiendo el nuevo array de tareas y dependencias.
3.  **Intercepción y Validación:** La aplicación NO aplica los cambios inmediatamente. Primero, pasa la propuesta por el motor matemático (`solveSchedule`).
4.  **Resolución:**
    *   **Si es viable:** Se actualiza el diagrama de Gantt y se le devuelve a la IA un `{ success: true, currentTasks, currentDependencies }`.
    *   **Si es inviable:** Se rechaza el cambio y se le devuelve a la IA un `{ success: false, error, diagnostics }`.
5.  **Respuesta Natural:** Gracias a este feedback, si la agenda choca, la IA le dice al usuario: "No puedo poner esa reunión porque chocaría con tu límite de las 6 PM", en lugar de mentir diciendo "Listo, lo he agendado".

## 4. Refinamientos Clave Logrados

Durante el desarrollo, superamos varios obstáculos críticos que llevaron la app a su estado actual de perfección:

### A. El Bug del "Día de la Marmota" (Domingo Perpetuo)
*   **Problema:** El motor calculaba los días laborales asumiendo matemáticamente que el "Día 0" (hoy) era siempre Domingo. Como el usuario trabaja de Lunes a Viernes, el motor siempre creía que "hoy" era un día inhábil. Si el asistente de voz ponía un límite estricto para "hoy mismo", el motor fallaba diciendo que no había huecos.
*   **Solución:** Se implementó `new Date().getDay()` en la generación de dominios del motor para que se alinee con el calendario real del usuario.

### B. La Amnesia del Asistente de Voz
*   **Problema:** La API de Gemini Live (Voz) mantiene una sesión abierta por WebSockets. A diferencia del chat de texto, no se le reenvía todo el contexto en cada turno. Si el usuario pedía 3 tareas seguidas, la IA olvidaba las primeras porque su estado interno no se actualizaba.
*   **Solución:** Se inyectó el estado actualizado (`currentTasks`, `currentDependencies`) directamente dentro de la respuesta de éxito de la herramienta `updateSchedule`. Así, cada vez que la IA modifica algo, recibe de vuelta una "fotografía" perfecta de cómo quedó la base de datos, manteniendo su memoria intacta.

### C. Inyección de Contexto en Tiempo Real
*   Se le inyecta a la IA la **fecha y hora exactas** en su System Prompt, además de lo que el usuario está viendo actualmente en pantalla (`currentSchedule`). Esto permite que la IA entienda conceptos relativos como "hoy", "mañana" o "después de la tarea que tengo a las 3".

---
*Documento generado tras la estabilización exitosa del asistente de voz y la sincronización total entre el motor matemático y los modelos LLM.*
