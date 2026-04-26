import type { WorkflowIntent, WorkflowMap } from '@argo/shared-types';

/**
 * Templated fallback maps. Used when LISTENING -> MAPPING fails twice.
 *
 * Section 10: "By week thirteen this fallback has fired enough times that
 * the templated maps cover 95% of cases and the LLM is the cherry on top,
 * not the load-bearing layer."
 *
 * Adding a new archetype here is the right move when fallback usage on a
 * new shape exceeds 5% of weekly invocations.
 */

export type FallbackArgs = {
  archetype: WorkflowIntent['archetype'];
  operationName: string;
  ownerEmail: string;
  timezone: string;
  intent: WorkflowIntent;
};

export function fallbackMapForArchetype(args: FallbackArgs): WorkflowMap {
  switch (args.archetype) {
    case 'candidate_intake':
      return candidateIntakeMap(args);
    case 'lead_qualification':
      return leadQualificationMap(args);
    case 'onboarding_sequence':
      return onboardingSequenceMap(args);
    case 'generic':
    default:
      return genericMap(args);
  }
}

function candidateIntakeMap(args: FallbackArgs): WorkflowMap {
  return {
    version: 1,
    operationName: args.operationName,
    ownerEmail: args.ownerEmail,
    trigger: {
      type: 'form_submission',
      formTitle: `${args.operationName} — Apply`,
      formDescription: 'Tell us about yourself. We read every submission.',
      fields: [
        { id: 'full-name', label: 'Full name', type: 'short_text', required: true },
        { id: 'email', label: 'Email', type: 'email', required: true },
        { id: 'phone', label: 'Phone', type: 'phone', required: false },
        { id: 'role', label: 'Role you are applying for', type: 'short_text', required: true },
        { id: 'years', label: 'Years of relevant experience', type: 'number', required: true },
        { id: 'location', label: 'Current location', type: 'short_text', required: true },
        { id: 'comp', label: 'Compensation expectation', type: 'short_text', required: false },
        { id: 'why', label: 'Why are you interested?', type: 'long_text', required: true },
        { id: 'resume', label: 'Resume / CV link', type: 'url', required: true },
      ],
      confirmationMessage: 'Thanks. We\'ve received your application and will be in touch.',
    },
    steps: defaultSteps(),
    edges: defaultEdges(),
    digest: {
      enabled: true,
      cron: '0 9 * * 1',
      timezone: args.timezone,
      audience: [args.ownerEmail],
    },
    metadata: { archetype: 'candidate_intake', generatedAt: new Date().toISOString() },
  };
}

function leadQualificationMap(args: FallbackArgs): WorkflowMap {
  return {
    version: 1,
    operationName: args.operationName,
    ownerEmail: args.ownerEmail,
    trigger: {
      type: 'form_submission',
      formTitle: `${args.operationName} — Get in touch`,
      fields: [
        { id: 'name', label: 'Name', type: 'short_text', required: true },
        { id: 'email', label: 'Work email', type: 'email', required: true },
        { id: 'company', label: 'Company', type: 'short_text', required: true },
        { id: 'budget', label: 'Approximate budget', type: 'short_text', required: false },
        { id: 'use_case', label: 'What are you trying to solve?', type: 'long_text', required: true },
      ],
    },
    steps: defaultSteps(),
    edges: defaultEdges(),
    digest: { enabled: true, cron: '0 9 * * 1', timezone: args.timezone, audience: [args.ownerEmail] },
    metadata: { archetype: 'lead_qualification', generatedAt: new Date().toISOString() },
  };
}

function onboardingSequenceMap(args: FallbackArgs): WorkflowMap {
  return {
    version: 1,
    operationName: args.operationName,
    ownerEmail: args.ownerEmail,
    trigger: {
      type: 'form_submission',
      formTitle: `${args.operationName} — Welcome`,
      fields: [
        { id: 'name', label: 'Name', type: 'short_text', required: true },
        { id: 'email', label: 'Email', type: 'email', required: true },
        { id: 'goal', label: 'What do you want to get done in 30 days?', type: 'long_text', required: true },
      ],
    },
    steps: defaultSteps(),
    edges: defaultEdges(),
    digest: { enabled: true, cron: '0 9 * * 1', timezone: args.timezone, audience: [args.ownerEmail] },
    metadata: { archetype: 'onboarding_sequence', generatedAt: new Date().toISOString() },
  };
}

function genericMap(args: FallbackArgs): WorkflowMap {
  return {
    version: 1,
    operationName: args.operationName,
    ownerEmail: args.ownerEmail,
    trigger: {
      type: 'form_submission',
      formTitle: args.operationName,
      fields: [
        { id: 'name', label: 'Name', type: 'short_text', required: true },
        { id: 'email', label: 'Email', type: 'email', required: true },
        { id: 'message', label: 'Message', type: 'long_text', required: true },
      ],
    },
    steps: defaultSteps(),
    edges: defaultEdges(),
    digest: { enabled: true, cron: '0 9 * * 1', timezone: args.timezone, audience: [args.ownerEmail] },
    metadata: { archetype: 'generic', generatedAt: new Date().toISOString() },
  };
}

function defaultSteps(): WorkflowMap['steps'] {
  return [
    { id: 'trigger', kind: 'trigger', title: 'Submission received', summary: 'A new submission arrives at the form endpoint.', config: {}, position: { x: 0, y: 0 } },
    { id: 'validate', kind: 'validate', title: 'Validate', summary: 'Required fields are present and well-formed.', config: {}, position: { x: 200, y: 0 } },
    { id: 'classify', kind: 'classify', title: 'Classify', summary: 'Score the submission against your criteria.', config: {}, position: { x: 400, y: 0 } },
    { id: 'draft', kind: 'draft_email', title: 'Draft reply', summary: 'A reply is drafted in your voice.', config: {}, position: { x: 600, y: 0 } },
    { id: 'approval', kind: 'approval_gate', title: 'Wait for your approval', summary: 'You receive an email and tap one of three buttons.', config: {}, position: { x: 800, y: 0 } },
    { id: 'send', kind: 'send_email', title: 'Send', summary: 'The approved reply is sent.', config: {}, position: { x: 1000, y: 0 } },
    { id: 'persist', kind: 'persist', title: 'Record', summary: 'The submission and decision are saved.', config: {}, position: { x: 1200, y: 0 } },
    { id: 'digest', kind: 'digest', title: 'Monday digest', summary: 'A summary of the week is sent each Monday.', config: { cron: '0 9 * * 1' }, position: { x: 600, y: 200 } },
  ];
}

function defaultEdges(): WorkflowMap['edges'] {
  return [
    { id: 'e1', source: 'trigger', target: 'validate' },
    { id: 'e2', source: 'validate', target: 'classify' },
    { id: 'e3', source: 'classify', target: 'draft' },
    { id: 'e4', source: 'draft', target: 'approval' },
    { id: 'e5', source: 'approval', target: 'send', label: 'approved' },
    { id: 'e6', source: 'send', target: 'persist' },
    { id: 'e7', source: 'approval', target: 'persist', label: 'declined' },
  ];
}
