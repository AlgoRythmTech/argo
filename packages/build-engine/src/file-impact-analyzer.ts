/**
 * File Impact Analyzer — predicts which files an instruction affects.
 *
 * Pain point #2 from user research: "Agents frequently edit the wrong
 * files, re-introduce old bugs, or rewrite stable code when asked for
 * small, targeted changes."
 *
 * This analyzer looks at the instruction keywords and the file contents
 * to predict which files need to change. The iterate route uses this to
 * tell GPT-5.5 "only touch these files" — dramatically reducing the
 * risk of unintended changes.
 */

export interface FileImpact {
  path: string;
  confidence: number; // 0-1, how likely this file needs to change
  reason: string;
}

/**
 * Analyze which files an instruction is likely to affect.
 * Returns files sorted by confidence (highest first).
 */
export function analyzeFileImpact(
  instruction: string,
  files: Array<[string, string]>,
): FileImpact[] {
  const lower = instruction.toLowerCase();
  const impacts: FileImpact[] = [];

  // Extract key entities from the instruction
  const mentionedPaths = extractMentionedPaths(lower);
  const mentionedConcepts = extractConcepts(lower);

  for (const [path, contents] of files) {
    let confidence = 0;
    const reasons: string[] = [];

    // Direct path mention (highest confidence)
    for (const mp of mentionedPaths) {
      if (path.includes(mp)) {
        confidence = Math.max(confidence, 0.95);
        reasons.push(`Directly mentioned: "${mp}"`);
      }
    }

    // Concept matching
    for (const concept of mentionedConcepts) {
      // Check filename
      if (path.toLowerCase().includes(concept.keyword)) {
        confidence = Math.max(confidence, concept.weight);
        reasons.push(`Filename matches concept: "${concept.keyword}"`);
      }

      // Check file contents for relevant patterns
      if (contents.toLowerCase().includes(concept.keyword)) {
        const contentWeight = concept.weight * 0.7; // Content match is weaker than filename
        confidence = Math.max(confidence, contentWeight);
        reasons.push(`Content contains: "${concept.keyword}"`);
      }
    }

    // Special rules for common change types
    if (lower.includes('email') && (path.includes('mail') || path.includes('template'))) {
      confidence = Math.max(confidence, 0.9);
      reasons.push('Email-related change affects mailer/templates');
    }

    if (lower.includes('field') && (path.includes('schema') || path.includes('form'))) {
      confidence = Math.max(confidence, 0.85);
      reasons.push('Field change affects schema/form');
    }

    if ((lower.includes('style') || lower.includes('color') || lower.includes('theme') || lower.includes('design')) && (path.includes('css') || path.includes('style') || path.includes('tailwind') || path.includes('theme'))) {
      confidence = Math.max(confidence, 0.7);
      reasons.push('Style change affects CSS/components');
    }

    if (lower.includes('api') && path.includes('route')) {
      confidence = Math.max(confidence, 0.8);
      reasons.push('API change affects routes');
    }

    if (lower.includes('database') && (path.includes('db') || path.includes('mongo') || path.includes('schema'))) {
      confidence = Math.max(confidence, 0.85);
      reasons.push('Database change affects db/schema files');
    }

    if (lower.includes('test') && path.includes('test')) {
      confidence = Math.max(confidence, 0.8);
      reasons.push('Test-related change affects test files');
    }

    // package.json is affected by dependency-related changes
    if (path === 'package.json' && (lower.includes('add') || lower.includes('install') || lower.includes('dependency') || lower.includes('package'))) {
      confidence = Math.max(confidence, 0.7);
      reasons.push('Dependency change affects package.json');
    }

    // README is almost never the target of a change
    if (path === 'README.md') {
      confidence = Math.min(confidence, 0.1);
    }

    if (confidence > 0.1) {
      impacts.push({
        path,
        confidence: Math.round(confidence * 100) / 100,
        reason: reasons.join('; '),
      });
    }
  }

  return impacts.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Generate a prompt section telling the model which files to focus on.
 */
export function renderImpactAsPromptSection(impacts: FileImpact[]): string {
  if (impacts.length === 0) return '';

  const high = impacts.filter((i) => i.confidence >= 0.7);
  const medium = impacts.filter((i) => i.confidence >= 0.4 && i.confidence < 0.7);

  const lines: string[] = [];
  lines.push('## File impact prediction');
  lines.push('');
  lines.push('Based on your instruction, these files are most likely to need changes:');
  lines.push('');

  if (high.length > 0) {
    lines.push('**HIGH confidence (focus here first):**');
    for (const h of high.slice(0, 8)) {
      lines.push(`- \`${h.path}\` (${Math.round(h.confidence * 100)}%) — ${h.reason}`);
    }
    lines.push('');
  }

  if (medium.length > 0) {
    lines.push('**MEDIUM confidence (may need changes):**');
    for (const m of medium.slice(0, 5)) {
      lines.push(`- \`${m.path}\` (${Math.round(m.confidence * 100)}%) — ${m.reason}`);
    }
    lines.push('');
  }

  lines.push('**DO NOT modify files not listed above unless absolutely necessary.**');
  lines.push('If you need to change an unlisted file, explain WHY in your response.');
  lines.push('');

  return lines.join('\n');
}

// ── Helpers ─────────────────────────────────────────────────────────

function extractMentionedPaths(instruction: string): string[] {
  const paths: string[] = [];
  // Match quoted paths
  const quoted = instruction.match(/["'`]([a-z0-9._/-]+\.[a-z]+)["'`]/gi);
  if (quoted) {
    for (const q of quoted) {
      paths.push(q.replace(/["'`]/g, ''));
    }
  }
  // Match paths with extensions
  const extensions = instruction.match(/\b([a-z0-9._/-]+\.(ts|tsx|js|jsx|json|css|html|md))\b/gi);
  if (extensions) {
    for (const e of extensions) {
      paths.push(e);
    }
  }
  return [...new Set(paths)];
}

interface Concept {
  keyword: string;
  weight: number;
}

function extractConcepts(instruction: string): Concept[] {
  const concepts: Concept[] = [];

  const conceptMap: Record<string, number> = {
    email: 0.8, mail: 0.8, template: 0.7,
    form: 0.8, submit: 0.7, validation: 0.7,
    auth: 0.85, login: 0.85, session: 0.7, password: 0.8,
    route: 0.7, endpoint: 0.7, api: 0.6,
    database: 0.8, mongo: 0.8, schema: 0.8, collection: 0.7,
    style: 0.6, css: 0.7, tailwind: 0.7, color: 0.6, font: 0.6,
    button: 0.6, header: 0.6, footer: 0.6, navbar: 0.6,
    test: 0.7, spec: 0.7,
    config: 0.6, env: 0.6, setting: 0.6,
    cron: 0.8, schedule: 0.8, job: 0.7, worker: 0.7,
    webhook: 0.8, notification: 0.7, slack: 0.8,
    billing: 0.8, stripe: 0.8, payment: 0.8, price: 0.7,
    approval: 0.8, reject: 0.7, accept: 0.7,
    digest: 0.8, summary: 0.7, report: 0.6,
  };

  for (const [keyword, weight] of Object.entries(conceptMap)) {
    if (instruction.includes(keyword)) {
      concepts.push({ keyword, weight });
    }
  }

  return concepts;
}
