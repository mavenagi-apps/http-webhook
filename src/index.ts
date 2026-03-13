import { MavenAGIClient } from "mavenagi";
import * as MavenAGI from "mavenagi/api";
import { interpolate, interpolateHeaders } from "@/lib/interpolate";


// Map event types to Maven trigger types
const EVENT_TYPE_TO_TRIGGER_TYPE: Record<string, MavenAGI.EventTriggerType> = {
  feedback_created: MavenAGI.EventTriggerType.FeedbackCreated,
  conversation_created: MavenAGI.EventTriggerType.ConversationCreated,
  event_created: MavenAGI.EventTriggerType.EventCreated,
  inbox_item_created: MavenAGI.EventTriggerType.InboxItemCreated,
};

// Request timeout for all webhook calls
const REQUEST_TIMEOUT_MS = 60000;

// Hostnames and IP patterns that should not be used as webhook targets (SSRF protection)
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  'metadata.google.internal',
]);

const PRIVATE_IP_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,       // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/, // 172.16.0.0/12
  /^192\.168\.\d{1,3}\.\d{1,3}$/,           // 192.168.0.0/16
  /^169\.254\.\d{1,3}\.\d{1,3}$/,           // Link-local / cloud metadata
];

/**
 * Validate that a webhook URL does not target internal or private addresses.
 * Throws if the URL is blocked. Skipped in test environments to allow localhost integration tests.
 */
function validateUrl(url: string): void {
  if (process.env.NODE_ENV === 'test') return;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    if (BLOCKED_HOSTNAMES.has(hostname)) {
      throw new Error(`Webhook URL targets a blocked host: ${hostname}`);
    }

    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        throw new Error(`Webhook URL targets a private IP range: ${hostname}`);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Webhook URL')) {
      throw error;
    }
    // URL parsing failed — let fetch handle the error
  }
}

