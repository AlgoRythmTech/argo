import { describe, expect, it } from 'vitest';
import { detectTrigger, questionsFor } from './question-tree.js';

describe('detectTrigger', () => {
  it('routes "candidates apply through a Google Form" to form_submission', () => {
    expect(
      detectTrigger('Candidates apply through a Google Form linked from my website.'),
    ).toBe('form_submission');
  });

  it('routes "watch my Gmail label" to email_received', () => {
    expect(detectTrigger('Watch my Gmail label "support" and reply to messages.')).toBe(
      'email_received',
    );
  });

  it('routes "every Monday at 9am" to scheduled', () => {
    expect(detectTrigger('Every Monday at 9am send a digest to my clients.')).toBe('scheduled');
  });

  it('defaults to form_submission for ambiguous input', () => {
    expect(detectTrigger('I want to do something with my work.')).toBe('form_submission');
  });
});

describe('questionsFor', () => {
  it('returns exactly three questions per trigger', () => {
    expect(questionsFor('form_submission')).toHaveLength(3);
    expect(questionsFor('email_received')).toHaveLength(3);
    expect(questionsFor('scheduled')).toHaveLength(3);
  });
});
