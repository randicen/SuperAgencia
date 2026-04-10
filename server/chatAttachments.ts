import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import xlsx from 'xlsx';
import { HttpError } from './httpErrors.js';
import {
  type ChatAttachmentContext,
  type ChatAttachmentDescriptor,
  type ChatAttachmentKind,
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_ATTACHMENT_SIZE_BYTES,
} from '../src/lib/chatAttachments.js';

const MAX_EXTRACTED_TEXT_LENGTH = 12000;
const MAX_XLSX_ROWS_PER_SHEET = 40;
const MAX_XLSX_COLS = 12;

const IMAGE_MIME_PREFIX = 'image/';
const PDF_MIME_TYPES = new Set(['application/pdf']);
const DOCX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);
const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
]);

const truncateText = (value: string): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_EXTRACTED_TEXT_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_EXTRACTED_TEXT_LENGTH)}…`;
};

const resolveAttachmentKind = (file: Express.Multer.File): ChatAttachmentKind => {
  const mimeType = file.mimetype.toLowerCase();
  const fileName = file.originalname.toLowerCase();

  if (mimeType.startsWith(IMAGE_MIME_PREFIX)) return 'image';
  if (PDF_MIME_TYPES.has(mimeType) || fileName.endsWith('.pdf')) return 'pdf';
  if (DOCX_MIME_TYPES.has(mimeType) || fileName.endsWith('.docx') || fileName.endsWith('.doc')) return 'docx';
  if (
    XLSX_MIME_TYPES.has(mimeType) ||
    fileName.endsWith('.xlsx') ||
    fileName.endsWith('.xls') ||
    fileName.endsWith('.csv')
  ) {
    return 'xlsx';
  }

  throw new HttpError(
    400,
    'unsupported_attachment_type',
    `El archivo '${file.originalname}' no tiene un formato soportado. Usa imágenes, PDF, DOCX o XLSX.`,
  );
};

const describeAttachment = (file: Express.Multer.File): ChatAttachmentDescriptor => ({
  name: file.originalname,
  mimeType: file.mimetype || 'application/octet-stream',
  size: file.size,
  kind: resolveAttachmentKind(file),
});

const extractDocxText = async (buffer: Buffer): Promise<string> => {
  const result = await mammoth.extractRawText({ buffer });
  return truncateText(result.value);
};

const extractPdfText = async (buffer: Buffer): Promise<string> => {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return truncateText(result.text);
};

const extractSpreadsheetText = (buffer: Buffer): string => {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetChunks: string[] = [];

  workbook.SheetNames.slice(0, 3).forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;

    const rows = xlsx.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
      header: 1,
      raw: false,
      blankrows: false,
    });

    const clippedRows = rows.slice(0, MAX_XLSX_ROWS_PER_SHEET).map((row) =>
      row
        .slice(0, MAX_XLSX_COLS)
        .map((cell) => (cell === null || cell === undefined ? '' : String(cell)))
        .join(' | '),
    );

    if (clippedRows.length > 0) {
      sheetChunks.push(`Hoja: ${sheetName}\n${clippedRows.join('\n')}`);
    }
  });

  return truncateText(sheetChunks.join('\n\n'));
};

const toBase64 = (buffer: Buffer): string => buffer.toString('base64');

const enrichAttachment = async (file: Express.Multer.File): Promise<ChatAttachmentContext> => {
  const descriptor = describeAttachment(file);

  if (descriptor.size > MAX_CHAT_ATTACHMENT_SIZE_BYTES) {
    throw new HttpError(
      400,
      'attachment_too_large',
      `El archivo '${descriptor.name}' supera el límite de 10 MB.`,
    );
  }

  let extractedText: string | undefined;
  if (descriptor.kind === 'docx') {
    extractedText = await extractDocxText(file.buffer);
  } else if (descriptor.kind === 'xlsx') {
    extractedText = extractSpreadsheetText(file.buffer);
  } else if (descriptor.kind === 'pdf') {
    extractedText = await extractPdfText(file.buffer);
  }

  return {
    ...descriptor,
    base64Data: toBase64(file.buffer),
    extractedText,
  };
};

export const parseChatAttachments = async (
  files: Express.Multer.File[] | undefined,
): Promise<ChatAttachmentContext[]> => {
  if (!files || files.length === 0) return [];
  if (files.length > MAX_CHAT_ATTACHMENTS) {
    throw new HttpError(
      400,
      'too_many_attachments',
      `Puedes adjuntar hasta ${MAX_CHAT_ATTACHMENTS} archivos por mensaje.`,
    );
  }

  return Promise.all(files.map((file) => enrichAttachment(file)));
};
