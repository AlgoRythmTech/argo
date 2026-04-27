// Skills directory loader.
//
// Adapted from OpenClaw's local-loader.ts (MIT, Copyright (c) 2025 Peter
// Steinberger). The original walks `<dir>/<skill>/SKILL.md` files at boot,
// validates path containment, and returns lightweight Skill records that
// hold ONLY the frontmatter — the body is not loaded into context until
// the agent actually triggers the skill.
//
// Why this matters for Argo:
//   The body is the part the model reads when it decides how to use the
//   skill. Loading every body up-front wastes context for skills that
//   never trigger. We mirror OpenClaw's approach: parse frontmatter at
//   boot, store filePath, defer body load until skill invocation.
//
// Differences from upstream:
//   - We use async fs/promises throughout. OpenClaw uses sync fs because
//     it ships as a single binary — Argo runs inside Node servers where
//     async is preferred.
//   - We dropped the openVerifiedFileSync hardening (OpenClaw runs on
//     untrusted desktop FS; Argo skills directories are already inside
//     the Blaxel sandbox).
//   - We only support the per-subdirectory layout, not the rare "root is
//     a single skill" layout, since Argo always loads from a parent dir.

import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep, basename } from 'node:path';
import { parseFrontmatter, type ParsedFrontmatter } from './frontmatter.js';

export interface Skill {
  /** From frontmatter `name:`, falls back to directory basename. */
  name: string;
  /** From frontmatter `description:` — required. */
  description: string;
  /** Absolute path to the SKILL.md file. */
  filePath: string;
  /** Absolute path to the skill's directory (parent of SKILL.md). */
  baseDir: string;
  /** Where this skill came from. Free-form label — e.g. 'project',
   *  'plugin:my-plugin', 'home'. Used in audit logs. */
  source: string;
  /** Full structured frontmatter — preserves nested objects (metadata,
   *  inputSchema, etc.) the loader callers may need. */
  frontmatter: ParsedFrontmatter;
}

export interface LoadSkillsOptions {
  /** Directory whose subdirectories are individual skills. */
  dir: string;
  /** Source label for audit. */
  source: string;
  /** Max bytes per SKILL.md file (default 256 KiB — bodies can be long). */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 256 * 1024;

function isPathWithinRoot(rootRealPath: string, candidatePath: string): boolean {
  const rel = relative(rootRealPath, candidatePath);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

async function readSkillFile(opts: {
  rootRealPath: string;
  filePath: string;
  maxBytes: number;
}): Promise<string | null> {
  let real: string;
  try {
    real = await realpath(opts.filePath);
  } catch {
    return null;
  }
  if (!isPathWithinRoot(opts.rootRealPath, real)) return null;
  const s = await stat(real);
  if (!s.isFile()) return null;
  if (s.size > opts.maxBytes) return null;
  return readFile(real, 'utf8');
}

async function loadSingleSkill(opts: {
  skillDir: string;
  source: string;
  rootRealPath: string;
  maxBytes: number;
}): Promise<Skill | null> {
  const skillFilePath = join(opts.skillDir, 'SKILL.md');
  const raw = await readSkillFile({
    rootRealPath: opts.rootRealPath,
    filePath: skillFilePath,
    maxBytes: opts.maxBytes,
  });
  if (!raw) return null;

  const fm = parseFrontmatter(raw);
  const fallbackName = basename(opts.skillDir).trim();
  const name = (fm.scalars.name ?? '').trim() || fallbackName;
  const description = (fm.scalars.description ?? '').trim();
  if (!name || !description) return null;

  return {
    name,
    description,
    filePath: resolve(skillFilePath),
    baseDir: resolve(opts.skillDir),
    source: opts.source,
    frontmatter: fm,
  };
}

async function listCandidateDirs(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => join(dir, e.name))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Scan a directory for SKILL.md files and return parsed Skill records.
 * Skills with missing/invalid frontmatter are silently skipped (they
 * cannot trigger). Path-traversal-safe.
 */
export async function loadSkillsFromDirectory(opts: LoadSkillsOptions): Promise<Skill[]> {
  const rootDir = resolve(opts.dir);
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  let rootRealPath: string;
  try {
    rootRealPath = await realpath(rootDir);
  } catch {
    return [];
  }
  const candidates = await listCandidateDirs(rootRealPath);
  const loaded = await Promise.all(
    candidates.map((skillDir) =>
      loadSingleSkill({ skillDir, source: opts.source, rootRealPath, maxBytes }),
    ),
  );
  return loaded.filter((s): s is Skill => s !== null);
}

/**
 * Render the loaded skills as a compact text block the agent's system
 * prompt can embed. Only the name + description appear in the block —
 * the body is loaded on demand when the agent triggers the skill.
 *
 * This mirrors OpenClaw's compact-format approach, where the body never
 * enters context until needed.
 */
export function renderSkillsAsPromptCatalogue(skills: readonly Skill[]): string {
  if (skills.length === 0) return '';
  const out: string[] = [];
  out.push('# Available skills');
  out.push('');
  out.push(
    `These ${skills.length} skills are available. Each skill's body lives at the` +
      ` listed path; load it ONLY when you decide to use that skill.`,
  );
  out.push('');
  for (const s of skills) {
    out.push(`## ${s.name}`);
    out.push(`*Path: \`${s.filePath}\` · source: ${s.source}*`);
    out.push('');
    out.push(s.description);
    out.push('');
  }
  return out.join('\n');
}

/**
 * Read a skill's body on demand. Used when the agent triggers a skill
 * and the body needs to enter context.
 */
export async function readSkillBody(skill: Skill, maxBytes = DEFAULT_MAX_BYTES): Promise<string> {
  const raw = await readSkillFile({
    rootRealPath: skill.baseDir,
    filePath: skill.filePath,
    maxBytes,
  });
  if (!raw) return '';
  return parseFrontmatter(raw).body;
}
