import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to properly hoist mocks
const mocks = vi.hoisted(() => {
  const mockActionsCreateOrUpdate = vi.fn().mockResolvedValue({});
  const mockActionsDelete = vi.fn().mockResolvedValue({});
  const mockTriggersCreateOrUpdate = vi.fn().mockResolvedValue({});
  const mockTriggersDelete = vi.fn().mockResolvedValue({});
  
  return {
    mockActionsCreateOrUpdate,
    mockActionsDelete,
    mockTriggersCreateOrUpdate,
    mockTriggersDelete,
    MavenAGIClient: vi.fn(() => ({
      actions: {
        createOrUpdate: mockActionsCreateOrUpdate,
        delete: mockActionsDelete,
      },
      triggers: {
        createOrUpdate: mockTriggersCreateOrUpdate,
        delete: mockTriggersDelete,
      },
    })),
  };
});

// Mock the MavenAGIClient before importing the module
vi.mock('mavenagi', () => ({
  MavenAGIClient: mocks.MavenAGIClient,
}));

// Import after mocking
import app from './index';

const { mockActionsCreateOrUpdate, mockActionsDelete, mockTriggersCreateOrUpdate, mockTriggersDelete } = mocks;

describe('HTTP Webhook App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActionsCreateOrUpdate.mockResolvedValue({});
    mockActionsDelete.mockResolvedValue({});
    mockTriggersCreateOrUpdate.mockResolvedValue({});
    mockTriggersDelete.mockResolvedValue({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('preInstall', () => {
    const baseParams = {
      organizationId: 'org-123',
      agentId: 'agent-456',
    };

    it('validates webhooks array exists', async () => {
      await expect(app.preInstall({
        ...baseParams,
        settings: {} as any,
      })).rejects.toThrow("Settings must include a 'webhooks' array");
    });

    it('validates webhooks is an array', async () => {
      await expect(app.preInstall({
        ...baseParams,
        settings: { webhooks: 'not-array' } as any,
      })).rejects.toThrow("Settings must include a 'webhooks' array");
    });

    it('validates at least one webhook', async () => {
      await expect(app.preInstall({
        ...baseParams,
        settings: { webhooks: [] },
      })).rejects.toThrow("At least one webhook configuration is required");
    });

    it('validates webhook name', async () => {
      await expect(app.preInstall({
        ...baseParams,
        settings: { webhooks: [{ url: 'http://test.com', method: 'POST', triggerMode: 'llm_action' }] } as any,
      })).rejects.toThrow("Each webhook must have a 'name'");
    });

    it('validates webhook url', async () => {
      await expect(app.preInstall({
        ...baseParams,
        settings: { webhooks: [{ name: 'test', method: 'POST', triggerMode: 'llm_action' }] } as any,
      })).rejects.toThrow("Webhook 'test' must have a 'url'");
    });

    it('validates webhook method', async () => {
      await expect(app.preInstall({
        ...baseParams,
        settings: { webhooks: [{ name: 'test', url: 'http://test.com', triggerMode: 'llm_action' }] } as any,
      })).rejects.toThrow("Webhook 'test' must have a 'method'");
    });

    it('validates webhook triggerMode', async () => {
      await expect(app.preInstall({
        ...baseParams,
        settings: { webhooks: [{ name: 'test', url: 'http://test.com', method: 'POST' }] } as any,
      })).rejects.toThrow("Webhook 'test' must have a 'triggerMode'");
    });

    it('validates eventType for event_trigger', async () => {
      await expect(app.preInstall({
        ...baseParams,
        settings: { webhooks: [{ name: 'test', url: 'http://test.com', method: 'POST', triggerMode: 'event_trigger' }] } as any,
      })).rejects.toThrow("Webhook 'test' with triggerMode 'event_trigger' must have an 'eventType'");
    });

    it('passes validation for valid LLM action', async () => {
      await expect(app.preInstall({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'test_action',
            url: 'http://test.com/api',
            method: 'POST',
            triggerMode: 'llm_action',
            description: 'A test action',
          }],
        },
      })).resolves.toBeUndefined();
    });

    it('passes validation for valid event trigger', async () => {
      await expect(app.preInstall({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'test_trigger',
            url: 'http://test.com/api',
            method: 'POST',
            triggerMode: 'event_trigger',
            eventType: 'conversation_created',
          }],
        },
      })).resolves.toBeUndefined();
    });
  });

  describe('postInstall', () => {
    const baseParams = {
      organizationId: 'org-123',
      agentId: 'agent-456',
    };

    it('registers LLM action webhook', async () => {
      await app.postInstall({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'send_event',
            description: 'Send an event to the system',
            url: 'http://api.example.com/event',
            method: 'POST',
            triggerMode: 'llm_action',
          }],
        },
      });

      expect(mockActionsCreateOrUpdate).toHaveBeenCalledWith({
        actionId: { referenceId: 'send_event' },
        name: 'send_event',
        description: 'Send an event to the system',
        userInteractionRequired: false,
        userFormParameters: [],
      });
    });

    it('registers LLM action with form parameters', async () => {
      await app.postInstall({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'create_ticket',
            description: 'Create a support ticket',
            url: 'http://api.example.com/tickets',
            method: 'POST',
            triggerMode: 'llm_action',
            userFormParameters: [
              { id: 'summary', label: 'Summary', description: 'Ticket summary', required: true },
              { id: 'priority', label: 'Priority', description: 'Ticket priority', required: false },
            ],
          }],
        },
      });

      expect(mockActionsCreateOrUpdate).toHaveBeenCalledWith({
        actionId: { referenceId: 'create_ticket' },
        name: 'create_ticket',
        description: 'Create a support ticket',
        userInteractionRequired: true,
        userFormParameters: [
          { id: 'summary', label: 'Summary', description: 'Ticket summary', required: true },
          { id: 'priority', label: 'Priority', description: 'Ticket priority', required: false },
        ],
      });
    });

    it('registers event trigger for conversation_created', async () => {
      await app.postInstall({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'sync_conversation',
            description: 'Sync conversation to external system',
            url: 'http://api.example.com/sync',
            method: 'POST',
            triggerMode: 'event_trigger',
            eventType: 'conversation_created',
          }],
        },
      });

      expect(mockTriggersCreateOrUpdate).toHaveBeenCalledWith({
        triggerId: { referenceId: 'sync_conversation' },
        description: 'Sync conversation to external system',
        type: 'CONVERSATION_CREATED',
      });
    });

    it('registers event trigger for feedback_created', async () => {
      await app.postInstall({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'feedback_webhook',
            description: 'Send feedback to analytics',
            url: 'http://api.example.com/feedback',
            method: 'POST',
            triggerMode: 'event_trigger',
            eventType: 'feedback_created',
          }],
        },
      });

      expect(mockTriggersCreateOrUpdate).toHaveBeenCalledWith({
        triggerId: { referenceId: 'feedback_webhook' },
        description: 'Send feedback to analytics',
        type: 'FEEDBACK_CREATED',
      });
    });

    it('registers mixed webhooks', async () => {
      await app.postInstall({
        ...baseParams,
        settings: {
          webhooks: [
            {
              name: 'action_webhook',
              description: 'An action',
              url: 'http://api.example.com/action',
              method: 'POST',
              triggerMode: 'llm_action',
            },
            {
              name: 'trigger_webhook',
              description: 'A trigger',
              url: 'http://api.example.com/trigger',
              method: 'POST',
              triggerMode: 'event_trigger',
              eventType: 'feedback_created',
            },
          ],
        },
      });

      expect(mockActionsCreateOrUpdate).toHaveBeenCalledTimes(1);
      expect(mockTriggersCreateOrUpdate).toHaveBeenCalledTimes(1);
    });

    it('warns on unknown event type', async () => {
      await app.postInstall({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'unknown_trigger',
            url: 'http://api.example.com/unknown',
            method: 'POST',
            triggerMode: 'event_trigger',
            eventType: 'unknown_event' as any,
          }],
        },
      });

      expect(console.warn).toHaveBeenCalledWith(
        '[HTTP Webhook] Unknown event type: unknown_event'
      );
      expect(mockTriggersCreateOrUpdate).not.toHaveBeenCalled();
    });
  });

  describe('uninstall', () => {
    const baseParams = {
      organizationId: 'org-123',
      agentId: 'agent-456',
    };

    it('deletes LLM action', async () => {
      await app.uninstall({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'test_action',
            url: 'http://test.com',
            method: 'POST',
            triggerMode: 'llm_action',
            description: 'Test',
          }],
        },
      });

      expect(mockActionsDelete).toHaveBeenCalledWith('test_action');
    });

    it('deletes event trigger', async () => {
      await app.uninstall({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'test_trigger',
            url: 'http://test.com',
            method: 'POST',
            triggerMode: 'event_trigger',
            eventType: 'feedback_created',
            description: 'Test',
          }],
        },
      });

      expect(mockTriggersDelete).toHaveBeenCalledWith('test_trigger');
    });

    it('handles deletion errors gracefully', async () => {
      mockActionsDelete.mockRejectedValueOnce(new Error('Not found'));

      await expect(app.uninstall({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'missing_action',
            url: 'http://test.com',
            method: 'POST',
            triggerMode: 'llm_action',
            description: 'Test',
          }],
        },
      })).resolves.toBeUndefined();

      expect(console.warn).toHaveBeenCalled();
    });
  });
});

