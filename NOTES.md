# Notas Internas y Estado de la App (OptiSchedule AI)

Este documento sirve para llevar un registro del estado actual de la aplicación, errores conocidos y los próximos pasos de desarrollo.

## Estado Actual
- **Motor Matemático (COP Engine):** Implementado y funcional. Soporta estrategias "Balanced" y "Survival".
- **Asistente de Texto:** Conectado al motor. Respeta el Principio de Inmutabilidad y soporta Modo Consultivo/Autónomo según la configuración de la UI.
- **Asistente de Voz (Live API):** Conectado al motor. Sincronizado con las mismas reglas estrictas que el asistente de texto (incluyendo la prevención de borrado de tareas y el Modo Consultivo).
- **UI:** Diagrama de Gantt funcional con vistas de Día, Semana, Mes, Trimestre y Año. Panel de configuración de motor y UX integrado.

## Errores sin resolver (Bugs)
- *(Ninguno documentado actualmente. El sistema es estable tras las últimas correcciones de inmutabilidad y borrado).*

## Próximos pasos pendientes (TODOs)
- [ ] **Seguridad y Prompt Injection:** Proteger la app de prompts malintencionados de usuarios que solicitan revelar el *system prompt* de la app o que solicitan conductas del asistente que sean peligrosas o inadecuadas para el propietario. Implementar barreras de seguridad (guardrails) en las instrucciones del sistema.
- [ ] **Arquitectura de Producción (Diferida):** Implementar la arquitectura definitiva para producción (backend, base de datos persistente, autenticación, etc.) cuando el proyecto esté listo para escalar. Por ahora, se mantiene el enfoque en el prototipo funcional actual.
- [ ] **OAuth con dominio propio:** Cuando Agena migre de la URL pública de Railway a un dominio propio o a un proxy dedicado, definir explícitamente `GOOGLE_REDIRECT_URI` y `MICROSOFT_REDIRECT_URI` para que los callbacks OAuth no dependan solo de `PUBLIC_APP_URL`.
- [ ] *(Añadir futuras mejoras aquí)*
