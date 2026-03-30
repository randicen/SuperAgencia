
import React, { useState, useMemo } from 'react';
import { Client, Installment } from '../types';
import { useSpaces, getAllTasks, TaskWithLocation } from '../contexts/SpacesContext';
import { SpaceTask } from '../spacesTypes';
import { formatLocalDate } from '../utils/dateUtils';

interface FinanceViewProps {
  clients: Client[];
  onUpdateClients: (clients: Client[]) => void;
  onAddClient: (c: Client) => void;
  onDeleteClient: (id: string) => void;
}

// COMPONENTE DE BOTÓN SEGURO (2 Pasos)
const SecureDeleteButton = ({ onDelete, label, confirmLabel }: { onDelete: () => void, label: string, confirmLabel: string }) => {
    const [confirming, setConfirming] = useState(false);
    
    if (confirming) {
        return (
            <button 
                onClick={(e) => { e.stopPropagation(); onDelete(); }} 
                onMouseLeave={() => setConfirming(false)}
                className="bg-red-600 text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase animate-pulse shadow-lg hover:bg-red-700 transition-all"
            >
                {confirmLabel}
            </button>
        );
    }
    return (
        <button 
            onClick={(e) => { e.stopPropagation(); setConfirming(true); }} 
            className="text-red-400 border border-red-200 bg-red-50 hover:bg-red-100 hover:text-red-600 px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all"
        >
            {label}
        </button>
    );
};

