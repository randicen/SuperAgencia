
$path = "C:\Users\acer\Desktop\proyectos antigravity\documentos\2026 coo_cfo-in-a-box\components\SpacesView.tsx"
$content = Get-Content $path -Raw
$target = @'
                {/* Rows */}
                {tasks.filter(t => t.estado !== 'DONE').map(task => {
                    const renderTaskRow = (t: SpaceTask, level: number = 0) => {
                        const pos = getPosition(t.startDate || new Date().toISOString().split('T')[0], t.endDate || t.dueDate);

                        return (
                            <React.Fragment key={t.id}>
                                <div className="flex border-b border-slate-50 hover:bg-slate-50/30 transition-colors group">
                                    <div className="w-64 flex-shrink-0 p-3 border-r border-slate-100 bg-white sticky left-0 z-20 flex items-center gap-2">
                                        <div style={{ marginLeft: `${level * 16}px` }} className="flex items-center gap-2 overflow-hidden">
                                            {level > 0 && <div className="w-3 h-3 border-l-2 border-b-2 border-slate-200 rounded-bl-md -mt-2"></div>}
                                            <div className={`w-2 h-2 rounded-full ${t.priority === 'High' || t.priority === 'ASAP' ? 'bg-red-400' : 'bg-slate-300'}`}></div>
                                            <span className="text-xs font-bold text-slate-700 truncate">{t.nombre}</span>
                                        </div>
                                    </div>
                                    <div className="flex-1 relative h-10 flex items-center bg-white">
                                        {/* Grid lines */}
                                        {dates.map((_, i) => (
                                            <div key={i} className="flex-1 h-full border-r border-slate-50/50"></div>
                                        ))}
                                        
                                        {/* Bar */}
                                        {pos && (
                                            <div
                                                onClick={() => onEditTask(t)}
                                                className={`absolute h-6 rounded-md shadow-sm border border-white/40 overflow-hidden cursor-pointer transition-all hover:scale-[1.02] z-10 ${t.estado === 'DONE' ? 'bg-green-200 opacity-60' :
                                                        t.priority === 'ASAP' ? 'bg-purple-200' : 'bg-blue-200'
                                                    }`}
                                                style={{ left: pos.left, width: pos.width }}
                                            >
                                                <div className="h-full bg-black/5" style={{ width: `${t.progress}%` }}></div>
                                                <span className="absolute inset-0 flex items-center px-2 text-[9px] font-bold text-slate-700 whitespace-nowrap overflow-hidden">
                                                    {t.nombre}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                {/* Recurse */}
                                {t.subtasks && t.subtasks.filter(st => st.estado !== 'DONE').map(st => renderTaskRow(st, level + 1))}
                            </React.Fragment>
                        );
                    };

                    return renderTaskRow(task);
                })}
'@
$replacement = @'
                {/* Rows - TOP LEVEL ONLY - Subtasks hidden in Gantt as requested */}
                {tasks.filter(t => t.estado !== 'DONE').map(task => { // Flat rendering
                    const pos = getPosition(task.startDate || new Date().toISOString().split('T')[0], task.endDate || task.dueDate);
                    
                    return (
                        <div key={task.id} className="flex border-b border-slate-50 hover:bg-slate-50/30 transition-colors group">
                            <div className="w-64 flex-shrink-0 p-3 border-r border-slate-100 bg-white sticky left-0 z-20 flex items-center gap-2">
                                <div className="flex items-center gap-2 overflow-hidden">
                                    <div className={`w-2 h-2 rounded-full ${task.priority === 'High' || task.priority === 'ASAP' ? 'bg-red-400' : 'bg-slate-300'}`}></div>
                                    <span className="text-xs font-bold text-slate-700 truncate">{task.nombre}</span>
                                </div>
                            </div>
                            <div className="flex-1 relative h-10 flex items-center bg-white">
                                {/* Grid lines */}
                                {dates.map((_, i) => (
                                    <div key={i} className="flex-1 h-full border-r border-slate-50/50"></div>
                                ))}
                                
                                {/* Bar */}
                                {pos && (
                                    <div 
                                        onClick={() => onEditTask(task)}
                                        className={`absolute h-6 rounded-md shadow-sm border border-white/40 overflow-hidden cursor-pointer transition-all hover:scale-[1.02] z-10 ${
                                            task.estado === 'DONE' ? 'bg-green-200 opacity-60' : 
                                            task.priority === 'ASAP' ? 'bg-purple-200' : 'bg-blue-200'
                                        }`}
                                        style={{ left: pos.left, width: pos.width }}
                                    >
                                        <div className="h-full bg-black/5" style={{ width: `${task.progress}%` }}></div>
                                        <span className="absolute inset-0 flex items-center px-2 text-[9px] font-bold text-slate-700 whitespace-nowrap overflow-hidden">
                                            {task.nombre}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
'@

if ($content.Contains($target)) {
    $newContent = $content.Replace($target, $replacement)
    Set-Content $path $newContent -NoNewline
    Write-Host "Success: File patched."
}
else {
    Write-Host "Error: Target string not found."
    # Debug: Output length and first few chars
    Write-Host "Content Length: $($content.Length)"
    Write-Host "Target Length: $($target.Length)"
}
