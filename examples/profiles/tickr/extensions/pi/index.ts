import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const execFileAsync = promisify(execFile);

export default function tickrProfileExtension(pi: ExtensionAPI) {
  pi.on('session_start', () => {
    const active = new Set(pi.getActiveTools());
    active.add('tickr_http');
    active.add('bob_memory');
    pi.setActiveTools([...active]);
  });

  pi.registerTool({
    name: 'tickr_http',
    label: 'Tickr API request',
    description: 'Make one HTTP request to a Tickr API without invoking a shell.',
    parameters: Type.Object({
      method: Type.Optional(
        Type.Union([
          Type.Literal('GET'),
          Type.Literal('POST'),
          Type.Literal('PUT'),
          Type.Literal('PATCH'),
          Type.Literal('DELETE'),
        ]),
      ),
      url: Type.String(),
      body: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params) {
      const target = new URL(params.url);
      if (!['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) {
        return {
          content: [{ type: 'text', text: 'Rejected: Tickr requests must target localhost.' }],
          details: {},
          isError: true,
        };
      }
      const args = [
        '--silent',
        '--show-error',
        '--max-time',
        '30',
        '--request',
        params.method ?? 'GET',
        '--write-out',
        '\n__BOB_STATUS__%{http_code}\n',
      ];
      if (params.body !== undefined) {
        args.push('--header', 'content-type: application/json', '--data-raw', params.body);
      }
      args.push('--url', target.toString());
      try {
        const result = await execFileAsync(
          process.env.BOB_CURL_BINARY ?? 'curl',
          args,
          { encoding: 'utf8', timeout: 35_000, maxBuffer: 2_000_000 },
        );
        const marker = '\n__BOB_STATUS__';
        const markerIndex = result.stdout.lastIndexOf(marker);
        const status = Number.parseInt(
          result.stdout.slice(markerIndex + marker.length).trim(),
          10,
        );
        return {
          content: [{ type: 'text', text: result.stdout.slice(0, markerIndex) }],
          details: { status, url: target.toString() },
          isError: status >= 400,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Tickr request failed: ${String(error)}` }],
          details: { url: target.toString() },
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: 'bob_memory',
    label: 'Bob memory',
    description: 'Search or retrieve conversations from Bob’s local store.',
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal('list'),
        Type.Literal('search'),
        Type.Literal('get'),
      ]),
      query: Type.Optional(Type.String()),
      sessionId: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params) {
      const base = process.env.BOB_MEMORY_URL ?? 'http://127.0.0.1:5556/api/memory';
      const profile = encodeURIComponent(
        process.env.BOB_ACTIVE_PROFILE_ID ?? 'tickr',
      );
      const url =
        params.action === 'list'
          ? `${base}/sessions?profile=${profile}`
          : params.action === 'search'
            ? `${base}/search?profile=${profile}&query=${encodeURIComponent(params.query ?? '')}`
            : `${base}/sessions/${encodeURIComponent(params.sessionId ?? '')}?profile=${profile}`;
      try {
        const response = await fetch(url);
        return {
          content: [{ type: 'text', text: await response.text() }],
          details: { status: response.status },
          isError: !response.ok,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Bob memory unavailable: ${String(error)}` }],
          details: {},
          isError: true,
        };
      }
    },
  });
}
