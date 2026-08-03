import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

function isInside(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export default function bobProfileExtension(pi: ExtensionAPI) {
  const profilePath = process.env.BOB_ACTIVE_PROFILE_PATH;
  const workspacePath = process.env.BOB_WORKSPACE_PATH;
  if (!profilePath || !workspacePath) {
    throw new Error('Bob did not provide an active profile and workspace to Pi.');
  }

  const systemPromptPath = process.env.BOB_SYSTEM_PROMPT_PATH;
  const systemPrompt = systemPromptPath
    ? readFileSync(systemPromptPath, 'utf8').trim()
    : '';
  const skillsPath = process.env.BOB_SKILLS_PATH;
  const writeRoots = JSON.parse(
    process.env.BOB_WRITE_ROOTS_JSON || '[]',
  ) as string[];

  pi.on('session_start', () => {
    const active = new Set(pi.getActiveTools());
    for (const tool of ['read', 'grep', 'find', 'ls']) active.add(tool);
    if (writeRoots.length > 0) {
      active.add('edit');
      active.add('write');
    } else {
      active.delete('edit');
      active.delete('write');
    }
    active.delete('bash');
    pi.setActiveTools([...active]);
  });

  if (skillsPath) {
    pi.on('resources_discover', () => ({ skillPaths: [skillsPath] }));
  }
  if (systemPrompt) {
    pi.on('before_agent_start', (event) => ({
      systemPrompt: `${event.systemPrompt}\n\n${systemPrompt}`,
    }));
  }

  pi.on('tool_call', (event) => {
    if (event.toolName !== 'write' && event.toolName !== 'edit') return;
    const path = typeof event.input.path === 'string' ? event.input.path : '';
    const absolute = isAbsolute(path) ? path : join(workspacePath, path);
    const allowed = writeRoots.some((root) =>
      isInside(absolute, isAbsolute(root) ? root : join(workspacePath, root)),
    );
    if (!allowed) {
      return {
        block: true,
        reason: 'This profile may only write inside its declared write roots.',
      };
    }
  });
}
