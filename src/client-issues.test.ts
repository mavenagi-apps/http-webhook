/**
 * Client Issue Reproduction Tests
 *
 * Reproduces and validates fixes for three reported issues:
 * 1. "Sorry I do not have information" response instead of webhook confirmation
 * 2. Webhook triggers 2 calls instead of 1 for conversation events
 * 3. Body content not arriving at webhook.site (missing Content-Type header)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the MavenAGIClient
vi.mock('mavenagi', () => ({
  MavenAGIClient: vi.fn().mockImplementation(() => ({
    actions: {
      createOrUpdate: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    triggers: {
      createOrUpdate: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
  })),
}));

import app, { _resetDedupCache } from './index';

describe('Client Issue Reproductions', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let originalFetch: typeof global.fetch;

  const baseActionParams = {
    organizationId: 'org-123',
    agentId: 'agent-456',
    user: {
      userId: { referenceId: 'user-789' },
      userIdentifiers: [{ value: 'user@example.com', type: 'EMAIL' as const }],
      allUserData: {},
      defaultUserData: { firstName: 'Test', lastName: 'User' },
    },
    conversationId: {
      referenceId: 'conv-123',
      appId: 'app-123',
      organizationId: 'org-123',
      agentId: 'agent-456',
      type: 'conversation',
    },
    conversationMetadata: {},
  };

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    _resetDedupCache();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Issue 1: "Sorry I do not have information for that question"
  //
  // When the LLM triggers a webhook action, the raw HTTP response goes back
  // to the LLM. If the target (e.g. webhook.site) returns HTML or an empty
  // body, the LLM has no clear signal that the action succeeded and falls
  // back to "Sorry I don't have information."
  //
  // Fix: Wrap successful responses with an explicit success message so the
  // LLM knows to confirm the action to the user.
  // ---------------------------------------------------------------------------
  describe('Issue 1: Unhelpful LLM response after webhook execution', () => {
    const webhookSiteConfig: WebhookConfig = {
      name: 'test_webhook',
      description: 'Send a test event',
      triggerMode: 'llm_action',
      url: 'https://webhook.site/abc-123',
      method: 'POST',
      bodyTemplate: '{"event": "test"}',
    };

    it('returns a clear success message even when the target returns HTML', async () => {
      // webhook.site returns its confirmation page as HTML
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<html><body><h1>Request received</h1></body></html>'),
      });

      const result = await app.executeAction({
        ...baseActionParams,
        actionId: 'test_webhook',
        parameters: {},
        settings: { webhooks: [webhookSiteConfig] },
      });

      // The LLM should receive an unambiguous success signal
      expect(result).toMatch(/^Successfully executed webhook/);
      expect(result).toContain('test_webhook');
    });

    it('returns a clear success message when the target returns JSON', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{"status": "ok"}'),
      });

      const result = await app.executeAction({
        ...baseActionParams,
        actionId: 'test_webhook',
        parameters: {},
        settings: { webhooks: [webhookSiteConfig] },
      });

      expect(result).toMatch(/^Successfully executed webhook/);
      expect(result).toContain('"status": "ok"');
    });

    it('returns a clear success message when the target returns empty body', async () => {
      // Many webhook endpoints return 200 with empty body
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      });

      const result = await app.executeAction({
        ...baseActionParams,
        actionId: 'test_webhook',
        parameters: {},
        settings: { webhooks: [webhookSiteConfig] },
      });

      expect(result).toMatch(/^Successfully executed webhook/);
    });

    it('does NOT wrap error responses (pass-through for LLM error handling)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Server error'),
      });

      const result = await app.executeAction({
        ...baseActionParams,
        actionId: 'test_webhook',
        parameters: {},
        settings: { webhooks: [webhookSiteConfig] },
      });

      // Error messages should pass through directly
      expect(result).toMatch(/^Webhook failed:/);
      expect(result).not.toMatch(/^Successfully/);
    });

    it('does NOT wrap network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const result = await app.executeAction({
        ...baseActionParams,
        actionId: 'test_webhook',
        parameters: {},
        settings: { webhooks: [webhookSiteConfig] },
      });

      expect(result).toMatch(/^Webhook error:/);
      expect(result).not.toMatch(/^Successfully/);
    });
  });

  // ---------------------------------------------------------------------------
  // Issue 2: Webhook triggers 2 calls instead of 1
  //
  // Maven calls conversationCreatedOrUpdated for both create AND update events.
  // A single user message causes: create → trigger fires, AI responds →
  // update → trigger fires again. Result: 2 webhook calls per message.
  //
  // Fix: Deduplicate by conversation ID with a short time window. The first
  // event fires the webhook; subsequent events for the same conversation
  // within the window are skipped.
  // ---------------------------------------------------------------------------
  describe('Issue 2: Duplicate webhook calls on conversation events', () => {
    const conversationWebhookSettings = {
      webhooks: [{
        name: 'sync_conversation',
        description: 'Sync conversation to external system',
        url: 'https://webhook.site/abc-123',
        method: 'POST' as const,
        triggerMode: 'event_trigger' as const,
        eventType: 'conversation_created' as const,
        bodyTemplate: '{"id": "{{conversationId.referenceId}}"}',
      }],
    };

    const conversationId = {
      referenceId: 'conv-999',
      appId: 'app-1',
      organizationId: 'org-123',
      agentId: 'agent-456',
      type: 'conversation',
    };

    const baseEventParams = {
      organizationId: 'org-123',
      agentId: 'agent-456',
      settings: conversationWebhookSettings,
    };

    it('fires webhook only once when called twice rapidly with the same conversation', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK'),
      });

      // First call: conversation created
      await app.conversationCreatedOrUpdated({
        ...baseEventParams,
        conversations: [conversationId],
      });

      // Second call: conversation updated (AI responded) — should be deduped
      await app.conversationCreatedOrUpdated({
        ...baseEventParams,
        conversations: [conversationId],
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('logs a message when skipping duplicate events', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK'),
      });

      await app.conversationCreatedOrUpdated({
        ...baseEventParams,
        conversations: [conversationId],
      });

      await app.conversationCreatedOrUpdated({
        ...baseEventParams,
        conversations: [conversationId],
      });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Skipping duplicate event for conversation: conv-999')
      );
    });

    it('allows the same conversation through after the dedup window expires', async () => {
      vi.useFakeTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK'),
      });

      // First call goes through
      await app.conversationCreatedOrUpdated({
        ...baseEventParams,
        conversations: [conversationId],
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance past the 5-second dedup window
      vi.advanceTimersByTime(6000);

      // Second call should now go through
      await app.conversationCreatedOrUpdated({
        ...baseEventParams,
        conversations: [conversationId],
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('does NOT deduplicate different conversation IDs', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK'),
      });

      const convA = { ...conversationId, referenceId: 'conv-aaa' };
      const convB = { ...conversationId, referenceId: 'conv-bbb' };

      await app.conversationCreatedOrUpdated({
        ...baseEventParams,
        conversations: [convA],
      });

      await app.conversationCreatedOrUpdated({
        ...baseEventParams,
        conversations: [convB],
      });

      // Both should fire — they are different conversations
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('fires all configured webhooks for a single conversation event', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK'),
      });

      const multiWebhookSettings = {
        webhooks: [
          {
            name: 'webhook_a',
            description: 'First webhook',
            url: 'https://a.example.com/hook',
            method: 'POST' as const,
            triggerMode: 'event_trigger' as const,
            eventType: 'conversation_created' as const,
            bodyTemplate: '{"source": "a"}',
          },
          {
            name: 'webhook_b',
            description: 'Second webhook',
            url: 'https://b.example.com/hook',
            method: 'POST' as const,
            triggerMode: 'event_trigger' as const,
            eventType: 'conversation_created' as const,
            bodyTemplate: '{"source": "b"}',
          },
        ],
      };

      await app.conversationCreatedOrUpdated({
        organizationId: 'org-123',
        agentId: 'agent-456',
        settings: multiWebhookSettings,
        conversations: [conversationId],
      });

      // Both webhooks fire for the same event
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith('https://a.example.com/hook', expect.anything());
      expect(mockFetch).toHaveBeenCalledWith('https://b.example.com/hook', expect.anything());
    });
  });

  // ---------------------------------------------------------------------------
  // Issue 3: Body content not arriving at webhook.site
  //
  // When a webhook is configured with a body template but no Content-Type
  // header, the body is sent without a content type. Webhook.site (and many
  // other HTTP inspection tools) won't display the body because they don't
  // know how to interpret it.
  //
  // Fix: Auto-add Content-Type: application/json when a body is present and
  // no Content-Type header is configured.
  // ---------------------------------------------------------------------------
  describe('Issue 3: Missing body content at webhook.site', () => {
    it('auto-adds Content-Type: application/json when body is present and no Content-Type is set', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK'),
      });

      await app.executeAction({
        ...baseActionParams,
        actionId: 'no_content_type',
        parameters: {},
        settings: {
          webhooks: [{
            name: 'no_content_type',
            description: 'Webhook without Content-Type',
            triggerMode: 'llm_action',
            url: 'https://webhook.site/abc-123',
            method: 'POST',
            // Body template present, but NO headers configured
            bodyTemplate: '{"event": "test", "email": "{{user.email}}"}',
          }],
        },
      });

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers).toHaveProperty('Content-Type', 'application/json');
    });

    it('does NOT override an existing Content-Type header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK'),
      });

      await app.executeAction({
        ...baseActionParams,
        actionId: 'custom_content_type',
        parameters: {},
        settings: {
          webhooks: [{
            name: 'custom_content_type',
            description: 'Webhook with custom Content-Type',
            triggerMode: 'llm_action',
            url: 'https://webhook.site/abc-123',
            method: 'POST',
            headers: { 'Content-Type': 'text/xml' },
            bodyTemplate: '<event>test</event>',
          }],
        },
      });

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers).toHaveProperty('Content-Type', 'text/xml');
    });

    it('does NOT override Content-Type regardless of casing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK'),
      });

      await app.executeAction({
        ...baseActionParams,
        actionId: 'lowercase_content_type',
        parameters: {},
        settings: {
          webhooks: [{
            name: 'lowercase_content_type',
            description: 'Webhook with lowercase content-type',
            triggerMode: 'llm_action',
            url: 'https://webhook.site/abc-123',
            method: 'POST',
            headers: { 'content-type': 'application/xml' },
            bodyTemplate: '<event>test</event>',
          }],
        },
      });

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers).toHaveProperty('content-type', 'application/xml');
      // Should NOT have a duplicate Content-Type key
      expect(callArgs.headers).not.toHaveProperty('Content-Type');
    });

    it('does NOT add Content-Type for GET requests (no body)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK'),
      });

      await app.executeAction({
        ...baseActionParams,
        actionId: 'get_request',
        parameters: {},
        settings: {
          webhooks: [{
            name: 'get_request',
            description: 'GET request',
            triggerMode: 'llm_action',
            url: 'https://webhook.site/abc-123',
            method: 'GET',
          }],
        },
      });

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers).not.toHaveProperty('Content-Type');
    });

    it('sends interpolated body content correctly to webhook.site', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK'),
      });

      await app.executeAction({
        ...baseActionParams,
        actionId: 'body_test',
        parameters: { event_name: 'signup' },
        settings: {
          webhooks: [{
            name: 'body_test',
            description: 'Test body interpolation',
            triggerMode: 'llm_action',
            url: 'https://webhook.site/abc-123',
            method: 'POST',
            bodyTemplate: '{"event": "{{parameters.event_name}}", "email": "{{user.email}}"}',
          }],
        },
      });

      const callArgs = mockFetch.mock.calls[0][1];

      // Body is sent
      expect(callArgs.body).toBeDefined();
      expect(callArgs.body).not.toBeNull();

      // Body contains interpolated values
      const body = JSON.parse(callArgs.body);
      expect(body.event).toBe('signup');
      expect(body.email).toBe('user@example.com');

      // Content-Type is set so webhook.site can display it
      expect(callArgs.headers['Content-Type']).toBe('application/json');
    });

    it('auto-adds Content-Type for event trigger webhooks too', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('OK'),
      });

      await app.conversationCreatedOrUpdated({
        organizationId: 'org-123',
        agentId: 'agent-456',
        settings: {
          webhooks: [{
            name: 'event_no_headers',
            description: 'Event trigger without headers',
            url: 'https://webhook.site/abc-123',
            method: 'POST',
            triggerMode: 'event_trigger',
            eventType: 'conversation_created',
            // Body template set, but no headers at all
            bodyTemplate: '{"conversation": "{{conversationId.referenceId}}"}',
          }],
        },
        conversations: [{
          referenceId: 'conv-ct-test',
          appId: 'app-1',
          organizationId: 'org-123',
          agentId: 'agent-456',
          type: 'conversation',
        }],
      });

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers).toHaveProperty('Content-Type', 'application/json');
      expect(callArgs.body).toContain('conv-ct-test');
    });
  });
});
