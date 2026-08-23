import { describe, expect, it } from 'vitest';
import { assertSafeUiNetwork } from './networkPolicy';

describe('UI network policy', () => {
  it('accepts the localhost default', () => {
    expect(() => assertSafeUiNetwork({})).not.toThrow();
  });

  it('rejects an accidental public bind', () => {
    expect(() => assertSafeUiNetwork({ BOB_UI_HOST: '0.0.0.0' })).toThrow(
      'Refusing non-loopback',
    );
  });

  it('requires an explicit host allowlist in proxy mode', () => {
    expect(() =>
      assertSafeUiNetwork({
        BOB_UI_HOST: '0.0.0.0',
        BOB_REMOTE_MODE: 'proxy',
      }),
    ).toThrow('requires explicit BOB_UI_ALLOWED_HOSTS');
    expect(() =>
      assertSafeUiNetwork({
        BOB_UI_HOST: '0.0.0.0',
        BOB_REMOTE_MODE: 'proxy',
        BOB_UI_ALLOWED_HOSTS: 'bob.example.com',
      }),
    ).not.toThrow();
    expect(() =>
      assertSafeUiNetwork({
        BOB_UI_HOST: '0.0.0.0',
        BOB_REMOTE_MODE: 'proxy',
        BOB_UI_ALLOWED_HOSTS: '.example.com',
      }),
    ).toThrow('wildcard or non-host entries are forbidden');
  });
});
