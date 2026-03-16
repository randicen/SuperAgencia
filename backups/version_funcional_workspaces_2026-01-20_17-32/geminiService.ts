
import { GoogleGenAI, Type } from "@google/genai";
import { BusinessRules, Project, Message, Client, SeasonalityData } from "./types";

const tools = [
  {
    functionDeclarations: [
      {
        name: "crear_proyecto",
        description: "Registra un nuevo proyecto. Diferencia entre Tarea IA (Auto) y Evento Fijo.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            clientName: { type: Type.STRING },
            projectName: { type: Type.STRING },
            startDate: { type: Type.STRING, description: "Si autoSchedule=TRUE, es la fecha MÍNIMA de inicio (constraint). Si autoSchedule=FALSE, es el inicio exacto." },
            endDate: { type: Type.STRING },
            totalValue: { type: Type.NUMBER },
            priority: { type: Type.STRING, enum: ["ASAP", "High", "Medium", "Low"] },
            duration: { type: Type.NUMBER, description: "ESFUERZO NETO DE TRABAJO en MINUTOS. (Ej: '2 horas' = 120. '1 día' = 480. '1 semana' = 2400). NO es la duración calendario." },
            deadlineType: { type: Type.STRING, enum: ["Hard Deadline", "Soft Deadline"] },
            dueDate: { type: Type.STRING, description: "Fecha límite real (YYYY-MM-DD)" },
            autoSchedule: { type: Type.BOOLEAN, description: "TRUE = IA decide cuándo (dentro de la ventana). FALSE = Fijo en calendario." },
            elasticity: { type: Type.NUMBER, description: "0 = Tarea Indivisible (Bloque continuo), 1 = Flexible (Divisible)" }
          },
          required: ["clientName", "projectName", "totalValue", "priority", "duration", "deadlineType", "dueDate", "autoSchedule"]
        }
      },
      {
        name: "actualizar_proyecto",
        description: "Modifica un proyecto existente, incluyendo campos de auto-agendamiento y elasticidad.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            clientName: { type: Type.STRING },
            projectName: { type: Type.STRING },
            newProgress: { type: Type.NUMBER },
            newEndDate: { type: Type.STRING },
            newPriority: { type: Type.STRING, enum: ["ASAP", "High", "Medium", "Low"] },
            newTotalValue: { type: Type.NUMBER },
            newDuration: { type: Type.NUMBER },
            newDeadlineType: { type: Type.STRING, enum: ["Hard Deadline", "Soft Deadline"] },
            newDueDate: { type: Type.STRING },
            newAutoSchedule: { type: Type.BOOLEAN },
            newElasticity: { type: Type.NUMBER, description: "0 = Indivisible, 1 = Flexible" }
          },
          required: ["clientName", "projectName"]
        }
      },
      {
        name: "eliminar_proyecto",
        description: "Borra un proyecto específico.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            clientName: { type: Type.STRING },
            projectName: { type: Type.STRING }
          },
          required: ["clientName", "projectName"]
        }
      },
      {
        name: "registrar_transaccion",
        description: "Registra un ingreso o gasto manual en el flujo de caja.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING, description: "Descripción del movimiento" },
            amount: { type: Type.NUMBER, description: "Monto positivo" },
            type: { type: Type.STRING, enum: ["income", "expense"] },
            category: { type: Type.STRING, description: "Categoría (ej: Oficina, Impuestos, Venta)" },
            date: { type: Type.STRING, description: "Fecha YYYY-MM-DD" }
          },
          required: ["description", "amount", "type", "date"]
        }
      },
      {
        name: "crear_cliente",
        description: "Crea un nuevo cliente.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            email: { type: Type.STRING },
            phone: { type: Type.STRING }
          },
          required: ["name"]
        }
      },
      {
        name: "eliminar_cliente",
        description: "Elimina un cliente completo.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING }
          },
          required: ["name"]
        }
      },
      {
        name: "actualizar_cliente",
        description: "Actualiza datos de contacto de un cliente.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            currentName: { type: Type.STRING, description: "Nombre actual para buscar" },
            newName: { type: Type.STRING },
            newEmail: { type: Type.STRING },
            newPhone: { type: Type.STRING }
          },
          required: ["currentName"]
        }
      },
      {
        name: "abrir_calculadora",
        description: "Abre una calculadora visual en la interfaz para que el usuario haga cuentas manuales.",
        parameters: {
          type: Type.OBJECT,
          properties: {},
          required: []
        }
      }
    ]
  }
];

