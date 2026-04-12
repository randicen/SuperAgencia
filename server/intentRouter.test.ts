import { describe, expect, it } from 'vitest';

import { classifyIntentRoute } from './intentRouter.js';

describe('classifyIntentRoute', () => {
  it('classifies explicit planner actions as planner mutations', () => {
    expect(classifyIntentRoute('agendame cardio mañana a las 3 pm')).toBe('planner_mutation');
    expect(classifyIntentRoute('mueve mi reunion de mañana a las 4')).toBe('planner_mutation');
  });

  it('keeps read-only questions as planner read', () => {
    expect(classifyIntentRoute('que tengo mañana')).toBe('planner_read');
    expect(classifyIntentRoute('muestrame mi agenda de manana')).toBe('planner_read');
  });

  it('keeps greetings as conversation', () => {
    expect(classifyIntentRoute('hola')).toBe('conversation');
    expect(classifyIntentRoute('gracias')).toBe('conversation');
  });
});
