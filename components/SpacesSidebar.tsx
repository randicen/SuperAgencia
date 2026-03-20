
import React, { useState, useMemo } from 'react';
import { useSpaces } from '../contexts/SpacesContext';
import { SpaceTask } from '../spacesTypes';

const COLORS = ['#7C3AED', '#2563EB', '#059669', '#DC2626', '#F59E0B', '#EC4899'];

const SpacesSidebar: React.FC = () => {
    const { state, dispatch } = useSpaces();
    const [newSpaceName, setNewSpaceName] = useState('');
    const [showAddSpace, setShowAddSpace] = useState(false);
    const [addingFolderToSpace, setAddingFolderToSpace] = useState<string | null>(null);
    const [addingListTo, setAddingListTo] = useState<{ spaceId: string; folderId?: string } | null>(null);
    const [inputValue, setInputValue] = useState('');

    // Workspace Switcher State
    const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
    const [newWorkspaceName, setNewWorkspaceName] = useState('');
    const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
    const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
    const [editWorkspaceName, setEditWorkspaceName] = useState('');

    // State for renaming nodes
    const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null);
    const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
    const [editingListId, setEditingListId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

    // State for Custom Delete Modal
    const [deleteModal, setDeleteModal] = useState<{ type: string; payload: any; message: string; subMessage: string } | null>(null);

    const activeWorkspace = state.workspaces.find(w => w.id === state.activeWorkspaceId);
    const espacios = activeWorkspace?.espacios || [];

    // Compute upcoming tasks from the selected scope
    const upcomingTasks = useMemo(() => {
        const flattenTasks = (tasks: SpaceTask[]): SpaceTask[] => {
            const result: SpaceTask[] = [];
            for (const t of tasks) {
                result.push(t);
                if (t.subtasks) result.push(...flattenTasks(t.subtasks));
            }
            return result;
        };

        let collected: SpaceTask[] = [];
        const activeSpace = espacios.find(s => s.id === state.activeSpaceId);
        
        if (state.activeListId && activeSpace) {
            // Specific list selected
            const findList = () => {
                const directList = activeSpace.listas.find(l => l.id === state.activeListId);
                if (directList) return directList;
                for (const f of activeSpace.carpetas) {
                    const fl = f.listas.find(l => l.id === state.activeListId);
                    if (fl) return fl;
                }
                return null;
            };
            const list = findList();
            if (list) collected = flattenTasks(list.tareas);
        } else if (state.activeFolderId && activeSpace) {
            // Folder selected
            const folder = activeSpace.carpetas.find(f => f.id === state.activeFolderId);
            if (folder) {
                folder.listas.forEach(l => { collected.push(...flattenTasks(l.tareas)); });
            }
        } else if (activeSpace) {
            // Space selected
            activeSpace.listas.forEach(l => { collected.push(...flattenTasks(l.tareas)); });
            activeSpace.carpetas.forEach(f => { f.listas.forEach(l => { collected.push(...flattenTasks(l.tareas)); }); });
        }

        // Filter out DONE and tasks without dueDate, then sort by dueDate ascending
        return collected
            .filter(t => t.estado !== 'DONE' && t.dueDate)
            .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
            .slice(0, 5);
    }, [espacios, state.activeSpaceId, state.activeFolderId, state.activeListId]);

    const handleRenameSpace = (id: string) => {
        if (!editName.trim()) return;
        dispatch({ type: 'RENAME_SPACE', payload: { spaceId: id, nombre: editName.trim() } });
        setEditingSpaceId(null);
    };

    const handleRenameFolder = (spaceId: string, folderId: string) => {
        if (!editName.trim()) return;
        dispatch({ type: 'RENAME_FOLDER', payload: { spaceId, folderId, nombre: editName.trim() } });
        setEditingFolderId(null);
    };

    const handleRenameList = (spaceId: string, listId: string, folderId?: string) => {
        if (!editName.trim()) return;
        dispatch({ type: 'RENAME_LIST', payload: { spaceId, folderId, listId, nombre: editName.trim() } });
        setEditingListId(null);
    };

    const handleAddSpace = () => {
        if (!newSpaceName.trim()) return;
        const newId = Math.random().toString(36).substr(2, 9);
        dispatch({
            type: 'ADD_SPACE',
            payload: { id: newId, nombre: newSpaceName.trim(), color: COLORS[espacios.length % COLORS.length] },
        });
        dispatch({ type: 'SET_ACTIVE', payload: { spaceId: newId, folderId: null, listId: null } });
        setNewSpaceName('');
        setShowAddSpace(false);
    };

    const handleAddFolder = (spaceId: string) => {
        if (!inputValue.trim()) return;
        dispatch({ type: 'ADD_FOLDER', payload: { spaceId, nombre: inputValue.trim() } });
        setInputValue('');
        setAddingFolderToSpace(null);
        if (!state.expandedIds.includes(spaceId)) {
            dispatch({ type: 'TOGGLE_EXPAND', payload: { id: spaceId } });
        }
    };

    const handleAddList = (spaceId: string, folderId?: string) => {
        if (!inputValue.trim()) return;
        const newId = Math.random().toString(36).substr(2, 9);
        dispatch({ type: 'ADD_LIST', payload: { id: newId, spaceId, folderId, nombre: inputValue.trim() } });
        dispatch({ type: 'SET_ACTIVE', payload: { spaceId, folderId: folderId || null, listId: newId } });
        setInputValue('');
        setAddingListTo(null);
        const parentId = folderId || spaceId;
        if (!state.expandedIds.includes(parentId)) {
            dispatch({ type: 'TOGGLE_EXPAND', payload: { id: parentId } });
        }
    };

    const handleListClick = (spaceId: string, listId: string, folderId?: string) => {
        dispatch({ type: 'SET_ACTIVE', payload: { spaceId, folderId: folderId || null, listId } });
    };

    const handleSpaceClick = (spaceId: string) => {
        dispatch({ type: 'SET_ACTIVE', payload: { spaceId, folderId: null, listId: null } });
    };

    const handleFolderClick = (spaceId: string, folderId: string) => {
        dispatch({ type: 'SET_ACTIVE', payload: { spaceId, folderId, listId: null } });
    };

    const handleCreateWorkspace = () => {
        if (!newWorkspaceName.trim()) return;
        dispatch({ type: 'ADD_WORKSPACE', payload: { nombre: newWorkspaceName.trim() } });
        setNewWorkspaceName('');
        setIsCreatingWorkspace(false);
        setShowWorkspaceMenu(false);
    };

    const handleRenameWorkspace = (id: string) => {
        if (!editWorkspaceName.trim()) return;
        dispatch({ type: 'RENAME_WORKSPACE', payload: { workspaceId: id, nombre: editWorkspaceName.trim() } });
        setEditingWorkspaceId(null);
    };

    const handleDeleteWorkspace = (e: React.MouseEvent, id: string, name: string) => {
        e.preventDefault();
        e.stopPropagation();
        setDeleteModal({
            type: 'DELETE_WORKSPACE',
            payload: { workspaceId: id },
            message: `Eliminar "${name}"`,
            subMessage: 'Esta acción eliminará el workspace y todo su contenido. No se puede deshacer.'
        });
    };

    return (
        <div className="w-56 bg-[#0F1117] border-r border-[#1E293B] flex flex-col h-full overflow-hidden">
            {/* WORKSPACE SWITCHER */}
            <div className="relative border-b border-[#1E293B]">
                <button
                    onClick={() => setShowWorkspaceMenu(!showWorkspaceMenu)}
                    className="w-full h-14 px-4 flex items-center justify-between hover:bg-[#1A1C23] transition-colors"
                >
                    <div className="flex items-center gap-2 overflow-hidden">
                        <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                            {activeWorkspace?.nombre.substring(0, 2).toUpperCase() || 'WS'}
                        </div>
                        <span className="font-bold text-sm text-slate-200 truncate">{activeWorkspace?.nombre || 'Select Workspace'}</span>
                    </div>
                    <i className="fa-solid fa-chevron-down text-xs text-slate-500"></i>
                </button>

                {showWorkspaceMenu && (
                    <div className="absolute top-full left-0 w-full bg-[#1A1C23] border-b border-[#1E293B] shadow-xl z-50 animate-in fade-in slide-in-from-top-2 p-2 space-y-2">
                        {state.workspaces.map(ws => (
                            <div key={ws.id} className="group flex items-center justify-between p-2 rounded hover:bg-[#2A2D35] cursor-pointer" onClick={() => { dispatch({ type: 'SET_ACTIVE_WORKSPACE', payload: { workspaceId: ws.id } }); setShowWorkspaceMenu(false); }}>
                                {editingWorkspaceId === ws.id ? (
                                    <input
                                        autoFocus
                                        value={editWorkspaceName}
                                        onChange={e => setEditWorkspaceName(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') handleRenameWorkspace(ws.id);
                                            e.stopPropagation();
                                        }}
                                        onClick={e => e.stopPropagation()}
                                        onBlur={() => setEditingWorkspaceId(null)}
                                        className="bg-[#0F1117] text-white text-xs p-1 rounded border border-blue-500 w-full"
                                    />
                                ) : (
                                    <span className={`text-xs ${ws.id === state.activeWorkspaceId ? 'text-blue-400 font-bold' : 'text-slate-300'}`}>{ws.nombre}</span>
                                )}

                                <div className="hidden group-hover:flex items-center gap-1">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setEditingWorkspaceId(ws.id); setEditWorkspaceName(ws.nombre); }}
                                        className="text-slate-500 hover:text-white p-1"
                                    >
                                        <i className="fa-solid fa-pencil text-[10px]"></i>
                                    </button>
                                    <button
                                        onClick={(e) => handleDeleteWorkspace(e, ws.id, ws.nombre)}
                                        className="text-slate-500 hover:text-red-500 p-1"
                                    >
                                        <i className="fa-solid fa-trash text-[10px]"></i>
                                    </button>
                                </div>
                            </div>
                        ))}

                        {isCreatingWorkspace ? (
                            <div className="p-2 bg-[#0F1117] rounded border border-[#2A2D35]">
                                <input
                                    autoFocus
                                    value={newWorkspaceName}
                                    onChange={e => setNewWorkspaceName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleCreateWorkspace()}
                                    placeholder="New Workspace Name"
                                    className="w-full bg-transparent text-white text-xs outline-none mb-2"
                                />
                                <div className="flex gap-2">
                                    <button onClick={handleCreateWorkspace} className="bg-blue-600 text-[10px] text-white px-2 py-1 rounded">Create</button>
                                    <button onClick={() => setIsCreatingWorkspace(false)} className="text-[10px] text-slate-400">Cancel</button>
                                </div>
                            </div>
                        ) : (
                            <button onClick={() => setIsCreatingWorkspace(true)} className="w-full text-left p-2 text-xs text-blue-400 hover:bg-[#2A2D35] rounded flex items-center gap-2">
                                <i className="fa-solid fa-plus text-green-500"></i> Add New Workspace
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Header: Espacios */}
            <div className="h-10 flex items-center justify-between px-4 shrink-0 bg-[#0F1117]">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Espacios</span>
                <button
                    onClick={() => setShowAddSpace(true)}
                    className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-700 rounded transition-colors"
                >
                    <i className="fa-solid fa-plus text-[10px]"></i>
                </button>
            </div>

            {/* Add Space Form */}
            {showAddSpace && (
                <div className="p-3 border-b border-[#1E293B] bg-[#1A1C23]">
                    <input
                        autoFocus
                        value={newSpaceName}
                        onChange={(e) => setNewSpaceName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddSpace()}
                        placeholder="Nombre del espacio..."
                        className="w-full bg-[#0F1117] text-white text-xs p-2 rounded border border-[#2A2D35] focus:border-blue-500 outline-none"
                    />
                    <div className="flex gap-2 mt-2">
                        <button onClick={handleAddSpace} className="flex-1 py-1.5 bg-blue-600 text-white text-[10px] font-bold uppercase rounded">
                            Crear
                        </button>
                        <button onClick={() => setShowAddSpace(false)} className="flex-1 py-1.5 text-slate-400 text-[10px] font-bold uppercase">
                            Cancelar
                        </button>
                    </div>
                </div>
            )}

            {/* Spaces List */}
            <div className="flex-1 overflow-y-auto py-2 custom-scrollbar">
                {espacios.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                        <i className="fa-solid fa-layer-group text-2xl text-slate-600 mb-2"></i>
                        <p className="text-[10px] text-slate-500">No hay espacios</p>
                        <button
                            onClick={() => setShowAddSpace(true)}
                            className="mt-2 text-[10px] text-blue-500 hover:text-blue-400"
                        >
                            Crear tu primer espacio
                        </button>
                    </div>
                ) : (
                    espacios.map((space) => {
                        const isSpaceExpanded = state.expandedIds.includes(space.id);
                        const isActive = state.activeSpaceId === space.id;
                        const isSpaceStrictlyActive = isActive && !state.activeFolderId && !state.activeListId;

                        return (
                            <div key={space.id} className="mb-1">
                                {/* Space Item */}
                                <div
                                    onClick={() => handleSpaceClick(space.id)}
                                    className={`group flex items-center gap-2 px-3 py-1.5 mx-2 rounded cursor-pointer transition-colors ${isSpaceStrictlyActive ? 'bg-[#1E293B] ring-1 ring-[#3A57E8]/50' : isActive ? 'bg-[#1E293B]/50' : 'hover:bg-[#1A1C23]'
                                        }`}
                                >
                                    <button
                                        onClick={(e) => { e.stopPropagation(); dispatch({ type: 'TOGGLE_EXPAND', payload: { id: space.id } }); }}
                                        className="w-4 h-4 flex items-center justify-center text-slate-500"
                                    >
                                        <i className={`fa-solid fa-chevron-right text-[8px] transition-transform ${isSpaceExpanded ? 'rotate-90' : ''}`}></i>
                                    </button>
                                    <div className="w-3 h-3 rounded" style={{ backgroundColor: space.color }}></div>
                                    <div 
                                        className="flex-1 overflow-hidden"
                                        onDoubleClick={(e) => { e.stopPropagation(); setEditingSpaceId(space.id); setEditName(space.nombre); }}
                                    >
                                        {editingSpaceId === space.id ? (
                                            <input
                                                autoFocus
                                                value={editName}
                                                onChange={e => setEditName(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleRenameSpace(space.id)}
                                                onBlur={() => setEditingSpaceId(null)}
                                                onClick={e => e.stopPropagation()}
                                                className="w-full bg-transparent text-xs text-white border-b border-blue-500 outline-none"
                                            />
                                        ) : (
                                            <span className="text-xs text-slate-300 truncate block">{space.nombre}</span>
                                        )}
                                    </div>
                                    <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setEditingSpaceId(space.id); setEditName(space.nombre); }}
                                            className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-blue-400"
                                            title="Renombrar (Doble clic)"
                                        >
                                            <i className="fa-solid fa-pen-to-square text-[10px]"></i>
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setAddingFolderToSpace(space.id); setInputValue(''); }}
                                            className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-600 rounded"
                                            title="Agregar carpeta"
                                        >
                                            <i className="fa-solid fa-folder-plus text-[10px]"></i>
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setAddingListTo({ spaceId: space.id }); setInputValue(''); }}
                                            className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-600 rounded"
                                            title="Agregar lista"
                                        >
                                            <i className="fa-solid fa-list text-[10px]"></i>
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setDeleteModal({ type: 'DELETE_SPACE', payload: { spaceId: space.id }, message: `Eliminar Espacio: ${space.nombre}`, subMessage: 'Se eliminarán todas las carpetas y listas que contiene. Esta acción no se puede deshacer.' }); }}
                                            className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-red-500 hover:bg-slate-600 rounded"
                                            title="Eliminar"
                                        >
                                            <i className="fa-solid fa-trash text-[10px]"></i>
                                        </button>
                                    </div>
                                </div>

                                {/* Expanded Content */}
                                {isSpaceExpanded && (
                                    <div className="ml-6 mt-1 space-y-0.5">
                                        {/* Add Folder Form */}
                                        {addingFolderToSpace === space.id && (
                                            <div className="mx-2 p-2 bg-[#1A1C23] rounded border border-[#2A2D35]">
                                                <input
                                                    autoFocus
                                                    value={inputValue}
                                                    onChange={(e) => setInputValue(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleAddFolder(space.id)}
                                                    placeholder="Nombre de carpeta..."
                                                    className="w-full bg-[#0F1117] text-white text-[10px] p-1.5 rounded border border-[#2A2D35] outline-none"
                                                />
                                                <div className="flex gap-1 mt-1">
                                                    <button onClick={() => handleAddFolder(space.id)} className="flex-1 py-1 bg-blue-600 text-white text-[9px] rounded">OK</button>
                                                    <button onClick={() => setAddingFolderToSpace(null)} className="flex-1 py-1 text-slate-400 text-[9px]">✕</button>
                                                </div>
                                            </div>
                                        )}

                                        {/* Folders */}
                                        {space.carpetas.map((folder) => {
                                            const isFolderExpanded = state.expandedIds.includes(folder.id);
                                            const isFolderStrictlyActive = state.activeFolderId === folder.id && !state.activeListId;
                                            return (
                                                <div key={folder.id}>
                                                    <div 
                                                        onClick={() => handleFolderClick(space.id, folder.id)}
                                                        className={`group flex items-center gap-2 px-2 py-1 mx-2 rounded cursor-pointer transition-colors ${isFolderStrictlyActive ? 'bg-[#2A2D35] ring-1 ring-yellow-500/50' : 'hover:bg-[#1A1C23]'}`}
                                                    >
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); dispatch({ type: 'TOGGLE_EXPAND', payload: { id: folder.id } }); }}
                                                            className="w-3 h-3 flex items-center justify-center text-slate-500"
                                                        >
                                                            <i className={`fa-solid fa-chevron-right text-[7px] transition-transform ${isFolderExpanded ? 'rotate-90' : ''}`}></i>
                                                        </button>
                                                        <i className="fa-solid fa-folder text-yellow-500 text-[10px]"></i>
                                                        <div 
                                                            className="flex-1 overflow-hidden"
                                                            onDoubleClick={(e) => { e.stopPropagation(); setEditingFolderId(folder.id); setEditName(folder.nombre); }}
                                                        >
                                                            {editingFolderId === folder.id ? (
                                                                <input
                                                                    autoFocus
                                                                    value={editName}
                                                                    onChange={e => setEditName(e.target.value)}
                                                                    onKeyDown={e => e.key === 'Enter' && handleRenameFolder(space.id, folder.id)}
                                                                    onBlur={() => setEditingFolderId(null)}
                                                                    onClick={e => e.stopPropagation()}
                                                                    className="w-full bg-transparent text-[10px] text-white border-b border-blue-500 outline-none"
                                                                />
                                                            ) : (
                                                                <span className="text-[11px] text-slate-400 truncate block">{folder.nombre}</span>
                                                            )}
                                                        </div>
                                                        <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setEditingFolderId(folder.id); setEditName(folder.nombre); }}
                                                                className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-blue-400"
                                                                title="Renombrar (Doble clic)"
                                                            >
                                                                <i className="fa-solid fa-pen-to-square text-[10px]"></i>
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setAddingListTo({ spaceId: space.id, folderId: folder.id }); setInputValue(''); }}
                                                                className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-white"
                                                            >
                                                                <i className="fa-solid fa-plus text-[10px]"></i>
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setDeleteModal({ type: 'DELETE_FOLDER', payload: { spaceId: space.id, folderId: folder.id }, message: `Eliminar Carpeta: ${folder.nombre}`, subMessage: 'Se eliminarán todas las listas dentro de ella. Esta acción no se puede deshacer.' }); }}
                                                                className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-red-500"
                                                            >
                                                                <i className="fa-solid fa-trash text-[10px]"></i>
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Lists inside Folder */}
                                                    {isFolderExpanded && (
                                                        <div className="ml-5 space-y-0.5">
                                                            {addingListTo?.spaceId === space.id && addingListTo?.folderId === folder.id && (
                                                                <div className="mx-2 p-2 bg-[#1A1C23] rounded border border-[#2A2D35]">
                                                                    <input
                                                                        autoFocus
                                                                        value={inputValue}
                                                                        onChange={(e) => setInputValue(e.target.value)}
                                                                        onKeyDown={(e) => e.key === 'Enter' && handleAddList(space.id, folder.id)}
                                                                        placeholder="Nombre de lista..."
                                                                        className="w-full bg-[#0F1117] text-white text-[10px] p-1.5 rounded border border-[#2A2D35] outline-none"
                                                                    />
                                                                    <div className="flex gap-1 mt-1">
                                                                        <button onClick={() => handleAddList(space.id, folder.id)} className="flex-1 py-1 bg-blue-600 text-white text-[9px] rounded">OK</button>
                                                                        <button onClick={() => setAddingListTo(null)} className="flex-1 py-1 text-slate-400 text-[9px]">✕</button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                            {folder.listas.map((list) => (
                                                                <div
                                                                    key={list.id}
                                                                    onClick={() => handleListClick(space.id, list.id, folder.id)}
                                                                    className={`group flex items-center gap-2 px-2 py-1 mx-2 rounded cursor-pointer transition-colors ${state.activeListId === list.id ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-[#1A1C23] text-slate-400'
                                                                        }`}
                                                                >
                                                                    <i className="fa-solid fa-list text-[9px]"></i>
                                                                    <div 
                                                                        className="flex-1 overflow-hidden"
                                                                        onDoubleClick={(e) => { e.stopPropagation(); setEditingListId(list.id); setEditName(list.nombre); }}
                                                                    >
                                                                        {editingListId === list.id ? (
                                                                            <input
                                                                                autoFocus
                                                                                value={editName}
                                                                                onChange={e => setEditName(e.target.value)}
                                                                                onKeyDown={e => e.key === 'Enter' && handleRenameList(space.id, list.id, folder.id)}
                                                                                onBlur={() => setEditingListId(null)}
                                                                                onClick={e => e.stopPropagation()}
                                                                                className="w-full bg-transparent text-[10px] text-white border-b border-blue-500 outline-none"
                                                                            />
                                                                        ) : (
                                                                            <span className="text-[11px] truncate block">{list.nombre}</span>
                                                                        )}
                                                                    </div>
                                                                    <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); setEditingListId(list.id); setEditName(list.nombre); }}
                                                                            className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-blue-400"
                                                                            title="Renombrar (Doble clic)"
                                                                        >
                                                                            <i className="fa-solid fa-pen-to-square text-[10px]"></i>
                                                                        </button>
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); setDeleteModal({ type: 'DELETE_LIST', payload: { spaceId: space.id, folderId: folder.id, listId: list.id }, message: `Eliminar Lista: ${list.nombre}`, subMessage: 'Las tareas de esta lista se perderán permanentemente.' }); }}
                                                                            className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-red-500"
                                                                            title="Eliminar"
                                                                        >
                                                                            <i className="fa-solid fa-trash text-[10px]"></i>
                                                                        </button>
                                                                    </div>
                                                                    <span className="text-[9px] text-slate-500 group-hover:hidden">{list.tareas.length}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}

                                        {/* Direct Lists (no folder) */}
                                        {addingListTo?.spaceId === space.id && !addingListTo?.folderId && (
                                            <div className="mx-2 p-2 bg-[#1A1C23] rounded border border-[#2A2D35]">
                                                <input
                                                    autoFocus
                                                    value={inputValue}
                                                    onChange={(e) => setInputValue(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleAddList(space.id)}
                                                    placeholder="Nombre de lista..."
                                                    className="w-full bg-[#0F1117] text-white text-[10px] p-1.5 rounded border border-[#2A2D35] outline-none"
                                                />
                                                <div className="flex gap-1 mt-1">
                                                    <button onClick={() => handleAddList(space.id)} className="flex-1 py-1 bg-blue-600 text-white text-[9px] rounded">OK</button>
                                                    <button onClick={() => setAddingListTo(null)} className="flex-1 py-1 text-slate-400 text-[9px]">✕</button>
                                                </div>
                                            </div>
                                        )}
                                        {space.listas.map((list) => (
                                            <div
                                                key={list.id}
                                                onClick={() => handleListClick(space.id, list.id)}
                                                className={`group flex items-center gap-2 px-2 py-1 mx-2 rounded cursor-pointer transition-colors ${state.activeListId === list.id ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-[#1A1C23] text-slate-400'
                                                    }`}
                                            >
                                                <i className="fa-solid fa-list text-[9px]"></i>
                                                 <div 
                                                     className="flex-1 overflow-hidden"
                                                     onDoubleClick={(e) => { e.stopPropagation(); setEditingListId(list.id); setEditName(list.nombre); }}
                                                 >
                                                     {editingListId === list.id ? (
                                                         <input
                                                             autoFocus
                                                             value={editName}
                                                             onChange={e => setEditName(e.target.value)}
                                                             onKeyDown={e => e.key === 'Enter' && handleRenameList(space.id, list.id)}
                                                             onBlur={() => setEditingListId(null)}
                                                             onClick={e => e.stopPropagation()}
                                                             className="w-full bg-transparent text-[10px] text-white border-b border-blue-500 outline-none"
                                                         />
                                                     ) : (
                                                         <span className="text-[11px] truncate block">{list.nombre}</span>
                                                     )}
                                                 </div>
                                                 <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                                                     <button
                                                         onClick={(e) => { e.stopPropagation(); setEditingListId(list.id); setEditName(list.nombre); }}
                                                         className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-blue-400"
                                                         title="Renombrar (Doble clic)"
                                                     >
                                                         <i className="fa-solid fa-pen-to-square text-[10px]"></i>
                                                     </button>
                                                     <button
                                                         onClick={(e) => { e.stopPropagation(); setDeleteModal({ type: 'DELETE_LIST', payload: { spaceId: space.id, listId: list.id }, message: `Eliminar Lista: ${list.nombre}`, subMessage: 'Las tareas de esta lista se perderán permanentemente.' }); }}
                                                         className="w-5 h-5 flex items-center justify-center text-slate-500 hover:text-red-500"
                                                         title="Eliminar"
                                                     >
                                                         <i className="fa-solid fa-trash text-[10px]"></i>
                                                     </button>
                                                 </div>
                                                <span className="text-[9px] text-slate-500 group-hover:hidden">{list.tareas.length}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* UPCOMING TASKS MINI-TABLE */}
            {upcomingTasks.length > 0 && (
                <div className="border-t border-[#1E293B] px-3 py-3 shrink-0">
                    <div className="flex items-center gap-2 mb-2">
                        <i className="fa-solid fa-clock text-blue-400 text-[10px]"></i>
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider">Próximas Tareas</span>
                    </div>
                    <div className="space-y-1">
                        {upcomingTasks.map((t) => {
                            const due = new Date(t.dueDate);
                            const now = new Date();
                            const diffMs = due.getTime() - now.getTime();
                            const isOverdue = diffMs < 0;
                            const absDiff = Math.abs(diffMs);
                            const daysLeft = Math.floor(absDiff / (1000 * 3600 * 24));
                            const hoursLeft = Math.floor((absDiff % (1000 * 3600 * 24)) / (1000 * 3600));

                            let timeLabel = '';
                            if (daysLeft > 0) timeLabel = `${daysLeft}d ${hoursLeft}h`;
                            else if (hoursLeft > 0) timeLabel = `${hoursLeft}h`;
                            else timeLabel = '<1h';

                            const priorityColor = t.priority === 'ASAP' ? 'bg-purple-500' : t.priority === 'High' ? 'bg-red-500' : t.priority === 'Medium' ? 'bg-orange-400' : 'bg-emerald-500';

                            return (
                                <div
                                    key={t.id}
                                    className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-[#1A1C23] transition-colors group cursor-default"
                                >
                                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${priorityColor}`}></div>
                                    <span className="text-[10px] text-slate-300 truncate flex-1 font-medium" title={t.nombre}>
                                        {t.nombre}
                                    </span>
                                    <span className={`text-[9px] font-bold shrink-0 ${isOverdue ? 'text-red-400' : daysLeft === 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                                        {isOverdue ? `-${timeLabel}` : timeLabel}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* CUSTOM DELETE CONFIRMATION MODAL */}
            {deleteModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-[#1A1C23] border border-[#2A2D35] rounded-xl shadow-2xl p-6 w-80 animate-in zoom-in-95 duration-200">
                        <div className="flex justify-center mb-4">
                            <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center">
                                <i className="fa-solid fa-triangle-exclamation text-red-500 text-xl"></i>
                            </div>
                        </div>
                        <h3 className="text-white text-center font-bold mb-2">{deleteModal.message}</h3>
                        <p className="text-slate-400 text-xs text-center mb-6 leading-relaxed">
                            {deleteModal.subMessage}
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setDeleteModal(null)}
                                className="flex-1 px-4 py-2 bg-[#2A2D35] hover:bg-[#343841] text-slate-300 text-xs font-bold rounded-lg transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    dispatch({ type: deleteModal.type as any, payload: deleteModal.payload });
                                    setDeleteModal(null);
                                }}
                                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors shadow-lg shadow-red-500/20"
                            >
                                Eliminar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SpacesSidebar;