const FinanceView: React.FC<FinanceViewProps> = ({ clients, onUpdateClients, onAddClient, onDeleteClient }) => {
  const { state, dispatch } = useSpaces();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [showAddClient, setShowAddClient] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [newClientData, setNewClientData] = useState({ name: '', email: '', phone: '' });

  // Plan de pagos modal state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingInstallments, setEditingInstallments] = useState<Installment[]>([]);
  const [editingTotalValue, setEditingTotalValue] = useState<number>(0);
  const [numInstallmentsToGen, setNumInstallmentsToGen] = useState(1);

  // Flatten all tasks from all workspaces
  const allTasksWithLoc = useMemo(() => getAllTasks(state), [state]);

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
    c.email.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
    c.phone.includes(searchTerm.trim())
  );

  const activeClient = useMemo(() => 
    clients.find(c => c.id === selectedClientId) || null
  , [clients, selectedClientId]);

  // Get tasks for a specific client
  const getClientTasks = (clientId: string): TaskWithLocation[] => {
    return allTasksWithLoc.filter(t => t.task.clientId === clientId);
  };

  // --- FINANCIAL HELPERS ---
  const getTaskFinancials = (task: SpaceTask) => {
    const installments = task.installments || [];
    const paid = installments.filter(i => i.status === 'PAGADO').reduce((sum, i) => sum + i.amount, 0);
    const total = task.totalValue || 0;
    return { paid, total, pending: total - paid, progress: total > 0 ? Math.round((paid / total) * 100) : 0 };
  };

  const getClientFinancials = (clientId: string) => {
    const tasks = getClientTasks(clientId);
    let paid = 0; let total = 0;
    tasks.forEach(({ task }) => {
      const f = getTaskFinancials(task);
      paid += f.paid;
      total += f.total;
    });
    return { paid, total, pending: total - paid, progress: total > 0 ? Math.round((paid / total) * 100) : 0, taskCount: tasks.length };
  };

  // Toggle installment status (PENDIENTE <-> PAGADO)
  const toggleInstallment = (taskLoc: TaskWithLocation, instId: string) => {
    const task = taskLoc.task;
    const updatedInstallments = (task.installments || []).map(i =>
      i.id === instId ? { ...i, status: (i.status === 'PAGADO' ? 'PENDIENTE' : 'PAGADO') as 'PENDIENTE' | 'PAGADO', paidDate: i.status === 'PENDIENTE' ? formatLocalDate() : undefined } : i
    );
    dispatchTaskUpdate(taskLoc, { installments: updatedInstallments });
  };

  // Update task totalValue from Finance
  const handleUpdateTaskValue = (taskLoc: TaskWithLocation, newValue: number) => {
    dispatchTaskUpdate(taskLoc, { totalValue: newValue });
  };

  // Save installments plan to task
  const handleSaveInstallments = () => {
    if (!editingTaskId) return;
    const taskLoc = allTasksWithLoc.find(t => t.task.id === editingTaskId);
    if (!taskLoc) return;
    dispatchTaskUpdate(taskLoc, { installments: editingInstallments, totalValue: editingTotalValue });
    setEditingTaskId(null);
  };

  // Generic dispatch helper for updating a task in the Spaces context
  const dispatchTaskUpdate = (taskLoc: TaskWithLocation, updates: Partial<SpaceTask>) => {
    // We need to find the ROOT task and update it recursively if the target is a subtask
    const findAndUpdate = (tasks: SpaceTask[], targetId: string): SpaceTask[] => {
      return tasks.map(t => {
        if (t.id === targetId) {
          return { ...t, ...updates };
        }
        if (t.subtasks && t.subtasks.length > 0) {
          return { ...t, subtasks: findAndUpdate(t.subtasks, targetId) };
        }
        return t;
      });
    };

    // Find the root task in the list
    const workspace = state.workspaces.find(w => w.id === taskLoc.workspaceId);
    if (!workspace) return;

    const space = workspace.espacios.find(s => s.id === taskLoc.spaceId);
    if (!space) return;

    let list;
    if (taskLoc.folderId) {
      const folder = space.carpetas.find(f => f.id === taskLoc.folderId);
      list = folder?.listas.find(l => l.id === taskLoc.listId);
    } else {
      list = space.listas.find(l => l.id === taskLoc.listId);
    }
    if (!list) return;

    // Find the root-level task that contains our target
    const findRoot = (tasks: SpaceTask[], targetId: string): SpaceTask | null => {
      for (const t of tasks) {
        if (t.id === targetId) return t;
        if (t.subtasks && t.subtasks.length > 0) {
          const found = findRoot(t.subtasks, targetId);
          if (found) return t; // Return the root, not the found subtask
        }
      }
      return null;
    };

    // Check if it's a root-level task
    const rootTask = list.tareas.find(t => t.id === taskLoc.task.id);
    if (rootTask) {
      dispatch({
        type: 'UPDATE_TASK',
        payload: {
          spaceId: taskLoc.spaceId,
          folderId: taskLoc.folderId,
          listId: taskLoc.listId,
          task: { ...rootTask, ...updates }
        }
      });
    } else {
      // It's a subtask - find root and update recursively
      const rootParent = findRoot(list.tareas, taskLoc.task.id);
      if (rootParent) {
        const updatedRoot = {
          ...rootParent,
          subtasks: findAndUpdate(rootParent.subtasks || [], taskLoc.task.id)
        };
        dispatch({
          type: 'UPDATE_TASK',
          payload: {
            spaceId: taskLoc.spaceId,
            folderId: taskLoc.folderId,
            listId: taskLoc.listId,
            task: updatedRoot
          }
        });
      }
    }
  };

  const generateAutoInstallments = () => {
    if (numInstallmentsToGen < 1 || editingTotalValue <= 0) return;
    const amountPerInstallment = Math.floor(editingTotalValue / numInstallmentsToGen);
    const remainder = editingTotalValue % numInstallmentsToGen;
    const newInstallments: Installment[] = Array.from({ length: numInstallmentsToGen }, (_, i) => {
        const d = new Date(); d.setMonth(d.getMonth() + i);
        return {
            id: Math.random().toString(36).substr(2, 9),
            amount: i === numInstallmentsToGen - 1 ? amountPerInstallment + remainder : amountPerInstallment,
            dueDate: formatLocalDate(d), status: 'PENDIENTE' as const
        };
    });
    setEditingInstallments(newInstallments);
  };

  const openInstallmentEditor = (taskLoc: TaskWithLocation) => {
    setEditingTaskId(taskLoc.task.id);
    setEditingInstallments(taskLoc.task.installments ? [...taskLoc.task.installments.map(i => ({...i}))] : []);
    setEditingTotalValue(taskLoc.task.totalValue || 0);
    setNumInstallmentsToGen(1);
  };

  const handleCreateClient = () => {
    if (!newClientData.name.trim()) return;
    onAddClient({
      id: Math.random().toString(36).substr(2, 9),
      name: newClientData.name, email: newClientData.email, phone: newClientData.phone
    });
    setNewClientData({ name: '', email: '', phone: '' });
    setShowAddClient(false);
  };

  // Editing task name for the installment editor
  const editingTaskData = editingTaskId ? allTasksWithLoc.find(t => t.task.id === editingTaskId) : null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <div className="flex justify-between items-center bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Gestor de Clientes</h2>
          <p className="text-[10px] text-slate-400 font-bold">Proyectos vinculados desde Espacios</p>
        </div>
        <div className="flex gap-2">
            <input 
              type="text" 
              placeholder="Buscar cliente..." 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)}
              className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 ring-blue-500/20 w-48"
            />
            <button 
                onClick={() => setIsAdminMode(!isAdminMode)} 
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 ${isAdminMode ? 'bg-red-500 text-white shadow-lg shadow-red-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            >
                <i className={`fa-solid ${isAdminMode ? 'fa-toggle-on' : 'fa-toggle-off'}`}></i>
                {isAdminMode ? 'Admin: ON' : 'Admin: OFF'}
            </button>
            <button onClick={() => setShowAddClient(true)} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase shadow-xl cursor-pointer hover:bg-slate-800 transition-colors">Nuevo</button>
        </div>
      </div>

      {/* --- MODO ADMINISTRADOR (TABLA PURA) --- */}
      {isAdminMode ? (
        <div className="bg-white rounded-[2rem] border-2 border-red-100 shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-4">
            <div className="bg-red-50 p-6 border-b border-red-100">
                <h3 className="text-red-800 font-black uppercase tracking-tight flex items-center gap-2">
                    <i className="fa-solid fa-shield-halved"></i> Panel de Control de Datos
                </h3>
                <p className="text-red-600/60 text-xs font-bold mt-1">Elimina datos con precaución. Esta acción no se puede deshacer.</p>
            </div>
            <div className="p-0 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 tracking-widest">
                        <tr>
                            <th className="p-6 border-b">Cliente</th>
                            <th className="p-6 border-b">Contacto</th>
                            <th className="p-6 border-b">Proyectos Vinculados</th>
                            <th className="p-6 border-b text-right">Acciones Críticas</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm font-medium text-slate-700">
                        {clients.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-400 italic">Base de datos vacía</td></tr>}
                        {clients.map(client => {
                            const clientTasks = getClientTasks(client.id);
                            return (
                            <tr key={client.id} className="hover:bg-red-50/10 transition-colors group">
                                <td className="p-6">
                                    <div className="font-bold text-slate-900">{client.name}</div>
                                    <div className="text-xs text-slate-400 font-mono mt-1">{client.id}</div>
                                </td>
                                <td className="p-6 text-xs">
                                    <div className="font-bold">{client.email || '-'}</div>
                                    <div className="text-slate-400">{client.phone || '-'}</div>
                                </td>
                                <td className="p-6">
                                    {clientTasks.length === 0 ? <span className="text-xs text-slate-300 italic">Sin proyectos</span> : (
                                        <div className="space-y-1">
                                            {clientTasks.map(({ task }) => (
                                                <div key={task.id} className="text-xs font-bold text-slate-600 bg-slate-50 px-2 py-1 rounded">
                                                    {task.nombre} {task.totalValue > 0 && <span className="text-blue-500 ml-1">${task.totalValue.toLocaleString()}</span>}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </td>
                                <td className="p-6 text-right align-top">
                                    <SecureDeleteButton 
                                        label="Eliminar Cliente" 
                                        confirmLabel="¿Seguro?" 
                                        onDelete={() => onDeleteClient(client.id)} 
                                    />
                                </td>
                            </tr>
                        );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
      ) : (
        /* --- MODO VISUAL (GRID DE TARJETAS) --- */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredClients.map(client => {
            const financials = getClientFinancials(client.id);
            return (
                <div 
                    key={client.id} 
                    onClick={() => setSelectedClientId(client.id)}
                    className="bg-white rounded-[2rem] border border-slate-100 shadow-sm transition-all flex flex-col hover:shadow-xl overflow-hidden group relative cursor-pointer hover:-translate-y-1"
                >
                <div className="p-8 flex-1">
                    <div className="flex justify-between items-center mb-6">
                    <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-sm">{client.name.substring(0, 2).toUpperCase()}</div>
                    <span className="text-[9px] font-black text-slate-400 uppercase bg-slate-50 px-3 py-1 rounded-full">{financials.taskCount} Proyecto{financials.taskCount !== 1 ? 's' : ''}</span>
                    </div>
                    <h3 className="font-black text-slate-800 text-xl truncate mb-2">{client.name}</h3>
                    {financials.total > 0 && (
                      <p className="text-xs font-bold text-slate-500 mb-6">${financials.paid.toLocaleString()} / ${financials.total.toLocaleString()}</p>
                    )}
                    <div className="space-y-3">
                    <div className="flex justify-between text-[9px] font-black uppercase"><span className="text-slate-400">Progreso Pago</span><span className="text-emerald-500">{financials.progress}%</span></div>
                    <div className="w-full bg-slate-50 h-2 rounded-full overflow-hidden border"><div className="bg-emerald-500 h-full transition-all duration-700" style={{width: `${financials.progress}%`}}></div></div>
                    </div>
                </div>
                </div>
            );
            })}
            {filteredClients.length === 0 && (
              <div className="col-span-full text-center py-16">
                <i className="fa-solid fa-users-slash text-4xl text-slate-200 mb-4"></i>
                <p className="text-sm text-slate-400 font-bold">{searchTerm ? 'Sin resultados' : 'No hay clientes registrados'}</p>
              </div>
            )}
        </div>
      )}

      {/* MODAL DETALLE CLIENTE */}
      {!isAdminMode && activeClient && (() => {
        const clientTasks = getClientTasks(activeClient.id);
        const financials = getClientFinancials(activeClient.id);
        return (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-[100] flex items-center justify-center p-4" onClick={() => setSelectedClientId(null)}>
          <div className="bg-white w-full max-w-3xl rounded-[2.5rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
            <div className="p-8 border-b flex justify-between items-center bg-slate-50/50 shrink-0">
              <div>
                <h2 className="text-3xl font-black text-slate-800 tracking-tight">{activeClient.name}</h2>
                <p className="text-xs text-slate-400 font-bold mt-1">{activeClient.email} {activeClient.phone && `· ${activeClient.phone}`}</p>
              </div>
              <button type="button" onClick={() => setSelectedClientId(null)} className="w-12 h-12 bg-white border rounded-xl text-slate-400 hover:text-slate-800 flex items-center justify-center transition-colors cursor-pointer text-xl"><i className="fa-solid fa-xmark"></i></button>
            </div>
            
            <div className="p-8 overflow-y-auto space-y-8 flex-1 custom-scrollbar">
              <div className="grid grid-cols-3 gap-4">
                <StatBox label="Pagado" value={`$${financials.paid.toLocaleString()}`} color="text-emerald-500" />
                <StatBox label="Pendiente" value={`$${financials.pending.toLocaleString()}`} color="text-red-500" />
                <StatBox label="Total" value={`$${financials.total.toLocaleString()}`} color="text-slate-900" />
              </div>

              <div className="space-y-6">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-2">Proyectos y Servicios Vinculados</h4>
                {clientTasks.length === 0 && <p className="text-center text-slate-400 text-sm py-8 font-medium bg-slate-50 rounded-2xl border border-dashed">Sin proyectos vinculados. Asigna este cliente a una tarea desde Espacios.</p>}
                {clientTasks.map(taskLoc => {
                  const task = taskLoc.task;
                  const taskFin = getTaskFinancials(task);
                  return (
                    <div key={task.id} className="bg-slate-50 rounded-[2rem] p-6 border border-slate-100 space-y-6 relative group/item hover:border-blue-200 transition-colors">
                      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded ${task.estado === 'DONE' ? 'bg-green-100 text-green-700' : task.estado === 'ACTIVE' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                              {task.estado === 'DONE' ? 'Completado' : task.estado === 'ACTIVE' ? 'En curso' : 'Pendiente'}
                            </span>
                            <span className="text-[8px] text-slate-400 font-bold">{task.progress}% operativo</span>
                          </div>
                          <h5 className="font-black text-lg uppercase text-slate-800 truncate mb-2">{task.nombre}</h5>
                          <div className="space-y-1.5 w-full max-w-xs">
                             <div className="flex justify-between text-[8px] font-black uppercase text-slate-400"><span>Cobro Recaudado</span><span>{taskFin.progress}%</span></div>
                             <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden border border-white/50"><div className="bg-blue-500 h-full transition-all duration-700" style={{width: `${taskFin.progress}%`}}></div></div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                            <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-2xl border shadow-sm">
                                <span className="text-[9px] font-black text-slate-400 uppercase">$</span>
                                <input type="number" className="w-24 text-blue-600 font-black text-right outline-none bg-transparent" value={task.totalValue} onChange={(e) => handleUpdateTaskValue(taskLoc, Number(e.target.value))} />
                                <button type="button" onClick={() => openInstallmentEditor(taskLoc)} className="ml-2 bg-slate-900 text-white px-3 py-1.5 rounded-lg text-[9px] font-black uppercase hover:bg-slate-700 transition-colors cursor-pointer">Plan</button>
                            </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {(task.installments || []).map(inst => (
                          <div key={inst.id} className="bg-white p-4 rounded-2xl border border-slate-100 flex justify-between items-center shadow-sm">
                            <div className="text-[9px] font-bold">
                                <p className="text-slate-800 text-xs font-black">${inst.amount.toLocaleString()}</p>
                                <p className="text-slate-400 mt-0.5 uppercase tracking-tighter">Vence: {inst.dueDate}</p>
                            </div>
                            <button type="button" onClick={() => toggleInstallment(taskLoc, inst.id)} className={`px-4 py-2 rounded-xl text-[8px] font-black uppercase transition-all ${inst.status === 'PAGADO' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' : 'bg-slate-50 border text-slate-400 hover:bg-slate-100'} cursor-pointer`}>{inst.status === 'PAGADO' ? 'Pagado' : 'Marcar'}</button>
                          </div>
                        ))}
                        {(!task.installments || task.installments.length === 0) && task.totalValue > 0 && (
                          <div className="col-span-full text-center py-4">
                            <button type="button" onClick={() => openInstallmentEditor(taskLoc)} className="text-[10px] font-black text-blue-600 uppercase hover:underline cursor-pointer">
                              <i className="fa-solid fa-plus mr-1"></i>Configurar Plan de Pagos
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="p-4 text-center bg-slate-50 border-t border-slate-100 text-[10px] text-slate-400 font-medium">
                ¿Necesitas eliminar? Activa el "Modo Admin" en la vista principal.
            </div>
          </div>
        </div>
      );
      })()}

      {/* MODAL PLAN DE PAGOS */}
      {editingTaskData && (
        <div className="fixed inset-0 bg-slate-900/95 z-[110] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-10 space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="space-y-2">
              <h3 className="text-2xl font-black text-slate-800 tracking-tighter uppercase">Plan de Pagos</h3>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{editingTaskData.task.nombre}</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-[9px] font-black uppercase text-slate-400 ml-1">Valor Total del Proyecto ($)</label>
              <input type="number" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black outline-none focus:ring-4 ring-blue-500/10" value={editingTotalValue} onChange={e => setEditingTotalValue(Number(e.target.value))} />
            </div>
            <div className="bg-blue-50 p-6 rounded-3xl border border-blue-100 flex items-center gap-6">
                <div className="flex-1 space-y-1"><label className="text-[9px] font-black uppercase text-blue-600 ml-1">Nº Cuotas</label><input type="number" min="1" className="w-full p-3 bg-white border border-blue-200 rounded-xl font-black text-xs" value={numInstallmentsToGen} onChange={e => setNumInstallmentsToGen(Math.max(1, Number(e.target.value)))} /></div>
                <button type="button" onClick={generateAutoInstallments} className="mt-4 bg-blue-600 text-white px-6 py-4 rounded-2xl font-black text-[10px] uppercase shadow-lg shadow-blue-200 cursor-pointer">Generar</button>
            </div>
            <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                {editingInstallments.map((inst, idx) => (
                    <div key={inst.id} className="flex gap-3 items-center bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        <input type="number" className="w-24 p-2 bg-white border rounded-lg font-bold text-xs" value={inst.amount} onChange={(e) => { const upd = [...editingInstallments]; upd[idx] = {...upd[idx], amount: Number(e.target.value)}; setEditingInstallments(upd); }} />
                        <input type="date" className="flex-1 p-2 bg-white border rounded-lg font-bold text-xs" value={inst.dueDate} onChange={(e) => { const upd = [...editingInstallments]; upd[idx] = {...upd[idx], dueDate: e.target.value}; setEditingInstallments(upd); }} />
                        <button type="button" onClick={() => setEditingInstallments(editingInstallments.filter((_, i) => i !== idx))} className="p-2 text-red-500 hover:bg-red-50 rounded-lg cursor-pointer"><i className="fa-solid fa-trash-can"></i></button>
                    </div>
                ))}
                <button type="button" onClick={() => setEditingInstallments([...editingInstallments, {id: Math.random().toString(36).substr(2,9), amount: 0, dueDate: formatLocalDate(), status: 'PENDIENTE'}])} className="w-full py-3 border-2 border-dashed border-slate-200 rounded-2xl text-[9px] font-black text-slate-400 uppercase hover:border-blue-400 hover:text-blue-500 transition-all cursor-pointer">+ Manual</button>
            </div>
            <div className="pt-6 border-t border-slate-100 flex gap-4">
                <button type="button" onClick={() => setEditingTaskId(null)} className="flex-1 font-black text-slate-400 text-[10px] uppercase cursor-pointer">Cancelar</button>
                <button type="button" onClick={handleSaveInstallments} className="flex-2 bg-slate-900 text-white px-10 py-4 rounded-2xl font-black text-[10px] uppercase shadow-2xl cursor-pointer">Guardar</button>
            </div>
          </div>
        </div>
      )}

      {showAddClient && (
        <div className="fixed inset-0 bg-slate-900/95 z-[120] flex items-center justify-center p-4" onClick={() => setShowAddClient(false)}>
          <div className="bg-white w-full max-w-md rounded-[2.5rem] p-10 space-y-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-2xl font-black text-slate-800 tracking-tighter uppercase">Nuevo Cliente</h3>
            <div className="space-y-4">
                <FInput label="Nombre" value={newClientData.name} onChange={v => setNewClientData({...newClientData, name: v})} />
                <FInput label="Email" value={newClientData.email} onChange={v => setNewClientData({...newClientData, email: v})} />
                <FInput label="Teléfono" value={newClientData.phone} onChange={v => setNewClientData({...newClientData, phone: v})} />
            </div>
            <div className="flex gap-3 pt-4">
              <button type="button" onClick={() => setShowAddClient(false)} className="flex-1 font-black text-slate-400 uppercase text-[10px] cursor-pointer">Cerrar</button>
              <button type="button" onClick={handleCreateClient} className="flex-1 bg-slate-900 text-white py-4 rounded-2xl font-black text-[10px] uppercase cursor-pointer">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatBox = ({ label, value, color }: any) => (
  <div className="bg-white p-4 rounded-2xl border text-center shadow-sm"><p className="text-[8px] font-black text-slate-400 uppercase mb-1">{label}</p><p className={`text-base font-black ${color}`}>{value}</p></div>
);

const FInput = ({ label, value, onChange, type = "text" }: any) => (
  <div className="space-y-1 flex-1"><label className="text-[9px] font-black uppercase text-slate-400 ml-1">{label}</label><input type={type} value={value} onChange={e => onChange(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-4 ring-blue-500/10" /></div>
);

export default FinanceView;
