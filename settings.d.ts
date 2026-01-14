declare global {
  /**
   * Webhook configuration for HTTP requests
   */
  interface WebhookConfig {
    /** Unique identifier for the webhook (used as action ID) */
    name: string;
    
    /** Description - guides LLM for actions, documentation for triggers */
    description: string;
    
    /** How this webhook is triggered */
    triggerMode: 'llm_action' | 'event_trigger';
    
    /** For event triggers: which event type fires this webhook */
    eventType?: 'feedback_created' | 'conversation_created' | 'event_created' | 'inbox_item_created';
    
    /** HTTP endpoint URL (supports {{settings.*}} interpolation) */
    url: string;
    
    /** HTTP method */
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    
    /** HTTP headers (supports {{settings.*}} interpolation). May be JSON string from form. */
    headers?: Record<string, string> | string;
    
    /** Request body template with {{variable}} interpolation */
    bodyTemplate?: string;
    
    /** For LLM actions: form parameters to collect from user */
    userFormParameters?: Array<{
      id: string;
      label: string;
      description?: string;
      required?: boolean;
    }>;
    
    /** 
     * Per-webhook timeout in milliseconds.
     * Overrides the global timeout setting.
     * Useful for slow endpoints like Glean agent /wait calls.
     * Default: uses settings.timeout or 30000ms
     */
    timeout?: number;
    
    /**
     * API key for this specific webhook.
     * Available as {{webhook.apiKey}} in headers and body templates.
     */
    apiKey?: string;
  }

  interface AppSettings {
    /** Array of webhook configurations */
    webhooks: WebhookConfig[];
    
    /** Default headers applied to all webhooks. May be JSON string from form. */
    defaultHeaders?: Record<string, string> | string;
    
    /** Request timeout in milliseconds (default: 30000) */
    timeout?: number;
    
    /** API keys and secrets for {{settings.*}} interpolation */
    [key: string]: unknown;
  }
}

export {};

