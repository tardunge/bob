import { Controller, Get } from '@nestjs/common';
import { DEFAULT_PROFILE, PROFILE_KEYS, PROFILES } from './profiles';

function profileProjection(id: string) {
  const profile = PROFILES[id];
  const harness = profile.defaultHarness;
  const rpcHarness = harness === 'pi' || harness === 'omp';
  return {
    id,
    displayName: profile.displayName,
    description: profile.description,
    defaultHarness: harness,
    capabilities: {
      workspace: profile.cwd,
      backgroundWork: rpcHarness,
      read: {
        roots: profile.readRoots,
        enforcement:
          harness === 'claude' ? 'harness-settings' : 'workspace-process',
      },
      write: {
        roots: profile.writeRoots,
        enforcement:
          profile.writeRoots.length === 0
            ? 'disabled'
            : rpcHarness
              ? 'bob-extension'
              : 'harness-settings',
      },
      operatorCommands: {
        declared: profile.operatorCommands,
        effective: harness === 'claude' ? profile.operatorCommands : [],
      },
      webResearch: profile.webResearch,
      mcp: {
        configured: profile.mcpConfigPath !== null,
        effective: profile.mcpConfigPath !== null && harness === 'claude',
      },
      extensions:
        harness === 'pi'
          ? profile.piExtensions.length
          : harness === 'omp'
            ? profile.ompExtensions.length
            : 0,
    },
  };
}

@Controller('profiles')
export class ProfilesController {
  @Get()
  list() {
    return {
      defaultProfile: DEFAULT_PROFILE,
      profiles: PROFILE_KEYS.map(profileProjection),
    };
  }
}
