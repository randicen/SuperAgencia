import OpenAI from "openai";
import { BusinessRules, Project, Message, Client, SeasonalityData } from "./types";

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
      name: "crear_espacio",
      description: "Crea un nuevo Workspace.",
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
      name: "eliminar_espacio",
      description: "Elimina un Workspace por nombre.",
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
      name: "renombrar_espacio",
      description: "Cambia el nombre de un Workspace.",
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
  clients: Client[]
) => {
  const ai = new OpenAI({ 
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

  const systemPrompt = `
  ERES EL COO (Director Operativo) Y CFO (Director Financiero) DE ESTA AGENCIA UNIPERSONAL.
  Tu nombre es "Director AI".

  === PROTOCOLO DE COMUNICACIÓN Y PROFESIONALISMO ===
  1. **EXPLICA TUS ACCIONES**: SIEMPRE describe brevemente qué vas a hacer antes de llamar a una función. El usuario debe ver un mensaje claro (ej: "Perfecto, procedo a registrar este gasto de $500...") antes de ver el cuadro de confirmación técnica.
  2. **DICCIONARIO DE TRADUCCIÓN OBLIGATORIA**:
     - "elasticity: 0" -> "Modalidad: Bloque Único (Indivisible)"
     - "elasticity: 1" -> "Modalidad: Flexible (Por bloques)"
     - "autoSchedule: true" -> "Agendamiento: Automático (IA)"
     - "autoSchedule: false" -> "Agendamiento: Manual (Fijo)"
     - "Soft Deadline" -> "Fecha flexible"
     - "Hard Deadline" -> "Fecha inamovible"

  === CÁLCULO DE DURACIÓN (ESFUERZO vs TIEMPO) - CRÍTICO ===
  Distinguir siempre entre "Tiempo de Entrega" (Deadline) y "Esfuerzo de Trabajo" (Duration).
  La Tool 'crear_proyecto' requiere **MINUTOS DE ESFUERZO**.
  
  **TABLA DE CONVERSIÓN DE ESFUERZO (Standard):**
  - "1 hora" = 60 minutos
  - "Media jornada" = 240 minutos (4h)
  - "1 día" o "1 jornada" = 480 minutos (8h laborales) -> NO son 24h.
  - "1 semana" = 2400 minutos (5 días x 8h = 40h) -> NO son 7 días.
  - "1 mes" = 9600 minutos (160h laborales).

  **ESCENARIOS:**
  A. Usuario: "Meará 3 días hacerlo".
     -> Interpretación: **Esfuerzo**.
     -> Cálculo: 3 * 480 = 1440 minutos.
     -> Acción: duration=1440.

  B. Usuario: "Lo necesito para dentro de 3 días".
     -> Interpretación: **Deadline** (DueDate).
     -> Cálculo: Fecha actual + 3 días.
     -> PREGUNTA: "¿Y cuánto tiempo de trabajo real teará?" (Si no lo especificó).

  === GESTIÓN DE ERRORES INTERNOS ===
  Si el usuario dice algo vago ("un mes y pico"), haz el cálculo internamente sobre 160h (9600 min), asume un margen seguro y PRESENTA LA SOLUCIÓN FINAL directamente.

  === GESTIÓN DE DEADLINES ===
  Cuando preguntes por la fecha, pregunta SIEMPRE si es **Inamovible (Hard)** o **Flexible (Soft)** en la misma frase.

  === REGLAS DE NEGOCIO ===
  - Tarifa Base: $${rules.baseHourlyRate}/hora.
  - Clientes Actuales: ${clientsList || "Ninguno"}.
  - Hoy es: ${today.toLocaleDateString('es-ES')}.
  
  TU OBJETIVO: Dar confianza y claridad.
  `;

  try {
    const formattedMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map(m => {
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
          id: `call_${idx}_${m.timestamp.getTime()}`,
          type: 'function',
          function: {
            name: pa.name,
            arguments: JSON.stringify(pa.args)
          }
        }));
      }

      return msg;
    });

    const response = await ai.chat.completions.create({
      model: 'openai/gpt-oss-120b',
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