export function isLoopbackHost(host: string): boolean {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(
    host.trim().toLowerCase(),
  );
}

export function assertSafeServerNetwork(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const host = env.BOB_HOST || '127.0.0.1';
  if (isLoopbackHost(host)) return;
  if (env.BOB_REMOTE_MODE !== 'proxy') {
    throw new Error(
      `Refusing non-loopback BOB_HOST '${host}'. Keep Bob on localhost or set BOB_REMOTE_MODE=proxy behind an authenticated HTTPS reverse proxy.`,
    );
  }
  const origins = (env.BOB_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0 || origins.some((origin) => origin.includes('*'))) {
    throw new Error(
      'BOB_REMOTE_MODE=proxy requires explicit BOB_ALLOWED_ORIGINS; wildcard origins are forbidden.',
    );
  }
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`Invalid BOB_ALLOWED_ORIGINS entry: '${origin}'.`);
    }
    if (url.protocol !== 'https:' || url.origin !== origin) {
      throw new Error(
        `Remote origin '${origin}' must use HTTPS and be an exact origin when BOB_REMOTE_MODE=proxy.`,
      );
    }
  }
}
