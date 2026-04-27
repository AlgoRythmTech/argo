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

  it('routes a tenancy + RBAC + websockets description to multi_tenant_saas', () => {
    expect(
      pickSpecialist({
        archetype: 'generic',
        triggerKind: 'form_submission',
        description: 'A multi-tenant SaaS for design teams with OAuth login, role-based permissions, and realtime updates.',
      }),
    ).toBe('multi_tenant_saas');
  });

  it('routes "build me an AI agent that …" to agent_runtime', () => {
    expect(
      pickSpecialist({
        archetype: 'generic',
        triggerKind: 'webhook',
        description: 'Build me an AI agent that summarises customer support tickets and tags them.',
      }),
    ).toBe('agent_runtime');
  });

  it('routes "tool-using LLM agent" to agent_runtime', () => {
    expect(
      pickSpecialist({
        archetype: 'generic',
        triggerKind: 'scheduled',
        description: 'A tool-using LLM agent that runs every morning to triage my inbox.',
      }),
    ).toBe('agent_runtime');
  });

  it('routes "semantic search" to search_service', () => {
    expect(
      pickSpecialist({
        archetype: 'generic',
        triggerKind: 'form_submission',
        description: 'A semantic search backend over my support tickets with embeddings.',
      }),
    ).toBe('search_service');
  });

  it('routes "ETL backfill" to data_pipeline', () => {
    expect(
      pickSpecialist({
        archetype: 'generic',
        triggerKind: 'scheduled',
        description: 'An ETL pipeline pulling from Stripe with hourly incremental + nightly backfill.',
      }),
    ).toBe('data_pipeline');
  });

  it('routes "internal admin panel" to internal_tool', () => {
    expect(
      pickSpecialist({
        archetype: 'generic',
        triggerKind: 'form_submission',
        description: 'Internal tool for ops to inspect and refund customers, magic-link only.',
      }),
    ).toBe('internal_tool');
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
