# Email doctrine — Section 8 of the master prompt

> Email is not a feature. Email is the product.

## Doctrine 1 — every email is one Maya is glad to receive

Argo emails Maya only when:

- (a) her decision is required, OR
- (b) something good happened she'd want to know about, OR
- (c) something is being repaired and she should approve, OR
- (d) the weekly digest is ready.

Argo never emails for confirmation, status, or "FYI". Notifications are
spam by another name. If a feature requires a notification email, we
redesign the feature.

## Doctrine 2 — approval emails are the same shape every time

THREE buttons. Three. APPROVE & SEND, EDIT FIRST, DECLINE. The approval
link is a one-time tokenized URL that resolves the action without login
and expires in 72 hours. If unclicked at 48 hours, Argo sends one (and
only one) reminder. If unclicked at 72 hours, the action is auto-declined
and logged.

Wire format: `apps/web/src/components/ui/...` does not render approval
emails. The renderer lives in `packages/email-automation/src/templates.ts`
and is the single source of truth for `[Argo · {OperationName}]` subject
prefix and the locked body shape.

## Doctrine 3 — the weekly digest is prose

Three paragraphs. No bullet lists. No metrics tables. No charts. Generated
fresh every Monday by `composeWeeklyDigest()` (in `packages/agent/src/digest`).
The model is system-prompted to write as a knowledgeable employee who has
been with the company for a year — calm, brief, human.

If the third paragraph proposes an action, Maya can accept by replying
"yes" — that is parsed by the inbound parser and converted into a new
approval gate.

## Doctrine 4 — inbound replies are first-class

Maya can reply to any Argo email. The inbound parser
(`packages/email-automation/src/inbound-parser.ts`) handles:

- "approve all the engineering ones"
- "skip Priya, send the others"
- "what did Acme say to last week's batch?"
- "stop" / "pause" — invokes the kill switch

Pre-production the parser must be benchmarked against ≥200 anonymised
real replies. The eval harness lives in `apps/api/scripts/inbound-parser-eval.ts`
(TODO when the corpus exists).

## Doctrine 5 — visual identity in the inbox

Every subject starts with `[Argo · {OperationName}]`. The body uses a
single monospace block for context data. No HTML email frameworks. No
logos. No images. No tracking pixels.
