import { Controller, Get } from '@nestjs/common';
import { DEFAULT_PROFILE, PROFILE_KEYS, PROFILES } from './profiles';

@Controller('profiles')
export class ProfilesController {
  @Get()
  list() {
    return {
      defaultProfile: DEFAULT_PROFILE,
      profiles: PROFILE_KEYS.map((id) => ({
        id,
        displayName: PROFILES[id].displayName,
        description: PROFILES[id].description,
      })),
    };
  }
}
