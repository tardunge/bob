import type { SessionProfile } from '../types/session';

export interface SkillInfo {
  name: string;
  description: string;
}

export async function fetchSkills(profile?: SessionProfile): Promise<SkillInfo[]> {
  const query = profile ? `?profile=${encodeURIComponent(profile)}` : '';
  const response = await fetch(`/api/skills${query}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch skills: ${response.statusText}`);
  }
  return response.json();
}
