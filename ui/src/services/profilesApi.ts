export interface ProfileOption {
  id: string;
  displayName: string;
  description: string;
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
