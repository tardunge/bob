import type {
  Session,
  SessionProfile,
  SessionUsage,
  SessionWithMessages,
} from '../types/session';

const API_BASE_URL = '/api';

export async function createSession(
  title?: string,
  profile?: SessionProfile,
): Promise<Session> {
  const response = await fetch(`${API_BASE_URL}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, profile }),
  });

  if (!response.ok) {
    throw new Error('Failed to create session');
  }

  return response.json();
}

export async function getSessions(): Promise<Session[]> {
  const response = await fetch(`${API_BASE_URL}/sessions`);

  if (!response.ok) {
    throw new Error('Failed to fetch sessions');
  }

  return response.json();
}

export async function getSession(id: string): Promise<SessionWithMessages> {
  const response = await fetch(`${API_BASE_URL}/sessions/${id}`);

  if (!response.ok) {
    throw new Error('Failed to fetch session');
  }

  return response.json();
}

export async function updateSession(
  id: string,
  data: { title?: string },
): Promise<Session> {
  const response = await fetch(`${API_BASE_URL}/sessions/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error('Failed to update session');
  }

  return response.json();
}

export async function getSessionUsage(id: string): Promise<SessionUsage> {
  const response = await fetch(`${API_BASE_URL}/sessions/${id}/usage`);
  if (!response.ok) {
    throw new Error('Failed to fetch session usage');
  }
  return response.json();
}

export async function deleteSession(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/sessions/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete session');
  }
}
