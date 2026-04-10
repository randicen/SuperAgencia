import React, { useRef } from 'react';
import { BookOpen, Loader2, Search, Trash2, UploadCloud, X } from 'lucide-react';
import type { AttachedLibraryDocument, DocumentRecord } from '../lib/documents';
import { MAX_DOCUMENTS_PER_QUERY } from '../lib/documents';
import { cn } from '../lib/utils';

interface DocumentLibraryProps {
  isOpen: boolean;
  documents: DocumentRecord[];
  query: string;
  isLoading: boolean;
  selectedDocuments: AttachedLibraryDocument[];
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onUpload: (files: File[]) => void;
  onUseDocument: (document: DocumentRecord) => void;
  onOpenDocument: (documentId: string) => void;
  onDeleteDocument: (documentId: string) => void;
}

const statusLabel: Record<DocumentRecord['status'], string> = {
  uploaded: 'Subido',
  ready: 'Listo para consultar',
  too_large: 'Demasiado grande para consulta directa',
  unsupported: 'Formato guardado pero no consultable',
  error: 'Error',
};

export function DocumentLibrary({
  isOpen,
  documents,
  query,
  isLoading,
  selectedDocuments,
  onClose,
  onQueryChange,
  onUpload,
  onUseDocument,
  onOpenDocument,
  onDeleteDocument,
}: DocumentLibraryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const selectedIds = new Set(selectedDocuments.map((document) => document.id));

  return (
    <div className="absolute inset-0 z-40 flex justify-end bg-slate-900/15 backdrop-blur-[1px]">
      <div className="h-full w-full max-w-xl border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Documentos</h2>
            <p className="text-xs text-slate-500">
              Biblioteca privada con consulta directa al asistente, sin búsqueda automática global.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cerrar documentos"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length > 0) onUpload(files);
              event.target.value = '';
            }}
          />

          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Filtrar por nombre..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm text-slate-800 outline-none transition-all focus:border-blue-400 focus:bg-white"
              />
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100"
            >
              <UploadCloud size={16} />
              <span>Subir</span>
            </button>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-xs text-slate-600">
            Puedes seleccionar hasta {MAX_DOCUMENTS_PER_QUERY} documentos por mensaje. Si un archivo es muy grande,
            se guarda, pero no se consulta directamente en esta versión.
          </div>

          {selectedDocuments.length > 0 ? (
            <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-500">
                Documentos listos para el chat
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedDocuments.map((document) => (
                  <span
                    key={document.id}
                    className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs text-slate-700"
                  >
                    <BookOpen size={12} className="text-blue-500" />
                    {document.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="max-h-[58vh] overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50/60">
            {isLoading && documents.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin text-blue-500" />
                Cargando documentos...
              </div>
            ) : documents.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-500">Aún no tienes documentos guardados.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {isLoading ? (
                  <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-100 bg-white/90 px-4 py-2 text-xs text-slate-500 backdrop-blur">
                    <Loader2 size={14} className="animate-spin text-blue-500" />
                    Actualizando documentos...
                  </div>
                ) : null}
                {documents.map((document) => (
                  <div key={document.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{document.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {statusLabel[document.status]} · {(document.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onUseDocument(document)}
                        className={cn(
                          'rounded-xl px-3 py-2 text-xs font-medium transition-colors',
                          selectedIds.has(document.id)
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                        )}
                        disabled={document.status !== 'ready'}
                      >
                        {selectedIds.has(document.id) ? 'Usando' : 'Usar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenDocument(document.id)}
                        className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200"
                      >
                        Abrir
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteDocument(document.id)}
                        className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        aria-label={`Borrar ${document.name}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
