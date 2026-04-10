import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Bot,
  User,
  Sparkles,
  Phone,
  PhoneOff,
  Loader2,
  Paperclip,
  X,
  BookOpen,
  FileText,
  Save,
  Check,
} from 'lucide-react';
import { motion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/utils';
import { MAX_CHAT_ATTACHMENTS, MAX_CHAT_ATTACHMENT_SIZE_BYTES } from '../lib/chatAttachments';
import type { ChatMessage, SearchSource } from '../lib/plannerState';
import type { AttachedLibraryDocument } from '../lib/documents';

interface ChatProps {
  messages: ChatMessage[];
  onSendMessage: (text: string, attachments: File[], selectedDocuments: AttachedLibraryDocument[]) => void;
  onSaveAttachmentToLibrary: (file: File) => Promise<{ id: string; name: string }>;
  isLoading: boolean;
  pendingSearch?: {
    message: string;
    sources: SearchSource[];
  } | null;
  pendingAssistantMessage?: string | null;
  liveStatus: 'disconnected' | 'connecting' | 'connected';
  onToggleLive: () => void;
  canUseText: boolean;
  canUseVoice: boolean;
  usageCaption?: string | null;
  voiceError?: string | null;
  selectedDocuments: AttachedLibraryDocument[];
  onRemoveSelectedDocument: (documentId: string) => void;
  onOpenDocumentLibrary: () => void;
}

type PendingAttachment = {
  id: string;
  file: File;
  saveState: 'idle' | 'saving' | 'saved';
};

const formatAttachmentSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const injectSourceSuperscripts = (text: string, sources?: SearchSource[]) => {
  const safeText = escapeHtml(text);
  if (!sources?.length) return safeText;

  return safeText.replace(
    /(?:\[\s*fuente\s+(\d+)\s*\]|\(\s*fuente\s+(\d+)\s*\)|\bfuente\s+(\d+)\b|\[(\d+)\])/gi,
    (match, squareIndex, parenIndex, bareIndex, bracketIndex) => {
      const rawIndex = Number(squareIndex || parenIndex || bareIndex || bracketIndex);
      if (!Number.isFinite(rawIndex) || rawIndex < 1 || rawIndex > sources.length) {
        return match;
      }

      const source = sources[rawIndex - 1];
      const label = String(rawIndex);
      return `<sup class="ml-1 align-super text-[10px] font-semibold"><a href="${source.url}" target="_blank" rel="noreferrer" class="text-blue-600 no-underline hover:text-blue-700 hover:underline">[${label}]</a></sup>`;
    },
  );
};

const renderMarkdownMessage = (text: string, sources?: SearchSource[]) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    rehypePlugins={[rehypeRaw]}
    components={{
      p: ({ children }) => <p className="mb-3 last:mb-0 leading-8">{children}</p>,
      ul: ({ children }) => <ul className="mb-3 ml-5 list-disc space-y-2 last:mb-0">{children}</ul>,
      ol: ({ children }) => <ol className="mb-3 ml-5 list-decimal space-y-2 last:mb-0">{children}</ol>,
      li: ({ children }) => <li className="leading-8">{children}</li>,
      strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
      em: ({ children }) => <em className="italic">{children}</em>,
      h1: ({ children }) => <h1 className="mb-3 text-xl font-bold text-slate-900">{children}</h1>,
      h2: ({ children }) => <h2 className="mb-3 text-lg font-bold text-slate-900">{children}</h2>,
      h3: ({ children }) => <h3 className="mb-2 text-base font-semibold text-slate-900">{children}</h3>,
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 underline decoration-blue-200 underline-offset-2 hover:text-blue-700"
        >
          {children}
        </a>
      ),
      blockquote: ({ children }) => (
        <blockquote className="mb-3 border-l-2 border-slate-200 pl-3 italic text-slate-600">
          {children}
        </blockquote>
      ),
    }}
  >
    {injectSourceSuperscripts(text, sources)}
  </ReactMarkdown>
);