describe('executeAction', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const baseParams = {
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
    conversationMetadata: { source: 'web' },
  };

  it('returns error for unknown action', async () => {
    const result = await app.executeAction({
      ...baseParams,
      actionId: 'unknown_action',
      parameters: {},
      settings: { webhooks: [] },
    });

    expect(result).toBe('Unknown action: unknown_action');
  });

  it('makes HTTP request with interpolated body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('{"success": true}'),
    });
    global.fetch = mockFetch;

    const result = await app.executeAction({
      ...baseParams,
      actionId: 'send_event',
      parameters: { event_name: 'button_click' },
      settings: {
        webhooks: [{
          name: 'send_event',
          description: 'Send event',
          url: 'http://api.example.com/event',
          method: 'POST',
          triggerMode: 'llm_action',
          bodyTemplate: '{"event": "{{parameters.event_name}}", "email": "{{user.email}}"}',
        }],
      },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://api.example.com/event',
      expect.objectContaining({
        method: 'POST',
        body: '{"event": "button_click", "email": "user@example.com"}',
      })
    );
    expect(result).toContain('"success": true');
  });

  it('interpolates URL parameters', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('OK'),
    });
    global.fetch = mockFetch;

    await app.executeAction({
      ...baseParams,
      actionId: 'get_user',
      parameters: { user_id: '12345' },
      settings: {
        webhooks: [{
          name: 'get_user',
          description: 'Get user',
          url: 'http://api.example.com/users/{{parameters.user_id}}',
          method: 'GET',
          triggerMode: 'llm_action',
        }],
      },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://api.example.com/users/12345',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('interpolates headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('OK'),
    });
    global.fetch = mockFetch;

    await app.executeAction({
      ...baseParams,
      actionId: 'auth_request',
      parameters: {},
      settings: {
        apiKey: 'secret-key-123',
        webhooks: [{
          name: 'auth_request',
          description: 'Authenticated request',
          url: 'http://api.example.com/secure',
          method: 'GET',
          triggerMode: 'llm_action',
          headers: {
            'Authorization': 'Bearer {{settings.apiKey}}',
          },
        }],
      },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://api.example.com/secure',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer secret-key-123',
        }),
      })
    );
  });

  it('handles HTTP error response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: () => Promise.resolve('Invalid token'),
    });
    global.fetch = mockFetch;

    const result = await app.executeAction({
      ...baseParams,
      actionId: 'failing_request',
      parameters: {},
      settings: {
        webhooks: [{
          name: 'failing_request',
          description: 'Failing request',
          url: 'http://api.example.com/fail',
          method: 'GET',
          triggerMode: 'llm_action',
        }],
      },
    });

    expect(result).toContain('Webhook failed: 401 Unauthorized');
  });

  it('handles network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    global.fetch = mockFetch;

    const result = await app.executeAction({
      ...baseParams,
      actionId: 'network_error',
      parameters: {},
      settings: {
        webhooks: [{
          name: 'network_error',
          description: 'Network error',
          url: 'http://api.example.com/fail',
          method: 'GET',
          triggerMode: 'llm_action',
        }],
      },
    });

    expect(result).toContain('Webhook error: Network error');
  });

  it('includes AbortSignal timeout on requests', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('OK'),
    });
    global.fetch = mockFetch;

    await app.executeAction({
      ...baseParams,
      actionId: 'slow_request',
      parameters: {},
      settings: {
        webhooks: [{
          name: 'slow_request',
          description: 'Slow request',
          url: 'http://api.example.com/slow',
          method: 'GET',
          triggerMode: 'llm_action',
        }],
      },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://api.example.com/slow',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
  });
});

