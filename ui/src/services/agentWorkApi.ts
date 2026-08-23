import type { AgentWorkRecord } from '../types/session';

const API_BASE_URL = '/api/agent-work';

export async function getTerminalSequence(): Promise<number> {
  const response = await fetch(`${API_BASE_URL}/terminal-sequence`);
  if (!response.ok) throw new Error('Failed to fetch terminal sequence');
  const payload = (await response.json()) as { terminalSequence: number };
  return payload.terminalSequence;
}

export async function getTerminalAgentWorkAfter(
  sequence: number,
): Promise<AgentWorkRecord[]> {
  const response = await fetch(`${API_BASE_URL}?after=${sequence}`);
  if (!response.ok) throw new Error('Failed to fetch terminal Agent Work');
  return response.json();
}

export async function cancelAgentWork(id: string): Promise<AgentWorkRecord> {
  const response = await fetch(`${API_BASE_URL}/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Failed to cancel Agent Work');
  }
  return response.json();
}