/**
 * Redact query parameters from a URL for safe logging.
 * Prevents API keys in query strings from appearing in logs.
 */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.search) {
      return `${parsed.origin}${parsed.pathname}?[REDACTED]`;
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * Build the webhook-specific context by merging base context with webhook metadata.
 */
function buildWebhookContext(
  context: Record<string, unknown>,
  webhook: WebhookConfig
): Record<string, unknown> {
  return {
    ...context,
    webhook: { apiKey: webhook.apiKey || "", name: webhook.name },
  };
}

// Deduplication cache for event triggers.
// Prevents double-firing when conversationCreatedOrUpdated is called for both create and update events.
// NOTE: This is best-effort in serverless environments — the in-memory Map is not shared across
// cold starts or concurrent instances. It reliably catches the common case of rapid create+update
// events on the same warm instance.
const DEDUP_WINDOW_MS = 5000;
const recentlyProcessed = new Map<string, number>();

/**
 * Check if an event should be processed based on deduplication window.
 * Returns true if the event should be processed, false if it's a duplicate.
 */
function shouldProcess(key: string): boolean {
  const now = Date.now();
  const lastProcessed = recentlyProcessed.get(key);

  if (lastProcessed && now - lastProcessed < DEDUP_WINDOW_MS) {
    return false;
  }

  recentlyProcessed.set(key, now);

  // Cleanup entries older than 2x the window
  recentlyProcessed.forEach((v, k) => {
    if (now - v > DEDUP_WINDOW_MS * 2) {
      recentlyProcessed.delete(k);
    }
  });

  return true;
}

/** Exported for testing only */
export function _resetDedupCache() {
  recentlyProcessed.clear();
}

/**
 * Parse headers from string (JSON) or object format
 * The form may return headers as a JSON string that needs parsing
 */
function parseHeaders(headers: string | Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  if (typeof headers === 'string') {
    try {
      return JSON.parse(headers);
    } catch {
      console.warn('[HTTP Webhook] Failed to parse headers JSON:', headers);
      return {};
    }
  }
  return headers;
}

/**
 * Make an HTTP request based on webhook configuration
 */
async function makeWebhookRequest(
  webhook: WebhookConfig,
  context: Record<string, unknown>,
  settings: AppSettings
): Promise<string> {
  // Build URL with interpolation
  const url = interpolate(webhook.url, context);

  // SSRF protection: reject requests to internal/private addresses
  validateUrl(url);

  // Parse and merge headers (may come as JSON string from form)
  const webhookHeaders = parseHeaders(webhook.headers);
  const defaultHeaders = parseHeaders(settings.defaultHeaders);
  
  // Interpolate headers
  const headers = interpolateHeaders(
    {
      ...defaultHeaders,
      ...webhookHeaders,
    },
    context
  );

  // Interpolate body template
  const body =
    webhook.bodyTemplate && webhook.method !== "GET"
      ? interpolate(webhook.bodyTemplate, context)
      : undefined;

  // Auto-add Content-Type: application/json when body is present and no Content-Type is configured
  if (body && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }

  console.log(`[HTTP Webhook] ${webhook.method} ${redactUrl(url)} (timeout: ${REQUEST_TIMEOUT_MS}ms)`);

  try {
    const response = await fetch(url, {
      method: webhook.method,
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        `[HTTP Webhook] Error: ${response.status} ${response.statusText}`
      );
      return `Webhook failed: ${response.status} ${response.statusText} - ${responseText}`;
    }

    // Try to parse as JSON for better formatting
    try {
      const json = JSON.parse(responseText);
      return JSON.stringify(json, null, 2);
    } catch {
      return responseText;
    }
  } catch (error) {
    console.error(`[HTTP Webhook] Request failed:`, error);
    return `Webhook error: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

export default {
  /**
   * Validate settings before installation
   */
  async preInstall({
    settings,
  }: {
    organizationId: string;
    agentId: string;
    settings: AppSettings;
  }) {
    if (!settings.webhooks || !Array.isArray(settings.webhooks)) {
      throw new Error("Settings must include a 'webhooks' array");
    }

    if (settings.webhooks.length === 0) {
      throw new Error("At least one webhook configuration is required");
    }

    for (const webhook of settings.webhooks) {
      if (!webhook.name) {
        throw new Error("Each webhook must have a 'name'");
      }
      if (!webhook.url) {
        throw new Error(`Webhook '${webhook.name}' must have a 'url'`);
      }
      if (!webhook.method) {
        throw new Error(`Webhook '${webhook.name}' must have a 'method'`);
      }
      if (!webhook.triggerMode) {
        throw new Error(`Webhook '${webhook.name}' must have a 'triggerMode'`);
      }
      if (
        webhook.triggerMode === "event_trigger" &&
        !webhook.eventType
      ) {
        throw new Error(
          `Webhook '${webhook.name}' with triggerMode 'event_trigger' must have an 'eventType'`
        );
      }
    }

    console.log(
      `[HTTP Webhook] Validated ${settings.webhooks.length} webhook configurations`
    );
  },

  /**
   * Register actions and event triggers after installation
   */
  async postInstall({
    organizationId,
    agentId,
    settings,
  }: {
    organizationId: string;
    agentId: string;
    settings: AppSettings;
  }) {
    const client = new MavenAGIClient({ organizationId, agentId });

    for (const webhook of settings.webhooks) {
      if (webhook.triggerMode === "llm_action") {
        // Register as an action (LLM-invoked)
        const hasFormParameters =
          (webhook.userFormParameters && webhook.userFormParameters.length > 0) ?? false;

        await client.actions.createOrUpdate({
          actionId: { referenceId: webhook.name },
          name: webhook.name,
          description:
            webhook.description || `Calls webhook: ${webhook.url}`,
          userInteractionRequired: hasFormParameters === true,
          userFormParameters: (webhook.userFormParameters || []).map(
            (param) => ({
              id: param.id,
              label: param.label,
              description: param.description || param.label,
              required: param.required ?? false,
            })
          ),
        });

        console.log(`[HTTP Webhook] Registered action: ${webhook.name}`);
      } else if (webhook.triggerMode === "event_trigger") {
        // Register as an event trigger
        const triggerType = EVENT_TYPE_TO_TRIGGER_TYPE[webhook.eventType!];

        if (!triggerType) {
          console.warn(
            `[HTTP Webhook] Unknown event type: ${webhook.eventType}`
          );
          continue;
        }

        await client.triggers.createOrUpdate({
          triggerId: { referenceId: webhook.name },
          description:
            webhook.description || `Webhook trigger for ${webhook.eventType}`,
          type: triggerType,
        });

        console.log(
          `[HTTP Webhook] Registered trigger: ${webhook.name} (${webhook.eventType})`
        );
      }
    }

    console.log(
      `[HTTP Webhook] Completed registration for ${settings.webhooks.length} webhooks`
    );
  },

  /**
   * Handle LLM-invoked action execution
   */
  async executeAction({
    actionId,
    parameters,
    settings,
    user,
    conversationId,
    conversationMetadata,
  }: {
    organizationId: string;
    agentId: string;
    actionId: string;
    parameters: Record<string, unknown>;
    settings: AppSettings;
    user: MavenAGI.ActionUser;
    conversationId?: MavenAGI.EntityId | null;
    conversationMetadata: Record<string, string>;
  }): Promise<string> {
    // Find the webhook configuration
    const webhook = settings.webhooks.find(
      (w) => w.name === actionId && w.triggerMode === "llm_action"
    );

    if (!webhook) {
      console.error(`[HTTP Webhook] Action not found: ${actionId}`);
      return `Unknown action: ${actionId}`;
    }

    // Build interpolation context
    // Map all identifiers to camelCase keys (e.g. EMAIL → email, PHONE_NUMBER → phoneNumber)
    const identifiers = Object.fromEntries(
      user.userIdentifiers.map((id) => [
        id.type.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
        id.value,
      ])
    );

    const context: Record<string, unknown> = {
      user: {
        ...identifiers,
        ...user.defaultUserData,
      },
      parameters,
      settings,
      conversationId,
      metadata: conversationMetadata,
      webhook: {
        apiKey: webhook.apiKey || "",
        name: webhook.name,
      },
    };

    const result = await makeWebhookRequest(webhook, context, settings);

    // Error responses pass through as-is so the LLM can report the failure
    if (result.startsWith('Webhook failed:') || result.startsWith('Webhook error:')) {
      return result;
    }

    // Wrap successful responses with clear context so the LLM confirms the action to the user
    return `Successfully executed webhook "${webhook.name}". Response: ${result}`;
  },

  /**
   * Handle feedback created/updated events
   */
  async feedbackCreatedOrUpdated({
    organizationId,
    agentId,
    settings,
    feedbacks,
  }: {
    organizationId: string;
    agentId: string;
    settings: AppSettings;
    feedbacks: MavenAGI.Feedback[];
  }): Promise<void> {
    // Find webhooks configured for feedback events
    const feedbackWebhooks = settings.webhooks.filter(
      (w) =>
        w.triggerMode === "event_trigger" && w.eventType === "feedback_created"
    );

    if (feedbackWebhooks.length === 0) {
      return;
    }

    for (const feedback of feedbacks) {
      const context: Record<string, unknown> = {
        feedback: {
          type: feedback.type,
          text: feedback.text || "",
          id: feedback.feedbackId.referenceId,
          feedbackId: feedback.feedbackId,
          thumbsUp: feedback.type === "THUMBS_UP",
          createdAt: feedback.createdAt,
        },
        conversation: {
          conversationId: feedback.conversationId,
        },
        conversationId: feedback.conversationId,
        conversationMessageId: feedback.conversationMessageId,
        settings,
        organization: { id: organizationId },
        agent: { id: { agentId } },
        organizationId,
        agentId,
      };

      for (const webhook of feedbackWebhooks) {
        console.log(
          `[HTTP Webhook] Firing feedback trigger: ${webhook.name}`
        );
        await makeWebhookRequest(webhook, buildWebhookContext(context, webhook), settings);
      }
    }
  },

  /**
   * Handle conversation created/updated events
   */
  async conversationCreatedOrUpdated({
    organizationId,
    agentId,
    settings,
    conversations,
  }: {
    organizationId: string;
    agentId: string;
    settings: AppSettings;
    conversations: MavenAGI.EntityId[];
  }): Promise<void> {
    // Find webhooks configured for conversation events
    const conversationWebhooks = settings.webhooks.filter(
      (w) =>
        w.triggerMode === "event_trigger" &&
        w.eventType === "conversation_created"
    );

    if (conversationWebhooks.length === 0) {
      return;
    }

    for (const conversationId of conversations) {
      // Deduplicate rapid create+update events for the same conversation
      const dedupKey = `conv:${conversationId.referenceId}`;
      if (!shouldProcess(dedupKey)) {
        console.log(
          `[HTTP Webhook] Skipping duplicate event for conversation: ${conversationId.referenceId}`
        );
        continue;
      }

      const context: Record<string, unknown> = {
        conversationId,
        settings,
        organizationId,
        agentId,
      };

      for (const webhook of conversationWebhooks) {
        console.log(
          `[HTTP Webhook] Firing conversation trigger: ${webhook.name}`
        );
        await makeWebhookRequest(webhook, buildWebhookContext(context, webhook), settings);
      }
    }
  },

  /**
   * Handle event created/updated (generic events)
   */
  async eventCreatedOrUpdated({
    organizationId,
    agentId,
    settings,
    events,
  }: {
    organizationId: string;
    agentId: string;
    settings: AppSettings;
    events: unknown;
  }): Promise<void> {
    // Find webhooks configured for generic events
    const eventWebhooks = settings.webhooks.filter(
      (w) =>
        w.triggerMode === "event_trigger" && w.eventType === "event_created"
    );

    if (eventWebhooks.length === 0) {
      return;
    }

    const context: Record<string, unknown> = {
      events,
      settings,
      organizationId,
      agentId,
    };

    for (const webhook of eventWebhooks) {
      console.log(`[HTTP Webhook] Firing event trigger: ${webhook.name}`);
      await makeWebhookRequest(webhook, buildWebhookContext(context, webhook), settings);
    }
  },

  /**
   * Handle inbox item created/updated events
   */
  async inboxItemCreatedOrUpdated({
    organizationId,
    agentId,
    settings,
    inboxItemIds,
  }: {
    organizationId: string;
    agentId: string;
    settings: AppSettings;
    inboxItemIds: MavenAGI.EntityId[];
  }): Promise<void> {
    // Find webhooks configured for inbox item events
    const inboxWebhooks = settings.webhooks.filter(
      (w) =>
        w.triggerMode === "event_trigger" &&
        w.eventType === "inbox_item_created"
    );

    if (inboxWebhooks.length === 0) {
      return;
    }

    for (const inboxItemId of inboxItemIds) {
      const context: Record<string, unknown> = {
        inboxItemId,
        settings,
        organizationId,
        agentId,
      };

      for (const webhook of inboxWebhooks) {
        console.log(
          `[HTTP Webhook] Firing inbox item trigger: ${webhook.name}`
        );
        await makeWebhookRequest(webhook, buildWebhookContext(context, webhook), settings);
      }
    }
  },

  /**
   * Cleanup on uninstall
   */
  async uninstall({
    organizationId,
    agentId,
    settings,
  }: {
    organizationId: string;
    agentId: string;
    settings: AppSettings;
  }) {
    const client = new MavenAGIClient({ organizationId, agentId });

    for (const webhook of settings.webhooks) {
      try {
        if (webhook.triggerMode === "llm_action") {
          await client.actions.delete(webhook.name);
          console.log(`[HTTP Webhook] Deleted action: ${webhook.name}`);
        } else if (webhook.triggerMode === "event_trigger") {
          await client.triggers.delete(webhook.name);
          console.log(`[HTTP Webhook] Deleted trigger: ${webhook.name}`);
        }
      } catch (error) {
        console.warn(
          `[HTTP Webhook] Failed to delete ${webhook.name}:`,
          error
        );
      }
    }

    console.log(`[HTTP Webhook] Uninstall complete`);
  },
};

