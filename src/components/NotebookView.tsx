
import React, { useState, useEffect } from 'react';
import { Note } from '../types';

interface NotebookViewProps {
  notes: Note[];
  onSaveNote: (note: Note) => void;
  onDeleteNote: (id: string) => void;
  onDiscussNote: (note: Note) => void;
}

const NotebookView: React.FC<NotebookViewProps> = ({ notes, onSaveNote, onDeleteNote, onDiscussNote }) => {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [editData, setEditData] = useState<{title: string, content: string}>({ title: '', content: '' });
  const [isEditing, setIsEditing] = useState(false);

  // Ordenar notas por modificación
  const sortedNotes = [...notes].sort((a, b) => b.lastModified - a.lastModified);

  const handleSelectNote = (note: Note) => {
    setSelectedNoteId(note.id);
    setEditData({ title: note.title, content: note.content });
    setIsEditing(false); // Modo visualización primero
  };

  const handleCreateNew = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    const newNote: Note = {
      id: newId,
      title: 'Nueva Nota Sin Título',
      content: '',
      lastModified: Date.now()
    };
    onSaveNote(newNote);
    handleSelectNote(newNote);
    setIsEditing(true); // Entrar en modo edición directamente
  };

  const handleSave = () => {
    if (selectedNoteId) {
      onSaveNote({
        id: selectedNoteId,
        title: editData.title || 'Sin Título',
        content: editData.content,
        lastModified: Date.now()
      });
      setIsEditing(false);
    }
  };

  const handleDelete = (id: string) => {
    onDeleteNote(id);
    if (selectedNoteId === id) {
      setSelectedNoteId(null);
      setEditData({ title: '', content: '' });
    }
  };

  return (
    <div className="flex h-[calc(100vh-140px)] bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden animate-in fade-in duration-500">
      
      {/* SIDEBAR DE NOTAS */}
      <div className="w-80 bg-slate-50 border-r border-slate-200 flex flex-col">
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">Libreta</h2>
            <button 
              onClick={handleCreateNew}
              className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center hover:bg-slate-700 transition-colors shadow-lg"
              title="Crear Nota"
            >
              <i className="fa-solid fa-plus"></i>
            </button>
          </div>
          <div className="relative">
            <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
            <input 
              placeholder="Buscar notas..." 
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 ring-blue-500/10"
            />
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
          {sortedNotes.length === 0 && (
            <div className="text-center p-8 text-slate-400 text-xs italic">
              No tienes notas guardadas.
            </div>
          )}
          {sortedNotes.map(note => (
            <div 
              key={note.id}
              onClick={() => handleSelectNote(note)}
              className={`p-4 rounded-xl cursor-pointer transition-all border group relative ${
                selectedNoteId === note.id 
                  ? 'bg-white border-blue-200 shadow-md ring-1 ring-blue-100' 
                  : 'bg-transparent border-transparent hover:bg-white hover:border-slate-200'
              }`}
            >
              <h4 className={`font-bold text-sm mb-1 truncate ${selectedNoteId === note.id ? 'text-blue-700' : 'text-slate-700'}`}>
                {note.title}
              </h4>
              <p className="text-[10px] text-slate-500 truncate font-medium">
                {note.content || "Sin contenido..."}
              </p>
              <span className="text-[9px] text-slate-400 mt-2 block font-mono">
                {new Date(note.lastModified).toLocaleDateString()}
              </span>
              
              <button 
                onClick={(e) => { e.stopPropagation(); handleDelete(note.id); }}
                className="absolute right-2 top-2 w-6 h-6 rounded-lg flex items-center justify-center text-slate-300 hover:bg-red-50 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
              >
                <i className="fa-solid fa-trash text-[10px]"></i>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ÁREA DE EDICIÓN / LECTURA */}
      <div className="flex-1 flex flex-col bg-white">
        {selectedNoteId ? (
          <>
            <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
               {isEditing ? (
                 <input 
                    value={editData.title}
                    onChange={(e) => setEditData({...editData, title: e.target.value})}
                    className="text-2xl font-black text-slate-800 bg-transparent outline-none placeholder:text-slate-300 w-full"
                    placeholder="Título de la Nota"
                    autoFocus
                 />
               ) : (
                 <h2 className="text-2xl font-black text-slate-800">{editData.title}</h2>
               )}
               
               <div className="flex gap-2 ml-4">
                 {!isEditing ? (
                    <>
                      <button 
                        onClick={() => onDiscussNote(notes.find(n => n.id === selectedNoteId)!)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-[10px] font-black uppercase hover:bg-blue-100 transition-colors"
                      >
                        <i className="fa-solid fa-comment-dots"></i> Discutir en AI
                      </button>
                      <button 
                        onClick={() => setIsEditing(true)}
                        className="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 transition-colors"
                      >
                        <i className="fa-solid fa-pen"></i>
                      </button>
                    </>
                 ) : (
                    <button 
                      onClick={handleSave}
                      className="flex items-center gap-2 px-6 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase shadow-lg hover:bg-slate-700 transition-colors"
                    >
                      <i className="fa-solid fa-floppy-disk"></i> Guardar
                    </button>
                 )}
               </div>
            </div>
            
            <div className="flex-1 overflow-hidden relative">
              {isEditing ? (
                <textarea 
                  value={editData.content}
                  onChange={(e) => setEditData({...editData, content: e.target.value})}
                  className="w-full h-full p-8 resize-none outline-none text-slate-700 font-medium leading-relaxed custom-scrollbar"
                  placeholder="Empieza a escribir aquí..."
                />
              ) : (
                <div className="w-full h-full p-8 overflow-y-auto custom-scrollbar">
                  <div className="prose prose-slate max-w-none text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {editData.content}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
            <i className="fa-regular fa-folder-open text-6xl mb-4 opacity-50"></i>
            <p className="font-bold text-sm">Selecciona una nota para verla o editarla</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default NotebookView;
