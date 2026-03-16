
$path = "C:\Users\acer\Desktop\proyectos antigravity\documentos\2026 coo_cfo-in-a-box\components\SpacesView.tsx"
$content = Get-Content $path -Raw

# Use Regex to find the block. Escape special chars in the signature match.
# Pattern: const renderTaskRow ... until ... return renderTaskRow(task);
$pattern = "(?s)\s*const renderTaskRow = \(t: SpaceTask, level: number = 0\) => \{.*?return renderTaskRow\(task\);"

$replacement = @'

                    // FIXED: Flat rendering for Gantt (Top level only)
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
'@

if ($content -match $pattern) {
    $newContent = $content -replace $pattern, $replacement
    Set-Content $path $newContent -NoNewline
    Write-Host "Success: File patched with Regex."
}
else {
    Write-Host "Error: Regex pattern not found."
}
