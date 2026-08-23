#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { createInterface } from 'node:readline';

const databasePath = process.env.DATABASE_PATH;
if (!databasePath) throw new Error('DATABASE_PATH is required');
const profile = process.env.BOB_MEMORY_PROFILE || process.env.BOB_ACTIVE_PROFILE_ID || 'sample';
const database = new DatabaseSync(databasePath, { readOnly: true });

const tools = [
  {
    name: 'list_conversations',
    description: 'List recent conversations for the active Bob profile.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_conversations',
    description: 'Search conversation messages for the active Bob profile.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_conversation',
    description: 'Read one conversation for the active Bob profile.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', minLength: 1 } },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
];

function toolResult(name, args) {
  if (name === 'list_conversations') {
    return database
      .prepare(
        `SELECT s.id, s.title, s.updated_at, COUNT(m.id) AS message_count
         FROM sessions s
         LEFT JOIN messages m ON m.session_id = s.id
         WHERE s.profile = ?
         GROUP BY s.id
         ORDER BY s.updated_at DESC
         LIMIT 50`,
      )
      .all(profile);
  }
  if (name === 'search_conversations') {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) throw new Error('query is required');
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    return database
      .prepare(
        `SELECT m.session_id, s.title, m.role, m.content, m.created_at
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE s.profile = ? AND m.content LIKE ? ESCAPE '\\'
         ORDER BY m.created_at DESC
         LIMIT 100`,
      )
      .all(profile, pattern);
  }
  if (name === 'get_conversation') {
    const sessionId = typeof args.sessionId === 'string' ? args.sessionId.trim() : '';
    if (!sessionId) throw new Error('sessionId is required');
    return database
      .prepare(
        `SELECT m.role, m.content, m.created_at
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE m.session_id = ? AND s.profile = ?
         ORDER BY m.created_at ASC`,
      )
      .all(sessionId, profile);
  }
  throw new Error(`Unknown tool: ${name}`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

createInterface({ input: process.stdin }).on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (!request || typeof request !== 'object' || request.id === undefined) return;
  try {
    let result;
    if (request.method === 'initialize') {
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'bob-conversation-memory', version: '1.0.0' },
      };
    } else if (request.method === 'ping') {
      result = {};
    } else if (request.method === 'tools/list') {
      result = { tools };
    } else if (request.method === 'tools/call') {
      const params = request.params && typeof request.params === 'object' ? request.params : {};
      const name = typeof params.name === 'string' ? params.name : '';
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      result = {
        content: [{ type: 'text', text: JSON.stringify(toolResult(name, args), null, 2) }],
      };
    } else {
      throw new Error(`Unsupported method: ${String(request.method)}`);
    }
    send({ jsonrpc: '2.0', id: request.id, result });
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32603, message: String(error) },
    });
  }
});
