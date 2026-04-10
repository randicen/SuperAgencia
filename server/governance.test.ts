import { describe, expect, it } from 'vitest';
import { computeAccessSummary, resolveEffectivePlanCode } from './governance.js';

describe('resolveEffectivePlanCode', () => {
  it('falls back to free when premium has expired', () => {
    const plan = resolveEffectivePlanCode(
      {
        plan_code: 'premium',
        status: 'active',
        current_period_end: '2026-04-01T00:00:00.000Z',
      },
      new Date('2026-04-06T12:00:00.000Z'),
    );

    expect(plan).toBe('free');
  });

  it('keeps premium while cycle is active', () => {
    const plan = resolveEffectivePlanCode(
      {
        plan_code: 'premium',
        status: 'active',
        current_period_end: '2026-05-01T00:00:00.000Z',
      },
      new Date('2026-04-06T12:00:00.000Z'),
    );

    expect(plan).toBe('premium');
  });
});

describe('computeAccessSummary', () => {
  it('blocks free text after lifetime quota is exhausted', () => {
    const access = computeAccessSummary(
      'active',
      {
        code: 'free',
        text_ai_enabled: true,
        voice_ai_enabled: false,
        web_search_enabled: true,
        lifetime_text_limit: 25,
        period_text_limit: null,
        period_voice_minutes_limit: null,
        manual_planning_enabled: true,
      },
      {
        text_requests_used_lifetime: 25,
        text_requests_used_period: 0,
        voice_seconds_used_period: 0,
        period_start: null,
        period_end: null,
      },
    );

    expect(access.textAllowed).toBe(false);
    expect(access.voiceAllowed).toBe(false);
    expect(access.remainingTextLifetime).toBe(0);
  });

  it('allows premium text and voice while cycle has remaining quota', () => {
    const access = computeAccessSummary(
      'active',
      {
        code: 'premium',
        text_ai_enabled: true,
        voice_ai_enabled: true,
        web_search_enabled: true,
        lifetime_text_limit: null,
        period_text_limit: 300,
        period_voice_minutes_limit: 30,
        manual_planning_enabled: true,
      },
      {
        text_requests_used_lifetime: 40,
        text_requests_used_period: 20,
        voice_seconds_used_period: 300,
        period_start: '2026-04-01T00:00:00.000Z',
        period_end: '2026-05-01T00:00:00.000Z',
      },
    );

    expect(access.textAllowed).toBe(true);
    expect(access.voiceAllowed).toBe(true);
    expect(access.remainingTextPeriod).toBe(280);
    expect(access.remainingVoiceSeconds).toBe(1500);
  });
});
