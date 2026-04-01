import React from 'react';
import type { DeadlineType, SpaceTask, TaskWorkStyle, WorkBlock } from '../spacesTypes';
import {
    createTaskWorkBlock,
    getTaskPlanningMode,
    getTaskWorkBlocks,
    setTaskManualWorkBlocks,
    setTaskPlanningMode,
    validateTaskPlanning,
} from '../utils/taskWorkBlocks';

type TaskPlanningSectionProps = {
    task: SpaceTask;
    onChange: (task: SpaceTask) => void;
    parentTask?: SpaceTask | null;
    formatSlotDateTime: (value: string) => string;
};

const toDateTimeLocalValue = (value?: string | null) => (value ? value.slice(0, 16) : '');

const LabeledInput = ({
    label,
    value,
    onChange,
    type = 'text',
    min,
}: {
    label: string;
    value: string | number;
    onChange: (value: string) => void;
    type?: string;
    min?: number;
}) => (
    <div className="space-y-1.5">
        <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1">{label}</label>
        <input
            type={type}
            min={min}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-4 ring-blue-500/10 transition-all"
        />
    </div>
);

const MinutesInput = ({
    label,
    value,
    onChange,
}: {
    label: string;
    value: number | null | undefined;
    onChange: (value: number) => void;
}) => {
    const minutesValue = value ?? 0;
    const hours = Math.floor(minutesValue / 60);
    const minutes = minutesValue % 60;

    return (
        <div className="space-y-1.5">
            <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1">{label}</label>
            <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                    <input
                        type="number"
                        min="0"
                        value={hours || ''}
                        placeholder="0"
                        onChange={(event) => {
                            const nextHours = Math.max(0, parseInt(event.target.value || '0', 10) || 0);
                            onChange(nextHours * 60 + minutes);
                        }}
                        className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-4 ring-blue-500/10 transition-all pr-8"
                    />
                    <span className="absolute right-3 top-[17px] text-[10px] font-black text-slate-400 uppercase">h</span>
                </div>
                <div className="relative">
                    <input
                        type="number"
                        min="0"
                        max="59"
                        value={minutes === 0 && hours === 0 ? '' : minutes}
                        placeholder="0"
                        onChange={(event) => {
                            const nextMinutes = Math.min(59, Math.max(0, parseInt(event.target.value || '0', 10) || 0));
                            onChange(hours * 60 + nextMinutes);
                        }}
                        className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-4 ring-blue-500/10 transition-all pr-8"
                    />
                    <span className="absolute right-3 top-[17px] text-[10px] font-black text-slate-400 uppercase">m</span>
                </div>
            </div>
        </div>
    );
};

const PlanningModeButton = ({
    active,
    label,
    icon,
    onClick,
}: {
    active: boolean;
    label: string;
    icon: string;
    onClick: () => void;
}) => (
    <button
        type="button"
        onClick={onClick}
        className={`flex-1 px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all border ${
            active
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-white text-slate-400 border-slate-200 hover:text-slate-700'
        }`}
    >
        <i className={`fa-solid ${icon} mr-1.5`}></i>
        {label}
    </button>
);

const getParentRange = (parentTask?: SpaceTask | null) => {
    if (!parentTask) return null;

    const parentStart = parentTask.earliestStartAt || parentTask.startDate;
    const parentEnd = parentTask.dueDate || parentTask.endDate;

    if (!parentStart && !parentEnd) return null;

    return { parentStart, parentEnd };
};

