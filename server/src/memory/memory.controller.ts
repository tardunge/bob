import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { MemoryService } from './memory.service';
import { DEFAULT_PROFILE, isValidProfile } from '../profiles';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  private profile(value?: string): string {
    const profile = value ?? DEFAULT_PROFILE;
    if (!isValidProfile(profile)) {
      throw new NotFoundException('Profile not found');
    }
    return profile;
  }

  @Get('sessions')
  listSessions(@Query('profile') profile?: string) {
    return this.memory.listSessions(this.profile(profile));
  }

  @Get('search')
  search(@Query('query') query?: string, @Query('profile') profile?: string) {
    return this.memory.searchConversations(
      this.profile(profile),
      query ?? '',
    );
  }

  @Get('sessions/:id')
  getConversation(
    @Param('id') id: string,
    @Query('profile') profile?: string,
  ) {
    const conversation = this.memory.getConversation(
      this.profile(profile),
      id,
    );
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }
}
