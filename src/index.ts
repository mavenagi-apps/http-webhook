import { MavenAGIClient } from "mavenagi";
import * as MavenAGI from "mavenagi/api";
import { interpolate, interpolateHeaders } from "@/lib/interpolate";

// Re-export types from app-interface for event handlers
interface EntityId {
  referenceId: string;
  appId: string;
  organizationId: string;
  agentId: string;
  type: string;
}

interface EntityIdBase {
  referenceId: string;
}

interface ActionUser {
  userId?: EntityIdBase;
  userIdentifiers: Array<{ value: string; type: "EMAIL" | "PHONE_NUMBER" }>;
  allUserData: Record<string, Record<string, string>>;
  defaultUserData: Record<string, string>;
}

interface Feedback {
  feedbackId: EntityId;
  conversationId: EntityId;
  conversationMessageId: EntityId;
  type: "THUMBS_UP" | "THUMBS_DOWN" | "INSERT" | "HANDOFF";
  text?: string;
}

// Map event types to Maven trigger types
const EVENT_TYPE_TO_TRIGGER_TYPE: Record<string, MavenAGI.EventTriggerType> = {
  feedback_created: MavenAGI.EventTriggerType.FeedbackCreated,
  conversation_created: MavenAGI.EventTriggerType.ConversationCreated,
};

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

  // Use webhook timeout if specified, otherwise default to 30 seconds
  // Use || instead of ?? because empty form fields may come through as 0
  const timeout = webhook.timeout || 30000;

  console.log(`[HTTP Webhook] ${webhook.method} ${url} (timeout: ${timeout}ms)`);

  try {
    const response = await fetch(url, {
      method: webhook.method,
      headers,
      body,
      signal: AbortSignal.timeout(timeout),
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
    user: ActionUser;
    conversationId?: EntityId | null;
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
    const context: Record<string, unknown> = {
      user: {
        email:
          user.userIdentifiers.find((id) => id.type === "EMAIL")?.value || "",
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

    return makeWebhookRequest(webhook, context, settings);
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
    feedbacks: Feedback[];
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
      // Build feedback object with all available fields
      const feedbackObj: Record<string, unknown> = {
        type: feedback.type,
        text: feedback.text || "",
        id: feedback.feedbackId.referenceId,
        feedbackId: feedback.feedbackId,
        // Include thumbsUp for THUMBS_UP/THUMBS_DOWN feedback types
        thumbsUp: feedback.type === "THUMBS_UP",
      };
      
      // Add timestamp fields if they exist on the raw object
      const rawFeedback = feedback as unknown as Record<string, unknown>;
      if (rawFeedback.createdAt) feedbackObj.createdAt = rawFeedback.createdAt;
      if (rawFeedback.updatedAt) feedbackObj.updatedAt = rawFeedback.updatedAt;
      
      const context: Record<string, unknown> = {
        feedback: feedbackObj,
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
        const webhookContext = {
          ...context,
          webhook: { apiKey: webhook.apiKey || "", name: webhook.name },
        };
        await makeWebhookRequest(webhook, webhookContext, settings);
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
    conversations: EntityId[];
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
        const webhookContext = {
          ...context,
          webhook: { apiKey: webhook.apiKey || "", name: webhook.name },
        };
        await makeWebhookRequest(webhook, webhookContext, settings);
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
      const webhookContext = {
        ...context,
        webhook: { apiKey: webhook.apiKey || "", name: webhook.name },
      };
      await makeWebhookRequest(webhook, webhookContext, settings);
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
    inboxItemIds: EntityId[];
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
        const webhookContext = {
          ...context,
          webhook: { apiKey: webhook.apiKey || "", name: webhook.name },
        };
        await makeWebhookRequest(webhook, webhookContext, settings);
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

