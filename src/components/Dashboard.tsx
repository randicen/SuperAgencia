import React, { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, ComposedChart, Area, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getAllTasks, useSpaces } from '../contexts/SpacesContext';
import { Client, Project, SeasonalityData, Transaction } from '../types';
import { buildPanoramaOperationalSummary, PanoramaCommitmentItem, PanoramaTaskItem } from '../utils/panoramaSummary';
import { parseLocalDate } from '../utils/dateTime';

interface DashboardProps {
  projects: Project[];
  transactions: Transaction[];
  clients: Client[];
  seasonality: SeasonalityData[];
  setActiveTab: (tab: 'dashboard' | 'chat' | 'spaces' | 'agenda' | 'finance' | 'notebook') => void;
}

const formatCurrency = (value: number) => `$${value.toLocaleString('es-CO')}`;

const formatDateTime = (value: string | null) => {
  if (!value) return 'Sin fecha';
  const parsed = parseLocalDate(value);
  if (!parsed) return value;
  return parsed.toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const Dashboard: React.FC<DashboardProps> = ({ transactions, clients, setActiveTab }) => {
  const { state } = useSpaces();
  const allTaskLocations = useMemo(() => getAllTasks(state), [state]);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNowTick(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  const operationalSummary = useMemo(() => buildPanoramaOperationalSummary(state, new Date(nowTick)), [state, nowTick]);
  const activeWorkspaceId = state.activeWorkspaceId || state.workspaces[0]?.id || null;
  const activeTaskLocations = useMemo(
    () => allTaskLocations.filter(({ workspaceId }) => workspaceId === activeWorkspaceId),
    [allTaskLocations, activeWorkspaceId]
  );

  const currentBalance = useMemo(
    () => transactions.reduce((accumulator, transaction) => accumulator + (transaction.type === 'income' ? transaction.amount : -transaction.amount), 0),
    [transactions]
  );

  const financialProjection = useMemo(() => {
    const data: Array<{ date: string; balance: number; type: 'actual' | 'projected' }> = [];
    let rollingBalance = currentBalance;
    let realizedBalance = 0;

    transactions
      .filter((transaction) => !transaction.isPredictive)
      .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
      .forEach((transaction) => {
        realizedBalance += transaction.type === 'income' ? transaction.amount : -transaction.amount;
        data.push({ date: transaction.date, balance: realizedBalance, type: 'actual' });
      });

    activeTaskLocations
      .flatMap(({ task }) =>
        (task.installments || [])
          .filter((installment) => installment.status === 'PENDIENTE')
          .map((installment) => ({ date: installment.dueDate, amount: installment.amount }))
      )
      .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
      .forEach((installment) => {
        rollingBalance += installment.amount;
        data.push({ date: installment.date, balance: rollingBalance, type: 'projected' });
      });

    return data.length > 0 ? data : [{ date: new Date().toISOString(), balance: currentBalance, type: 'actual' as const }];
  }, [activeTaskLocations, currentBalance, transactions]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-7xl mx-auto">
      <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 md:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-500 mb-2">Panorama</p>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">Centro operativo</h1>
            <p className="text-sm text-slate-500 mt-2 max-w-2xl">
              Vista unificada del trabajo pendiente, compromisos del workspace y salud financiera.
              {operationalSummary.activeWorkspaceName ? ` Workspace activo: ${operationalSummary.activeWorkspaceName}.` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <QuickAction label="Espacios" icon="fa-layer-group" onClick={() => setActiveTab('spaces')} />
            <QuickAction label="Agenda" icon="fa-calendar-days" onClick={() => setActiveTab('agenda')} />
            <QuickAction label="Finanzas" icon="fa-wallet" onClick={() => setActiveTab('finance')} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard title="Vencidas" value={String(operationalSummary.overdueCount)} subtitle="Requieren atención inmediata" icon="fa-triangle-exclamation" tone="red" />
        <MetricCard title="Próximas 48h" value={String(operationalSummary.upcomingCount)} subtitle="Entregas cercanas" icon="fa-clock" tone="blue" />
        <MetricCard title="Compromisos" value={String(operationalSummary.commitmentCount)} subtitle="Agenda del workspace" icon="fa-calendar-check" tone="orange" />
        <MetricCard title="Flujo pendiente" value={formatCurrency(operationalSummary.pendingIncome)} subtitle="Cobros aún no recibidos" icon="fa-hand-holding-dollar" tone="emerald" />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <Panel title="Radar operativo" description="Tareas que necesitan seguimiento en este momento.">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <TaskListCard
                title="Con atraso"
                emptyLabel="No tienes tareas vencidas."
                tasks={operationalSummary.overdueTasks.slice(0, 5)}
                accent="red"
              />
              <TaskListCard
                title="Próximas 48h"
                emptyLabel="No hay entregas inminentes."
                tasks={operationalSummary.upcomingTasks.slice(0, 5)}
                accent="blue"
              />
            </div>
          </Panel>

          <Panel title="Próximos compromisos" description="Eventos y bloqueos que impactan tu planificación.">
            <CommitmentList items={operationalSummary.upcomingCommitments} />
          </Panel>
        </div>

        <Panel title="Enfoque inmediato" description="Prioridades recomendadas para retomar trabajo.">
          <div className="space-y-3">
            {operationalSummary.focusTasks.length > 0 ? operationalSummary.focusTasks.map((task) => (
              <TaskFocusItem key={task.id} task={task} />
            )) : (
              <EmptyState icon="fa-check-circle" label="No hay tareas pendientes por priorizar." />
            )}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3">
            <StatPill label="Pendientes" value={operationalSummary.todoCount} />
            <StatPill label="En curso" value={operationalSummary.activeCount} />
            <StatPill label="Hechas" value={operationalSummary.doneCount} />
          </div>
        </Panel>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-1">Finanzas</p>
            <h2 className="text-xl font-black text-slate-900">Módulo financiero</h2>
          </div>
          <button
            onClick={() => setActiveTab('finance')}
            className="text-[10px] font-black uppercase tracking-wide text-blue-600 hover:text-blue-700"
          >
            Abrir finanzas
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard title="Caja real" value={formatCurrency(currentBalance)} subtitle="Saldo según movimientos" icon="fa-vault" tone="slate" />
          <MetricCard title="Proyectado" value={formatCurrency(currentBalance + operationalSummary.pendingIncome)} subtitle="Caja real + cobros pendientes" icon="fa-chart-line" tone="blue" />
          <MetricCard title="Por cobrar" value={formatCurrency(operationalSummary.pendingIncome)} subtitle="Cuotas pendientes en tareas" icon="fa-file-invoice-dollar" tone="emerald" />
          <MetricCard title="Clientes" value={String(clients.length)} subtitle="Base registrada" icon="fa-users" tone="orange" />
        </div>

        <Panel title="Flujo de caja predictivo" description="Realidad actual frente a próximos cobros pendientes.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={financialProjection}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => new Date(value).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ borderRadius: '16px', border: '1px solid #E2E8F0', boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)', fontSize: '12px' }}
                  labelFormatter={(value) => formatDateTime(value as string)}
                  formatter={(value: number) => [formatCurrency(value), 'Balance']}
                />
                <Area type="monotone" dataKey="balance" fill="#3b82f6" fillOpacity={0.08} stroke="none" />
                <Line type="monotone" dataKey="balance" stroke="#2563eb" strokeWidth={3} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </section>
    </div>
  );
};

const QuickAction = ({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) => (
  <button
    onClick={onClick}
    className="px-4 py-2 rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 text-[10px] font-black uppercase tracking-widest hover:border-blue-200 hover:text-blue-700 hover:bg-blue-50 transition-all"
  >
    <i className={`fa-solid ${icon} mr-2`}></i>{label}
  </button>
);

const Panel = ({ title, description, children }: { title: string; description: string; children: React.ReactNode }) => (
  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
    <div className="mb-5">
      <h3 className="text-lg font-black tracking-tight text-slate-900">{title}</h3>
      <p className="text-sm text-slate-500 mt-1">{description}</p>
    </div>
    {children}
  </div>
);

const MetricCard = ({
  title,
  value,
  subtitle,
  icon,
  tone,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: string;
  tone: 'red' | 'blue' | 'orange' | 'emerald' | 'slate';
}) => {
  const toneStyles: Record<typeof tone, string> = {
    red: 'bg-red-50 text-red-600',
    blue: 'bg-blue-50 text-blue-600',
    orange: 'bg-orange-50 text-orange-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    slate: 'bg-slate-100 text-slate-700',
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{title}</p>
          <p className="text-3xl font-black tracking-tight text-slate-900 mt-3">{value}</p>
          <p className="text-xs text-slate-500 mt-2">{subtitle}</p>
        </div>
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${toneStyles[tone]}`}>
          <i className={`fa-solid ${icon}`}></i>
        </div>
      </div>
    </div>
  );
};

const TaskListCard = ({
  title,
  emptyLabel,
  tasks,
  accent,
}: {
  title: string;
  emptyLabel: string;
  tasks: PanoramaTaskItem[];
  accent: 'red' | 'blue';
}) => {
  const accentStyles = accent === 'red' ? 'border-red-100 bg-red-50/60' : 'border-blue-100 bg-blue-50/60';

  return (
    <div className={`rounded-2xl border p-4 ${accentStyles}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500 mb-4">{title}</p>
      <div className="space-y-3">
        {tasks.length > 0 ? tasks.map((task) => <TaskSummaryItem key={task.id} task={task} />) : <EmptyState icon="fa-check-circle" label={emptyLabel} />}
      </div>
    </div>
  );
};

const TaskSummaryItem = ({ task }: { task: PanoramaTaskItem }) => (
  <div className="rounded-2xl bg-white border border-white px-4 py-3 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-black text-slate-900 truncate">{task.nombre}</p>
        <p className="text-[11px] text-slate-500 truncate">
          {task.clientName ? `${task.clientName} · ` : ''}{task.workspaceName}
        </p>
      </div>
      <span className="text-[10px] font-black uppercase text-slate-400 whitespace-nowrap">{task.priority}</span>
    </div>
    <p className="text-[11px] text-slate-500 mt-3">Límite: {formatDateTime(task.dueDate)}</p>
  </div>
);

const TaskFocusItem = ({ task }: { task: PanoramaTaskItem }) => (
  <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-black text-slate-900 truncate">{task.nombre}</p>
        <p className="text-[11px] text-slate-500 truncate">{task.clientName || task.workspaceName}</p>
      </div>
      <span className="text-[10px] font-black uppercase text-blue-600 whitespace-nowrap">{task.priority}</span>
    </div>
    <div className="flex items-center justify-between mt-3 text-[11px] text-slate-500">
      <span>Progreso {task.progress}%</span>
      <span>{formatDateTime(task.dueDate)}</span>
    </div>
  </div>
);

const CommitmentList = ({ items }: { items: PanoramaCommitmentItem[] }) => (
  <div className="space-y-3">
    {items.length > 0 ? items.map((item) => (
      <div key={item.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-900 truncate">{item.nombre}</p>
            <p className="text-[11px] text-slate-500 truncate">{item.workspaceName} · {item.sourceLabel}</p>
          </div>
          <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">{formatDateTime(item.startDate)}</span>
        </div>
      </div>
    )) : <EmptyState icon="fa-calendar-check" label="No hay compromisos próximos registrados." />}
  </div>
);

const StatPill = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-center">
    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{label}</p>
    <p className="text-lg font-black text-slate-900 mt-2">{value}</p>
  </div>
);

const EmptyState = ({ icon, label }: { icon: string; label: string }) => (
  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-slate-400">
    <i className={`fa-solid ${icon} text-xl mb-3`}></i>
    <p className="text-xs font-bold">{label}</p>
  </div>
);

export default Dashboard;
