import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { discoverSkills, parseSkillFrontmatter } from './skill-catalog';

describe('skill catalog', () => {
  it('parses required Agent Skills metadata and quoted values', () => {
    expect(
      parseSkillFrontmatter(
        `---\nname: "grill-me"\ndescription: 'Interview the user'\n---\n# Grill`,
      ),
    ).toEqual({ name: 'grill-me', description: 'Interview the user' });
  });

  it('recursively discovers skills and prefers the canonical root', () => {
    const root = join(tmpdir(), `bob-skills-${randomUUID()}`);
    const canonical = join(root, 'canonical', 'shared');
    const duplicate = join(root, 'duplicate', 'shared');
    const nested = join(root, 'duplicate', 'nested', 'other');
    mkdirSync(canonical, { recursive: true });
    mkdirSync(duplicate, { recursive: true });
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(canonical, 'SKILL.md'),
      '---\nname: shared\ndescription: canonical\n---\n',
    );
    writeFileSync(
      join(duplicate, 'SKILL.md'),
      '---\nname: shared\ndescription: duplicate\n---\n',
    );
    writeFileSync(
      join(nested, 'SKILL.md'),
      '---\nname: other\ndescription: nested\n---\n',
    );

    try {
      expect(discoverSkills([join(root, 'canonical'), join(root, 'duplicate')])).toEqual([
        { name: 'other', description: 'nested', path: join(nested, 'SKILL.md') },
        { name: 'shared', description: 'canonical', path: join(canonical, 'SKILL.md') },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
