import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { MemoryStore } from './memory-store';

@Injectable()
export class MemoryService {
  constructor(private readonly database: DatabaseService) {}

  private get store(): MemoryStore {
    return new MemoryStore(this.database.getDatabase());
  }

  listSessions(profile: string) {
    return this.store.listSessions(profile);
  }

  searchConversations(profile: string, query: string) {
    return this.store.searchConversations(profile, query);
  }

  getConversation(profile: string, sessionId: string) {
    return this.store.getConversation(profile, sessionId);
  }
}
