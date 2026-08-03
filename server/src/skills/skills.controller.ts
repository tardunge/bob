import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { SkillsService } from './skills.service';
import { DEFAULT_PROFILE, isValidProfile, PROFILE_KEYS } from '../profiles';

@Controller('skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Get()
  list(@Query('profile') profile?: string) {
    const p = profile ?? DEFAULT_PROFILE;
    if (!isValidProfile(p)) {
      throw new BadRequestException(
        `Unknown profile '${p}'. Valid: ${PROFILE_KEYS.join(', ')}`,
      );
    }
    return this.skillsService.listSkills(p);
  }
}
