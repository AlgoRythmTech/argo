import type { InboundEmail } from '@argo/shared-types';

/**
 * Lightweight inbound parser. Extracts structured intent from Maya's reply
 * to an Argo email — `approve all the engineering ones`, `skip Priya, send
 * the others`, `what did Acme say to last week's batch?`, etc.
 *
 * Section 8, Doctrine 4: "Inbound replies are first-class. [...] The system
 * prompt for inbound parsing must be tested against at least 200 real
 * (anonymized) replies before going to production."
 *
 * In v1 the parser is a deterministic-first heuristic plus a fallback to the
 * agent (the agent is invoked from /packages/agent/src/running/parse-reply.ts
 * which uses this module's normalised input).
 */

export type InboundIntentKind =
  | 'approve_all'
  | 'decline_all'
  | 'approve_subset'
  | 'decline_subset'
  | 'free_text_question'
  | 'forward_request'
  | 'unknown';

export type InboundIntent = {
  kind: InboundIntentKind;
  /** Names or IDs the user explicitly mentioned. */
  mentionedNames: string[];
  /** Free-form residual text for the LLM to interpret. */
  residualText: string;
  /** Whether the user used the magic word "stop" / "pause". */
  pauseRequested: boolean;
};

const APPROVE_REGEX = /\b(approve|approved|yes|ship|send it|go ahead|sounds good|lgtm)\b/i;
const DECLINE_REGEX = /\b(decline|reject|no|skip|don'?t send|hold)\b/i;
const ALL_REGEX = /\b(all|everyone|everybody|every one|each)\b/i;
const QUESTION_REGEX = /\?/;
const PAUSE_REGEX = /\b(pause|stop|cancel)\b/i;
const FORWARD_REGEX = /\b(forward|fwd|send to)\b/i;

export function parseInboundIntent(email: InboundEmail): InboundIntent {
  const text = stripQuotedReply(email.textBody);

  const approve = APPROVE_REGEX.test(text);
  const decline = DECLINE_REGEX.test(text);
  const all = ALL_REGEX.test(text);
  const isQuestion = QUESTION_REGEX.test(text);
  const pauseRequested = PAUSE_REGEX.test(text);
  const forward = FORWARD_REGEX.test(text);

  const mentionedNames = extractCapitalisedNames(text);

  let kind: InboundIntentKind = 'unknown';
  if (forward) kind = 'forward_request';
  else if (approve && all) kind = 'approve_all';
  else if (decline && all) kind = 'decline_all';
  else if (approve && mentionedNames.length > 0) kind = 'approve_subset';
  else if (decline && mentionedNames.length > 0) kind = 'decline_subset';
  else if (isQuestion) kind = 'free_text_question';

  return {
    kind,
    mentionedNames,
    residualText: text,
    pauseRequested,
  };
}

const QUOTED_LINE = /^>/;
const REPLY_DELIMITERS = [
  /^On .+ wrote:$/m,
  /^From: .+$/m,
  /^-{2,}\s*Original Message\s*-{2,}$/im,
];

function stripQuotedReply(text: string): string {
  let cut = text.length;
  for (const r of REPLY_DELIMITERS) {
    const m = text.match(r);
    if (m && typeof m.index === 'number' && m.index < cut) cut = m.index;
  }
  const trimmed = text.slice(0, cut);
  return trimmed
    .split('\n')
    .filter((line) => !QUOTED_LINE.test(line.trim()))
    .join('\n')
    .trim();
}

const NAME_REGEX = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
const STOP_WORDS = new Set([
  'I', 'You', 'Argo', 'The', 'A', 'An', 'And', 'But', 'Or', 'Yes', 'No',
  'Approve', 'Decline', 'Skip', 'Hold', 'Stop', 'Send', 'Forward', 'From',
  'On', 'At', 'In', 'To', 'For', 'Of', 'With', 'By', 'About',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'Hi', 'Hello', 'Hey', 'Thanks', 'Thank',
]);

function extractCapitalisedNames(text: string): string[] {
  const matches = text.match(NAME_REGEX) ?? [];
  const names = new Set<string>();
  for (const m of matches) {
    if (STOP_WORDS.has(m)) continue;
    names.add(m);
  }
  return Array.from(names);
}
