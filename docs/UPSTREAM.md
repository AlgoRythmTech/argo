# Upstream attribution

Per the Apache 2.0 / MIT license terms of the projects we lean on, here
is the inventory of what was lifted, borrowed, or studied. Every relevant
file in the codebase carries `// argo:upstream <project>@<sha>` so it can
be re-merged quarterly when upstream improves.

## Cloned (runtime substrate)

| Project        | License     | What we use                                        |
| -------------- | ----------- | -------------------------------------------------- |
| **Dyad**       | Apache-2.0  | File-streaming generator pattern + sandbox boot    |
| **Open Lovable** | Apache-2.0 | Per-step file-by-file generation pattern           |

Both license texts live in `/licenses/`. The marketing site footer
includes the required attribution paragraph.

## Borrowed (patterns, not code)

| Project    | License    | What we borrow                                       |
| ---------- | ---------- | ---------------------------------------------------- |
| **Cline**  | Apache-2.0 | Diff-then-approve UX for repair flow                 |
| **OpenHands** | MIT     | Event taxonomy for `agent_invocations`               |

## Studied (read, then walked away)

| Project | What it taught us                                                       |
| ------- | ----------------------------------------------------------------------- |
| Bolt.diy | What WebContainers licensing trap to avoid                             |
| Aider    | Why CLI-first abstractions don't translate to non-developer surfaces   |
| Cursor   | Why IDE forks aren't a viable wedge for non-engineer customers         |

## UI components

The `apps/web/src/components/ui/*` directory hosts components from
**21st.dev**, **shadcn/ui**, and **aceternity**. Each file carries
`// argo:upstream <namespace>@<component>` and is themed against Argo's
HSL token palette. The components are *configured once* and never
customised piecewise — if a customisation is needed, we add a token.
