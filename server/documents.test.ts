import { describe, expect, it } from 'vitest';
import { shouldRetrieveDocumentsForMessage } from './documents.js';

describe('shouldRetrieveDocumentsForMessage', () => {
  it('returns true when the user explicitly selected documents', () => {
    expect(shouldRetrieveDocumentsForMessage('que dice esto', ['doc-1'])).toBe(true);
    expect(shouldRetrieveDocumentsForMessage('compara estos archivos', ['doc-1', 'doc-2'])).toBe(true);
  });

  it('returns false when there are no explicitly selected documents', () => {
    expect(shouldRetrieveDocumentsForMessage('segun mis documentos, que dice el contrato', [])).toBe(false);
    expect(shouldRetrieveDocumentsForMessage('busca en mis archivos el valor total', [])).toBe(false);
    expect(shouldRetrieveDocumentsForMessage('que tengo para hoy', [])).toBe(false);
  });
});
