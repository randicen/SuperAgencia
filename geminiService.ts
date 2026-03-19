import OpenAI from "openai";
import { BusinessRules, Project, Message, Client, SeasonalityData, Note, Transaction } from "./types";

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "crear_proyecto",
      description: "Registra un nuevo proyecto. Diferencia entre Tarea IA (Auto) y Evento Fijo.",
      parameters: {
        type: "object",
        properties: {
          clientName: { type: "string" },
          projectName: { type: "string" },
          startDate: { type: "string", description: "Si autoSchedule=TRUE, es la fecha MÍNIMA de inicio (constraint). Si autoSchedule=FALSE, es el inicio exacto." },
          endDate: { type: "string" },
          totalValue: { type: "number" },
          priority: { type: "string", enum: ["ASAP", "High", "Medium", "Low"] },
          duration: { type: "number", description: "ESFUERZO NETO DE TRABAJO en MINUTOS. (Ej: '2 horas' = 120. '1 día' = 480. '1 semana' = 2400). NO es la duración calendario." },
          deadlineType: { type: "string", enum: ["Hard Deadline", "Soft Deadline"] },
          dueDate: { type: "string", description: "Fecha límite real (YYYY-MM-DD)" },
          autoSchedule: { type: "boolean", description: "TRUE = IA decide cuándo (dentro de la ventana). FALSE = Fijo en calendario." },
          elasticity: { type: "number", description: "0 = Tarea Indivisible (Bloque continuo), 1 = Flexible (Divisible)" }
        },
        required: ["clientName", "projectName", "totalValue", "priority", "duration", "deadlineType", "dueDate", "autoSchedule"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "actualizar_proyecto",
      description: "Modifica un proyecto existente, incluyendo campos de auto-agendamiento y elasticidad.",
      parameters: {
        type: "object",
        properties: {
          clientName: { type: "string" },
          projectName: { type: "string" },
          newProgress: { type: "number" },
          newEndDate: { type: "string" },
          newPriority: { type: "string", enum: ["ASAP", "High", "Medium", "Low"] },
          newTotalValue: { type: "number" },
          newDuration: { type: "number" },
          newDeadlineType: { type: "string", enum: ["Hard Deadline", "Soft Deadline"] },
          newDueDate: { type: "string" },
          newAutoSchedule: { type: "boolean" },
          newElasticity: { type: "number", description: "0 = Indivisible, 1 = Flexible" }
        },
        required: ["clientName", "projectName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "eliminar_proyecto",
      description: "Borra un proyecto específico.",
      parameters: {
        type: "object",
        properties: {
          clientName: { type: "string" },
          projectName: { type: "string" }
        },
        required: ["clientName", "projectName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "registrar_transaccion",
      description: "Registra un ingreso o gasto manual en el flujo de caja.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "Descripción del movimiento" },
          amount: { type: "number", description: "Monto positivo" },
          type: { type: "string", enum: ["income", "expense"] },
          category: { type: "string", description: "Categoría (ej: Oficina, Impuestos, Venta)" },
          date: { type: "string", description: "Fecha YYYY-MM-DD" }
        },
        required: ["description", "amount", "type", "date"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "crear_cliente",
      description: "Crea un nuevo cliente.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" }
        },
        required: ["name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "eliminar_cliente",
      description: "Elimina un cliente completo.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" }
        },
        required: ["name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "actualizar_cliente",
      description: "Actualiza datos de contacto de un cliente.",
      parameters: {
        type: "object",
        properties: {
          currentName: { type: "string", description: "Nombre actual para buscar" },
          newName: { type: "string" },
          newEmail: { type: "string" },
          newPhone: { type: "string" }
        },
        required: ["currentName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "eliminar_transaccion",
      description: "Elimina un registro de ingreso o gasto.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID de la transacción" },
          description: { type: "string", description: "Búsqueda por descripción si no hay ID" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "crear_nota",
      description: "Crea una nueva nota en la libreta.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          tags: { type: "array", items: { type: "string" } }
        },
        required: ["title", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "actualizar_nota",
      description: "Modifica una nota existente.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Búsqueda por título" },
          newContent: { type: "string" },
          newTitle: { type: "string" }
        },
        required: ["title"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "eliminar_nota",
      description: "Borra una nota.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" }
        },
        required: ["title"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "crear_workspace",
      description: "Crea un nuevo Workspace de alto nivel (ej: Personal, Trabajo, Agencia).",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string" }
        },
        required: ["nombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "eliminar_workspace",
      description: "Elimina un Workspace completo por su nombre.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string" }
        },
        required: ["nombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "renombrar_workspace",
      description: "Cambia el nombre de un Workspace de alto nivel.",
      parameters: {
        type: "object",
        properties: {
          nombreActual: { type: "string" },
          nuevoNombre: { type: "string" }
        },
        required: ["nombreActual", "nuevoNombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "crear_space",
      description: "Crea una nueva sección (Espacio) con color dentro del Workspace activo.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string" },
          color: { type: "string", description: "Color en HEX (opcional)" }
        },
        required: ["nombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "eliminar_space",
      description: "Elimina un Espacio (sección coloreada) dentro del Workspace activo.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string" }
        },
        required: ["nombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "renombrar_space",
      description: "Cambia el nombre de un Espacio (sección) dentro del Workspace activo.",
      parameters: {
        type: "object",
        properties: {
          nombreActual: { type: "string" },
          nuevoNombre: { type: "string" }
        },
        required: ["nombreActual", "nuevoNombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "actualizar_estado_proyecto",
      description: "Cambia el estado de un proyecto (active, completed, todo, proposal).",
      parameters: {
        type: "object",
        properties: {
          clientName: { type: "string" },
          projectName: { type: "string" },
          status: { type: "string", enum: ["active", "completed", "todo", "proposal"] }
        },
        required: ["clientName", "projectName", "status"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "crear_lista",
      description: "Crea una nueva lista de tareas dentro de un Espacio o una Carpeta.",
      parameters: {
        type: "object",
        properties: {
          espacioNombre: { type: "string", description: "Nombre del Espacio (Space) contededor" },
          carpetaNombre: { type: "string", description: "Nombre de la carpeta (opcional)" },
          nombre: { type: "string", description: "Nombre de la nueva lista" }
        },
        required: ["espacioNombre", "nombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "crear_carpeta",
      description: "Crea una nueva carpeta (Folder) dentro de un Espacio.",
      parameters: {
        type: "object",
        properties: {
          espacioNombre: { type: "string" },
          nombre: { type: "string", description: "Nombre de la nueva carpeta" }
        },
        required: ["espacioNombre", "nombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "renombrar_lista",
      description: "Cambia el nombre de una lista de tareas dentro de un Workspace.",
      parameters: {
        type: "object",
        properties: {
          espacioNombre: { type: "string", description: "Nombre del Espacio (Space) contenedor" },
          carpetaNombre: { type: "string", description: "Nombre de la carpeta (opcional)" },
          listaActualNombre: { type: "string" },
          nuevoNombre: { type: "string" }
        },
        required: ["espacioNombre", "listaActualNombre", "nuevoNombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "eliminar_lista",
      description: "Elimina una lista de tareas completa.",
      parameters: {
        type: "object",
        properties: {
          espacioNombre: { type: "string" },
          carpetaNombre: { type: "string" },
          listaNombre: { type: "string" }
        },
        required: ["espacioNombre", "listaNombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "renombrar_carpeta",
      description: "Cambia el nombre de una carpeta (Folder) dentro de un Espacio.",
      parameters: {
        type: "object",
        properties: {
          espacioNombre: { type: "string" },
          carpetaActualNombre: { type: "string" },
          nuevoNombre: { type: "string" }
        },
        required: ["espacioNombre", "carpetaActualNombre", "nuevoNombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "eliminar_carpeta",
      description: "Elimina una carpeta y todo su contenido.",
      parameters: {
        type: "object",
        properties: {
          espacioNombre: { type: "string" },
          carpetaNombre: { type: "string" }
        },
        required: ["espacioNombre", "carpetaNombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "proponer_reorganizacion",
      description: "Sugiere una nueva estructura de espacios, carpetas o listas para mejorar la claridad.",
      parameters: {
        type: "object",
        properties: {
          justificacion: { type: "string" },
          nuevaEstructura: { type: "string", description: "Descripción de cómo quedaría organizado" }
        },
        required: ["justificacion", "nuevaEstructura"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "mover_lista",
      description: "Mueve una lista de un Espacio o Carpeta a otra Carpeta diferente dentro del mismo Espacio.",
      parameters: {
        type: "object",
        properties: {
          espacioNombre: { type: "string", description: "Espacio donde está actualmente la lista" },
          carpetaOrigenNombre: { type: "string", description: "Carpeta de origen (si la lista está en una carpeta)" },
          listaNombre: { type: "string" },
          carpetaDestinoNombre: { type: "string", description: "Carpeta de destino" }
        },
        required: ["espacioNombre", "listaNombre", "carpetaDestinoNombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "crear_tarea",
      description: "Crea una nueva tarea detallada dentro de una lista.",
      parameters: {
        type: "object",
        properties: {
          espacioNombre: { type: "string" },
          carpetaNombre: { type: "string", description: "Opcional" },
          listaNombre: { type: "string" },
          nombre: { type: "string" },
          priority: { type: "string", enum: ["ASAP", "High", "Medium", "Low"] },
          duration: { type: "number", description: "Minutos de esfuerzo (ej. 60 para 1 hora)" },
          dueDate: { type: "string", description: "Fecha de vencimiento (YYYY-MM-DD)" },
          autoSchedule: { type: "boolean" },
          elasticity: { type: "number", enum: [0, 1], description: "0=Rígido, 1=Flexible" }
        },
        required: ["espacioNombre", "listaNombre", "nombre"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "abrir_calculadora",
      description: "Abre una calculadora visual en la interfaz.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "consultar_estado_app",
      description: "Úsala SIEMPRE que te pregunten qué listas, carpetas, espacios, notas o proyectos existen actualmente en la agencia. Obligatorio para leer el estado del negocio.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  }
];



export const calculateQuote = async (
  messages: Message[],
  rules: BusinessRules,
  currentProjects: Project[],
  clients: Client[],
  workspaces: any[] = [],
  notes: Note[] = [],
  transactions: Transaction[] = []
) => {
  // --- MODELO Y CLAVES CON FAILOVER SILENCIOSO ---
  const MODEL = 'openai/gpt-oss-120b';
  const GROQ_KEYS = [
    // @ts-ignore
    import.meta.env.VITE_GROQ_API_KEY || '',
    // @ts-ignore
    import.meta.env.VITE_GROQ_API_KEY_BACKUP || ''
  ].filter(Boolean);

  const createClient = (apiKey: string) => new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
    dangerouslyAllowBrowser: true
  });

  const today = new Date();
  const activeProjects = currentProjects.filter(p => p.status === 'active');

  const capacityPercent = Math.round((activeProjects.length / rules.maxProjectsCapacity) * 100);
  const isOverloaded = capacityPercent >= 80;

  const sortedEndDates = activeProjects.map(p => new Date(p.endDate).getTime()).sort((a, b) => a - b);
  const nextFreeDate = sortedEndDates.length > 0 ? new Date(sortedEndDates[0]).toLocaleDateString() : 'HOY';

  let totalReceivables = 0;
  clients.forEach(c => c.services.forEach(s => s.installments.forEach(i => { if (i.status === 'PENDIENTE') totalReceivables += i.amount })));

  const clientsList = clients.map(c => c.name).join(", ");

  // CONTEXTO DE DATOS EN TEXTO PLANO (Solo se genera cuando el Agente llama a la herramienta)
  const buildPlainTextContext = () => {
    let text = '';

    // Workspaces
    text += 'ESTRUCTURA DE WORKSPACES:\n';
    workspaces.forEach((w: any) => {
      text += `\n📦 Workspace: ${w.nombre}\n`;
      w.espacios.forEach((s: any) => {
        text += `  📂 Espacio: ${s.nombre}\n`;
        // Listas raíz (sin carpeta)
        s.listas.forEach((l: any) => {
          text += `    📋 Lista: ${l.nombre}\n`;
        });
        // Carpetas con sus listas
        s.carpetas.forEach((f: any) => {
          text += `    📁 Carpeta: ${f.nombre}\n`;
          f.listas.forEach((l: any) => {
            text += `      📋 Lista: ${l.nombre}\n`;
          });
        });
      });
    });

    // Proyectos
    if (currentProjects.length > 0) {
      text += '\nPROYECTOS:\n';
      currentProjects.forEach(p => {
        text += `  • ${p.projectName} | Cliente: ${p.clientName} | $${p.totalValue} | ${p.status} | ${p.progress}%\n`;
      });
    }

    // Notas
    if (notes.length > 0) {
      text += '\nNOTAS:\n';
      notes.forEach(n => { text += `  • ${n.title}\n`; });
    }

    // Flujo de caja
    const balance = transactions.reduce((acc, t) => t.type === 'income' ? acc + t.amount : acc - t.amount, 0);
    text += `\nFLUJO DE CAJA: ${transactions.length} transacciones | Balance: $${balance.toLocaleString()}\n`;

    return text;
  };

  // --- SYSTEM PROMPT (Ligero, sin inyección pasiva de estado) ---
  const systemPrompt = `
  ERES EL COO Y CFO DE ESTA AGENCIA. Tu nombre es "Director AI".
  Eres un socio estratégico: conversa con fluidez y mantén un tono profesional pero cercano.
  Motor de IA: GPT OSS 120B (via Groq). Si alguien te pregunta qué modelo eres, responde exactamente: "Soy Director AI, impulsado por GPT OSS 120B en Groq."

  === REGLA DE INTEGRIDAD Y ESTADO ===
  1. NUNCA asumas qué listas, carpetas o proyectos tiene el usuario de memoria.
  2. Si el usuario te hace una pregunta de información (e.g. "¿Qué listas tengo?"), OBLIGATORIAMENTE debes llamar a la herramienta "consultar_estado_app". No intentes responder usando información del historial porque puede estar desactualizada. Confía SOLO en lo que te devuelva la herramienta.
  3. No reportes que completaste una acción si no usaste la tool correspondiente.
  4. CERO INICIATIVA DESTRUCTIVA: NUNCA elimines carpetas, listas, proyectos ni notas a menos que el usuario te haya dado la orden EXPLÍCITA de eliminar. Si el usuario pide mover archivos, SOLO mueve, NO elimines la carpeta de origen vacía.

  === PREGUNTAS vs COMANDOS ===
  EJEMPLOS DE PREGUNTAS:
  - "q listas tengo" / "qué listas tengo" / "cuáles son mis proyectos" → LLAMA A LA HERRAMIENTA consultar_estado_app
  - "cuántos proyectos tengo" / "dime el balance" → LLAMA A LA HERRAMIENTA consultar_estado_app

  EJEMPLOS DE COMANDOS:
  - "crea una carpeta" / "mueve la lista" / "registra un gasto" → LLAMA A LA HERRAMIENTA CORRECTA (ej. crear_carpeta)

  === REGLAS DE FORMATO ===
  - Respuestas concisas. Usa **negritas** para nombres.
  - Tarifa de agencia: $${rules.baseHourlyRate}/hora | Hoy: ${today.toLocaleDateString('es-ES')}
  `;

  // --- BUCLE DE FAILOVER SILENCIOSO ---
  for (let keyIndex = 0; keyIndex < GROQ_KEYS.length; keyIndex++) {
    const ai = createClient(GROQ_KEYS[keyIndex]);
    console.log(`[ReAct] Intentando con API key #${keyIndex + 1}...`);

  try {
    // TRUNCAR historial a últimos 30 mensajes
    const recentMessages = messages.slice(-30);

    // DEBUG: Informar que inició la inferencia
    console.log('🤖 Solicitando completion a Groq con routing activo...');

    const formattedMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = recentMessages.map(m => {
      let textContent = m.content;
      
      if (m.attachments && m.attachments.length > 0) {
        textContent += "\n\n--- ARCHIVOS ADJUNTOS ---\n";
        m.attachments.forEach(att => {
          if (!att.isBinary) {
            textContent += `\n[Archivo: ${att.name}]\n${att.content}\n`;
          }
        });
      }

      const msg: any = {
        role: m.role,
        content: textContent || "."
      };

      // Si el mensaje tiene acciones (pendientes o ya ejecutadas), las pasamos como tool_calls
      const allActions = [...(m.pendingActions || []), ...(m.executedActions || [])];
      if (m.role === 'assistant' && allActions.length > 0) {
        msg.tool_calls = allActions.map((pa, idx) => ({
          id: `call_${idx}_${new Date(m.timestamp).getTime()}`,
          type: 'function',
          function: {
            name: pa.name,
            arguments: JSON.stringify(pa.args)
          }
        }));
      }

      return msg;
    });

    // --- FILTRADO DINÁMICO DE HERRAMIENTAS (ANTI-AUTODESTRUCCIÓN) ---
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userMessageContent = lastUserMsg ? lastUserMsg.content.toLowerCase() : "";
    const isDestructiveIntent = /(elimina|borra|quita|suprime|delete|remove|destruye|limpia)/.test(userMessageContent);

    const safeTools = tools.filter(t => {
      if (!isDestructiveIntent && (t as any).function?.name?.startsWith('eliminar_')) {
        return false;
      }
      return true;
    });

    // --- LLAMADA PRINCIPAL A LA API ---
    console.log('[ReAct] Iniciando Primera Llamada a Groq... (SafeTools:', safeTools.length, ')');
    let response = await ai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...formattedMessages
      ],
      temperature: 0.1,
      tools: safeTools,
      tool_choice: 'auto'
    });

    let messageResponse = response.choices[0].message;
    console.log('[ReAct] Groq Respondió:', messageResponse);

    // --- BUCLE REACT: Intercepción de Herramientas de Solo Lectura ---
    const toolCalls = messageResponse.tool_calls || [];
    const hasConsultarEstado = toolCalls.some(tc => (tc as any).function.name === 'consultar_estado_app');

    if (hasConsultarEstado) {
      console.log('🔄 [ReAct] Agente solicitó consultar estado. Interceptando internamente...');
      
      const cleanAssistantMessage = {
        role: messageResponse.role,
        content: messageResponse.content || "",
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: tc.type,
          function: { name: (tc as any).function.name, arguments: (tc as any).function.arguments }
        }))
      };

      const reactMessages: any[] = [
        { role: 'system', content: systemPrompt },
        ...formattedMessages,
        cleanAssistantMessage
      ];

      toolCalls.forEach(tc => {
        if ((tc as any).function.name === 'consultar_estado_app') {
          const estadoApp = buildPlainTextContext();
          reactMessages.push({ role: 'tool', tool_call_id: tc.id, name: "consultar_estado_app", content: estadoApp });
        } else {
          reactMessages.push({ role: 'tool', tool_call_id: tc.id, name: (tc as any).function.name, content: "Delegado. Continúa redactando." });
        }
      });

      console.log('[ReAct] Iniciando Segunda Llamada Silenciosa...');
      response = await ai.chat.completions.create({
        model: MODEL,
        messages: reactMessages,
        temperature: 0.1
      });
      messageResponse = response.choices[0].message;
      console.log('[ReAct] Segunda Respuesta Groq:', messageResponse);
    }
    
    // --- GESTIÓN DE ACCIONES PARA EL FRONTEND ---
    let functionCalls;
    if (messageResponse.tool_calls && messageResponse.tool_calls.length > 0) {
      functionCalls = messageResponse.tool_calls
        .filter(tc => (tc as any).function.name !== 'consultar_estado_app')
        .map(tc => {
          try {
            return {
              name: (tc as any).function.name,
              args: JSON.parse((tc as any).function.arguments)
            };
          } catch (e) {
            console.error("Error parseando args:", e);
            return null;
          }
        }).filter(Boolean);
    }

    return { text: messageResponse.content || "", functionCalls };
  } catch (error: any) {
    const errorMsg = error?.error?.message || error?.message || "";
    const isRateLimit = errorMsg.toLowerCase().includes('rate limit') || error?.status === 429;

    // Si es rate-limit y aún quedan claves, reintentar silenciosamente con la siguiente
    if (isRateLimit && keyIndex < GROQ_KEYS.length - 1) {
      console.warn(`⚠️ [Failover] Rate limit en key #${keyIndex + 1}. Cambiando a key #${keyIndex + 2}...`);
      continue; // Saltar al siguiente ciclo del for con la siguiente API key
    }

    console.error("Groq API Error:", error);
    return { text: `⚠️ **Error de Groq**\n\nEl servidor respondió: *${errorMsg || 'Error desconocido'}*` };
  }
  } // fin del for de failover
  return { text: '⚠️ Todas las claves API alcanzaron su límite. Intenta más tarde.' };
};

export const analyzeSeasonality = async (s: SeasonalityData[], p: Project[]) => {
  const ai = new OpenAI({ 
    // @ts-ignore
    apiKey: import.meta.env.VITE_GROQ_API_KEY || '',
    baseURL: 'https://api.groq.com/openai/v1',
    dangerouslyAllowBrowser: true 
  });

  try {
    const response = await ai.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: `Analiza estacionalidad y dame 3 consejos cortos: ${JSON.stringify(s)}` }]
    });
    return response.choices[0].message.content || "Análisis completado sin texto.";
  } catch (e: any) { 
    const apiError = e?.error?.message || e?.message || "Error desconocido";
    return `Error: ${apiError}`; 
  }
};