export type ChatAttachmentKind = 'image' | 'pdf' | 'docx' | 'xlsx';

export interface ChatAttachmentDescriptor {
  name: string;
  mimeType: string;
  size: number;
  kind: ChatAttachmentKind;
}

export interface ChatAttachmentContext extends ChatAttachmentDescriptor {
  base64Data: string;
  extractedText?: string;
}

export const MAX_CHAT_ATTACHMENTS = 4;
export const MAX_CHAT_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
