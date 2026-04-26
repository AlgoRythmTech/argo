import { describe, expect, it } from 'vitest';
import { ALL_SPECIALISTS, buildSpecialistSystemPrompt, pickSpecialist } from './specialist-prompts.js';

describe('pickSpecialist', () => {
  it('routes candidate_intake to form_workflow', () => {
    expect(
      pickSpecialist({
        archetype: 'candidate_intake',
        triggerKind: 'form_submission',
        description: 'engineering candidates apply',
      }),
    ).toBe('form_workflow');
  });

  it('routes scheduled triggers to scheduled_job', () => {
    expect(
      pickSpecialist({ archetype: 'generic', triggerKind: 'scheduled', description: 'every monday' }),
    ).toBe('scheduled_job');
  });

  it('detects slack bots', () => {
    expect(
      pickSpecialist({ archetype: 'generic', triggerKind: 'email_received', description: 'reply to slack messages' }),
    ).toBe('slack_bot');
  });

  it('detects scrapers', () => {
    expect(
      pickSpecialist({ archetype: 'generic', triggerKind: 'form_submission', description: 'scrape product prices weekly' }),
    ).toBe('scraper_pipeline');
  });

  it('detects rest apis', () => {
    expect(
      pickSpecialist({ archetype: 'generic', triggerKind: 'form_submission', description: 'expose REST endpoints for clients' }),
    ).toBe('rest_api');
  });

  it('falls back to form_workflow for unknown form-triggered ops', () => {
    expect(
      pickSpecialist({ archetype: 'generic', triggerKind: 'form_submission', description: 'something' }),
    ).toBe('form_workflow');
  });

  it('falls back to generic when nothing matches', () => {
    expect(
      pickSpecialist({ archetype: 'generic', triggerKind: 'email_received', description: 'do something' }),
    ).toBe('generic');
  });
});

describe('buildSpecialistSystemPrompt', () => {
  it('includes the BUILD invariants and the specialist block for every kind', () => {
    for (const s of ALL_SPECIALISTS) {
      const prompt = buildSpecialistSystemPrompt(s);
      expect(prompt).toContain('Argo invariants');
      expect(prompt).toContain('Runtime contract (Blaxel)');
      expect(prompt.length).toBeGreaterThan(2000);
    }
  });
});