export const calculateQuote = async (
  messages: Message[],
  rules: BusinessRules,
  currentProjects: Project[],
  clients: Client[]
) => {
  // Always use {apiKey: process.env.GEMINI_API_KEY}
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // --- CONTEXT ENGINEERING (Pre-cálculo de inteligencia) ---
  const today = new Date();
  const activeProjects = currentProjects.filter(p => p.status === 'active');

  // 1. Capacidad Operativa
  const capacityPercent = Math.round((activeProjects.length / rules.maxProjectsCapacity) * 100);
  const isOverloaded = capacityPercent >= 80;

  // 2. Próxima fecha libre (estimada)
  const sortedEndDates = activeProjects.map(p => new Date(p.endDate).getTime()).sort((a, b) => a - b);
  const nextFreeDate = sortedEndDates.length > 0 ? new Date(sortedEndDates[0]).toLocaleDateString() : 'HOY';

  // 3. Salud Financiera Rápida
  let totalReceivables = 0;
  clients.forEach(c => c.services.forEach(s => s.installments.forEach(i => { if (i.status === 'PENDIENTE') totalReceivables += i.amount })));

  // Contexto simplificado para la IA (menos ruido JSON)
  const operationalContext = JSON.stringify({
    fecha_actual: today.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    carga_trabajo: `${capacityPercent}% (${activeProjects.length}/${rules.maxProjectsCapacity} proyectos)`,
    disponibilidad: isOverloaded ? `ALERTA: Agenda saturada. Libre aprox: ${nextFreeDate}` : "DISPONIBILIDAD: Alta.",
    flujo_caja_pendiente: `$${totalReceivables}`,
    proyectos_en_curso: activeProjects.map(p => `${p.projectName} (${p.clientName}) - Entrega: ${p.endDate}`)
  }, null, 2);

  const clientsList = clients.map(c => c.name).join(", ");

  const systemPrompt = `
  ERES EL COO (Director Operativo) Y CFO (Director Financiero) DE ESTA AGENCIA UNIPERSONAL.
  Tu nombre es "Director AI".

  === PROTOCOLO DE SILENCIO Y PROFESIONALISMO (STRICT) ===
  1. **PROHIBIDO PENSAR EN VOZ ALTA**: Tu proceso de cálculo y corrección es PRIVADO. Solo entrega el dato final corregido.
  2. **DICCIONARIO DE TRADUCCIÓN OBLIGATORIO**:
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
  A. Usuario: "Me tomará 3 días hacerlo".
     -> Interpretación: **Esfuerzo**.
     -> Cálculo: 3 * 480 = 1440 minutos.
     -> Acción: duration=1440.

  B. Usuario: "Lo necesito para dentro de 3 días".
     -> Interpretación: **Deadline** (DueDate).
     -> Cálculo: Fecha actual + 3 días.
     -> PREGUNTA: "¿Y cuánto tiempo de trabajo real te tomará?" (Si no lo especificó).

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
    const response = await ai.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents: messages.map(m => {
        let textContent = m.content;
        const parts: any[] = [];

        if (m.attachments && m.attachments.length > 0) {
          textContent += "\n\n--- ARCHIVOS ADJUNTOS ---\n";
          m.attachments.forEach(att => {
            if (att.isBinary) {
              parts.push({ inlineData: { mimeType: att.type, data: att.content } });
            } else {
              textContent += `\n[Archivo: ${att.name}]\n${att.content}\n`;
            }
          });
        }

        if (textContent && textContent.trim() !== "") {
          parts.push({ text: textContent });
        } else if (parts.length === 0) {
          parts.push({ text: "." });
        }

        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: parts
        };
      }),
      config: { systemInstruction: systemPrompt, temperature: 0.1, tools }
    });
    return { text: response.text, functionCalls: response.functionCalls };
  } catch (error) {
    console.error("Gemini API Error:", error);
    return { text: "⚠️ **Error de conexión**\n\nParece que perdí conexión con el servidor central. Por favor verifica tu API Key o intenta de nuevo en un momento." };
  }
};

export const analyzeSeasonality = async (s: SeasonalityData[], p: Project[]) => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [{ parts: [{ text: `Analiza estacionalidad y dame 3 consejos cortos: ${JSON.stringify(s)}` }] }]
    });
    return response.text;
  } catch (e) { return "No se pudo generar el análisis."; }
};
