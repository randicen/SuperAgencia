import { describe, expect, it } from 'vitest';
import { __intentRouter } from './intentRouter.js';

describe('intent router', () => {
  it('routes colloquial planner questions to planner read', () => {
    expect(__intentRouter.classifyIntentRoute('y para hoy q tengo')).toBe('planner_read');
    expect(__intentRouter.classifyIntentRoute('q tareas tengo esta semana')).toBe('planner_read');
  });

  it('keeps explicit external factual questions out of planner read', () => {
    expect(__intentRouter.classifyIntentRoute('cuando es la proxima declaracion de renta en colombia')).toBe(
      'external_lookup',
    );
  });

  it('keeps hybrid external+planner requests as hybrid', () => {
    expect(
      __intentRouter.classifyIntentRoute('cuando es el proximo festivo en medellin y recuerdamelo'),
    ).toBe('hybrid');
  });

  it('routes simple conversation away from planner mutations', () => {
    expect(__intentRouter.classifyIntentRoute('hola')).toBe('conversation');
    expect(__intentRouter.classifyIntentRoute('holaa')).toBe('conversation');
    expect(__intentRouter.classifyIntentRoute('holaaa')).toBe('conversation');
    expect(__intentRouter.classifyIntentRoute('hola :D')).toBe('conversation');
    expect(__intentRouter.classifyIntentRoute('hola!!!')).toBe('conversation');
    expect(__intentRouter.classifyIntentRoute('gracias')).toBe('conversation');
    expect(__intentRouter.classifyIntentRoute('que puedes hacer')).toBe('conversation');
  });

  it('inherits prior assistant context for short follow-ups', () => {
    expect(
      __intentRouter.classifyIntentRoute('no, para cuando es?', [
        {
          role: 'model',
          text: 'Los vencimientos empiezan en agosto.',
          metadata: { messageType: 'external_info' },
        },
      ]),
    ).toBe('external_lookup');
  });

  it('inherits planner read context for short planner follow-ups', () => {
    expect(
      __intentRouter.classifyIntentRoute('y manana?', [
        {
          role: 'model',
          text: 'Hoy no tienes nada programado.',
          metadata: { messageType: 'planner' },
        },
      ]),
    ).toBe('planner_read');
  });
});
