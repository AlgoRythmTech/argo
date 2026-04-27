# Third-party notices

This project incorporates code adapted from third-party open-source projects.
Each entry below lists the upstream project, the license under which we
received it, and which Argo files derive from it.

## OpenClaw

- Upstream: https://github.com/openclaw/openclaw
- Copyright: (c) 2025 Peter Steinberger
- License: MIT (full text in upstream repo)

Argo's skills-directory system is adapted from OpenClaw's `src/agents/skills/`
and `src/markdown/frontmatter.ts`. We re-implemented the patterns in
TypeScript that fits Argo's runtime (async I/O, no desktop FS hardening,
no install-spec normalization), but the design — SKILL.md frontmatter
required name + description, deferred body loading, path-traversal-safe
directory walk, hybrid line+YAML parser to resist colon-in-description
mis-parses — is all from upstream.

Files derived from OpenClaw:

- `packages/agent/src/skills/frontmatter.ts`
  - Adapted from `src/markdown/frontmatter.ts`
- `packages/agent/src/skills/loader.ts`
  - Adapted from `src/agents/skills/local-loader.ts`
