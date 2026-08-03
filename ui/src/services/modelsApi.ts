import type { AgentHarness } from '../types/session';

export interface ModelOption {
  id: string;
  label: string;
}

export async function fetchModels(harness?: AgentHarness): Promise<ModelOption[]> {
  const query = harness ? `?harness=${encodeURIComponent(harness)}` : '';
  const response = await fetch(`/api/models${query}`);
  if (!response.ok) throw new Error('Failed to fetch models');
  return response.json();
}
