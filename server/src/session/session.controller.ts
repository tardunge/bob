import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { SessionService } from './session.service';
import { CreateSessionDto, UpdateSessionDto } from './session.dto';

@Controller('sessions')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post()
  createSession(@Body() dto: CreateSessionDto) {
    return this.sessionService.createSession(dto);
  }

  @Get()
  getAllSessions() {
    return this.sessionService.getAllSessions();
  }

  @Get(':id')
  getSession(@Param('id') id: string) {
    const session = this.sessionService.getSessionWithMessages(id);
    if (!session) {
      throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
    }
    return session;
  }

  @Get(':id/usage')
  getSessionUsage(@Param('id') id: string) {
    const session = this.sessionService.getSession(id);
    if (!session) {
      throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
    }
    return this.sessionService.getSessionUsage(id);
  }

  @Put(':id')
  updateSession(@Param('id') id: string, @Body() dto: UpdateSessionDto) {
    const session = this.sessionService.updateSession(id, dto);
    if (!session) {
      throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
    }
    return session;
  }

  @Delete(':id')
  deleteSession(@Param('id') id: string) {
    const deleted = this.sessionService.deleteSession(id);
    if (!deleted) {
      throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
    }
    return { success: true };
  }
}
