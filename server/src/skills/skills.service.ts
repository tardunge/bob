import { Injectable } from '@nestjs/common';
import { getProfileConfig, type SessionProfile } from '../profiles';
import { discoverSkills, type SkillInfo } from './skill-catalog';

@Injectable()
export class SkillsService {
  listSkills(profile: SessionProfile): Omit<SkillInfo, 'path'>[] {
    const skillsPath = getProfileConfig(profile).skillsPath;
    if (!skillsPath) return [];
    return discoverSkills([skillsPath]).map(({ name, description }) => ({
      name,
      description,
    }));
  }
}