const TaskPlanningSection = ({
    task,
    onChange,
    parentTask,
    formatSlotDateTime,
}: TaskPlanningSectionProps) => {
    const planningMode = getTaskPlanningMode(task);
    const workBlocks = getTaskWorkBlocks(task);
    const planningError = validateTaskPlanning(task);
    const parentRange = getParentRange(parentTask);

    const updateTask = (patch: Partial<SpaceTask>) => onChange({ ...task, ...patch });

    const updateManualBlocks = (nextBlocks: WorkBlock[]) => {
        onChange(setTaskManualWorkBlocks(task, nextBlocks));
    };

    const addManualBlock = () => {
        updateManualBlocks([...workBlocks, createTaskWorkBlock(task.id, workBlocks.length)]);
    };

    const updateManualBlock = (blockId: string, patch: Partial<WorkBlock>) => {
        updateManualBlocks(
            workBlocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block))
        );
    };

    const removeManualBlock = (blockId: string) => {
        updateManualBlocks(workBlocks.filter((block) => block.id !== blockId));
    };

    return (
        <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-5">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-lg shadow-slate-300/60">
                            <i className="fa-solid fa-layer-group text-sm"></i>
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Trabajo</p>
                            <h4 className="text-lg font-black text-slate-900 uppercase tracking-tight">Plazo, esfuerzo y bloques</h4>
                        </div>
                    </div>
                    <p className="text-[11px] text-slate-500 font-bold leading-relaxed">
                        El plazo orienta la tarea. Solo los eventos y los bloques de trabajo reservan tiempo real en la agenda.
                    </p>
                </div>
            </div>

            <div className="flex gap-2">
                <PlanningModeButton
                    active={planningMode === 'none'}
                    icon="fa-layer-group"
                    label="Sin Bloques"
                    onClick={() => onChange(setTaskPlanningMode(task, 'none'))}
                />
                <PlanningModeButton
                    active={planningMode === 'ai'}
                    icon="fa-wand-magic-sparkles"
                    label="IA"
                    onClick={() => onChange(setTaskPlanningMode(task, 'ai'))}
                />
                <PlanningModeButton
                    active={planningMode === 'manual'}
                    icon="fa-calendar-days"
                    label="Manual"
                    onClick={() => onChange(setTaskPlanningMode(task, 'manual'))}
                />
            </div>

            {parentRange && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
                    <i className="fa-solid fa-diagram-project text-amber-500 mt-0.5"></i>
                    <div className="space-y-1">
                        <p className="text-[9px] font-black uppercase tracking-widest text-amber-700">Rango de la tarea padre</p>
                        <p className="text-[11px] text-amber-900 font-bold leading-relaxed">
                            {parentRange.parentStart ? `Inicio permitido desde ${formatSlotDateTime(parentRange.parentStart)}.` : 'Sin restricción de inicio.'}{' '}
                            {parentRange.parentEnd ? `Deadline padre: ${formatSlotDateTime(parentRange.parentEnd)}.` : 'Sin deadline padre.'}
                        </p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <LabeledInput
                    label="Inicio más temprano"
                    type="datetime-local"
                    value={toDateTimeLocalValue(task.earliestStartAt)}
                    onChange={(value) => updateTask({ earliestStartAt: value })}
                />
                <LabeledInput
                    label="Fecha límite"
                    type="datetime-local"
                    value={toDateTimeLocalValue(task.dueDate)}
                    onChange={(value) => updateTask({ dueDate: value })}
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1">Tipo Deadline</label>
                    <select
                        value={task.deadlineType}
                        onChange={(event) => updateTask({ deadlineType: event.target.value as DeadlineType })}
                        className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-black text-xs uppercase outline-none focus:ring-4 ring-blue-500/10"
                    >
                        <option value="Soft Deadline">Soft Deadline</option>
                        <option value="Hard Deadline">Hard Deadline</option>
                    </select>
                </div>
                <MinutesInput
                    label="Esfuerzo estimado"
                    value={task.estimatedEffortMinutes ?? task.duration}
                    onChange={(value) => updateTask({ estimatedEffortMinutes: value, duration: value })}
                />
                <MinutesInput
                    label="Tamaño ideal del bloque"
                    value={task.preferredBlockMinutes}
                    onChange={(value) => updateTask({ preferredBlockMinutes: value })}
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1">Estilo de trabajo</label>
                    <select
                        value={task.workStyle || 'flexible'}
                        onChange={(event) => {
                            const workStyle = event.target.value as TaskWorkStyle;
                            updateTask({
                                workStyle,
                                elasticity: workStyle === 'deep-work' ? 0 : 1,
                            });
                        }}
                        className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-black text-xs uppercase outline-none focus:ring-4 ring-blue-500/10"
                    >
                        <option value="flexible">Flexible</option>
                        <option value="deep-work">Deep Work</option>
                    </select>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-circle-info text-xs"></i>
                    </div>
                    <div>
                        <p className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Lectura del modelo</p>
                        <p className="text-[11px] text-slate-600 font-bold leading-relaxed">
                            Flexible permite repartir el trabajo. Deep Work privilegia bloques más largos y continuos.
                        </p>
                    </div>
                </div>
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Bloques de trabajo</p>
                        <p className="text-[11px] text-slate-500 font-bold">
                            {planningMode === 'none' && 'La tarea no reservará tiempo por ahora.'}
                            {planningMode === 'ai' && 'La IA propondrá bloques compatibles con la agenda actual.'}
                            {planningMode === 'manual' && 'Cada bloque reserva tiempo exclusivo para esta tarea.'}
                        </p>
                    </div>
                    {planningMode === 'manual' && (
                        <button
                            type="button"
                            onClick={addManualBlock}
                            className="px-3 py-2 rounded-xl bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest shadow-sm"
                        >
                            <i className="fa-solid fa-plus mr-1.5"></i>
                            Añadir bloque
                        </button>
                    )}
                </div>

                {planningMode === 'none' && (
                    <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-5 text-center">
                        <p className="text-[11px] text-slate-500 font-bold">
                            Puedes dejar la tarea sin bloques y planificar su tiempo más adelante.
                        </p>
                    </div>
                )}

                {planningMode === 'ai' && (
                    <div className="space-y-2">
                        {workBlocks.length > 0 ? (
                            workBlocks.map((block) => (
                                <div key={block.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Bloque sugerido</p>
                                        <p className="text-xs font-black text-slate-800">
                                            {formatSlotDateTime(block.startAt)} - {formatSlotDateTime(block.endAt)}
                                        </p>
                                    </div>
                                    <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-[9px] font-black uppercase tracking-widest">
                                        {block.locked ? 'Fijo' : 'Sugerido'}
                                    </span>
                                </div>
                            ))
                        ) : (
                            <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-5">
                                <p className="text-[11px] text-slate-500 font-bold leading-relaxed">
                                    Aún no hay bloques calculados. La vista los irá sugiriendo a partir de plazo, esfuerzo y prioridad.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {planningMode === 'manual' && (
                    <div className="space-y-3">
                        {workBlocks.length > 0 ? (
                            workBlocks.map((block, index) => (
                                <div key={block.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Bloque {index + 1}</p>
                                        <button
                                            type="button"
                                            onClick={() => removeManualBlock(block.id)}
                                            className="w-8 h-8 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                        >
                                            <i className="fa-solid fa-trash-can"></i>
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <LabeledInput
                                            label="Inicio"
                                            type="datetime-local"
                                            value={toDateTimeLocalValue(block.startAt)}
                                            onChange={(value) => updateManualBlock(block.id, { startAt: value })}
                                        />
                                        <LabeledInput
                                            label="Fin"
                                            type="datetime-local"
                                            value={toDateTimeLocalValue(block.endAt)}
                                            onChange={(value) => updateManualBlock(block.id, { endAt: value })}
                                        />
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-5">
                                <p className="text-[11px] text-slate-500 font-bold">
                                    Todavía no hay bloques manuales. Crea al menos uno para reservar tiempo.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {planningError && (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
                        <i className="fa-solid fa-triangle-exclamation text-red-500 mt-0.5"></i>
                        <p className="text-[11px] text-red-800 font-bold leading-relaxed">{planningError}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TaskPlanningSection;
