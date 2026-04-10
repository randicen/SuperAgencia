import { randomUUID, createHash } from 'crypto';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import xlsx from 'xlsx';
import type { UserTier, SearchSource } from '../src/lib/plannerState.js';
import type {
  DocumentKind,
  DocumentListResponse,
  DocumentRecord,
  DocumentStatus,
  DocumentTextExtractionStatus,
} from '../src/lib/documents.js';
import {
  FREE_DOCUMENT_LIMIT,
  FREE_DOCUMENT_STORAGE_LIMIT_BYTES,
  MAX_DOCUMENT_CONTEXT_TOKENS,
  MAX_DOCUMENT_FILE_SIZE_BYTES,
  MAX_DOCUMENTS_PER_QUERY,
  MAX_TOTAL_DOCUMENT_CONTEXT_TOKENS,
  PREMIUM_DOCUMENT_LIMIT,
  PREMIUM_DOCUMENT_STORAGE_LIMIT_BYTES,
} from '../src/lib/documents.js';
import { HttpError } from './httpErrors.js';
import { getSupabaseAdmin } from './supabase.js';

type DocumentRow = {
  id: string;
  user_id: string;
  name: string;
  mime_type: string;
  size: number;
  checksum: string;
  storage_key: string;
  status: DocumentStatus;
  kind: DocumentKind;
  page_count: number | null;
  text_extraction_status: DocumentTextExtractionStatus | null;
  extracted_text: string | null;
  text_length: number | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

type ExtractedDocumentText = {
  text: string;
  pageCount: number | null;
};

type DocumentRetrievalContext = {
  hits: Array<{
    documentId: string;
    documentName: string;
    pageLabel?: string | null;
    chunkIndex: number;
    text: string;
    score: number;
  }>;
  sources: SearchSource[];
  contextText: string;
};

const MAX_STORED_EXTRACTED_TEXT_CHARS = 120_000;
const PDF_MIME_TYPES = new Set(['application/pdf']);
const DOCX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);
const SPREADSHEET_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
]);
const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'text/x-markdown']);

let r2Client: S3Client | null = null;

const getEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const hasDocumentInfra = (): boolean =>
  Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );

const getDocumentQuota = (planCode: UserTier) =>
  planCode === 'premium'
    ? {
        maxDocuments: PREMIUM_DOCUMENT_LIMIT,
        maxStorageBytes: PREMIUM_DOCUMENT_STORAGE_LIMIT_BYTES,
      }
    : {
        maxDocuments: FREE_DOCUMENT_LIMIT,
        maxStorageBytes: FREE_DOCUMENT_STORAGE_LIMIT_BYTES,
      };

const getR2Client = (): S3Client => {
  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${getEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: getEnv('R2_ACCESS_KEY_ID'),
        secretAccessKey: getEnv('R2_SECRET_ACCESS_KEY'),
      },
    });
  }

  return r2Client;
};

const getR2Bucket = () => getEnv('R2_BUCKET');

