import {
  DEFAULT_PROFILE,
  getProfileConfig,
  isValidProfile,
  loadProfiles,
  PROFILE_KEYS,
  resolveProfilesPath,
  resolveWorkspacePath,
} from './profiles';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

describe('profiles', () => {
  it('loads the bundled generic sample profile independently of local configuration', () => {
    const bundled = loadProfiles({
      BOB_PROFILES_PATH: resolve(__dirname, '../../profiles'),
      BOB_WORKSPACE_PATH: '/workspace',
    });
    expect(bundled.sample.displayName).toBe('Bob');
    expect(bundled.sample.models).toEqual({});
    expect(PROFILE_KEYS).toContain(DEFAULT_PROFILE);
    expect(isValidProfile(DEFAULT_PROFILE)).toBe(true);
  });

  it('validates dynamic profile ids', () => {
    expect(isValidProfile(DEFAULT_PROFILE)).toBe(true);
    expect(isValidProfile('missing')).toBe(false);
    expect(isValidProfile(42)).toBe(false);
  });

  it('uses generic workspace and profiles environment paths', () => {
    expect(resolveWorkspacePath({ BOB_WORKSPACE_PATH: '/workspace' })).toBe(
      '/workspace',
    );
    expect(resolveProfilesPath({ BOB_PROFILES_PATH: '/profiles' })).toBe(
      '/profiles',
    );
  });

  it('loads prompts, permissions, skills, and extensions relative to a profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'bob-profile-test-'));
    const profile = join(root, 'custom');
    const workspace = join(root, 'workspace');
    mkdirSync(join(workspace, 'docs'), { recursive: true });
    mkdirSync(join(profile, 'skills'), { recursive: true });
    mkdirSync(join(profile, 'extensions'), { recursive: true });
    writeFileSync(join(profile, 'SYSTEM.md'), 'Custom prompt');
    writeFileSync(join(profile, 'extensions', 'pi.ts'), 'export default () => {}');
    writeFileSync(join(profile, 'extensions', 'omp.ts'), 'export default () => {}');
    writeFileSync(
      join(profile, 'profile.json'),
      JSON.stringify({
        version: 1,
        id: 'custom',
        displayName: 'Custom',
        systemPrompt: 'SYSTEM.md',
        defaultHarness: 'pi',
        permissions: {
          readRoots: ['.'],
          writeRoots: ['docs'],
          operatorCommands: ['just'],
          webResearch: true,
        },
        skillsDirectory: 'skills',
        piExtensions: ['extensions/pi.ts'],
        ompExtensions: ['extensions/omp.ts'],
      }),
    );

    try {
      const loaded = loadProfiles({
        BOB_PROFILES_PATH: root,
        BOB_WORKSPACE_PATH: workspace,
      }).custom;
      expect(loaded.systemPrompt).toBe('Custom prompt');
      expect(loaded.cwd).toBe(workspace);
      expect(loaded.writeRoots).toEqual([
        realpathSync.native(join(workspace, 'docs')),
      ]);
      expect(loaded.allowedTools).toEqual([
        'WebSearch',
        'WebFetch',
        'Skill',
        'Bash(just:*)',
      ]);
      expect(loaded.operatorCommands).toEqual(['just']);
      expect(loaded.webResearch).toBe(true);
      expect(loaded.skillsPath).toBe(join(profile, 'skills'));
      expect(loaded.piExtensions).toEqual([
        join(profile, 'extensions', 'pi.ts'),
      ]);
      expect(loaded.ompExtensions).toEqual([
        join(profile, 'extensions', 'omp.ts'),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });


  it('canonicalizes symlinked write roots and rejects missing roots', () => {
    const root = mkdtempSync(join(tmpdir(), 'bob-profile-roots-'));
    const profiles = join(root, 'profiles');
    const profile = join(profiles, 'custom');
    const workspace = join(root, 'workspace');
    const actual = join(workspace, 'actual');
    mkdirSync(profile, { recursive: true });
    mkdirSync(actual, { recursive: true });
    symlinkSync(actual, join(workspace, 'linked'));
    const manifest = {
      version: 1,
      id: 'custom',
      displayName: 'Custom',
      permissions: { writeRoots: ['linked'] },
    };
    writeFileSync(join(profile, 'profile.json'), JSON.stringify(manifest));
    try {
      const loaded = loadProfiles({
        BOB_PROFILES_PATH: profiles,
        BOB_WORKSPACE_PATH: workspace,
      });
      expect(loaded.custom.writeRoots).toEqual([realpathSync.native(actual)]);

      writeFileSync(
        join(profile, 'profile.json'),
        JSON.stringify({
          ...manifest,
          permissions: { writeRoots: ['missing'] },
        }),
      );
      expect(() =>
        loadProfiles({
          BOB_PROFILES_PATH: profiles,
          BOB_WORKSPACE_PATH: workspace,
        }),
      ).toThrow(/write root cannot be resolved/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('rejects a profile id that does not match its directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'bob-profile-test-'));
    const profile = join(root, 'directory-name');
    mkdirSync(profile);
    writeFileSync(
      join(profile, 'profile.json'),
      JSON.stringify({ version: 1, id: 'different', displayName: 'Broken' }),
    );
    try {
      expect(() => loadProfiles({ BOB_PROFILES_PATH: root })).toThrow(
        /must match directory/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
