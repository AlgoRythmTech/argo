import type { WorkflowMap } from '@argo/shared-types';

/**
 * Generates the per-operation default email templates. These seed the
 * `templates` collection in Mongo so the trust-ratchet counters can start
 * tracking from send #1.
 *
 * Templates here are deliberately simple. Argo's voice corpus + draft_email
 * agent produces the actual outbound text per submission.
 */

export type SeedTemplate = {
  kind: 'rejection_to_third_party' | 'forward_to_third_party' | 'screening_invite' | 'system_alert';
  name: string;
  subjectTemplate: string;
  bodyTemplate: string;
};

export function seedTemplatesFor(map: WorkflowMap): SeedTemplate[] {
  const op = map.operationName;
  const archetype = map.metadata?.archetype ?? 'generic';

  switch (archetype) {
    case 'candidate_intake':
      return [
        {
          kind: 'rejection_to_third_party',
          name: 'Polite candidate rejection',
          subjectTemplate: `Re: {{role}} — quick update`,
          bodyTemplate: [
            'Hi {{first_name}},',
            '',
            'Thanks for applying for {{role}}. After reviewing, we won\'t be moving forward with your application this time.',
            '',
            'I appreciate the time you took. I\'ll keep your details on file in case something else opens up that\'s a better match.',
            '',
            'Best,',
            '{{owner_first_name}}',
          ].join('\n'),
        },
        {
          kind: 'forward_to_third_party',
          name: 'Forward to client',
          subjectTemplate: `Candidate intro — {{candidate_name}} for {{role}}`,
          bodyTemplate: [
            'Hi {{client_first_name}},',
            '',
            'Sharing {{candidate_name}} for {{role}}. Strong match on {{matched_count}} of our criteria. Highlights:',
            '',
            '{{highlights}}',
            '',
            'Resume: {{resume_url}}',
            '',
            'Want me to set up a screen?',
            '',
            'Best,',
            '{{owner_first_name}}',
          ].join('\n'),
        },
        {
          kind: 'screening_invite',
          name: 'Screening call invite',
          subjectTemplate: `Quick chat about {{role}}?`,
          bodyTemplate: [
            'Hi {{first_name}},',
            '',
            'Thanks for applying for {{role}}. I\'d love to do a 20-minute screen this week. Please pick a time: {{calendly_url}}',
            '',
            'Best,',
            '{{owner_first_name}}',
          ].join('\n'),
        },
      ];
    case 'lead_qualification':
      return [
        {
          kind: 'screening_invite',
          name: 'Discovery call invite',
          subjectTemplate: `Re: ${op} — quick call?`,
          bodyTemplate: [
            'Hi {{first_name}},',
            '',
            'Thanks for reaching out. Based on what you described, this sounds like a fit. Pick a 20-minute slot here: {{calendly_url}}',
            '',
            'Best,',
            '{{owner_first_name}}',
          ].join('\n'),
        },
        {
          kind: 'rejection_to_third_party',
          name: 'Not a fit (polite)',
          subjectTemplate: `Re: ${op}`,
          bodyTemplate: [
            'Hi {{first_name}},',
            '',
            'Thanks for the note. Honestly, I don\'t think we\'re the right fit for what you\'re trying to do — but I appreciate the time.',
            '',
            'Best,',
            '{{owner_first_name}}',
          ].join('\n'),
        },
      ];
    case 'onboarding_sequence':
      return [
        {
          kind: 'system_alert',
          name: 'Welcome',
          subjectTemplate: `Welcome — let\'s get started`,
          bodyTemplate: [
            'Hi {{first_name}},',
            '',
            'Welcome aboard. Here\'s what to expect over the next 30 days: {{plan_summary}}',
            '',
            'Best,',
            '{{owner_first_name}}',
          ].join('\n'),
        },
      ];
    default:
      return [
        {
          kind: 'rejection_to_third_party',
          name: 'Generic decline',
          subjectTemplate: `Re: ${op}`,
          bodyTemplate: [
            'Hi {{first_name}},',
            '',
            'Thanks for reaching out. We\'re not in a position to take this on right now.',
            '',
            'Best,',
            '{{owner_first_name}}',
          ].join('\n'),
        },
      ];
  }
}

export function generateTemplatesSeedJson(map: WorkflowMap): string {
  return JSON.stringify(seedTemplatesFor(map), null, 2);
}