export function Chat({
  messages,
  onSendMessage,
  onSaveAttachmentToLibrary,
  isLoading,
  pendingSearch,
  pendingAssistantMessage,
  liveStatus,
  onToggleLive,
  canUseText,
  canUseVoice,
  usageCaption,
  voiceError,
  selectedDocuments,
  onRemoveSelectedDocument,
  onOpenDocumentLibrary,
}: ChatProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((input.trim() || attachments.length > 0) && !isLoading && canUseText) {
      onSendMessage(
        input.trim(),
        attachments.map((attachment) => attachment.file),
        selectedDocuments,
      );
      setInput('');
      setAttachments([]);
    }
  };

  const handleSelectFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    if (selected.length === 0) return;

    const merged = [
      ...attachments,
      ...selected.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        saveState: 'idle' as const,
      })),
    ].slice(0, MAX_CHAT_ATTACHMENTS);
    const valid = merged.filter((attachment) => attachment.file.size <= MAX_CHAT_ATTACHMENT_SIZE_BYTES);
    setAttachments(valid);
    event.target.value = '';
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== attachmentId));
  };

  const handleSaveAttachment = async (attachmentId: string) => {
    const target = attachments.find((attachment) => attachment.id === attachmentId);
    if (!target || target.saveState !== 'idle') return;

    setAttachments((current) =>
      current.map((attachment) =>
        attachment.id === attachmentId ? { ...attachment, saveState: 'saving' } : attachment,
      ),
    );

    try {
      await onSaveAttachmentToLibrary(target.file);
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.id === attachmentId ? { ...attachment, saveState: 'saved' } : attachment,
        ),
      );
    } catch {
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.id === attachmentId ? { ...attachment, saveState: 'idle' } : attachment,
        ),
      );
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden relative">
      <div className="px-6 py-4 border-b border-gray-100 bg-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
            <Sparkles size={20} />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900 leading-tight">Asistente IA</h2>
            <p className="text-xs font-medium text-gray-500">Planificación inteligente</p>
            {usageCaption ? <p className="text-[11px] text-gray-400 mt-0.5">{usageCaption}</p> : null}
          </div>
        </div>

        <button
          onClick={onToggleLive}
          disabled={!canUseVoice && liveStatus === 'disconnected'}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed',
            liveStatus === 'connected'
              ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
              : liveStatus === 'connecting'
                ? 'bg-blue-50 text-blue-600 border border-blue-200'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50',
          )}
        >
          {liveStatus === 'connecting' ? (
            <Loader2 size={16} className="animate-spin" />
          ) : liveStatus === 'connected' ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
              <PhoneOff size={16} />
            </>
          ) : (
            <Phone size={16} />
          )}
          <span className="hidden sm:inline">
            {liveStatus === 'connected'
              ? 'Colgar'
              : liveStatus === 'connecting'
                ? 'Conectando...'
                : 'Llamar'}
          </span>
        </button>
      </div>

      {liveStatus === 'connected' && (
        <div className="absolute inset-x-0 top-[73px] bottom-[73px] bg-white/90 backdrop-blur-sm z-10 flex flex-col items-center justify-center px-6">
          {pendingSearch ? (
            <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-lg shadow-slate-200/60">
              <div className="flex items-center gap-3 text-base font-semibold text-slate-800">
                <Loader2 size={18} className="animate-spin text-blue-500" />
                <span>{pendingSearch.message}</span>
              </div>
              {pendingSearch.sources.length > 0 ? (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                    Fuentes encontradas
                  </p>
                  <div className="space-y-2 opacity-70">
                    {pendingSearch.sources.slice(0, 4).map((source) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 transition-colors hover:border-blue-200 hover:bg-blue-50"
                      >
                        <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
                          <img
                            src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(source.domain)}&sz=32`}
                            alt=""
                            className="h-4 w-4 rounded-sm"
                          />
                          <span className="truncate">{source.domain}</span>
                        </div>
                        <p className="mt-1 line-clamp-1 text-xs font-medium text-slate-700">{source.title}</p>
                        {source.snippet ? (
                          <p className="mt-1 line-clamp-1 text-[11px] leading-relaxed text-slate-400">{source.snippet}</p>
                        ) : null}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="w-24 h-24 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 mb-6 relative">
                <div className="absolute inset-0 rounded-full border-4 border-blue-500/30 animate-ping" />
                <Bot size={48} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Procesando</h3>
              <p className="text-gray-500 text-center max-w-[250px]">
                Estoy preparando la respuesta.
              </p>
            </>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#F8FAFC] scroll-smooth">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-70">
            <div className="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center text-blue-500 mb-2">
              <Bot size={32} />
            </div>
            <p className="text-sm text-gray-600 max-w-[250px]">
              Hola. Dime qué tareas tienes que hacer hoy y sus restricciones.
            </p>
            <div className="text-xs text-gray-400 bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
              Ej: &quot;Tengo una reunión de 1 hora a las 10 AM, y luego necesito 2 horas para programar antes de las 5 PM.&quot;
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.2 }}
            className={cn('flex gap-3 max-w-[90%]', msg.role === 'user' ? 'ml-auto flex-row-reverse' : '')}
          >
            <div
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm',
                msg.role === 'user' ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-blue-600',
              )}
            >
              {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div
              className={cn(
                'px-4 py-3 rounded-2xl text-sm shadow-sm',
                msg.role === 'user'
                  ? 'bg-gray-900 text-white rounded-tr-sm'
                  : 'bg-white text-gray-800 border border-gray-100 rounded-tl-sm',
              )}
            >
              <div
                className={cn(
                  'markdown-body',
                  msg.role === 'user'
                    ? '[&_a]:text-blue-200 [&_strong]:text-white [&_h1]:text-white [&_h2]:text-white [&_h3]:text-white'
                    : '[&_sup_a]:text-blue-600',
                )}
              >
                {renderMarkdownMessage(msg.text, msg.metadata?.sources)}
              </div>
              {msg.role === 'model' && msg.metadata?.sources && msg.metadata.sources.length > 0 ? (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Fuentes
                  </p>
                  <div className="space-y-2">
                    {msg.metadata.sources.map((source, index) => {
                      const Wrapper = source.url ? 'a' : 'div';
                      const wrapperProps =
                        source.url
                          ? {
                              href: source.url,
                              target: '_blank',
                              rel: 'noreferrer',
                            }
                          : {};
                      return (
                      <Wrapper
                        key={`${source.url || source.documentId || source.title}-${index}`}
                        {...wrapperProps}
                        className="block rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition-colors hover:border-blue-200 hover:bg-blue-50"
                      >
                        <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
                          {source.kind === 'document' ? (
                            <FileText className="h-4 w-4 text-blue-500" />
                          ) : (
                            <img
                              src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(source.domain || source.url)}&sz=32`}
                              alt=""
                              className="h-4 w-4 rounded-sm"
                            />
                          )}
                          <span className="truncate">
                            {source.kind === 'document' ? source.pageLabel || 'Documento' : source.domain}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs font-semibold text-slate-800">{source.title}</p>
                        {source.snippet ? (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500">{source.snippet}</p>
                        ) : null}
                      </Wrapper>
                    )})}
                  </div>
                </div>
              ) : null}
            </div>
          </motion.div>
        ))}

        {pendingSearch && liveStatus !== 'connected' ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3 max-w-[90%]">
            <div className="w-8 h-8 rounded-full bg-white border border-gray-200 text-blue-600 flex items-center justify-center shrink-0 shadow-sm">
              <Bot size={14} />
            </div>
            <div className="px-4 py-3 rounded-2xl bg-white text-gray-800 border border-gray-100 shadow-sm rounded-tl-sm">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <Loader2 size={14} className="animate-spin text-blue-500" />
                <span>{pendingSearch.message}</span>
              </div>
              {pendingSearch.sources.length > 0 ? (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Fuentes encontradas
                  </p>
                  <div className="space-y-2">
                    {pendingSearch.sources.map((source, index) => {
                      const Wrapper = source.url ? 'a' : 'div';
                      const wrapperProps =
                        source.url
                          ? {
                              href: source.url,
                              target: '_blank',
                              rel: 'noreferrer',
                            }
                          : {};
                      return (
                      <Wrapper
                        key={`${source.url || source.documentId || source.title}-${index}`}
                        {...wrapperProps}
                        className="block rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition-colors hover:border-blue-200 hover:bg-blue-50"
                      >
                        <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
                          {source.kind === 'document' ? (
                            <FileText className="h-4 w-4 text-blue-500" />
                          ) : (
                            <img
                              src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(source.domain || source.url)}&sz=32`}
                              alt=""
                              className="h-4 w-4 rounded-sm"
                            />
                          )}
                          <span className="truncate">
                            {source.kind === 'document' ? source.pageLabel || 'Documento' : source.domain}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs font-semibold text-slate-800">{source.title}</p>
                      </Wrapper>
                    )})}
                  </div>
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}

        {isLoading && !pendingSearch && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3 max-w-[85%]">
            <div className="w-8 h-8 rounded-full bg-white border border-gray-200 text-blue-600 flex items-center justify-center shrink-0 shadow-sm">
              <Bot size={14} />
            </div>
            <div className="px-4 py-3 rounded-2xl bg-white text-gray-800 border border-gray-100 shadow-sm rounded-tl-sm min-w-[220px]">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <Loader2 size={14} className="animate-spin text-blue-500" />
                <span>{pendingAssistantMessage ?? 'Procesando tu solicitud...'}</span>
              </div>
              <p className="mt-2 text-xs leading-6 text-slate-500">
                Te mostraré el resultado en cuanto termine.
              </p>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} className="h-1" />
      </div>

      <div className="p-4 bg-white border-t border-gray-100 shrink-0">
        {voiceError ? (
          <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {voiceError}
          </div>
        ) : null}

        {attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="inline-flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-gray-400">
                  <FileText size={14} />
                </div>
                <div className="min-w-0">
                  <p className="max-w-[170px] truncate text-sm font-medium text-gray-700">
                    {attachment.file.name}
                  </p>
                  <p className="text-[11px] text-gray-400">{formatAttachmentSize(attachment.file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleSaveAttachment(attachment.id)}
                  disabled={attachment.saveState !== 'idle'}
                  className={cn(
                    'rounded-lg p-1 transition-colors',
                    attachment.saveState === 'saved'
                      ? 'text-gray-400'
                      : 'text-gray-500 hover:bg-white hover:text-gray-700 disabled:cursor-default',
                  )}
                  title={
                    attachment.saveState === 'saved'
                      ? 'Ya está guardado en biblioteca'
                      : attachment.saveState === 'saving'
                        ? 'Guardando en biblioteca...'
                        : 'Guardar archivo adjunto en biblioteca'
                  }
                  aria-label={
                    attachment.saveState === 'saved'
                      ? `${attachment.file.name} ya está guardado`
                      : `Guardar ${attachment.file.name} en biblioteca`
                  }
                >
                  {attachment.saveState === 'saving' ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : attachment.saveState === 'saved' ? (
                    <Check size={14} />
                  ) : (
                    <Save size={14} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(attachment.id)}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label={`Quitar ${attachment.file.name}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {selectedDocuments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {selectedDocuments.map((document) => (
              <div
                key={document.id}
                className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700"
              >
                <BookOpen size={12} />
                <span className="max-w-[180px] truncate">{document.name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveSelectedDocument(document.id)}
                  className="text-blue-400 hover:text-blue-600"
                  aria-label={`Quitar ${document.name}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="relative flex items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv"
            multiple
            className="hidden"
            onChange={handleSelectFiles}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || liveStatus === 'connected' || !canUseText || attachments.length >= MAX_CHAT_ATTACHMENTS}
            className="absolute left-2 z-10 w-10 h-10 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 disabled:opacity-50 disabled:hover:bg-transparent transition-all"
            title="Adjuntar archivos"
          >
            <Paperclip size={16} />
          </button>
          <button
            type="button"
            onClick={onOpenDocumentLibrary}
            disabled={isLoading || liveStatus === 'connected' || !canUseText}
            className="absolute left-12 z-10 w-10 h-10 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 disabled:opacity-50 disabled:hover:bg-transparent transition-all"
            title="Usar documentos"
          >
            <BookOpen size={16} />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={canUseText ? 'Escribe una tarea o restricción...' : 'Tu plan actual ya no tiene IA de texto disponible.'}
            className="w-full pl-24 pr-14 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-inner"
            disabled={isLoading || liveStatus === 'connected' || !canUseText}
          />
          <button
            type="submit"
            disabled={(!input.trim() && attachments.length === 0 && selectedDocuments.length === 0) || isLoading || liveStatus === 'connected' || !canUseText}
            className="absolute right-2 w-10 h-10 flex items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-all shadow-sm"
          >
            <Send size={16} className="ml-0.5" />
          </button>
        </form>
      </div>
    </div>
  );
}

