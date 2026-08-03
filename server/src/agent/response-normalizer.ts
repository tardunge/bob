export function cleanForDisplay(response: string): string {
  const ansiRegex = /\x1b\[[0-9;]*m/g;
  return response.replace(ansiRegex, '').trim();
}

export function cleanForSpeech(response: string): string {
  const ansiRegex = /\x1b\[[0-9;]*m/g;
  let cleaned = response.replace(ansiRegex, '').trim();

  cleaned = cleaned.replace(/```\w*\n?[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
  cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
  cleaned = cleaned.replace(/_([^_]+)_/g, '$1');
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned || 'Response shown on screen.';
}
