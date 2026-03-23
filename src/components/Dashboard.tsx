
import React, { useMemo } from 'react';
import { Project, Transaction, SeasonalityData, Priority, Client } from '../types';
import { useSpaces, getAllTasks } from '../contexts/SpacesContext';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, LineChart, Line, ComposedChart } from 'recharts';

interface DashboardProps {
  projects: Project[];
  transactions: Transaction[];
  clients: Client[];
  seasonality: SeasonalityData[];
  setActiveTab: (tab: any) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ projects, transactions, clients, seasonality, setActiveTab }) => {
  const { state } = useSpaces();
  const allTasks = useMemo(() => getAllTasks(state), [state]);

  const currentBalance = useMemo(() => 
    transactions.reduce((acc, t) => acc + (t.type === 'income' ? t.amount : -t.amount), 0)
  , [transactions]);

  const totalReceivable = useMemo(() => {
    let pending = 0;
    allTasks.forEach(({ task }) => {
      (task.installments || []).forEach(inst => { if (inst.status === 'PENDIENTE') pending += inst.amount; });
    });
    return pending;
  }, [allTasks]);

  // --- LÓGICA PREDICTIVA DE CFO ---
  const financialProjection = useMemo(() => {
    const data: any[] = [];
    let rollingBalance = currentBalance;

    // Pasado (Transacciones reales)
    const pastTransactions = transactions.filter(t => !t.isPredictive).sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let tempBalance = 0;
    pastTransactions.forEach(t => {
        tempBalance += (t.type === 'income' ? t.amount : -t.amount);
        data.push({ date: t.date, balance: tempBalance, type: 'actual' });
    });

    // Futuro (Cuotas pendientes from tasks)
    const futureIncomes: {date: string, amount: number}[] = [];
    allTasks.forEach(({ task }) => {
      (task.installments || []).forEach(inst => {
        if (inst.status === 'PENDIENTE') futureIncomes.push({ date: inst.dueDate, amount: inst.amount });
      });
    });
    
    futureIncomes.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    futureIncomes.forEach(inc => {
        rollingBalance += inc.amount;
        data.push({ date: inc.date, balance: rollingBalance, type: 'projected' });
    });

    return data.length > 0 ? data : [{ date: 'Hoy', balance: 0, type: 'actual' }];
  }, [transactions, allTasks, currentBalance]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard title="Caja Real" value={`$${currentBalance.toLocaleString()}`} icon="fa-vault" color="text-slate-800" />
        <SummaryCard title="Proyectado" value={`$${(currentBalance + totalReceivable).toLocaleString()}`} icon="fa-chart-line" color="text-[#3A57E8]" trend="Futuro" />
        <SummaryCard title="Por Cobrar" value={`$${totalReceivable.toLocaleString()}`} icon="fa-hand-holding-dollar" color="text-emerald-600" />
        <SummaryCard title="Proyectos Activos" value={`${projects.filter(p => p.status === 'active').length}`} icon="fa-layer-group" color="text-orange-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-sm font-bold text-slate-800">Flujo de Caja Predictivo</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Realidad vs Proyección IA</p>
                </div>
                <div className="flex gap-4">
                    <div className="flex items-center gap-2"><div className="w-2 h-2 bg-blue-500 rounded-full"></div><span className="text-[10px] font-semibold text-slate-500 uppercase">Real</span></div>
                    <div className="flex items-center gap-2"><div className="w-2 h-2 bg-blue-200 rounded-full"></div><span className="text-[10px] font-semibold text-slate-500 uppercase">Futuro</span></div>
                </div>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={financialProjection}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" hide />
                  <YAxis hide />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                    formatter={(value: any) => [`$${value.toLocaleString()}`, 'Balance']}
                  />
                  <Area type="monotone" dataKey="balance" fill="#3b82f6" fillOpacity={0.05} stroke="none" />
                  <Line type="monotone" dataKey="balance" stroke="#3b82f6" strokeWidth={2} dot={false} strokeDasharray={(props: any) => props.payload.type === 'projected' ? "4 4" : "0"} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
                <h3 className="text-sm font-bold text-slate-800">Prioridad Alta</h3>
                <button onClick={() => setActiveTab('gantt')} className="text-[10px] font-bold text-[#3A57E8] hover:underline">Ver Todo</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {projects.filter(p => p.status === 'active' || p.status === 'todo').slice(0, 6).map(p => (
                <div key={p.id} className="p-3 flex items-center gap-3 hover:bg-gray-50 rounded-md cursor-default transition-colors border border-transparent hover:border-gray-100">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${p.priority === Priority.HIGH || p.priority === Priority.ASAP ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-slate-700 text-xs truncate">{p.projectName}</h4>
                    <p className="text-[10px] text-slate-400 truncate">{p.clientName}</p>
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 bg-gray-100 px-2 py-0.5 rounded text-right">
                    {p.progress}%
                  </div>
                </div>
              ))}
              {projects.filter(p => p.status === 'active').length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-slate-300">
                      <i className="fa-solid fa-check-circle text-2xl mb-2"></i>
                      <span className="text-xs">Todo limpio</span>
                  </div>
              )}
            </div>
          </div>
      </div>
    </div>
  );
};

const SummaryCard = ({ title, value, icon, color }: any) => (
  <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm hover:border-blue-200 transition-colors">
    <div className="flex justify-between items-start mb-2">
        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">{title}</p>
        <i className={`fa-solid ${icon} ${color} text-sm opacity-80`}></i>
    </div>
    <h2 className="text-2xl font-bold text-slate-800 tracking-tight">{value}</h2>
  </div>
);

export default Dashboard;
