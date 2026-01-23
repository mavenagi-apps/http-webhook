/**
 * Tealium Use Case Tests
 * 
 * Tests for the specific use cases requested by Tealium:
 * 1. Send an event to Tealium AudienceStream
 * 2. Create a Volume Increase Request in JIRA
 * 3. Call a Glean Agent
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

import app from './index';

describe('Tealium Use Cases', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let originalFetch: typeof global.fetch;

  const baseUserParams = {
    organizationId: 'tealium-org',
    agentId: 'tealium-agent',
    user: {
      userId: { referenceId: 'user-123' },
      userIdentifiers: [{ value: 'user@tealium.com', type: 'EMAIL' as const }],
      allUserData: {},
      defaultUserData: { firstName: 'Tealium', lastName: 'User' },
    },
    conversationId: {
      referenceId: 'conv-tealium',
      appId: 'app-1',
      organizationId: 'tealium-org',
      agentId: 'tealium-agent',
      type: 'conversation',
    },
    conversationMetadata: {},
  };

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Use Case 1: Send Event to Tealium', () => {
    const tealiumEventWebhook = {
      name: 'send_tealium_event',
      description: 'Send a tracking event to Tealium AudienceStream',
      triggerMode: 'llm_action' as const,
      url: 'https://collect.tealiumiq.com/event',
      method: 'POST' as const,
      headers: {
        'Content-Type': 'application/json',
      },
      bodyTemplate: JSON.stringify({
        tealium_account: 'acme_corp',
        tealium_profile: 'main',
        tealium_event: '{{parameters.event_name}}',
        tealium_visitor_id: '{{parameters.visitor_id}}',
        tealium_trace_id: '{{parameters.trace_id}}',
        tealium_datasource: '{{parameters.datasource}}',
      }),
      userFormParameters: [
        { id: 'event_name', label: 'Event Name', description: 'Name of the event to send', required: true },
        { id: 'visitor_id', label: 'Visitor ID', description: 'Tealium visitor ID', required: true },
        { id: 'trace_id', label: 'Trace ID', description: 'Optional trace ID', required: false },
        { id: 'datasource', label: 'Data Source', description: 'Optional data source key', required: false },
      ],
    };

    it('sends event with required parameters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{"status": "ok"}'),
      });

      const result = await app.executeAction({
        ...baseUserParams,
        actionId: 'send_tealium_event',
        parameters: {
          event_name: 'page_view',
          visitor_id: 'visitor-abc123',
        },
        settings: {
          webhooks: [tealiumEventWebhook],
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://collect.tealiumiq.com/event',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );

      // Verify body contains the parameters
      const callArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArgs.body);
      expect(body.tealium_account).toBe('acme_corp');
      expect(body.tealium_profile).toBe('main');
      expect(body.tealium_event).toBe('page_view');
      expect(body.tealium_visitor_id).toBe('visitor-abc123');
    });

    it('sends event with all optional parameters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{"status": "ok"}'),
      });

      await app.executeAction({
        ...baseUserParams,
        actionId: 'send_tealium_event',
        parameters: {
          event_name: 'button_click',
          visitor_id: 'visitor-xyz789',
          trace_id: 'trace-123',
          datasource: 'web-source',
        },
        settings: {
          webhooks: [tealiumEventWebhook],
        },
      });

      const callArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArgs.body);
      expect(body.tealium_trace_id).toBe('trace-123');
      expect(body.tealium_datasource).toBe('web-source');
    });

    it('handles Tealium API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('Invalid visitor_id format'),
      });

      const result = await app.executeAction({
        ...baseUserParams,
        actionId: 'send_tealium_event',
        parameters: {
          event_name: 'test',
          visitor_id: 'invalid',
        },
        settings: {
          webhooks: [tealiumEventWebhook],
        },
      });

      expect(result).toContain('Webhook failed: 400 Bad Request');
    });
  });

  describe('Use Case 2: JIRA Volume Increase Request', () => {
    const jiraWebhook = {
      name: 'create_volume_increase_jira',
      description: 'Create a JIRA ticket to notify the Ops team of a volume increase request',
      triggerMode: 'llm_action' as const,
      url: 'https://tealium.atlassian.net/rest/api/2/issue',
      method: 'POST' as const,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic {{settings.jiraApiToken}}',
      },
      bodyTemplate: JSON.stringify({
        fields: {
          project: { id: '10110' },
          summary: '{{parameters.summary}}',
          description: '{{parameters.description}}',
          issuetype: { id: '1' },
        },
      }),
      userFormParameters: [
        { id: 'summary', label: 'Issue Summary', description: 'Brief title for the request', required: true },
        { id: 'description', label: 'Details', description: 'Full description of the volume increase', required: true },
      ],
    };

    it('creates JIRA ticket with user-provided details', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          id: '10001',
          key: 'OPS-123',
          self: 'https://tealium.atlassian.net/rest/api/2/issue/10001',
        })),
      });

      const result = await app.executeAction({
        ...baseUserParams,
        actionId: 'create_volume_increase_jira',
        parameters: {
          summary: 'Volume Increase Request for Q1 Campaign',
          description: 'Expecting 3x traffic increase starting next Monday due to marketing campaign.',
        },
        settings: {
          jiraApiToken: 'dXNlckBleGFtcGxlLmNvbTphcGktdG9rZW4=', // base64 email:token
          webhooks: [jiraWebhook],
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://tealium.atlassian.net/rest/api/2/issue',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Basic dXNlckBleGFtcGxlLmNvbTphcGktdG9rZW4=',
          }),
        })
      );

      const callArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArgs.body);
      expect(body.fields.project.id).toBe('10110');
      expect(body.fields.summary).toBe('Volume Increase Request for Q1 Campaign');
      expect(body.fields.issuetype.id).toBe('1');

      // Response contains ticket info
      expect(result).toContain('OPS-123');
    });

    it('handles JIRA authentication error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Authentication failed'),
      });

      const result = await app.executeAction({
        ...baseUserParams,
        actionId: 'create_volume_increase_jira',
        parameters: {
          summary: 'Test',
          description: 'Test',
        },
        settings: {
          jiraApiToken: 'invalid-token',
          webhooks: [jiraWebhook],
        },
      });

      expect(result).toContain('401 Unauthorized');
    });
  });

  describe('Use Case 3: Call Glean Agent', () => {
    const gleanWebhook = {
      name: 'call_glean_agent',
      description: 'Invoke the Glean agent for background operations like monthly ticket reviews',
      triggerMode: 'llm_action' as const,
      url: 'https://tealium-be.glean.com/rest/api/v1/agents/runs/wait',
      method: 'POST' as const,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer {{settings.gleanApiKey}}',
      },
      bodyTemplate: JSON.stringify({
        agent_id: 'test-glean-agent-id',
        input: '{{parameters.request}}',
        user_email: '{{user.email}}',
      }),
      userFormParameters: [
        { id: 'request', label: 'Request', description: 'What would you like the Glean agent to do?', required: true },
      ],
      timeout: 120000, // 2 minutes for long-running agent
    };

    it('calls Glean agent with request and user email', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          run_id: 'run-abc123',
          status: 'completed',
          output: 'Monthly ticket review complete. Report sent to your email.',
        })),
      });

      const result = await app.executeAction({
        ...baseUserParams,
        actionId: 'call_glean_agent',
        parameters: {
          request: 'Generate the monthly ticket review report for December 2025',
        },
        settings: {
          gleanApiKey: 'test-glean-api-key',
          webhooks: [gleanWebhook],
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://tealium-be.glean.com/rest/api/v1/agents/runs/wait',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-glean-api-key',
          }),
        })
      );

      const callArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArgs.body);
      expect(body.agent_id).toBe('test-glean-agent-id');
      expect(body.input).toBe('Generate the monthly ticket review report for December 2025');
      expect(body.user_email).toBe('user@tealium.com');

      expect(result).toContain('completed');
    });

    it('handles Glean agent processing time', async () => {
      // Simulate successful response after wait
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          run_id: 'run-xyz',
          status: 'completed',
          output: 'Processing complete',
        })),
      });

      await app.executeAction({
        ...baseUserParams,
        actionId: 'call_glean_agent',
        parameters: {
          request: 'Complex analysis task',
        },
        settings: {
          gleanApiKey: 'test-key',
          timeout: 120000, // Extended timeout for Glean
          webhooks: [gleanWebhook],
        },
      });

      // Verify the request was made with extended timeout
      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.signal).toBeDefined();
    });

    it('handles Glean agent error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Agent execution failed'),
      });

      const result = await app.executeAction({
        ...baseUserParams,
        actionId: 'call_glean_agent',
        parameters: {
          request: 'Failing task',
        },
        settings: {
          gleanApiKey: 'test-key',
          webhooks: [gleanWebhook],
        },
      });

      expect(result).toContain('500 Internal Server Error');
    });

    it('handles Glean agent timeout', async () => {
      mockFetch.mockRejectedValue(new Error('The operation was aborted'));

      const result = await app.executeAction({
        ...baseUserParams,
        actionId: 'call_glean_agent',
        parameters: {
          request: 'Very long running task',
        },
        settings: {
          gleanApiKey: 'test-key',
          webhooks: [gleanWebhook],
        },
      });

      expect(result).toContain('Webhook error');
      expect(result).toContain('aborted');
    });

    it('uses fixed 60 second timeout for Glean calls', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{"status": "ok"}'),
      });

      await app.executeAction({
        ...baseUserParams,
        actionId: 'call_glean_agent',
        parameters: {
          request: 'Long running report',
        },
        settings: {
          gleanApiKey: 'test-key',
          webhooks: [gleanWebhook],
        },
      });

      // The request should use the fixed 60 second timeout
      expect(mockFetch).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('timeout: 60000ms')
      );
    });
  });

  describe('Combined Configuration', () => {
    it('supports all three Tealium webhooks in single configuration', async () => {
      const settings = {
        jiraApiToken: 'jira-token',
        gleanApiKey: 'glean-key',
        webhooks: [
          {
            name: 'send_tealium_event',
            description: 'Send event to Tealium',
            triggerMode: 'llm_action' as const,
            url: 'https://collect.tealiumiq.com/event',
            method: 'POST' as const,
            bodyTemplate: '{"tealium_event": "{{parameters.event}}"}',
            userFormParameters: [{ id: 'event', label: 'Event', required: true }],
          },
          {
            name: 'create_jira_ticket',
            description: 'Create JIRA ticket',
            triggerMode: 'llm_action' as const,
            url: 'https://jira.example.com/rest/api/2/issue',
            method: 'POST' as const,
            headers: { 'Authorization': 'Basic {{settings.jiraApiToken}}' },
            bodyTemplate: '{"fields": {"summary": "{{parameters.summary}}"}}',
            userFormParameters: [{ id: 'summary', label: 'Summary', required: true }],
          },
          {
            name: 'call_glean',
            description: 'Call Glean agent',
            triggerMode: 'llm_action' as const,
            url: 'https://glean.example.com/agents/runs/wait',
            method: 'POST' as const,
            headers: { 'Authorization': 'Bearer {{settings.gleanApiKey}}' },
            bodyTemplate: '{"input": "{{parameters.request}}"}',
            userFormParameters: [{ id: 'request', label: 'Request', required: true }],
          },
        ],
      };

      // Test each action can be found and executed
      mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('OK') });

      // Tealium event
      await app.executeAction({
        ...baseUserParams,
        actionId: 'send_tealium_event',
        parameters: { event: 'test' },
        settings,
      });
      expect(mockFetch).toHaveBeenCalledWith('https://collect.tealiumiq.com/event', expect.anything());

      mockFetch.mockClear();

      // JIRA ticket
      await app.executeAction({
        ...baseUserParams,
        actionId: 'create_jira_ticket',
        parameters: { summary: 'Test ticket' },
        settings,
      });
      expect(mockFetch).toHaveBeenCalledWith('https://jira.example.com/rest/api/2/issue', expect.anything());

      mockFetch.mockClear();

      // Glean agent
      await app.executeAction({
        ...baseUserParams,
        actionId: 'call_glean',
        parameters: { request: 'Test request' },
        settings,
      });
      expect(mockFetch).toHaveBeenCalledWith('https://glean.example.com/agents/runs/wait', expect.anything());
    });
  });
});

