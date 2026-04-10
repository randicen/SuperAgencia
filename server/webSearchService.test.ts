import { describe, expect, it } from 'vitest';
import { __webSearchModel, classifyExternalIntent } from './webSearchService.js';

describe('classifyExternalIntent', () => {
  it('classifies tax-deadline questions as external info', () => {
    expect(
      classifyExternalIntent('La declaracion de renta de personas naturales en Colombia para el ano gravable 2025'),
    ).toBe('external_lookup');
  });

  it('classifies external question plus reminder action as hybrid', () => {
    expect(
      classifyExternalIntent('Cuando es el proximo festivo en Medellin y recuerdamelo'),
    ).toBe('hybrid');
  });

  it('keeps a short follow-up in external mode when previous assistant turn was external', () => {
    expect(
      classifyExternalIntent('no, para cuando es?', [
        {
          role: 'user',
          text: 'La declaracion de renta de personas naturales en Colombia para el ano gravable 2025',
        },
        {
          role: 'model',
          text: 'Los vencimientos empiezan en agosto.',
          metadata: {
            messageType: 'external_info',
          },
        },
      ]),
    ).toBe('external_lookup');
  });

  it('keeps ordinary planner commands out of hybrid routing', () => {
    expect(classifyExternalIntent('gym manana 3pm')).toBe('external_lookup');
  });

  it('keeps date-seeking tax questions in external mode', () => {
    expect(classifyExternalIntent('cuando es la proxima declaracion de renta en Colombia?')).toBe(
      'external_lookup',
    );
  });

  it('builds a multi-step contextualized plan for concert queries', () => {
    const plan = __webSearchModel.buildSearchPlan('proximo concierto de yeison jimenez', 'external_lookup');
    expect(plan.length).toBeGreaterThanOrEqual(3);
    expect(plan[0]?.query.toLowerCase()).toContain('yeison jimenez');
    expect(plan.map((step) => step.progressMessage).join(' ')).toContain('Contextualizando');
    expect(plan.some((step) => /fallecio|murio|obituario/i.test(step.query))).toBe(true);
  });

  it('adds an explicit time-validity verification step for time-sensitive queries', () => {
    const plan = __webSearchModel.buildSearchPlan(
      'cuando son las proximas votaciones para congreso colombia 2026',
      'external_lookup',
    );

    expect(plan.some((step) => /siguiente proximo vigente/i.test(step.query))).toBe(true);
  });

  it('builds temporal evidence context so past dates are labeled before resolution', () => {
    const context = __webSearchModel.buildSourcesContext(
      [
        {
          title: 'Calendario electoral',
          url: 'https://example.com/elecciones',
          domain: 'example.com',
          snippet: 'Las elecciones al Congreso fueron el 8 de marzo de 2026.',
        },
      ],
      false,
    );

    expect(context).toContain('EVIDENCIA TEMPORAL DETECTADA');
    expect(context).toContain('fecha="2026-03-08"');
    expect(context).toContain('relacion="past"');
  });
});