const toDocumentRecord = (row: DocumentRow): DocumentRecord => ({
  id: row.id,
  name: row.name,
  mimeType: row.mime_type,
  size: row.size,
  checksum: row.checksum,
  status: row.status,
  kind: row.kind,
  pageCount: row.page_count,
  textLength: row.text_length,
  textExtractionStatus: row.text_extraction_status,
  errorCode: row.error_code,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const normalizeText = (value: string): string =>
  value
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

const countApproxTokens = (value: string): number =>
  Math.max(1, Math.round(value.split(/\s+/).filter(Boolean).length * 1.25));

const computeChecksum = (buffer: Buffer): string =>
  createHash('sha256').update(buffer).digest('hex');

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'document';

const resolveDocumentKind = (file: Express.Multer.File): DocumentKind => {
  const mimeType = file.mimetype.toLowerCase();
  const fileName = file.originalname.toLowerCase();

  if (PDF_MIME_TYPES.has(mimeType) || fileName.endsWith('.pdf')) return 'pdf';
  if (DOCX_MIME_TYPES.has(mimeType) || fileName.endsWith('.docx') || fileName.endsWith('.doc')) return 'docx';
  if (
    SPREADSHEET_MIME_TYPES.has(mimeType) ||
    fileName.endsWith('.xlsx') ||
    fileName.endsWith('.xls') ||
    fileName.endsWith('.csv')
  ) {
    return fileName.endsWith('.csv') || mimeType.includes('csv') ? 'csv' : 'xlsx';
  }
  if (TEXT_MIME_TYPES.has(mimeType) || fileName.endsWith('.txt')) return 'txt';
  if (fileName.endsWith('.md') || mimeType === 'text/markdown' || mimeType === 'text/x-markdown') return 'md';

  throw new HttpError(
    400,
    'unsupported_document_type',
    `El archivo '${file.originalname}' no tiene un formato soportado en esta version.`,
  );
};

const buildStorageKey = (userId: string, documentId: string, originalName: string) =>
  `users/${userId}/documents/${documentId}/${slugify(originalName)}-${originalName}`;

const extractDocxText = async (buffer: Buffer): Promise<ExtractedDocumentText> => {
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: normalizeText(result.value),
    pageCount: null,
  };
};

const extractPdfText = async (buffer: Buffer): Promise<ExtractedDocumentText> => {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return {
    text: normalizeText(result.text),
    pageCount: (result as { numpages?: number }).numpages ?? null,
  };
};

const extractSpreadsheetText = (buffer: Buffer): ExtractedDocumentText => {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetBlocks = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return '';

    const rows = xlsx.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
      header: 1,
      raw: false,
      blankrows: false,
    });

    const serializedRows = rows
      .slice(0, 500)
      .map((row) =>
        row
          .slice(0, 40)
          .map((cell) => (cell === null || cell === undefined ? '' : String(cell).trim()))
          .join(' | '),
      )
      .filter((row) => row.replace(/\|/g, '').trim().length > 0);

    return serializedRows.length > 0 ? `Hoja: ${sheetName}\n${serializedRows.join('\n')}` : '';
  }).filter(Boolean);

  return {
    text: normalizeText(sheetBlocks.join('\n\n')),
    pageCount: workbook.SheetNames.length,
  };
};

const extractPlainText = (buffer: Buffer): ExtractedDocumentText => ({
  text: normalizeText(buffer.toString('utf8')),
  pageCount: null,
});

const extractDocumentText = async (kind: DocumentKind, buffer: Buffer): Promise<ExtractedDocumentText> => {
  if (kind === 'docx') return extractDocxText(buffer);
  if (kind === 'xlsx' || kind === 'csv') return extractSpreadsheetText(buffer);
  if (kind === 'txt' || kind === 'md') return extractPlainText(buffer);
  if (kind === 'pdf') return extractPdfText(buffer);
  return { text: '', pageCount: null };
};

const getDocumentOutcome = (
  extractedText: string,
): {
  status: Exclude<DocumentStatus, 'uploaded'>;
  textExtractionStatus: DocumentTextExtractionStatus;
  errorCode: string | null;
  storedText: string | null;
  textLength: number | null;
} => {
  if (!extractedText) {
    return {
      status: 'unsupported',
      textExtractionStatus: 'unsupported',
      errorCode: 'no_extractable_text',
      storedText: null,
      textLength: 0,
    };
  }

  const textLength = extractedText.length;
  const storedText = extractedText.slice(0, MAX_STORED_EXTRACTED_TEXT_CHARS);
  if (countApproxTokens(extractedText) > MAX_DOCUMENT_CONTEXT_TOKENS) {
    return {
      status: 'too_large',
      textExtractionStatus: 'too_large',
      errorCode: 'document_context_too_large',
      storedText,
      textLength,
    };
  }

  return {
    status: 'ready',
    textExtractionStatus: 'ready',
    errorCode: null,
    storedText,
    textLength,
  };
};

const assertDocumentQuota = async (userId: string, planCode: UserTier, incomingSize: number): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const quota = getDocumentQuota(planCode);

  const result = await supabase
    .from('documents')
    .select('size', { count: 'exact' })
    .eq('user_id', userId);

  if (result.error) throw result.error;

  const totalBytes = (result.data ?? []).reduce((sum, item: { size?: number | string | null }) => sum + Number(item.size || 0), 0);
  const count = result.count ?? result.data?.length ?? 0;

  if (count >= quota.maxDocuments) {
    throw new HttpError(403, 'document_quota_reached', 'Tu plan actual ya alcanzo el limite de documentos.');
  }

  if (totalBytes + incomingSize > quota.maxStorageBytes) {
    throw new HttpError(
      403,
      'document_storage_quota_reached',
      'Tu plan actual ya alcanzo el limite de almacenamiento documental.',
    );
  }
};

