import { assertSafeServerNetwork, isLoopbackHost } from './network-policy';

describe('server network policy', () => {
  it.each(['127.0.0.1', 'localhost', '::1', '[::1]'])(
    'accepts loopback host %s without remote mode',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
      expect(() => assertSafeServerNetwork({ BOB_HOST: host })).not.toThrow();
    },
  );

  it('rejects an accidental public bind', () => {
    expect(() => assertSafeServerNetwork({ BOB_HOST: '0.0.0.0' })).toThrow(
      'Refusing non-loopback',
    );
  });

  it('requires explicit HTTPS origins in proxy mode', () => {
    expect(() =>
      assertSafeServerNetwork({
        BOB_HOST: '0.0.0.0',
        BOB_REMOTE_MODE: 'proxy',
        BOB_ALLOWED_ORIGINS: 'http://bob.example.com',
      }),
    ).toThrow('must use HTTPS');
    expect(() =>
      assertSafeServerNetwork({
        BOB_HOST: '0.0.0.0',
        BOB_REMOTE_MODE: 'proxy',
        BOB_ALLOWED_ORIGINS: 'https://bob.example.com',
      }),
    ).not.toThrow();
    expect(() =>
      assertSafeServerNetwork({
        BOB_HOST: '0.0.0.0',
        BOB_REMOTE_MODE: 'proxy',
        BOB_ALLOWED_ORIGINS: 'https://*.example.com',
      }),
    ).toThrow('wildcard origins are forbidden');
    expect(() =>
      assertSafeServerNetwork({
        BOB_HOST: '0.0.0.0',
        BOB_REMOTE_MODE: 'proxy',
        BOB_ALLOWED_ORIGINS: 'https://bob.example.com/path',
      }),
    ).toThrow('exact origin');
  });
});
