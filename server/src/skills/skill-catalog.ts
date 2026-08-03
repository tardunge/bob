import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'fs';
import { join } from 'path';

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

export function discoverSkills(roots: string[]): SkillInfo[] {
  const byName = new Map<string, SkillInfo>();
  for (const root of roots) {
    for (const skill of walkSkills(root)) {
      // Earlier roots are canonical. This also prevents a skill appearing twice
      // when the Claude and Bob-kit paths point at the same files.
      if (!byName.has(skill.name)) byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function parseSkillFrontmatter(content: string): Omit<SkillInfo, 'path'> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { name: '', description: '' };

  let name = '';
  let description = '';
  for (const line of match[1].split('\n')) {
    const field = line.match(/^(name|description):\s*(.*?)\s*$/);
    if (!field) continue;
    const value = unquote(field[2]);
    if (field[1] === 'name') name = value;
    else description = value;
  }
  return { name, description };
}

function walkSkills(root: string): SkillInfo[] {
  if (!existsSync(root)) return [];
  const found: SkillInfo[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    let isDirectory = false;
    try {
      isDirectory = statSync(path).isDirectory();
    } catch {
      continue;
    }
    if (!isDirectory) continue;

    const skillPath = join(path, 'SKILL.md');
    if (existsSync(skillPath)) {
      try {
        const metadata = parseSkillFrontmatter(readFileSync(skillPath, 'utf8'));
        if (metadata.name && metadata.description) {
          found.push({ ...metadata, path: skillPath });
        }
      } catch {
        // A broken skill should not make the entire picker unavailable.
      }
    }
    found.push(...walkSkills(path));
  }
  return found;
}

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1).trim();
  }
  return value.trim();
}
