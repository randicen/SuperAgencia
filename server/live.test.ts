import { describe, expect, it } from 'vitest';
import { __private__ } from './live.js';

describe('extractInlineAudioBase64', () => {
  it('returns inline audio chunks from Gemini live server content', () => {
    const result = __private__.extractInlineAudioBase64({
      serverContent: {
        modelTurn: {
          role: 'model',
          parts: [
            { text: 'hola' },
            { inlineData: { data: 'YWJj', mimeType: 'audio/pcm;rate=24000' } },
            { inlineData: { data: 'ZGVm', mimeType: 'audio/pcm;rate=24000' } },
          ],
        },
      },
    } as any);

    expect(result).toEqual(['YWJj', 'ZGVm']);
  });
});

describe('extractFinishedTranscription', () => {
  it('returns only finished transcriptions with text', () => {
    expect(
      __private__.extractFinishedTranscription({
        serverContent: {
          inputTranscription: {
            text: 'mueve la reunión a las 4',
            finished: true,
          },
        },
      } as any),
    ).toBe('mueve la reunión a las 4');

    expect(
      __private__.extractFinishedTranscription({
        serverContent: {
          inputTranscription: {
            text: 'borrador parcial',
            finished: false,
          },
        },
      } as any),
    ).toBeNull();
  });
});
