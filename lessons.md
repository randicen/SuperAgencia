# Lessons

- Cuando el usuario pide "limpiar" o "empezar de cero" en una base de datos, distinguir explÃ­citamente entre `borrar filas` y `eliminar esquema/tablas`. No asumir que limpiar datos basta.
- Para un producto nuevo, preferir un proyecto Supabase nuevo o un esquema propio antes de adaptar tablas heredadas.
- Antes de conectar persistencia, confirmar el modelo de datos final y evitar capas de compatibilidad temporales si el usuario ya decidiÃ³ cortar con lo anterior.
- No exponer mensajes crudos del proveedor (`503`, JSON interno, stack traces) en la UI; mapearlos a mensajes amigables y dejar el detalle tÃ©cnico solo en logs.
- En integraciones multi-provider, primero capturar la salida real del modelo y normalizarla al schema del dominio; no asumir que dos proveedores devuelven la misma estructura JSON.
- Para consultas del mundo externo, separar detecciÃ³n de intenciÃ³n, bÃºsqueda externa y respuesta con fuentes; no depender del grounding implÃ­cito del modelo ni mezclarlo ciegamente con el planner.
- Al ajustar prompts o system instructions, preservar las reglas existentes y aÃ±adir restricciones de forma aditiva; no reescribir el contrato completo si el cambio solo afecta un comportamiento puntual.
- En Gemini Live, verificar primero las capacidades exactas del modelo antes de diseñar UX de tools: gemini-3.1-flash-live-preview no soporta function calling asíncrono, así que un flujo con NON_BLOCKING, willContinue y microrespuesta hablada por tool rompe la llamada; usar tools sincrónicas o cambiar de modelo conscientemente.

- Cuando una capacidad exista en texto y voz (como web search), preferir un contrato de progreso compartido entre backend y UI; no resolver la UX de voz con hacks separados si el mismo estado puede emitirse por WebSocket y renderizarse visualmente.


- En UX multimodal, no reutilizar ciegamente el chat persistido para eventos de voz: el progreso de búsqueda por llamada debe vivir en un estado efímero visible durante la llamada, y los errores transitorios del WebSocket no deben persistirse como mensajes del asistente.
- Cuando el usuario corrige un clasificador heurístico, no responder ampliando solo catálogos de palabras clave; preferir una arquitectura híbrida con historial y, para ambigüedad real, un router semántico controlado.


- Nunca dejar un spinner vacío en operaciones de IA de varios segundos; siempre mostrar un estado textual amigable y, si existen, hitos reales del backend.
- No mantener dos fuentes de verdad para el planner. El cliente no debe recalcular ni reanclar la agenda despu?s de cargar un snapshot del servidor; todas las mutaciones y recomputes del schedule deben ocurrir en backend, y el cliente solo debe pedir persistencia expl?cita para cambios locales puntuales como configuraci?n.
- No separar el ruteo de intención del planner en mecanismos independientes (`read-only` por un lado y `external search` por otro). Debe existir un único router de intención con prioridades de negocio explícitas para evitar que una frase coloquial de agenda caiga en Tavily o en el pipeline mutador.
- En voz, no enviar `state` al cliente tras una búsqueda externa que no muta agenda: eso limpia el feedback visual demasiado pronto y hace parecer que nunca hubo panel de espera. El progreso efímero de web search debe vivir hasta que empiece el audio de respuesta o ocurra un error real.
- Para búsquedas del mundo externo con entidades (artistas, personas, eventos), una sola query directa no basta. El retrieval debe seguir un plan multi-etapa: contextualizar la entidad, buscar la respuesta principal y luego verificarla. Si no hay evidencia fuerte, responder con incertidumbre explícita en vez de inventar un dato preciso.
- Cuando una consulta externa depende del estado de una entidad (por ejemplo, si un artista sigue activo, murió o canceló su gira), el agente no debe saltar directo a la búsqueda principal. Primero debe contextualizar la entidad y luego contrastar la hipótesis con queries de verificación antes de sintetizar una respuesta final.
- Nunca confiar en `tasks/messages/schedule` enviados por el cliente como fuente de verdad para mutaciones del planner. El backend debe cargar el estado autoritativo desde Supabase y tratar el payload del navegador solo como contexto efímero (anclas temporales, UI), porque un cliente vacío puede borrar todo el planner si se persiste sin guardas.
- No permitir overwrites a estado vacío sobre un planner no vacío sin una señal explícita de reset. Si el live state sale vacío de forma sospechosa, usar el último snapshot no vacío como red de seguridad antes de mostrar una agenda vacía al usuario.
- En respuestas externas, precisión no implica frialdad. Si la respuesta tiene carga humana obvia (por ejemplo, alguien busca un concierto), el asistente debe priorizar el contexto decisivo, hablar con tacto y ofrecer una alternativa útil; evitar tono de reporte, fechas ISO incrustadas y exceso de citas inline.
- El contrato de `plannerMutation` debe ser explícito. Las respuestas de información externa que no cambian agenda deben marcarse siempre como `plannerMutation: false`; dejarlo implícito hace que la UI muestre falsos estados de “guardando cambios” y erosiona la confianza del usuario.

