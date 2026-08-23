import type { AgentHarness } from '../types/session';

export interface ProfileCapabilities {
  workspace: string;
  backgroundWork: boolean;
  read: {
    roots: string[];
    enforcement: 'harness-settings' | 'workspace-process';
  };
  write: {
    roots: string[];
    enforcement: 'disabled' | 'bob-extension' | 'harness-settings';
  };
  operatorCommands: {
    declared: string[];
    effective: string[];
  };
  webResearch: boolean;
  mcp: {
    configured: boolean;
    effective: boolean;
  };
  extensions: number;
}

export interface ProfileOption {
  id: string;
  displayName: string;
  description: string;
  defaultHarness: AgentHarness;
  capabilities: ProfileCapabilities;
}

interface ProfilesResponse {
  defaultProfile: string;
  profiles: ProfileOption[];
}

export async function fetchProfiles(): Promise<ProfilesResponse> {
  const response = await fetch('/api/profiles');
  if (!response.ok) throw new Error('Failed to fetch profiles');
  return response.json() as Promise<ProfilesResponse>;
}
