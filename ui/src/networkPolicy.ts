export function isLoopbackHost(host: string): boolean {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(
    host.trim().toLowerCase(),
  );
}

export function assertSafeUiNetwork(env: Record<string, string>): void {
  const host = env.BOB_UI_HOST || '127.0.0.1';
  if (isLoopbackHost(host)) return;
  if (env.BOB_REMOTE_MODE !== 'proxy') {
    throw new Error(
      `Refusing non-loopback BOB_UI_HOST '${host}'. Keep Bob on localhost or set BOB_REMOTE_MODE=proxy behind an authenticated HTTPS reverse proxy.`,
    );
  }
  const allowedHosts = (env.BOB_UI_ALLOWED_HOSTS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    allowedHosts.length === 0 ||
    allowedHosts.some(
      (value) =>
        value.includes('*') ||
        value.startsWith('.') ||
        value.includes('/') ||
        value.includes(':'),
    )
  ) {
    throw new Error(
      'BOB_REMOTE_MODE=proxy requires explicit BOB_UI_ALLOWED_HOSTS; wildcard or non-host entries are forbidden.',
    );
  }
}