- La calidez y personalidad de respuestas externas no se resuelven solo con prompt. Para consultas del mundo externo, separar retrieve -> resolve -> compose: primero hechos estructurados, luego una resolucion semantica tipada, y solo al final composicion editorial determinista. No mezclar razonamiento factual y redaccion humana en una sola salida libre del modelo.

- La personalidad del asistente no debe depender de prompts sueltos ni compositores heurísticos por dominio. Para texto y voz, usar dos fases: un resolver factual estructurado y un editor LLM controlado por draft, con fallback determinista solo como red de seguridad.
- Si una señal externa de calendario entra al sistema, sus cambios reales deben persistirse aunque la policy luego decida solo sugerir o ignorar la replanificación. El calendario sincronizado y la decisión de mover tareas son capas distintas; no mezclar ambas deja el estado externo desactualizado.
- En el chat de Tandeba, las rutas no mutativas (`conversation`, `planner_read`, respuestas ya resueltas con `plannerMutation: false`) no deben hacer una segunda llamada LLM solo para "editorializar". Si los hechos ya están resueltos, componer la respuesta de forma determinista evita varios segundos extra de latencia sin perder el contrato de UX.
 
- Cuando el usuario redefine la marca visible del producto, alinear de inmediato strings de UI, correos, encabezados y metadata expuesta; no dejar mezcla de nombres viejos y nuevos en auth, dominio y producto.
- No tratar diagnostics por si solos como evidencia de planner con contenido. La recuperacion de estado debe basarse en mensajes/tareas/eventos/dependencias/bloques reales; si el estado vivo esta vacio pero existe una revision no vacia, restaurar tambien las tablas vivas desde esa revision en vez de depender de un fallback solo en memoria.
- NO DEMOS DE JUGUETE. NO BETAS. NO PARCHES. SOLO SOLUCIONES INGENIERILES PARA UNA AUDIENCIA DE INGENIEROS DE STANFORD.
- NO DEMOS DE JUGUETE. NO BETAS. NO PARCHES. SOLO SOLUCIONES INGENIERILES PARA UNA AUDIENCIA DE INGENIEROS DE STANFORD.
- NO DEMOS DE JUGUETE. NO BETAS. NO PARCHES. SOLO SOLUCIONES INGENIERILES PARA UNA AUDIENCIA DE INGENIEROS DE STANFORD.
- NO DEMOS DE JUGUETE. NO BETAS. NO PARCHES. SOLO SOLUCIONES INGENIERILES PARA UNA AUDIENCIA DE INGENIEROS DE STANFORD.
- NO DEMOS DE JUGUETE. NO BETAS. NO PARCHES. SOLO SOLUCIONES INGENIERILES PARA UNA AUDIENCIA DE INGENIEROS DE STANFORD.

