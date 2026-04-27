import { describe, expect, it } from 'vitest';
import { ProposedName, fallbackNameFromSentence } from './propose-name.js';

describe('ProposedName parser', () => {
  it('accepts a clean 2-word Title Case name', () => {
    expect(ProposedName.safeParse({ name: 'Candidate Intake' }).success).toBe(true);
  });

  it('accepts a 3-word name with an ampersand', () => {
    expect(ProposedName.safeParse({ name: 'Refunds & Returns' }).success).toBe(true);
  });

  it('rejects a name starting with lowercase', () => {
    expect(ProposedName.safeParse({ name: 'candidate Intake' }).success).toBe(false);
  });

  it('rejects a name with punctuation', () => {
    expect(ProposedName.safeParse({ name: 'Candidate, Intake!' }).success).toBe(false);
  });

  it('rejects a name with quotes or em-dashes', () => {
    expect(ProposedName.safeParse({ name: '"Candidate Intake"' }).success).toBe(false);
    expect(ProposedName.safeParse({ name: 'Candidate — Intake' }).success).toBe(false);
  });

  it('rejects an empty / 1-char name', () => {
    expect(ProposedName.safeParse({ name: '' }).success).toBe(false);
    expect(ProposedName.safeParse({ name: 'X' }).success).toBe(false);
  });

  it('rejects a name longer than 40 chars', () => {
    expect(ProposedName.safeParse({ name: 'Candidate Intake And Rejection And Forwarding And Triage' }).success).toBe(false);
  });
});

describe('fallbackNameFromSentence', () => {
  it('extracts 3 meaningful Title Case words', () => {
    const out = fallbackNameFromSentence(
      'I want to receive candidate applications and forward strong ones to the hiring client',
    );
    // Stop-word filter strips "to", "the", etc. so we get content words.
    expect(out).toMatch(/^[A-Z]/);
    expect(out.length).toBeGreaterThan(2);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).not.toMatch(/[!?,'"]/);
  });

  it('handles all-stopword input by returning the New Operation default', () => {
    expect(fallbackNameFromSentence('the and i to a of')).toBe('New Operation');
  });

  it('strips punctuation and digits-only tokens', () => {
    const out = fallbackNameFromSentence('Webhooks!! arrive — 12345 — and we forward them');
    expect(out).not.toMatch(/[!?,—]/);
    expect(out).toMatch(/^[A-Z]/);
  });

  it('caps output to 40 chars even with many long words', () => {
    const out = fallbackNameFromSentence(
      'application processing infrastructure deployment automation pipeline',
    );
    expect(out.length).toBeLessThanOrEqual(40);
  });
});
