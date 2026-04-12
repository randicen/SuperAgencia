import { describe, expect, it } from 'vitest';

import { classifyIntentRoute } from './intentRouter.js';

describe('classifyIntentRoute', () => {
  it('classifies imperative scheduling requests as planner mutations', () => {
    expect(classifyIntentRoute('pon cardio mañana 3pm')).toBe('planner_mutation');
    expect(classifyIntentRoute('anota cardio mañana a las 3 pm')).toBe('planner_mutation');
    expect(classifyIntentRoute('programa cardio mañana a las 3')).toBe('planner_mutation');
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
