import OpenAI from "openai";
import { BusinessRules, Project, Message, Client, SeasonalityData, Note, Transaction } from "./types";
import { getAllTasks } from "./contexts/SpacesContext";
import { SpacesState } from "./spacesTypes";

let currentGroqKeyIndex = 0;

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
      description: "Modifica una tarea/proyecto existente, incluyendo nombre, horarios actuales, fecha mínima de inicio, fecha límite, modo auto/manual y elasticidad.",
      parameters: {
        type: "object",
        properties: {
          clientName: { type: "string" },
          projectName: { type: "string" },
          newProjectName: { type: "string" },
          newProgress: { type: "number" },
          newStartDate: { type: "string", description: "Nuevo inicio. Si autoSchedule=TRUE, es la fecha mínima de inicio. Si autoSchedule=FALSE, es el inicio exacto." },
          newEndDate: { type: "string" },
          newPriority: { type: "string", enum: ["ASAP", "High", "Medium", "Low"] },
          newTotalValue: { type: "number" },
          newDuration: { type: "number" },
          newDeadlineType: { type: "string", enum: ["Hard Deadline", "Soft Deadline"] },
          newDueDate: { type: "string" },
          newAutoSchedule: { type: "boolean" },
          newElasticity: { type: "number", description: "0 = Indivisible, 1 = Flexible" }
        },
        required: ["projectName"]
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
        required: ["projectName"]
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
        required: ["projectName", "status"]
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
      description: "Úsala SIEMPRE que te pregunten por el estado actual de la agencia: listas, espacios, tareas, horarios, deadlines, agenda, notas, clientes o flujo de caja. Usa filtros concretos para traer solo lo necesario.",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["summary", "structure", "tasks", "task_detail", "agenda", "clients", "notes", "finance"],
            description: "Qué parte del estado quieres consultar. Usa 'task_detail' para una tarea concreta y 'tasks' para listas u ordenamientos de tareas."
          },
          projectName: { type: "string", description: "Nombre de la tarea/proyecto si buscas una tarea concreta." },
          clientName: { type: "string", description: "Nombre del cliente si quieres filtrar tareas o proyectos de un cliente." },
          limit: { type: "number", description: "Cantidad máxima de resultados. Usa un número pequeño salvo que el usuario pida una lista extensa." },
          includeCompleted: { type: "boolean", description: "Incluye tareas finalizadas si el usuario lo pidió explícitamente." }
        },
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
  const allAppTasksWithLocation = getAllTasks({ workspaces } as SpacesState);
  const allAppTasks = allAppTasksWithLocation.map(t => t.task);
  const activeTasks = allAppTasks.filter(t => t.estado === 'ACTIVE');

  const capacityPercent = Math.round((activeTasks.length / rules.maxProjectsCapacity) * 100);
  const isOverloaded = capacityPercent >= 80;

  let totalReceivables = 0;
  allAppTasks.forEach(t => {
      if (t.installments) {
          t.installments.forEach(i => {
              if (i.status === 'PENDIENTE') totalReceivables += i.amount;
          });
      }
  });

  const clientsList = clients.map(c => c.name).join(", ");

  // CONTEXTO DE DATOS EN TEXTO PLANO (Solo se genera cuando el Agente llama a la herramienta)
  const buildPlainTextContext = (query?: { scope?: string; projectName?: string; clientName?: string; limit?: number; includeCompleted?: boolean }) => {
    let text = '';
    const normalizeText = (value?: string) => (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    const formatDateTime = (value?: string) => {
      if (!value) return 'Sin fecha';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
    };
    const formatSchedule = (task: any) => {
      if (task.scheduledSlots && task.scheduledSlots.length > 0) {
        return task.scheduledSlots
          .slice(0, 2)
          .map((slot: any) => `${formatDateTime(slot.start)} → ${formatDateTime(slot.end)}`)
          .join(' | ');
      }

      if (task.startDate || task.endDate) {
        return `${formatDateTime(task.startDate)} → ${formatDateTime(task.endDate || task.dueDate)}`;
      }

      return 'Sin horario calculado';
    };
    const resolveLocation = (taskLoc: any) => {
      const workspace = workspaces.find((w: any) => w.id === taskLoc.workspaceId);
      const space = workspace?.espacios.find((s: any) => s.id === taskLoc.spaceId);
      const folder = space?.carpetas.find((f: any) => f.id === taskLoc.folderId);
      const list = folder
        ? folder.listas.find((l: any) => l.id === taskLoc.listId)
        : space?.listas.find((l: any) => l.id === taskLoc.listId) || space?.carpetas.flatMap((f: any) => f.listas).find((l: any) => l.id === taskLoc.listId);
      return `${workspace?.nombre || 'Workspace'} / ${space?.nombre || 'Espacio'}${folder ? ` / ${folder.nombre}` : ''} / ${list?.nombre || 'Lista'}`;
    };
    const parseDateValue = (value?: string) => {
      if (!value) return Number.MAX_SAFE_INTEGER;
      const parsed = new Date(value).getTime();
      return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
    };
    const matchesText = (value: string | undefined, queryValue: string) => {
      const normalizedValue = normalizeText(value);
      return normalizedValue.includes(queryValue) || queryValue.includes(normalizedValue);
    };

    const requestedScope = query?.scope || (query?.projectName ? 'task_detail' : 'summary');
    const normalizedProjectName = normalizeText(query?.projectName);
    const normalizedClientName = normalizeText(query?.clientName);
    const includeCompleted = query?.includeCompleted ?? Boolean(normalizedProjectName);
    const limit = Math.min(Math.max(query?.limit ?? (requestedScope === 'task_detail' ? 3 : 8), 1), 20);

    const filteredTasks = allAppTasksWithLocation
      .filter(taskLoc => {
        const task = taskLoc.task;
        if (!includeCompleted && task.estado === 'DONE') return false;
        if (normalizedProjectName && !matchesText(task.nombre, normalizedProjectName)) return false;
        if (normalizedClientName && !matchesText(task.clientName, normalizedClientName)) return false;
        return true;
      })
      .sort((left, right) => {
        const dueDiff = parseDateValue(left.task.dueDate) - parseDateValue(right.task.dueDate);
        if (dueDiff !== 0) return dueDiff;
        const startDiff = parseDateValue(left.task.startDate) - parseDateValue(right.task.startDate);
        if (startDiff !== 0) return startDiff;
        return left.task.nombre.localeCompare(right.task.nombre, 'es');
      });
    const limitedTasks = filteredTasks.slice(0, limit);

    if (requestedScope === 'task_detail') {
      if (limitedTasks.length === 0) {
        return `No encontré una tarea que coincida con "${query?.projectName || 'la búsqueda'}".`;
      }

      text += `DETALLE DE TAREA (${limitedTasks.length} resultado${limitedTasks.length === 1 ? '' : 's'}):\n`;
      limitedTasks.forEach(taskLoc => {
        const task = taskLoc.task;
        text += `- ${task.nombre} | Cliente: ${task.clientName || 'Sin cliente'} | Estado: ${task.estado} | Progreso: ${task.progress}% | Modalidad: ${task.autoSchedule ? 'Auto' : 'Manual'} | Inicio: ${formatDateTime(task.startDate)} | Fin actual: ${formatDateTime(task.endDate)} | Deadline: ${formatDateTime(task.dueDate)} | Horario actual: ${formatSchedule(task)} | Ubicación: ${resolveLocation(taskLoc)}\n`;
      });
      return text;
    }

    if (requestedScope === 'tasks') {
      text += `TAREAS ACTUALES (${Math.min(filteredTasks.length, limit)} de ${filteredTasks.length}):\n`;
      limitedTasks.forEach(taskLoc => {
        const task = taskLoc.task;
        text += `- ${task.nombre} | Cliente: ${task.clientName || 'Sin cliente'} | Estado: ${task.estado} | Deadline: ${formatDateTime(task.dueDate)} | Horario: ${formatSchedule(task)}\n`;
      });
      return text;
    }

    if (requestedScope === 'agenda') {
      const agendaLines = workspaces.flatMap((workspace: any) =>
        (workspace.agendaEvents || []).map((event: any) =>
          `- ${event.nombre} | ${formatDateTime(event.startDate)} → ${formatDateTime(event.endDate)} | Workspace: ${workspace.nombre}`
        )
      );
      return agendaLines.length > 0
        ? `AGENDA GLOBAL (${Math.min(agendaLines.length, limit)} de ${agendaLines.length}):\n${agendaLines.slice(0, limit).join('\n')}`
        : 'No hay eventos en la agenda global.';
    }

    if (requestedScope === 'structure') {
      text += 'ESTRUCTURA DE WORKSPACES:\n';
      workspaces.slice(0, limit).forEach((workspace: any) => {
        text += `- Workspace: ${workspace.nombre}\n`;
        workspace.espacios.slice(0, limit).forEach((space: any) => {
          text += `  • Espacio: ${space.nombre}\n`;
          space.listas.slice(0, limit).forEach((list: any) => {
            text += `    · Lista: ${list.nombre}\n`;
          });
          space.carpetas.slice(0, limit).forEach((folder: any) => {
            text += `    · Carpeta: ${folder.nombre}\n`;
            folder.listas.slice(0, limit).forEach((list: any) => {
              text += `      - Lista: ${list.nombre}\n`;
            });
          });
        });
      });
      return text;
    }

    if (requestedScope === 'clients') {
      const clientLines = clients.slice(0, limit).map(client => {
        const clientTasks = filteredTasks.filter(t => t.task.clientId === client.id || matchesText(t.task.clientName, normalizeText(client.name)));
        return `- ${client.name} | Proyectos asociados: ${clientTasks.length}`;
      });
      return clientLines.length > 0 ? `CLIENTES (${clientLines.length}):\n${clientLines.join('\n')}` : 'No hay clientes registrados.';
    }

    if (requestedScope === 'notes') {
      const noteLines = notes.slice(0, limit).map(note => `- ${note.title}`);
      return noteLines.length > 0 ? `NOTAS (${noteLines.length}):\n${noteLines.join('\n')}` : 'No hay notas registradas.';
    }

    if (requestedScope === 'finance') {
      const balance = transactions.reduce((acc, t) => t.type === 'income' ? acc + t.amount : acc - t.amount, 0);
      const recentTransactions = transactions
        .slice()
        .sort((left, right) => parseDateValue(right.date) - parseDateValue(left.date))
        .slice(0, limit)
        .map(transaction => `- ${transaction.date} | ${transaction.type} | ${transaction.description} | $${transaction.amount.toLocaleString()}`);
      return `FLUJO DE CAJA: ${transactions.length} transacciones | Balance: $${balance.toLocaleString()}\n${recentTransactions.join('\n')}`;
    }

    const upcomingTasks = filteredTasks.slice(0, Math.min(limit, 6));
    const balance = transactions.reduce((acc, t) => t.type === 'income' ? acc + t.amount : acc - t.amount, 0);
    const agendaCount = workspaces.reduce((acc: number, workspace: any) => acc + (workspace.agendaEvents?.length || 0), 0);

    text += `RESUMEN GENERAL:\n`;
    text += `- Workspaces: ${workspaces.length}\n`;
    text += `- Clientes: ${clients.length}\n`;
    text += `- Tareas activas/no finalizadas: ${filteredTasks.length}\n`;
    text += `- Eventos en agenda global: ${agendaCount}\n`;
    text += `- Balance de caja: $${balance.toLocaleString()}\n`;

    if (upcomingTasks.length > 0) {
      text += `\nPRÓXIMAS TAREAS:\n`;
      upcomingTasks.forEach(taskLoc => {
        const task = taskLoc.task;
        text += `- ${task.nombre} | Cliente: ${task.clientName || 'Sin cliente'} | Deadline: ${formatDateTime(task.dueDate)} | Horario: ${formatSchedule(task)}\n`;
      });
    }

    return text;
  };

  // --- SYSTEM PROMPT (Ligero, sin inyección pasiva de estado) ---
  const systemPrompt = `
  ERES EL COO Y CFO DE ESTA AGENCIA. Tu nombre es "Director AI".
  Eres un socio estratégico: conversa con fluidez y mantén un tono profesional pero cercano.
  Motor de IA: GPT OSS 120B (via Groq). Si alguien te pregunta qué modelo eres, responde exactamente: "Soy Director AI, impulsado por GPT OSS 120B en Groq."

  === REGLA DE INTEGRIDAD Y ESTADO ===
  1. NUNCA asumas qué listas, carpetas o proyectos tiene el usuario de memoria.
  2. Si el usuario te hace una pregunta de información (e.g. "¿Qué listas tengo?", "¿qué horario tiene X?", "ordena mis tareas por deadline"), OBLIGATORIAMENTE debes llamar a la herramienta "consultar_estado_app". Usa scope y filtros concretos (projectName, clientName, limit) para no pedir toda la app si no hace falta. No intentes responder usando información del historial porque puede estar desactualizada. Confía SOLO en lo que te devuelva la herramienta.
  3. No reportes que completaste una acción si no usaste la tool correspondiente.
  4. CERO INICIATIVA DESTRUCTIVA: NUNCA elimines carpetas, listas, proyectos ni notas a menos que el usuario te haya dado la orden EXPLÍCITA de eliminar. Si el usuario pide mover archivos, SOLO mueve, NO elimines la carpeta de origen vacía.

  === PREGUNTAS vs COMANDOS ===
  EJEMPLOS DE PREGUNTAS:
  - "q listas tengo" / "qué listas tengo" / "cuáles son mis proyectos" → LLAMA A LA HERRAMIENTA consultar_estado_app
  - "cuántos proyectos tengo" / "dime el balance" → LLAMA A LA HERRAMIENTA consultar_estado_app

  EJEMPLOS DE COMANDOS:
  - "crea una carpeta" / "mueve la lista" / "registra un gasto" → LLAMA A LA HERRAMIENTA CORRECTA (ej. crear_carpeta)

  === REGLAS DE FORMATO (CRÍTICO) ===
  - NUNCA ESTUDIES O PIENSES EN VOZ ALTA. Prohibido escribir frases como "Wait", "Oops", "Let me check", "Ah", "I see", "Actually". Da directamente la respuesta final al usuario.
  - El usuario es tu jefe. NUNCA le muestres tu proceso interno. Expresa todo directamente en español profesional.
  - Respuestas concisas. Usa **negritas** para nombres.
  - Tarifa de agencia: $${rules.baseHourlyRate}/hora | Hoy: ${today.toLocaleDateString('es-ES')}
  `;

  // --- BUCLE DE LOAD BALANCING (ROUND-ROBIN) + FAILOVER SILENCIOSO ---
  const startingIndex = currentGroqKeyIndex;

  for (let attempt = 0; attempt < GROQ_KEYS.length; attempt++) {
    const keyIndex = (startingIndex + attempt) % GROQ_KEYS.length;
    
    // Avanzamos el índice global para que la *siguiente* petición use la siguiente llave
    currentGroqKeyIndex = (keyIndex + 1) % GROQ_KEYS.length;

    const ai = createClient(GROQ_KEYS[keyIndex]);
    console.log(`[ReAct] Intentando con API key #${keyIndex + 1} (Intento ${attempt + 1}/${GROQ_KEYS.length})...`);

  try {
    // TRUNCAR historial a últimos 30 mensajes
    const recentMessages = messages.slice(-12);

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
    const reactMessages: any[] = [
      { role: 'system', content: systemPrompt },
      ...formattedMessages
    ];
    let reactStep = 0;

    while (reactStep < 2) {
      const toolCalls = messageResponse.tool_calls || [];
      const hasConsultarEstado = toolCalls.some(tc => (tc as any).function.name === 'consultar_estado_app');
      if (!hasConsultarEstado) break;

      console.log('🔄 [ReAct] Agente solicitó consultar estado. Interceptando internamente...');

      reactMessages.push({
        role: messageResponse.role,
        content: "",
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: tc.type,
          function: { name: (tc as any).function.name, arguments: (tc as any).function.arguments }
        }))
      });

      toolCalls.forEach(tc => {
        if ((tc as any).function.name === 'consultar_estado_app') {
          let queryArgs: { scope?: string; projectName?: string; clientName?: string; limit?: number; includeCompleted?: boolean } = {};
          try {
            queryArgs = JSON.parse((tc as any).function.arguments || '{}');
          } catch {
            queryArgs = {};
          }
          const estadoApp = buildPlainTextContext(queryArgs);
          reactMessages.push({ role: 'tool', tool_call_id: tc.id, name: "consultar_estado_app", content: estadoApp });
        } else {
          reactMessages.push({ role: 'tool', tool_call_id: tc.id, name: (tc as any).function.name, content: "Delegado. Continúa con la siguiente decisión." });
        }
      });

      console.log(`[ReAct] Iteración silenciosa #${reactStep + 1}...`);
      response = await ai.chat.completions.create({
        model: MODEL,
        messages: reactMessages,
        temperature: 0.1,
        tools: safeTools,
        tool_choice: 'auto'
      });
      messageResponse = response.choices[0].message;
      console.log('[ReAct] Respuesta posterior a consultar estado:', messageResponse);
      reactStep++;
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

    // Limpiamos posibles tags <think> si el modelo las filtra a pesar de todo
    const finalText = (messageResponse.content || "").replace(/<think>[\s\S]*?<\/think>\n*/g, '').trim();

    return { text: finalText, functionCalls };
  } catch (error: any) {
    const errorMsg = error?.error?.message || error?.message || "";
    const isRateLimit = errorMsg.toLowerCase().includes('rate limit') || error?.status === 429;

    // Si es rate-limit y aún nos quedan intentos en este bucle, reintentar silenciosamente con la siguiente
    if (isRateLimit && attempt < GROQ_KEYS.length - 1) {
      console.warn(`⚠️ [Failover] Rate limit en key #${keyIndex + 1}. Cambiando a la siguiente API key...`);
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