const getDocumentRowForUser = async (userId: string, documentId: string): Promise<DocumentRow> => {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .eq('id', documentId)
    .single();

  if (result.error || !result.data) {
    throw new HttpError(404, 'document_not_found', 'No encontre ese documento.');
  }

  return result.data as DocumentRow;
};

const createSignedDocumentUrl = async (row: DocumentRow): Promise<string> =>
  getSignedUrl(
    getR2Client(),
    new GetObjectCommand({
      Bucket: getR2Bucket(),
      Key: row.storage_key,
      ResponseContentDisposition: `inline; filename="${row.name}"`,
    }),
    { expiresIn: 60 * 5 },
  );

const assertSelectedDocumentCount = (documentIds: string[]) => {
  if (documentIds.length > MAX_DOCUMENTS_PER_QUERY) {
    throw new HttpError(
      400,
      'too_many_documents_selected',
      `Solo puedes consultar hasta ${MAX_DOCUMENTS_PER_QUERY} documentos al mismo tiempo en esta version.`,
    );
  }
};

export const queueDocumentsForUser = async (
  userId: string,
  planCode: UserTier,
  files: Express.Multer.File[],
): Promise<DocumentRecord[]> => {
  if (!hasDocumentInfra()) {
    throw new HttpError(503, 'documents_not_configured', 'La biblioteca documental aun no esta configurada en el servidor.');
  }

  const supabase = getSupabaseAdmin();
  const created: DocumentRecord[] = [];

  for (const file of files) {
    if (file.size > MAX_DOCUMENT_FILE_SIZE_BYTES) {
      throw new HttpError(
        400,
        'document_too_large',
        `El archivo '${file.originalname}' supera el limite de 5 MB para esta version.`,
      );
    }

    const kind = resolveDocumentKind(file);
    const checksum = computeChecksum(file.buffer);

    const existing = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', userId)
      .eq('checksum', checksum)
      .maybeSingle();

    if (existing.error) throw existing.error;
    if (existing.data) {
      created.push(toDocumentRecord(existing.data as DocumentRow));
      continue;
    }

    await assertDocumentQuota(userId, planCode, file.size);

    const documentId = randomUUID();
    const storageKey = buildStorageKey(userId, documentId, file.originalname);

    await getR2Client().send(
      new PutObjectCommand({
        Bucket: getR2Bucket(),
        Key: storageKey,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/octet-stream',
      }),
    );

    const inserted = await supabase
      .from('documents')
      .insert({
        id: documentId,
        user_id: userId,
        name: file.originalname,
        mime_type: file.mimetype || 'application/octet-stream',
        size: file.size,
        checksum,
        storage_key: storageKey,
        status: 'uploaded',
        kind,
      })
      .select('*')
      .single();

    if (inserted.error || !inserted.data) {
      throw inserted.error ?? new Error('No fue posible crear el documento.');
    }

    try {
      const extracted = await extractDocumentText(kind, file.buffer);
      const outcome = getDocumentOutcome(extracted.text);

      const updated = await supabase
        .from('documents')
        .update({
          status: outcome.status,
          text_extraction_status: outcome.textExtractionStatus,
          extracted_text: outcome.storedText,
          text_length: outcome.textLength,
          page_count: extracted.pageCount,
          error_code: outcome.errorCode,
        })
        .eq('id', documentId)
        .select('*')
        .single();

      if (updated.error || !updated.data) {
        throw updated.error ?? new Error('No fue posible actualizar el documento.');
      }

      created.push(toDocumentRecord(updated.data as DocumentRow));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await supabase
        .from('documents')
        .update({
          status: 'error',
          text_extraction_status: 'error',
          error_code: message.slice(0, 180),
        })
        .eq('id', documentId)
        .select('*')
        .single();

      if (failed.error || !failed.data) {
        throw failed.error ?? new Error('No fue posible registrar el error del documento.');
      }

      created.push(toDocumentRecord(failed.data as DocumentRow));
    }
  }

  return created;
};

