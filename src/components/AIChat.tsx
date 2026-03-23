
import React, { useState, useRef, useEffect } from 'react';
import { Project, BusinessRules, Message, Transaction, Priority, Client, Attachment, ChatSession, Note } from '../types';
import { calculateQuote } from '../aiService';
import { useSpaces } from '../contexts/SpacesContext';

interface AIChatProps {
  projects: Project[];
  clients: Client[];
  transactions?: Transaction[];
  rules: BusinessRules;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  onAddProject: (p: Project) => void;
  onUpdateProject: (p: Project) => void;
  onAddTransaction: (t: Transaction) => void;
  onDeleteTransaction?: (id: string) => void;
  onUpdateClients: (clients: Client[]) => void;
  onDeleteProject: (id: string) => void;
  onDeleteClient: (id: string) => void;
  chatSessions?: ChatSession[];
  currentChatId?: string;
  onNewChat?: () => void;
  onSelectChat?: (id: string) => void;
  onDeleteChat?: (id: string) => void;
  notes?: Note[];
  onSaveNote?: (note: Note) => void;
  onDeleteNote?: (id: string) => void;
  incomingNote?: Note | null; 
}

const AIChat: React.FC<AIChatProps> = ({ 
  projects, clients, transactions = [], rules, messages, setMessages, 
  onAddProject, onUpdateProject, onAddTransaction, onDeleteTransaction, onUpdateClients,
  onDeleteProject, onDeleteClient,
  chatSessions, currentChatId, onNewChat, onSelectChat, onDeleteChat,
  notes = [], onSaveNote, onDeleteNote, incomingNote
}) => {
  const { state: spacesState, dispatch: spacesDispatch } = useSpaces();
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [editingAction, setEditingAction] = useState<{msgIdx: number, actionIdx: number} | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showHistory, setShowHistory] = useState(false); 
  const [showNoteSelector, setShowNoteSelector] = useState(false); 
  
  const [showManualForm, setShowManualForm] = useState(false);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [manualData, setManualData] = useState({
    clientName: '',
    projectName: '',
    totalValue: 0,
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    priority: Priority.MEDIUM,
    duration: 60,
    deadlineType: 'Soft Deadline' as 'Hard Deadline' | 'Soft Deadline',
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    autoSchedule: true,
    elasticity: 1 // 1 = Flexible, 0 = Rigid
  });

  const [showCalculator, setShowCalculator] = useState(false);
  const [calcDisplay, setCalcDisplay] = useState('');
  const [calcHistory, setCalcHistory] = useState<{formula: string, label: string}[]>([]);
  const [exportedId, setExportedId] = useState<number | null>(null); 

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (incomingNote) {
        const exists = attachments.some(a => a.name === `Nota: ${incomingNote.title}` && a.content === incomingNote.content);
        if (!exists) {
            setAttachments(prev => [...prev, {
                name: `Nota: ${incomingNote.title}`,
                type: 'application/text', 
                content: incomingNote.content,
                isBinary: false
            }]);
        }
    }
  }, [incomingNote]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isTyping]);

  const findClientByName = (name: string) => {
    return clients.find(c => c.name.toLowerCase().trim() === name.toLowerCase().trim());
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = async (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files && e.dataTransfer.files.length > 0) { await processFiles(Array.from(e.dataTransfer.files)); } };
  const handleFileClick = () => { fileInputRef.current?.click(); };
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files && e.target.files.length > 0) { await processFiles(Array.from(e.target.files)); if (fileInputRef.current) fileInputRef.current.value = ''; } };

  const processFiles = async (files: File[]) => {
      const newAttachments: Attachment[] = [];
      for (const file of files) {
          if (file.size > 5 * 1024 * 1024) {
              alert(`El archivo ${file.name} es demasiado grande. Máx 5MB.`);
              continue;
          }
          try {
              let content = '';
              let isBinary = false;
              if (file.type.startsWith('image/') || file.type.startsWith('audio/')) {
                  const base64Url = await readFileAsBase64(file);
                  content = base64Url.split(',')[1];
                  isBinary = true;
              } else {
                  content = await readFileAsText(file);
                  isBinary = false;
              }
              newAttachments.push({ name: file.name, type: file.type, content: content, isBinary: isBinary });
          } catch (err) { console.error("Error leyendo archivo", err); }
      }
      setAttachments(prev => [...prev, ...newAttachments]);
  };

  const attachNote = (note: Note) => { setAttachments(prev => [...prev, { name: `Nota: ${note.title}`, type: 'application/text', content: note.content, isBinary: false }]); setShowNoteSelector(false); };
  const readFileAsText = (file: File): Promise<string> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = (e) => resolve(e.target?.result as string); reader.onerror = (e) => reject(e); reader.readAsText(file); });
  const readFileAsBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = (e) => resolve(e.target?.result as string); reader.onerror = (e) => reject(e); reader.readAsDataURL(file); });
  const removeAttachment = (index: number) => { setAttachments(prev => prev.filter((_, i) => i !== index)); };

  const handleExportToNote = (content: string, titlePrefix = "Nota AI") => {
      if (!onSaveNote) return;
      const title = prompt("Título para la nueva nota:", `${titlePrefix} - ${new Date().toLocaleDateString()}`);
      if (title) { onSaveNote({ id: Math.random().toString(36).substr(2, 9), title, content, lastModified: Date.now() }); alert("Nota guardada en la libreta."); }
  };

  const getStatusFromProgress = (progress: number): 'proposal' | 'active' | 'completed' => {
    if (progress <= 0) return 'proposal';
    if (progress >= 100) return 'completed';
    return 'active';
  };

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || isTyping) return;
    const userMessage: Message = { role: 'user', content: input, timestamp: new Date(), attachments: attachments.length > 0 ? [...attachments] : undefined };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setAttachments([]);
    setIsTyping(true);
    try {
      const response = await calculateQuote(newMessages, rules, projects, clients, spacesState.workspaces, notes, transactions);
      const text = response.text || (response.functionCalls && response.functionCalls.length > 0 ? "🔄 Preparando acción..." : "");
      const assistantMessage: Message = { role: 'assistant', content: text, timestamp: new Date(), pendingActions: response.functionCalls };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) { setMessages(prev => [...prev, { role: 'assistant', content: "Error de red.", timestamp: new Date() }]); } finally { setIsTyping(false); }
  };

  const executeAction = (action: any, processedIds?: Set<string>) => {
    const args = action.args || {}; 
    if (action.name === 'abrir_calculadora') { setShowCalculator(true); }
    
    // --- PROYECTOS ---
    if (action.name === 'crear_proyecto') {
      const taskId = Math.random().toString(36).substr(2, 9);
      let existingClient = findClientByName(args.clientName);
      const clientId = existingClient ? existingClient.id : Math.random().toString(36).substr(2, 9);
      
      // Auto-assign to first available Space and List (or a fallback space needs to be created, ideally already exists)
      const workspace = spacesState.workspaces[0];
      if (workspace && workspace.espacios.length > 0) {
          const space = workspace.espacios[0];
          const list = space.listas[0] || (space.carpetas[0]?.listas[0]);
          if (list) {
              spacesDispatch({
                  type: 'ADD_TASK',
                  payload: {
                      spaceId: space.id,
                      listId: list.id,
                      folderId: space.carpetas[0]?.listas[0] ? space.carpetas[0].id : undefined,
                      task: {
                          id: taskId,
                          clientId,
                          clientName: existingClient?.name || args.clientName,
                          nombre: args.projectName,
                          startDate: args.startDate || new Date().toISOString().split('T')[0],
                          endDate: args.endDate || new Date().toISOString().split('T')[0],
                          priority: args.priority || 'Medium',
                          progress: 0,
                          totalValue: args.totalValue || 0,
                          estado: 'TODO',
                          duration: args.duration || 60,
                          deadlineType: args.deadlineType || 'Soft Deadline',
                          dueDate: args.dueDate || args.endDate || new Date().toISOString().split('T')[0],
                          autoSchedule: args.autoSchedule !== undefined ? args.autoSchedule : false,
                          elasticity: args.elasticity !== undefined ? args.elasticity : 1,
                          orden: Date.now()
                      }
                  }
              });
          }
      }
      
      if (!existingClient) { onUpdateClients([...clients, { id: clientId, name: args.clientName, email: '', phone: '' }]); }
    }
    
    // Find task helper for actions
    const findTaskLocationByClientAndName = (clientName: string, taskName: string) => {
        let foundLoc: any = null;
        spacesState.workspaces.forEach(ws => {
            ws.espacios.forEach(space => {
                space.listas.forEach(list => {
                    const t = list.tareas.find(t => t.clientName?.toLowerCase() === clientName.toLowerCase() && t.nombre.toLowerCase().includes(taskName.toLowerCase()));
                    if (t) foundLoc = { spaceId: space.id, listId: list.id, task: t };
                });
                space.carpetas.forEach(folder => {
                    folder.listas.forEach(list => {
                        const t = list.tareas.find(t => t.clientName?.toLowerCase() === clientName.toLowerCase() && t.nombre.toLowerCase().includes(taskName.toLowerCase()));
                        if (t) foundLoc = { spaceId: space.id, folderId: folder.id, listId: list.id, task: t };
                    });
                });
            });
        });
        return foundLoc;
    };

    if (action.name === 'actualizar_proyecto' || action.name === 'actualizar_estado_proyecto') {
        const { clientName, projectName, newProgress, newEndDate, newPriority, newTotalValue, newDuration, newDeadlineType, newDueDate, newAutoSchedule, newElasticity, status } = args;
        const loc = findTaskLocationByClientAndName(clientName, projectName);
        
        if (loc) {
            const updated = { ...loc.task };
            if (newProgress !== undefined) { updated.progress = newProgress; updated.estado = getStatusFromProgress(newProgress) === 'completed' ? 'DONE' : 'ACTIVE'; }
            if (status) updated.estado = status === 'completed' ? 'DONE' : status === 'active' ? 'ACTIVE' : 'TODO';
            if (newEndDate) updated.endDate = newEndDate;
            if (newPriority) updated.priority = newPriority;
            if (newTotalValue !== undefined) updated.totalValue = newTotalValue;
            if (newDuration !== undefined) updated.duration = newDuration;
            if (newDeadlineType) updated.deadlineType = newDeadlineType;
            if (newDueDate) updated.dueDate = newDueDate;
            if (newAutoSchedule !== undefined) updated.autoSchedule = newAutoSchedule;
            if (newElasticity !== undefined) updated.elasticity = newElasticity;
            
            spacesDispatch({
                type: 'UPDATE_TASK',
                payload: { spaceId: loc.spaceId, folderId: loc.folderId, listId: loc.listId, task: updated }
            });
        }
    }
    
    if (action.name === 'eliminar_proyecto') {
      const { clientName, projectName } = args;
      const loc = findTaskLocationByClientAndName(clientName, projectName);
      if (loc) { 
          spacesDispatch({
              type: 'DELETE_TASK',
              payload: { spaceId: loc.spaceId, folderId: loc.folderId, listId: loc.listId, task: loc.task }
          });
      }
    }

    // --- TRANSACCIONES ---
    if (action.name === 'registrar_transaccion') {
        const { description, amount, type, category, date } = args;
        onAddTransaction({ id: Math.random().toString(36).substr(2, 9), date: date || new Date().toISOString().split('T')[0], description, amount, type, category, isPredictive: false });
    }
    if (action.name === 'eliminar_transaccion') {
        const { id, description } = args;
        if (id && onDeleteTransaction) {
            onDeleteTransaction(id);
        } else if (description && onDeleteTransaction) {
            const t = transactions.find(tx => tx.description.toLowerCase().includes(description.toLowerCase()));
            if (t) onDeleteTransaction(t.id);
        }
    }

    // --- CLIENTES ---
    if (action.name === 'crear_cliente') {
        const { name, email, phone } = args;
        if (!findClientByName(name)) { onUpdateClients([...clients, { id: Math.random().toString(36).substr(2, 9), name, email: email || '', phone: phone || '' }]); }
    }
    if (action.name === 'eliminar_cliente') { const client = findClientByName(args.name); if (client) onDeleteClient(client.id); }
    if (action.name === 'actualizar_cliente') {
        const { currentName, newName, newEmail, newPhone } = args;
        const client = findClientByName(currentName);
        if (client) { onUpdateClients(clients.map(c => c.id === client.id ? { ...c, name: newName || c.name, email: newEmail || c.email, phone: newPhone || c.phone } : c)); }
    }

    // --- NOTAS ---
    if (action.name === 'crear_nota') {
        if (onSaveNote) onSaveNote({ id: Math.random().toString(36).substr(2, 9), title: args.title, content: args.content, tags: args.tags || [], lastModified: Date.now() });
    }
    if (action.name === 'actualizar_nota') {
        const note = notes.find(n => n.title.toLowerCase().trim() === args.title.toLowerCase().trim());
        if (note && onSaveNote) {
            onSaveNote({ ...note, title: args.newTitle || note.title, content: args.newContent || note.content, lastModified: Date.now() });
        }
    }
    if (action.name === 'eliminar_nota') {
        const note = notes.find(n => n.title.toLowerCase().trim() === args.title.toLowerCase().trim());
        if (note && onDeleteNote) onDeleteNote(note.id);
    }

    // --- WORKSPACES (ALTO NIVEL) ---
    if (action.name === 'crear_workspace') {
        spacesDispatch({ type: 'ADD_WORKSPACE', payload: { nombre: args.nombre } });
    }
    if (action.name === 'eliminar_workspace') {
        const ws = spacesState.workspaces.find(w => w.nombre.toLowerCase().trim() === args.nombre.toLowerCase().trim());
        if (ws) spacesDispatch({ type: 'DELETE_WORKSPACE', payload: { workspaceId: ws.id } });
    }
    if (action.name === 'renombrar_workspace') {
        const ws = spacesState.workspaces.find(w => w.nombre.toLowerCase().trim() === args.nombreActual.toLowerCase().trim());
        if (ws) spacesDispatch({ type: 'RENAME_WORKSPACE', payload: { workspaceId: ws.id, nombre: args.nuevoNombre } });
    }

    // --- SPACES (SECCIONES DEL SIDEBAR) ---
    if (action.name === 'crear_space') {
        spacesDispatch({ type: 'ADD_SPACE', payload: { nombre: args.nombre, color: args.color || '#3b82f6' } });
    }
    const activeWS = spacesState.workspaces.find(w => w.id === spacesState.activeWorkspaceId);
    if (activeWS) {
        if (action.name === 'eliminar_space') {
            const space = activeWS.espacios.find(s => s.nombre.toLowerCase().trim() === args.nombre.toLowerCase().trim());
            if (space) spacesDispatch({ type: 'DELETE_SPACE', payload: { spaceId: space.id } });
        }
        if (action.name === 'renombrar_space') {
            const space = activeWS.espacios.find(s => s.nombre.toLowerCase().trim() === args.nombreActual.toLowerCase().trim());
            if (space) spacesDispatch({ type: 'RENAME_SPACE', payload: { spaceId: space.id, nombre: args.nuevoNombre } });
        }
    }

    // --- CARPETAS Y LISTAS ---
    if (activeWS) {
        const findSpace = (name: string) => activeWS.espacios.find(s => s.nombre.toLowerCase().trim() === name.toLowerCase().trim());
        
        if (action.name === 'crear_carpeta') {
            const space = findSpace(args.espacioNombre);
            if (space) spacesDispatch({ type: 'ADD_FOLDER', payload: { spaceId: space.id, nombre: args.nombre } });
        }
        if (action.name === 'crear_lista') {
            const space = findSpace(args.espacioNombre);
            if (space) {
                let folderId = undefined;
                if (args.carpetaNombre) {
                    const folder = space.carpetas.find(f => f.nombre.toLowerCase().trim() === args.carpetaNombre.toLowerCase().trim());
                    if (folder) folderId = folder.id;
                }
                spacesDispatch({ type: 'ADD_LIST', payload: { spaceId: space.id, folderId, nombre: args.nombre } });
            }
        }
        if (action.name === 'renombrar_carpeta') {
            const space = findSpace(args.espacioNombre);
            const folder = space?.carpetas.find(f => f.nombre.toLowerCase().trim() === args.carpetaActualNombre.toLowerCase().trim());
            if (space && folder) spacesDispatch({ type: 'RENAME_FOLDER', payload: { spaceId: space.id, folderId: folder.id, nombre: args.nuevoNombre } });
        }
        if (action.name === 'eliminar_carpeta') {
            const space = findSpace(args.espacioNombre);
            const folder = space?.carpetas.find(f => f.nombre.toLowerCase().trim() === args.carpetaNombre.toLowerCase().trim() && !(processedIds?.has(f.id)));
            if (space && folder) {
                if (processedIds) processedIds.add(folder.id);
                spacesDispatch({ type: 'DELETE_FOLDER', payload: { spaceId: space.id, folderId: folder.id } });
            }
        }
        if (action.name === 'renombrar_lista') {
            const space = findSpace(args.espacioNombre);
            if (space) {
                let listId = '';
                let folderId = undefined;
                if (args.carpetaNombre) {
                    const folder = space.carpetas.find(f => f.nombre.toLowerCase().trim() === args.carpetaNombre.toLowerCase().trim());
                    const list = folder?.listas.find(l => l.nombre.toLowerCase().trim() === args.listaActualNombre.toLowerCase().trim());
                    if (list) { listId = list.id; folderId = folder!.id; }
                } else {
                    const list = space.listas.find(l => l.nombre.toLowerCase().trim() === args.listaActualNombre.toLowerCase().trim());
                    if (list) listId = list.id;
                }
                if (listId) spacesDispatch({ type: 'RENAME_LIST', payload: { spaceId: space.id, folderId, listId, nombre: args.nuevoNombre } });
            }
        }
        if (action.name === 'eliminar_lista') {
            const space = findSpace(args.espacioNombre);
            if (space) {
                let listId = '';
                let folderId = undefined;
                if (args.carpetaNombre) {
                    const folder = space.carpetas.find(f => f.nombre.toLowerCase().trim() === args.carpetaNombre.toLowerCase().trim());
                    const list = folder?.listas.find(l => l.nombre.toLowerCase().trim() === args.listaNombre.toLowerCase().trim() && !(processedIds?.has(l.id)));
                    if (list) { listId = list.id; folderId = folder!.id; }
                } else {
                    const list = space.listas.find(l => l.nombre.toLowerCase().trim() === args.listaNombre.toLowerCase().trim() && !(processedIds?.has(l.id)));
                    if (list) listId = list.id;
                }
                if (listId) {
                    if (processedIds) processedIds.add(listId);
                    spacesDispatch({ type: 'DELETE_LIST', payload: { spaceId: space.id, folderId, listId } });
                }
            }
        }

        if (action.name === 'mover_lista') {
            const space = findSpace(args.espacioNombre);
            if (space) {
                let listId = '';
                let sourceFolderId: string | undefined;

                // Find the list in source (folder or root)
                if (args.carpetaOrigenNombre) {
                    const srcFolder = space.carpetas.find(f => f.nombre.toLowerCase().trim() === args.carpetaOrigenNombre.toLowerCase().trim());
                    const list = srcFolder?.listas.find(l => l.nombre.toLowerCase().trim() === args.listaNombre.toLowerCase().trim() && !(processedIds?.has(l.id)));
                    if (list && srcFolder) { listId = list.id; sourceFolderId = srcFolder.id; }
                } else {
                    const list = space.listas.find(l => l.nombre.toLowerCase().trim() === args.listaNombre.toLowerCase().trim() && !(processedIds?.has(l.id)));
                    if (list) listId = list.id;
                }

                const targetFolder = space.carpetas.find(f => f.nombre.toLowerCase().trim() === args.carpetaDestinoNombre.toLowerCase().trim());

                if (listId && targetFolder) {
                    if (processedIds) processedIds.add(listId);
                    spacesDispatch({ type: 'MOVE_LIST', payload: { spaceId: space.id, listId, sourceFolderId, targetFolderId: targetFolder.id } });
                }
            }
        }

        if (action.name === 'crear_tarea') {
            const space = findSpace(args.espacioNombre);
            if (space) {
                let listId = '';
                let folderId = undefined;
                
                if (args.carpetaNombre) {
                    const folder = space.carpetas.find(f => f.nombre.toLowerCase().trim() === args.carpetaNombre.toLowerCase().trim());
                    if (folder) {
                        folderId = folder.id;
                        const list = folder.listas.find(l => l.nombre.toLowerCase().trim() === args.listaNombre.toLowerCase().trim());
                        if (list) listId = list.id;
                    }
                } else {
                    const list = space.listas.find(l => l.nombre.toLowerCase().trim() === args.listaNombre.toLowerCase().trim());
                    if (list) listId = list.id;
                }

                if (listId) {
                    spacesDispatch({
                        type: 'ADD_TASK',
                        payload: {
                            spaceId: space.id,
                            folderId,
                            listId,
                            task: {
                                nombre: args.nombre,
                                estado: 'TODO',
                                progress: 0,
                                priority: args.priority || 'Medium',
                                duration: args.duration || 60,
                                dueDate: args.dueDate || new Date().toISOString().split('T')[0],
                                autoSchedule: args.autoSchedule !== undefined ? args.autoSchedule : true,
                                elasticity: args.elasticity !== undefined ? args.elasticity : 1,
                                deadlineType: 'Soft Deadline'
                            }
                        }
                    });
                }
            }
        }
    }
  };

  const handleConfirmActions = (msgIdx: number) => {
    const msg = messages[msgIdx];
    if (msg.pendingActions) {
      const processedIds = new Set<string>();
      msg.pendingActions.forEach(action => executeAction(action, processedIds));
      
      const summary = msg.pendingActions.map(a => `✅ **Ejecutado:** ${a.name.replace(/_/g, ' ')}`).join('\n');
      
      setMessages(prev => {
        const newMessages = [...prev];
        const updatedMsg = { 
          ...msg, 
          executedActions: [...(msg.executedActions || []), ...msg.pendingActions!],
          pendingActions: undefined 
        };
        
        // Si el contenido era solo el placeholder, lo reemplazamos por el resumen
        if (updatedMsg.content === "🔄 Preparando acción...") {
            updatedMsg.content = summary;
        } else {
            updatedMsg.content += `\n\n${summary}`;
        }
        
        newMessages[msgIdx] = updatedMsg;
        return newMessages;
      });
    }
  };

  const handleCalcInput = (char: string) => { if (char === 'C') { setCalcDisplay(''); } else if (char === 'DEL') { setCalcDisplay(prev => prev.slice(0, -1)); } else if (char === '=') { try { const result = new Function('return ' + calcDisplay)(); setCalcHistory(prev => [{formula: `${calcDisplay} = ${result}`, label: ''}, ...prev].slice(0, 15)); setCalcDisplay(String(result)); } catch (e) { setCalcDisplay('Error'); setTimeout(() => setCalcDisplay(''), 1000); } } else { setCalcDisplay(prev => prev + char); } };
  const updateCalcLabel = (index: number, label: string) => { setCalcHistory(prev => prev.map((item, i) => i === index ? { ...item, label } : item)); };
  const exportCalculation = (item: {formula: string, label: string}, index: number) => { if (!onSaveNote) return; onSaveNote({ id: Math.random().toString(36).substr(2, 9), title: item.label ? `Cálculo: ${item.label}` : `Cálculo: ${item.formula}`, content: `Operación: ${item.formula}\nFecha: ${new Date().toLocaleString()}`, lastModified: Date.now() }); setExportedId(index); setTimeout(() => setExportedId(null), 1500); };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualData.clientName || !manualData.projectName) return;
    const projectId = Math.random().toString(36).substr(2, 9);
    let existingClient = findClientByName(manualData.clientName);
    const clientId = existingClient ? existingClient.id : Math.random().toString(36).substr(2, 9);
    
    onAddProject({ 
        id: projectId, 
        clientId, 
        clientName: existingClient?.name || manualData.clientName, 
        projectName: manualData.projectName, 
        startDate: manualData.startDate, 
        endDate: manualData.endDate, 
        priority: manualData.priority as Priority, 
        progress: 0, 
        totalValue: manualData.totalValue, 
        paidValue: 0, 
        status: 'proposal', 
        duration: manualData.duration, 
        deadlineType: manualData.deadlineType, 
        dueDate: manualData.dueDate, 
        autoSchedule: manualData.autoSchedule,
        elasticity: manualData.elasticity
    });
    
    if (!existingClient) { onUpdateClients([...clients, { id: clientId, name: manualData.clientName, email: '', phone: '' }]); }
    setMessages(prev => [...prev, { role: 'assistant', content: `✅ **Registro Manual Exitoso**\nHe creado el ${manualData.autoSchedule ? 'Proyecto Inteligente' : 'Evento Fijo'} "${manualData.projectName}".`, timestamp: new Date() }]);
    setShowManualForm(false);
  };

  // Helper Simple para formatear texto (Negritas y Saltos de línea)
  const formatMessageText = (text: string) => {
      if (!text) return "";
      // Reemplazar **texto** por <b>texto</b>
      const bolded = text.replace(/\*\*(.*?)\*\*/g, '<b class="font-black text-slate-800">$1</b>');
      return bolded;
  };

  // --- TRADUCCIÓN VISUAL DE ARGUMENTOS (Hiding the machinery) ---
  const humanizeLabel = (key: string) => {
      const map: Record<string, string> = {
          clientName: 'Cliente',
          projectName: 'Proyecto',
          totalValue: 'Valor Total',
          duration: 'Esfuerzo Estimado',
          dueDate: 'Fecha Entrega',
          startDate: 'Fecha Inicio',
          autoSchedule: 'Agendamiento',
          elasticity: 'Modalidad Trabajo',
          priority: 'Prioridad',
          deadlineType: 'Tipo Deadline',
          description: 'Concepto',
          amount: 'Monto'
      };
      return map[key] || key;
  };

  const humanizeValue = (key: string, value: any) => {
      if (key === 'duration') {
          const h = Number(value) / 60;
          return `${h} Horas (${value} min)`;
      }
      if (key === 'totalValue' || key === 'amount') return `$${Number(value).toLocaleString()}`;
      if (key === 'autoSchedule') return value ? 'Automático (IA)' : 'Fijo en Calendario';
      if (key === 'elasticity') return value === 0 ? 'Bloque Indivisible (Rígido)' : 'Flexible (Por bloques)';
      if (key === 'priority') {
          const colors = { 'ASAP': '🔴 ASAP', 'High': '🟠 Alta', 'Medium': '🔵 Media', 'Low': '🟢 Baja' };
          return (colors as any)[value] || value;
      }
      return String(value);
  };

  return (
    <div className="flex h-[calc(100vh-140px)] gap-4">
      <div className={`transition-all duration-300 overflow-hidden bg-white rounded-3xl border border-slate-200 shadow-xl flex flex-col ${showHistory ? 'w-64 opacity-100' : 'w-0 opacity-0 border-0'}`}>
         <div className="p-4 border-b bg-slate-50 flex items-center justify-between shrink-0">
             <h3 className="font-black text-xs text-slate-500 uppercase tracking-widest">Historial</h3>
             <button onClick={() => { if(onNewChat) onNewChat(); }} className="text-blue-600 hover:bg-blue-50 p-1.5 rounded-lg transition-colors"><i className="fa-solid fa-pen-to-square"></i></button>
         </div>
         <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
             {chatSessions && chatSessions.sort((a,b) => b.lastModified - a.lastModified).map(session => (
                 <div key={session.id} onClick={() => { if(onSelectChat) onSelectChat(session.id); }} className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${currentChatId === session.id ? 'bg-blue-50 border border-blue-100' : 'hover:bg-slate-50 border border-transparent'}`}>
                     <div className="flex items-center gap-3 overflow-hidden"><i className="fa-regular fa-message text-slate-400 text-xs shrink-0"></i><span className={`text-xs font-bold truncate ${currentChatId === session.id ? 'text-blue-700' : 'text-slate-600'}`}>{session.title || 'Nuevo Chat'}</span></div>
                     {chatSessions.length > 1 && <button onClick={(e) => { e.stopPropagation(); if(onDeleteChat) onDeleteChat(session.id); }} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity px-1"><i className="fa-solid fa-trash text-[10px]"></i></button>}
                 </div>
             ))}
         </div>
      </div>

      <div className={`flex-1 flex flex-col bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-2xl relative transition-all ${isDragging ? 'ring-4 ring-blue-500/30 bg-blue-50/10' : ''}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        {isDragging && <div className="absolute inset-0 bg-blue-500/10 backdrop-blur-sm z-50 flex items-center justify-center border-4 border-blue-500 border-dashed rounded-3xl m-2"><div className="text-center animate-bounce"><i className="fa-solid fa-cloud-arrow-up text-6xl text-blue-600 mb-4"></i><h3 className="text-2xl font-black text-blue-700 uppercase tracking-tight">Suelta tus archivos aquí</h3></div></div>}

        <div className="p-5 border-b bg-slate-50/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3"><button onClick={() => setShowHistory(!showHistory)} className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${showHistory ? 'bg-slate-200 text-slate-600' : 'hover:bg-slate-200 text-slate-400'}`}><i className="fa-solid fa-bars"></i></button><div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-200"><i className="fa-solid fa-robot"></i></div><div><h3 className="font-black text-slate-800 uppercase text-[10px] tracking-widest">Director Operativo AI</h3><span className="text-[9px] text-green-500 font-black flex items-center gap-1"><span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span> CONTEXTO ACTIVO</span></div></div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/20 custom-scrollbar relative">
          {messages.length === 0 && <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300 pointer-events-none p-10 text-center"><i className="fa-brands fa-rocketchat text-6xl mb-4 opacity-50"></i><p className="font-black text-lg uppercase">¿En qué trabajamos hoy?</p></div>}
          {messages.map((m, idx) => (
            <div key={idx} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} animate-in slide-in-from-bottom-2`}>
              <div className={`max-w-[85%] rounded-[2rem] p-6 shadow-sm border ${m.role === 'user' ? 'bg-slate-900 text-white border-slate-800 rounded-tr-none' : 'bg-white border-slate-100 rounded-tl-none'} relative group`}>
                {m.role === 'assistant' && onSaveNote && <button onClick={() => handleExportToNote(m.content)} className="absolute -top-3 -right-2 bg-white text-slate-500 hover:text-blue-600 w-6 h-6 rounded-full border border-slate-200 shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-10"><i className="fa-solid fa-bookmark text-[10px]"></i></button>}
                {m.attachments && m.attachments.length > 0 && <div className="flex flex-wrap gap-2 mb-3 pb-3 border-b border-white/20">{m.attachments.map((att, i) => <div key={i} className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-lg text-xs font-medium max-w-full"><i className="fa-solid fa-file-lines text-blue-300"></i><span className="truncate max-w-[150px]">{att.name}</span></div>)}</div>}
                
                {/* Visualizador de Texto Mejorado con HTML Seguro */}
                <div 
                    className="text-sm font-medium leading-relaxed whitespace-pre-wrap"
                    dangerouslySetInnerHTML={{ __html: formatMessageText(m.content) }}
                ></div>

                {m.pendingActions && m.pendingActions.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-slate-100 space-y-4 w-full">
                    {m.pendingActions.map((action: any, i: number) => {
                        if (!action || !action.name) return null;
                        return (
                          <div key={i} className="p-4 rounded-2xl border bg-slate-50 border-slate-200">
                              <div className="flex items-center gap-3 mb-3">
                                  <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-xs"><i className="fa-solid fa-bolt"></i></div>
                                  <span className="text-[10px] font-black uppercase text-slate-800">{action.name.replace(/_/g, ' ')}</span>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {Object.entries(action.args || {}).map(([k, v]: any) => (
                                      <div key={k} className="flex flex-col bg-white p-2 rounded-lg border border-slate-100">
                                          <span className="text-[8px] font-black text-slate-400 uppercase mb-0.5">{humanizeLabel(k)}</span>
                                          <span className="text-[10px] font-bold text-slate-700 truncate">{humanizeValue(k, v)}</span>
                                      </div>
                                  ))}
                              </div>
                          </div>
                        );
                    })}
                    <div className="flex gap-3">
                      <button 
                        onClick={() => handleConfirmActions(idx)} 
                        className="flex-1 bg-blue-600 text-white py-4 rounded-2xl font-black text-[10px] uppercase shadow-xl hover:bg-blue-700 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                      >
                        <i className="fa-solid fa-check"></i>
                        Confirmar Acción
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isTyping && <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest animate-pulse ml-2">Pensando...</div>}
          <div ref={chatEndRef} />
        </div>

        <div className="p-6 bg-white border-t space-y-3 shrink-0">
          <div className="flex justify-end gap-2">
              <button onClick={() => setShowCalculator(true)} className="text-[10px] font-black text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg hover:bg-slate-200 flex items-center gap-2"><i className="fa-solid fa-calculator"></i> Calculadora</button>
              <button onClick={() => setShowManualForm(true)} className="text-[10px] font-black text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2"><i className="fa-solid fa-bolt"></i> Registro Manual</button>
          </div>
          <div className="bg-slate-50 p-2 rounded-[1.5rem] border focus-within:ring-4 ring-blue-500/10 transition-all flex items-center">
                  <input type="file" ref={fileInputRef} className="hidden" multiple onChange={handleFileChange} />
                  <button onClick={handleFileClick} className="w-10 h-10 ml-1 rounded-2xl text-slate-400 hover:text-blue-600 transition-all flex items-center justify-center flex-shrink-0"><i className="fa-solid fa-paperclip text-lg"></i></button>
                  <button onClick={() => setShowNoteSelector(true)} className="w-10 h-10 rounded-2xl text-slate-400 hover:text-yellow-600 transition-all flex items-center justify-center flex-shrink-0"><i className="fa-solid fa-note-sticky text-lg"></i></button>
                  <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} placeholder="Escribe o arrastra archivos aquí..." className="flex-1 bg-transparent px-2 outline-none font-bold text-sm text-slate-700 h-10" />
                  <button onClick={handleSend} disabled={(!input.trim() && attachments.length === 0) || isTyping} className="bg-blue-600 text-white w-12 h-10 rounded-2xl flex items-center justify-center shadow-lg disabled:bg-slate-200 transition-all"><i className="fa-solid fa-paper-plane"></i></button>
          </div>
        </div>

        {showManualForm && (
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowManualForm(false)}>
              <form onSubmit={handleManualSubmit} className="bg-white w-full max-w-xl rounded-[2rem] shadow-2xl p-8 space-y-6 animate-in zoom-in-95" onClick={(e) => { e.stopPropagation(); setShowClientSuggestions(false); }}>
                  <h3 className="text-2xl font-black text-slate-800 tracking-tighter uppercase mb-4">Registro Manual</h3>
                  
                  <div className="flex bg-slate-100 p-1.5 rounded-2xl mb-4">
                        <button type="button" onClick={() => setManualData({...manualData, autoSchedule: true})} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${manualData.autoSchedule ? 'bg-white text-blue-600 shadow-md' : 'text-slate-400'}`}>Tarea IA</button>
                        <button type="button" onClick={() => setManualData({...manualData, autoSchedule: false})} className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${!manualData.autoSchedule ? 'bg-white text-orange-600 shadow-md' : 'text-slate-400'}`}>Evento Fijo</button>
                  </div>

                  <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <Input label="Cliente" value={manualData.clientName} onChange={v => setManualData({...manualData, clientName: v})} />
                          <Input label="Proyecto / Tarea" value={manualData.projectName} onChange={v => setManualData({...manualData, projectName: v})} />
                      </div>

                      {manualData.autoSchedule ? (
                          <>
                          <div className="grid grid-cols-2 gap-4">
                              <Input label="Fecha Límite (Due Date)" type="date" value={manualData.dueDate} onChange={v => setManualData({...manualData, dueDate: v})} />
                              <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase">Deadline</label><select className="w-full p-3 bg-slate-50 border rounded-xl text-xs font-bold" value={manualData.deadlineType} onChange={e => setManualData({...manualData, deadlineType: e.target.value as any})}><option value="Soft Deadline">Soft Deadline</option><option value="Hard Deadline">Hard Deadline</option></select></div>
                          </div>
                          {/* Elasticity Toggle */}
                          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                             <div>
                                 <p className="text-[9px] font-black text-slate-500 uppercase">Elasticidad de Tarea</p>
                                 <p className="text-[8px] text-slate-400 font-bold">{manualData.elasticity === 1 ? 'La tarea puede ser realizada en momentos separados' : 'La tarea se realiza de seguido'}</p>
                             </div>
                             <button type="button" onClick={() => setManualData({...manualData, elasticity: manualData.elasticity === 1 ? 0 : 1})} className={`w-12 h-6 rounded-full transition-all relative ${manualData.elasticity === 1 ? 'bg-green-500' : 'bg-slate-300'}`}>
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${manualData.elasticity === 1 ? 'left-7' : 'left-1'}`}></div>
                             </button>
                          </div>
                          </>
                      ) : (
                          <div className="grid grid-cols-2 gap-4 p-4 bg-orange-50 rounded-2xl border border-orange-100">
                              <Input label="Inicio" type="date" value={manualData.startDate} onChange={v => setManualData({...manualData, startDate: v})} />
                              <Input label="Fin" type="date" value={manualData.endDate} onChange={v => setManualData({...manualData, endDate: v})} />
                          </div>
                      )}

                      <div className="grid grid-cols-3 gap-4">
                          {/* INPUT DE HORAS (VISUAL) -> MINUTOS (LÓGICO) */}
                          <div className="space-y-1 flex-1">
                              <label className="text-[9px] font-black uppercase text-slate-400 ml-1">Horas Estimadas</label>
                              <input 
                                type="number" 
                                step="0.5" 
                                min="0.1"
                                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-4 ring-blue-500/10 transition-all"
                                value={manualData.duration / 60} 
                                onChange={e => setManualData({...manualData, duration: Math.round(Number(e.target.value) * 60)})} 
                              />
                          </div>
                          <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase">Prioridad</label><select className="w-full p-3 bg-slate-50 border rounded-xl text-xs font-bold" value={manualData.priority} onChange={e => setManualData({...manualData, priority: e.target.value as Priority})}><option value={Priority.ASAP}>ASAP</option><option value={Priority.HIGH}>High</option><option value={Priority.MEDIUM}>Medium</option></select></div>
                          <Input label="Valor ($)" type="number" value={manualData.totalValue} onChange={v => setManualData({...manualData, totalValue: Number(v)})} />
                      </div>
                  </div>
                  <button type="submit" className="w-full bg-slate-900 text-white py-4 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-slate-800 transition-all mt-4">Registrar</button>
              </form>
          </div>
        )}
      </div>
    </div>
  );
};

const Input = ({ label, value, onChange, type = "text" }: any) => (
  <div className="space-y-1 flex-1"><label className="text-[9px] font-black uppercase text-slate-400 ml-1">{label}</label><input type={type} value={value} onChange={e => onChange(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-4 ring-blue-500/10 transition-all" /></div>
);

export default AIChat;
