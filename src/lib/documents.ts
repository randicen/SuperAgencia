export type DocumentStatus = 'uploaded' | 'ready' | 'too_large' | 'unsupported' | 'error';

export type DocumentTextExtractionStatus = 'ready' | 'too_large' | 'unsupported' | 'error';

export type DocumentKind = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'txt' | 'md';

export interface DocumentRecord {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  checksum: string;
  status: DocumentStatus;
  kind: DocumentKind;
  pageCount: number | null;
  textLength: number | null;
  textExtractionStatus: DocumentTextExtractionStatus | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface AttachedLibraryDocument {
  id: string;
  name: string;
  status: DocumentStatus;
}

export interface DocumentListResponse {
  documents: DocumentRecord[];
  totalCount: number;
  totalBytes: number;
}

export const MAX_DOCUMENT_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_QUERY = 3;
export const MAX_DOCUMENT_CONTEXT_TOKENS = 20_000;
export const MAX_TOTAL_DOCUMENT_CONTEXT_TOKENS = 45_000;
export const FREE_DOCUMENT_LIMIT = 25;
export const PREMIUM_DOCUMENT_LIMIT = 200;
export const FREE_DOCUMENT_STORAGE_LIMIT_BYTES = 250 * 1024 * 1024;
export const PREMIUM_DOCUMENT_STORAGE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