export const listDocumentsForUser = async (
  userId: string,
  query?: string,
  status?: DocumentStatus,
): Promise<DocumentListResponse> => {
  const supabase = getSupabaseAdmin();
  let request = supabase
    .from('documents')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (query?.trim()) {
    request = request.ilike('name', `%${query.trim()}%`);
  }
  if (status) {
    request = request.eq('status', status);
  }

  const result = await request;
  if (result.error) throw result.error;

  const rows = (result.data ?? []) as DocumentRow[];
  return {
    documents: rows.map(toDocumentRecord),
    totalCount: result.count ?? rows.length,
    totalBytes: rows.reduce((sum, row) => sum + row.size, 0),
  };
};

export const getDocumentForUser = async (userId: string, documentId: string): Promise<DocumentRecord> =>
  toDocumentRecord(await getDocumentRowForUser(userId, documentId));

export const createDocumentDownloadUrl = async (userId: string, documentId: string): Promise<string> => {
  const row = await getDocumentRowForUser(userId, documentId);
  return createSignedDocumentUrl(row);
};

export const deleteDocumentForUser = async (userId: string, documentId: string): Promise<void> => {
  const supabase = getSupabaseAdmin();
  const row = await getDocumentRowForUser(userId, documentId);

  const deleteDoc = await supabase.from('documents').delete().eq('user_id', userId).eq('id', documentId);
  if (deleteDoc.error) throw deleteDoc.error;

  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: getR2Bucket(),
      Key: row.storage_key,
    }),
  );
};

export const buildDocumentRetrievalContext = async (
  userId: string,
  _query: string,
  documentIds?: string[],
): Promise<DocumentRetrievalContext> => {
  if (!hasDocumentInfra() || !documentIds || documentIds.length === 0) {
    return {
      hits: [],
      sources: [],
      contextText: '',
    };
  }

  assertSelectedDocumentCount(documentIds);

  const rows = await Promise.all(documentIds.map((documentId) => getDocumentRowForUser(userId, documentId)));
  const invalid = rows.find((row) => row.status !== 'ready' || !row.extracted_text);
  if (invalid) {
    const reason =
      invalid.status === 'too_large'
        ? 'Ese documento quedó guardado, pero es demasiado grande para consulta directa en esta version.'
        : invalid.status === 'unsupported'
          ? 'Ese documento quedó guardado, pero su contenido no se puede consultar directamente en esta version.'
          : 'Ese documento todavia no esta listo para consulta directa.';
    throw new HttpError(400, 'document_not_ready_for_context', reason);
  }

  const totalTokens = rows.reduce((sum, row) => sum + countApproxTokens(row.extracted_text || ''), 0);
  if (totalTokens > MAX_TOTAL_DOCUMENT_CONTEXT_TOKENS) {
    throw new HttpError(
      400,
      'document_context_budget_exceeded',
      'Esos documentos juntos son demasiado grandes para consulta directa. Reduce la seleccion a archivos mas cortos o a menos documentos.',
    );
  }

  const urlEntries = await Promise.all(
    rows.map(async (row) => [row.id, await createSignedDocumentUrl(row)] as const),
  );
  const urlMap = new Map(urlEntries);

  return {
    hits: rows.map((row) => ({
      documentId: row.id,
      documentName: row.name,
      pageLabel: row.page_count ? `${row.page_count} paginas` : null,
      chunkIndex: 0,
      text: (row.extracted_text || '').slice(0, 300),
      score: 1,
    })),
    sources: rows.map((row) => ({
      kind: 'document',
      title: row.name,
      url: urlMap.get(row.id) || '',
      snippet: (row.extracted_text || '').slice(0, 240),
      documentId: row.id,
      pageLabel: row.page_count ? `${row.page_count} paginas` : undefined,
      mimeType: row.mime_type,
    })),
    contextText: rows
      .map(
        (row, index) => `[DOCUMENTO ${index + 1}]
Nombre: ${row.name}
Tipo: ${row.kind}
Contenido:
${row.extracted_text || ''}`,
      )
      .join('\n\n'),
  };
};

export const shouldRetrieveDocumentsForMessage = (
  _userMessage: string,
  selectedDocumentIds: string[],
): boolean => selectedDocumentIds.length > 0;