describe('Event Handlers', () => {
  let originalFetch: typeof global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('OK'),
    });
    global.fetch = mockFetch;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const baseParams = {
    organizationId: 'org-123',
    agentId: 'agent-456',
  };

  describe('feedbackCreatedOrUpdated', () => {
    it('fires webhook for feedback event', async () => {
      await app.feedbackCreatedOrUpdated({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'feedback_webhook',
            description: 'Send feedback',
            url: 'http://api.example.com/feedback',
            method: 'POST',
            triggerMode: 'event_trigger',
            eventType: 'feedback_created',
            bodyTemplate: '{"type": "{{feedback.type}}", "text": "{{feedback.text}}"}',
          }],
        },
        feedbacks: [{
          feedbackId: { referenceId: 'fb-1', appId: 'app', organizationId: 'org', agentId: 'agent', type: 'feedback' },
          conversationId: { referenceId: 'conv-1', appId: 'app', organizationId: 'org', agentId: 'agent', type: 'conversation' },
          conversationMessageId: { referenceId: 'msg-1', appId: 'app', organizationId: 'org', agentId: 'agent', type: 'message' },
          type: 'THUMBS_UP',
          text: 'Great help!',
        }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.example.com/feedback',
        expect.objectContaining({
          method: 'POST',
          body: '{"type": "THUMBS_UP", "text": "Great help!"}',
        })
      );
    });

    it('does not fire webhook if no feedback webhooks configured', async () => {
      await app.feedbackCreatedOrUpdated({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'other_webhook',
            description: 'Not feedback',
            url: 'http://api.example.com/other',
            method: 'POST',
            triggerMode: 'llm_action',
          }],
        },
        feedbacks: [{
          feedbackId: { referenceId: 'fb-1', appId: 'app', organizationId: 'org', agentId: 'agent', type: 'feedback' },
          conversationId: { referenceId: 'conv-1', appId: 'app', organizationId: 'org', agentId: 'agent', type: 'conversation' },
          conversationMessageId: { referenceId: 'msg-1', appId: 'app', organizationId: 'org', agentId: 'agent', type: 'message' },
          type: 'THUMBS_DOWN',
        }],
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('conversationCreatedOrUpdated', () => {
    it('fires webhook for conversation event', async () => {
      await app.conversationCreatedOrUpdated({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'conversation_sync',
            description: 'Sync conversation',
            url: 'http://api.example.com/sync',
            method: 'POST',
            triggerMode: 'event_trigger',
            eventType: 'conversation_created',
            bodyTemplate: '{"conversationId": "{{conversationId.referenceId}}"}',
          }],
        },
        conversations: [{
          referenceId: 'conv-123',
          appId: 'app-1',
          organizationId: 'org-123',
          agentId: 'agent-456',
          type: 'conversation',
        }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.example.com/sync',
        expect.objectContaining({
          body: '{"conversationId": "conv-123"}',
        })
      );
    });
  });

  describe('eventCreatedOrUpdated', () => {
    it('fires webhook for event_created trigger', async () => {
      await app.eventCreatedOrUpdated({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'event_sync',
            description: 'Sync events',
            url: 'http://api.example.com/events',
            method: 'POST',
            triggerMode: 'event_trigger',
            eventType: 'event_created',
            bodyTemplate: '{"org": "{{organizationId}}"}',
          }],
        },
        events: [{ id: 'evt-1', type: 'custom_event' }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.example.com/events',
        expect.objectContaining({
          method: 'POST',
          body: '{"org": "org-123"}',
        })
      );
    });

    it('does not fire webhook when no event_created webhooks configured', async () => {
      await app.eventCreatedOrUpdated({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'other_webhook',
            description: 'Not events',
            url: 'http://api.example.com/other',
            method: 'POST',
            triggerMode: 'llm_action',
          }],
        },
        events: [{ id: 'evt-1' }],
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('inboxItemCreatedOrUpdated', () => {
    it('fires webhook for inbox_item_created trigger', async () => {
      await app.inboxItemCreatedOrUpdated({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'inbox_sync',
            description: 'Sync inbox items',
            url: 'http://api.example.com/inbox',
            method: 'POST',
            triggerMode: 'event_trigger',
            eventType: 'inbox_item_created',
            bodyTemplate: '{"itemId": "{{inboxItemId.referenceId}}"}',
          }],
        },
        inboxItemIds: [{
          referenceId: 'inbox-1',
          appId: 'app-1',
          organizationId: 'org-123',
          agentId: 'agent-456',
          type: 'inbox_item',
        }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.example.com/inbox',
        expect.objectContaining({
          method: 'POST',
          body: '{"itemId": "inbox-1"}',
        })
      );
    });

    it('fires webhook for each inbox item', async () => {
      await app.inboxItemCreatedOrUpdated({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'inbox_sync',
            description: 'Sync inbox items',
            url: 'http://api.example.com/inbox',
            method: 'POST',
            triggerMode: 'event_trigger',
            eventType: 'inbox_item_created',
            bodyTemplate: '{"itemId": "{{inboxItemId.referenceId}}"}',
          }],
        },
        inboxItemIds: [
          { referenceId: 'inbox-1', appId: 'app-1', organizationId: 'org-123', agentId: 'agent-456', type: 'inbox_item' },
          { referenceId: 'inbox-2', appId: 'app-1', organizationId: 'org-123', agentId: 'agent-456', type: 'inbox_item' },
        ],
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const bodies = mockFetch.mock.calls.map((c: [string, RequestInit]) => JSON.parse(c[1].body as string));
      expect(bodies[0].itemId).toBe('inbox-1');
      expect(bodies[1].itemId).toBe('inbox-2');
    });

    it('does not fire webhook when no inbox_item_created webhooks configured', async () => {
      await app.inboxItemCreatedOrUpdated({
        ...baseParams,
        settings: {
          webhooks: [{
            name: 'other_webhook',
            description: 'Not inbox',
            url: 'http://api.example.com/other',
            method: 'POST',
            triggerMode: 'event_trigger',
            eventType: 'feedback_created',
          }],
        },
        inboxItemIds: [{
          referenceId: 'inbox-1',
          appId: 'app-1',
          organizationId: 'org-123',
          agentId: 'agent-456',
          type: 'inbox_item',
        }],
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

