import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadSkillsFromDirectory,
  renderSkillsAsPromptCatalogue,
  readSkillBody,
} from './loader.js';

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'argo-skills-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function writeSkill(name: string, content: string): Promise<void> {
  const dir = join(scratch, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), content, 'utf8');
}

describe('loadSkillsFromDirectory', () => {
  it('returns an empty array for an empty directory', async () => {
    const skills = await loadSkillsFromDirectory({ dir: scratch, source: 'project' });
    expect(skills).toEqual([]);
  });

  it('returns an empty array for a non-existent directory', async () => {
    const skills = await loadSkillsFromDirectory({
      dir: join(scratch, 'does-not-exist'),
      source: 'project',
    });
    expect(skills).toEqual([]);
  });

  it('loads multiple skills sorted by name', async () => {
    await writeSkill(
      'weather',
      `---\nname: weather\ndescription: Look up weather.\n---\nbody-w`,
    );
    await writeSkill('alpha', `---\nname: alpha\ndescription: first.\n---\nbody-a`);
    const skills = await loadSkillsFromDirectory({ dir: scratch, source: 'project' });
    expect(skills.map((s) => s.name)).toEqual(['alpha', 'weather']);
    expect(skills[0]?.description).toBe('first.');
    expect(skills[0]?.source).toBe('project');
  });

  it('falls back to directory name when frontmatter name is missing', async () => {
    await writeSkill(
      'fallback-name',
      `---\ndescription: Has no name field.\n---\nbody`,
    );
    const skills = await loadSkillsFromDirectory({ dir: scratch, source: 'project' });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe('fallback-name');
  });

  it('skips skills with no description (cannot trigger)', async () => {
    await writeSkill('broken', `---\nname: broken\n---\nbody`);
    const skills = await loadSkillsFromDirectory({ dir: scratch, source: 'project' });
    expect(skills).toEqual([]);
  });

  it('skips skills missing SKILL.md', async () => {
    await mkdir(join(scratch, 'no-skill-md'), { recursive: true });
    await writeFile(join(scratch, 'no-skill-md', 'README.md'), 'not a skill', 'utf8');
    const skills = await loadSkillsFromDirectory({ dir: scratch, source: 'project' });
    expect(skills).toEqual([]);
  });

  it('skips dotted directories and node_modules', async () => {
    await writeSkill('.hidden', `---\nname: hidden\ndescription: x\n---\nbody`);
    await writeSkill('node_modules', `---\nname: nm\ndescription: x\n---\nbody`);
    await writeSkill('real', `---\nname: real\ndescription: real one.\n---\nbody`);
    const skills = await loadSkillsFromDirectory({ dir: scratch, source: 'project' });
    expect(skills.map((s) => s.name)).toEqual(['real']);
  });

  it('rejects files larger than maxBytes', async () => {
    const big = '#'.repeat(2000);
    await writeSkill(
      'too-big',
      `---\nname: big\ndescription: huge.\n---\n${big}`,
    );
    const skills = await loadSkillsFromDirectory({
      dir: scratch,
      source: 'project',
      maxBytes: 100,
    });
    expect(skills).toEqual([]);
  });
});

describe('renderSkillsAsPromptCatalogue', () => {
  it('returns empty string for empty skill list', () => {
    expect(renderSkillsAsPromptCatalogue([])).toBe('');
  });

  it('renders only name + description, never the body', async () => {
    await writeSkill(
      'weather',
      `---\nname: weather\ndescription: Look up weather.\n---\n# secret body should not appear`,
    );
    const skills = await loadSkillsFromDirectory({ dir: scratch, source: 'project' });
    const md = renderSkillsAsPromptCatalogue(skills);
    expect(md).toContain('weather');
    expect(md).toContain('Look up weather.');
    expect(md).not.toContain('secret body');
  });
});

describe('readSkillBody', () => {
  it('returns the body without the frontmatter', async () => {
    await writeSkill(
      'weather',
      `---\nname: weather\ndescription: Look up weather.\n---\n# Weather body\n\nUse the API.`,
    );
    const skills = await loadSkillsFromDirectory({ dir: scratch, source: 'project' });
    expect(skills).toHaveLength(1);
    const body = await readSkillBody(skills[0]!);
    expect(body).toContain('# Weather body');
    expect(body).toContain('Use the API.');
    expect(body).not.toContain('---');
  });
});
