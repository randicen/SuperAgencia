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
  const ai = new OpenAI({ 
    // @ts-ignore
    apiKey: import.meta.env.VITE_GROQ_API_KEY || '',
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

  // CONTEXTO DE DATOS EN TEXTO PLANO (los LLMs lo parsean mejor que JSON anidado)
  const buildPlainTextContext = () => {
    let text = '';

    // Workspaces
    text += 'ESTRUCTURA DE WORKSPACES:\n';
    workspaces.forEach((w: any) => {
      text += `\n📦 ${w.nombre}\n`;
      w.espacios.forEach((s: any) => {
        text += `  📂 ${s.nombre}\n`;
        // Listas raíz (sin carpeta)
        s.listas.forEach((l: any) => {
          text += `    • ${l.nombre} (${l.tareas.length} tareas)\n`;
        });
        // Carpetas con sus listas
        s.carpetas.forEach((f: any) => {
          text += `    📁 ${f.nombre}\n`;
          f.listas.forEach((l: any) => {
            text += `      • ${l.nombre} (${l.tareas.length} tareas)\n`;
          });
          if (f.listas.length === 0) {
            text += `      (vacía)\n`;
          }
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

  const plainTextContext = buildPlainTextContext();

  // --- SYSTEM PROMPTS BIFURCADOS ---
  const baseContext = `
  ERES EL COO Y CFO DE ESTA AGENCIA. Tu nombre es "Director AI".
  Eres un socio estratégico: conversa con fluidez y mantén un tono profesional pero cercano.

  === REGLA DE INTEGRIDAD ===
  NUNCA reportes que completaste una acción si no ejecutaste la herramienta correspondiente.
  Si no tienes una tool para lo que se pidió, dilo honestamente.

  === FUENTE ÚNICA DE VERDAD ===
  Los datos listados abajo son el ESTADO ACTUAL Y REAL del sistema en este instante.
  IGNORA cualquier dato diferente que aparezca en mensajes anteriores del chat.
  Si un mensaje previo del asistente dice algo diferente, ESTÁ DESACTUALIZADO. Solo confía en estos datos:

${plainTextContext}

  === CÓMO REPORTAR DATOS ===
  Cuando el usuario pregunte qué tiene (listas, carpetas, proyectos, etc.):
  1. Lee los datos de arriba LITERALMENTE.
  2. Reporta CADA ELEMENTO de CADA CARPETA. No omitas nada.
  3. Si una carpeta tiene una lista, MENCIÓNALA. Si dice "• yug (0 tareas)", esa lista EXISTE.
  4. "0 tareas" significa la lista existe pero está vacía, NO que no hay listas.
  === SIN DATOS NO SOLICITADOS ===
  NUNCA menciones información que el usuario no preguntó.
  Cuando el usuario pregunte por listas, reporta TODAS las listas de TODAS las carpetas.
  Responde SOLO lo que se preguntó.

  Tarifa: $${rules.baseHourlyRate}/hora | Hoy: ${today.toLocaleDateString('es-ES')}
  `;

  const systemPrompt = `${baseContext}
  === PREGUNTAS vs COMANDOS ===
  ANTES de usar cualquier herramienta, DETENTE y pregúntate: "¿El usuario quiere INFORMACIÓN o quiere que EJECUTE algo?"

  EJEMPLOS DE PREGUNTAS (SOLO responde con texto, NUNCA llames herramientas):
  - "q listas tengo" / "qué listas tengo" / "cuáles son mis listas" → SOLO texto
  - "qué carpetas hay" / "q carpetas tengo" → SOLO texto
  - "cuántos proyectos tengo" / "cuál es mi balance" → SOLO texto
  - "cuéntame sobre X" / "qué sabes de Y" → SOLO texto
  - Cualquier frase que empiece con "qué", "cuál", "cuánto", "cómo", "dónde", "q" → SOLO texto

  EJEMPLOS DE COMANDOS (SÍ llama herramientas):
  - "crea una carpeta" / "mueve la lista" / "elimina el espacio" / "registra un gasto" → Usa herramienta
  - Verbos imperativos: crea, mueve, elimina, renombra, registra, añade → Usa herramienta

  SI TIENES DUDA: responde con texto. Es mejor NO ejecutar que ejecutar por error.

  === COMANDOS EN PLURAL = MÚLTIPLES LLAMADAS ===
  Si el usuario dice "mueve LAS listas" (plural), llama la herramienta UNA VEZ POR CADA ELEMENTO.

  === REGLAS DE FORMATO ===
  - Usa **negritas** para nombres, montos y fechas.
  - Cuando reportes listas, incluye TODAS las listas de TODAS las carpetas.
  - 'crear_tarea'/'crear_proyecto' usan MINUTOS: 1h=60 | 1día=480 | 1semana=2400.
  - Para 'mover_lista', usa carpetaOrigenNombre si la lista viene de una carpeta.
  `;

  try {
    // TRUNCAR historial a últimos 30 mensajes
    const recentMessages = messages.slice(-30);

    // DEBUG: Log context for troubleshooting
    console.log('📋 Context sent to AI:\n', plainTextContext);

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

    // --- SINGLE MODEL: tools always available, model decides ---
    const response = await ai.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...formattedMessages
      ],
      temperature: 0.1,
      tools: tools,
      tool_choice: 'auto'
    });

    const messageResponse = response.choices[0].message;
    
    let functionCalls;
    if (messageResponse.tool_calls && messageResponse.tool_calls.length > 0) {
      functionCalls = messageResponse.tool_calls.map(tc => ({
        name: (tc as any).function.name,
        args: JSON.parse((tc as any).function.arguments)
      }));
    }

    return { text: messageResponse.content || "", functionCalls };
  } catch (error: any) {
    console.error("Groq API Error:", error);
    const apiError = error?.error?.message || error?.message || "Error desconocido";
    return { text: `⚠️ **Error de Groq**\n\nEl servidor respondió: *${apiError}*` };
  }
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
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: `Analiza estacionalidad y dame 3 consejos cortos: ${JSON.stringify(s)}` }]
    });
    return response.choices[0].message.content || "Análisis completado sin texto.";
  } catch (e: any) { 
    const apiError = e?.error?.message || e?.message || "Error desconocido";
    return `Error: ${apiError}`; 
  }
};