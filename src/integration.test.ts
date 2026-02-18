/**
 * Integration Tests — Real HTTP, No Mocks
 *
 * Spins up a local HTTP server that captures incoming requests,
 * then calls the app's handlers with webhook URLs pointing to localhost.
 * This proves what actually arrives over the wire.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, IncomingMessage, ServerResponse } from 'http';

// Only mock the Maven SDK (needed for import, but not used by the handlers we test)
vi.mock('mavenagi', () => ({
  MavenAGIClient: vi.fn().mockImplementation(() => ({
    actions: { createOrUpdate: vi.fn(), delete: vi.fn() },
    triggers: { createOrUpdate: vi.fn(), delete: vi.fn() },
  })),
}));

import app, { _resetDedupCache } from './index';

// ---------------------------------------------------------------------------
// Local webhook receiver — captures every incoming HTTP request
// ---------------------------------------------------------------------------
interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  receivedAt: number;
}

let server: ReturnType<typeof createServer>;
let serverPort: number;
let capturedRequests: CapturedRequest[];

function baseUrl(): string {
  return `http://localhost:${serverPort}`;
}

beforeAll(async () => {
  capturedRequests = [];

  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      capturedRequests.push({
        method: req.method || 'UNKNOWN',
        url: req.url || '/',
        headers: req.headers,
        body,
        receivedAt: Date.now(),
      });
      // Respond like webhook.site would
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    });
  });

  // Bind to random available port
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        serverPort = addr.port;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

beforeEach(() => {
  capturedRequests = [];
  _resetDedupCache();
});

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------
const baseActionParams = {
  organizationId: 'org-integration',
  agentId: 'agent-integration',
  user: {
    userId: { referenceId: 'user-1' },
    userIdentifiers: [{ value: 'test@example.com', type: 'EMAIL' as const }],
    allUserData: {},
    defaultUserData: { firstName: 'Integration', lastName: 'Test' },
  },
  conversationId: {
    referenceId: 'conv-int-1',
    appId: 'app-1',
    organizationId: 'org-integration',
    agentId: 'agent-integration',
    type: 'conversation',
  },
  conversationMetadata: {},
};

// ---------------------------------------------------------------------------
// Issue 3: Does the body and Content-Type actually arrive over the wire?
// ---------------------------------------------------------------------------
describe('Issue 3 Integration: Body content arriving at webhook receiver', () => {
  it('sends body WITH Content-Type header when bodyTemplate is set and no headers configured', async () => {
    await app.executeAction({
      ...baseActionParams,
      actionId: 'body_test',
      parameters: { event: 'signup' },
      settings: {
        webhooks: [{
          name: 'body_test',
          description: 'Test body delivery',
          triggerMode: 'llm_action',
          url: `${baseUrl()}/webhook`,
          method: 'POST',
          // No headers configured — Content-Type should be auto-added
          bodyTemplate: '{"event": "{{parameters.event}}", "email": "{{user.email}}"}',
        }],
      },
    });

    expect(capturedRequests).toHaveLength(1);

    const req = capturedRequests[0];

    // Content-Type was auto-added and arrived at the server
    expect(req.headers['content-type']).toBe('application/json');

    // Body arrived and is valid JSON with interpolated values
    expect(req.body).toBeTruthy();
    const body = JSON.parse(req.body);
    expect(body.event).toBe('signup');
    expect(body.email).toBe('test@example.com');
  });

  it('sends body with explicit Content-Type when headers are configured', async () => {
    await app.executeAction({
      ...baseActionParams,
      actionId: 'explicit_ct',
      parameters: {},
      settings: {
        webhooks: [{
          name: 'explicit_ct',
          description: 'Test with explicit headers',
          triggerMode: 'llm_action',
          url: `${baseUrl()}/webhook`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Custom': 'test-value' },
          bodyTemplate: '{"hello": "world"}',
        }],
      },
    });

    expect(capturedRequests).toHaveLength(1);

    const req = capturedRequests[0];
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers['x-custom']).toBe('test-value');

    const body = JSON.parse(req.body);
    expect(body.hello).toBe('world');
  });

  it('sends NO body for GET requests', async () => {
    await app.executeAction({
      ...baseActionParams,
      actionId: 'get_test',
      parameters: {},
      settings: {
        webhooks: [{
          name: 'get_test',
          description: 'GET request',
          triggerMode: 'llm_action',
          url: `${baseUrl()}/webhook`,
          method: 'GET',
        }],
      },
    });

    expect(capturedRequests).toHaveLength(1);

    const req = capturedRequests[0];
    expect(req.method).toBe('GET');
    expect(req.body).toBe('');
    // No Content-Type auto-added for bodyless requests
    expect(req.headers['content-type']).toBeUndefined();
  });

  it('sends body with Content-Type for event trigger webhooks', async () => {
    await app.conversationCreatedOrUpdated({
      organizationId: 'org-integration',
      agentId: 'agent-integration',
      settings: {
        webhooks: [{
          name: 'event_body_test',
          description: 'Event trigger body test',
          url: `${baseUrl()}/event-webhook`,
          method: 'POST',
          triggerMode: 'event_trigger',
          eventType: 'conversation_created',
          bodyTemplate: '{"conversation": "{{conversationId.referenceId}}"}',
        }],
      },
      conversations: [{
        referenceId: 'conv-body-test',
        appId: 'app-1',
        organizationId: 'org-integration',
        agentId: 'agent-integration',
        type: 'conversation',
      }],
    });

    expect(capturedRequests).toHaveLength(1);

    const req = capturedRequests[0];
    expect(req.headers['content-type']).toBe('application/json');
    const body = JSON.parse(req.body);
    expect(body.conversation).toBe('conv-body-test');
  });
});

// ---------------------------------------------------------------------------
// Issue 2: Does deduplication actually prevent the second HTTP request?
// ---------------------------------------------------------------------------
describe('Issue 2 Integration: Deduplication over real HTTP', () => {
  const makeConversationSettings = (port: number) => ({
    webhooks: [{
      name: 'dedup_test',
      description: 'Dedup test',
      url: `http://localhost:${port}/dedup`,
      method: 'POST' as const,
      triggerMode: 'event_trigger' as const,
      eventType: 'conversation_created' as const,
      bodyTemplate: '{"id": "{{conversationId.referenceId}}"}',
    }],
  });

  it('only ONE HTTP request arrives when handler is called twice rapidly', async () => {
    const settings = makeConversationSettings(serverPort);
    const conversation = {
      referenceId: 'conv-dedup-real',
      appId: 'app-1',
      organizationId: 'org-integration',
      agentId: 'agent-integration',
      type: 'conversation',
    };

    // Simulate Maven calling the handler twice (create + update)
    await app.conversationCreatedOrUpdated({
      organizationId: 'org-integration',
      agentId: 'agent-integration',
      settings,
      conversations: [conversation],
    });

    await app.conversationCreatedOrUpdated({
      organizationId: 'org-integration',
      agentId: 'agent-integration',
      settings,
      conversations: [conversation],
    });

    // Only 1 request hit our server, not 2
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].url).toBe('/dedup');

    const body = JSON.parse(capturedRequests[0].body);
    expect(body.id).toBe('conv-dedup-real');
  });

  it('different conversations each produce their own request', async () => {
    const settings = makeConversationSettings(serverPort);

    const convA = {
      referenceId: 'conv-a',
      appId: 'app-1',
      organizationId: 'org-integration',
      agentId: 'agent-integration',
      type: 'conversation',
    };
    const convB = {
      referenceId: 'conv-b',
      appId: 'app-1',
      organizationId: 'org-integration',
      agentId: 'agent-integration',
      type: 'conversation',
    };

    await app.conversationCreatedOrUpdated({
      organizationId: 'org-integration',
      agentId: 'agent-integration',
      settings,
      conversations: [convA],
    });

    await app.conversationCreatedOrUpdated({
      organizationId: 'org-integration',
      agentId: 'agent-integration',
      settings,
      conversations: [convB],
    });

    expect(capturedRequests).toHaveLength(2);

    const bodies = capturedRequests.map(r => JSON.parse(r.body));
    expect(bodies[0].id).toBe('conv-a');
    expect(bodies[1].id).toBe('conv-b');
  });
});

// ---------------------------------------------------------------------------
// Issue 1: Does executeAction return a useful string over real HTTP?
// ---------------------------------------------------------------------------
describe('Issue 1 Integration: executeAction response over real HTTP', () => {
  it('returns "Successfully executed" with server response included', async () => {
    const result = await app.executeAction({
      ...baseActionParams,
      actionId: 'success_test',
      parameters: {},
      settings: {
        webhooks: [{
          name: 'success_test',
          description: 'Test success response',
          triggerMode: 'llm_action',
          url: `${baseUrl()}/webhook`,
          method: 'POST',
          bodyTemplate: '{"test": true}',
        }],
      },
    });

    // The return string clearly signals success to the LLM
    expect(result).toMatch(/^Successfully executed webhook "success_test"/);
    // The server's response ("OK") is included
    expect(result).toContain('OK');
  });

  it('returns error message when server returns 4xx/5xx', async () => {
    // Temporarily swap server to return errors
    const errorServer = createServer((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    });

    const errorPort = await new Promise<number>((resolve) => {
      errorServer.listen(0, '127.0.0.1', () => {
        const addr = errorServer.address();
        resolve(addr && typeof addr === 'object' ? addr.port : 0);
      });
    });

    try {
      const result = await app.executeAction({
        ...baseActionParams,
        actionId: 'error_test',
        parameters: {},
        settings: {
          webhooks: [{
            name: 'error_test',
            description: 'Test error response',
            triggerMode: 'llm_action',
            url: `http://localhost:${errorPort}/webhook`,
            method: 'POST',
            bodyTemplate: '{"test": true}',
          }],
        },
      });

      // Error messages pass through without "Successfully" prefix
      expect(result).toMatch(/^Webhook failed:/);
      expect(result).toContain('500');
    } finally {
      await new Promise<void>((resolve) => errorServer.close(() => resolve()));
    }
  });

  it('returns error message when server is unreachable', async () => {
    const result = await app.executeAction({
      ...baseActionParams,
      actionId: 'unreachable_test',
      parameters: {},
      settings: {
        webhooks: [{
          name: 'unreachable_test',
          description: 'Test unreachable server',
          triggerMode: 'llm_action',
          url: 'http://localhost:1/webhook', // port 1 — nothing listening
          method: 'POST',
          bodyTemplate: '{"test": true}',
        }],
      },
    });

    expect(result).toMatch(/^Webhook error:/);
  });
});

// ---------------------------------------------------------------------------
// Bonus: Full realistic scenario — Tealium-like webhook to local receiver
// ---------------------------------------------------------------------------
describe('Realistic scenario: webhook.site-like receiver', () => {
  it('captures a complete Tealium-style event with all fields', async () => {
    await app.executeAction({
      ...baseActionParams,
      actionId: 'tealium_event',
      parameters: {
        event_name: 'page_view',
        visitor_id: 'visitor-abc123',
      },
      settings: {
        webhooks: [{
          name: 'tealium_event',
          description: 'Send event to Tealium',
          triggerMode: 'llm_action',
          url: `${baseUrl()}/collect/event`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          bodyTemplate: JSON.stringify({
            tealium_account: 'acme_corp',
            tealium_event: '{{parameters.event_name}}',
            tealium_visitor_id: '{{parameters.visitor_id}}',
            user_email: '{{user.email}}',
          }),
        }],
      },
    });

    expect(capturedRequests).toHaveLength(1);

    const req = capturedRequests[0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/collect/event');
    expect(req.headers['content-type']).toBe('application/json');

    const body = JSON.parse(req.body);
    expect(body).toEqual({
      tealium_account: 'acme_corp',
      tealium_event: 'page_view',
      tealium_visitor_id: 'visitor-abc123',
      user_email: 'test@example.com',
    });
  });
});
