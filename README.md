# HTTP Webhook App for Maven AGI

A generic HTTP webhook app that supports both **LLM-invoked actions** and **event-triggered webhooks**.

## Features

- **Dual-mode operation**: LLM decides when to call webhooks OR webhooks fire automatically on Maven events
- **Template interpolation**: Use `{{variable.path}}` syntax in URLs, headers, and body templates
- **Multiple webhooks**: Configure any number of webhooks per installation
- **Event triggers**: Fire webhooks on feedback, conversation creation, and more

## Installation

Configure the app with a `webhooks` array in settings.

## Configuration

### LLM-Invoked Action Example

The LLM will decide when to invoke this action based on the description:

```json
{
  "webhooks": [
    {
      "name": "create_support_ticket",
      "description": "Create a support ticket when the user has an unresolved issue that needs human assistance",
      "triggerMode": "llm_action",
      "url": "https://api.example.com/tickets",
      "method": "POST",
      "headers": {
        "Authorization": "Bearer {{settings.apiKey}}",
        "Content-Type": "application/json"
      },
      "bodyTemplate": "{\"title\": \"{{parameters.title}}\", \"description\": \"{{parameters.description}}\", \"user_email\": \"{{user.email}}\"}",
      "userFormParameters": [
        {"id": "title", "label": "Issue Title", "required": true},
        {"id": "description", "label": "Issue Description", "required": true}
      ]
    }
  ],
  "apiKey": "your-api-key-here"
}
```

### Event-Triggered Webhook Example

This webhook fires automatically when feedback is submitted:

```json
{
  "webhooks": [
    {
      "name": "send_feedback_to_analytics",
      "description": "Sends all feedback to our analytics pipeline",
      "triggerMode": "event_trigger",
      "eventType": "feedback_created",
      "url": "https://analytics.example.com/feedback",
      "method": "POST",
      "headers": {
        "Authorization": "Bearer {{settings.analyticsApiKey}}",
        "Content-Type": "application/json"
      },
      "bodyTemplate": "{\"feedback_type\": \"{{feedback.type}}\", \"feedback_text\": \"{{feedback.text}}\", \"conversation_id\": \"{{conversationId.referenceId}}\"}"
    }
  ],
  "analyticsApiKey": "your-analytics-key"
}
```

## Supported Event Types

| Event Type | Description |
|------------|-------------|
| `feedback_created` | Fires when user submits feedback (thumbs up/down, etc.) |
| `conversation_created` | Fires when a new conversation starts |
| `event_created` | Fires on generic Maven events |
| `inbox_item_created` | Fires when inbox items are created |

## Variable Interpolation

### For LLM Actions

| Variable | Description |
|----------|-------------|
| `{{user.email}}` | User's email address |
| `{{user.*}}` | Other user data from `defaultUserData` |
| `{{parameters.fieldName}}` | Form field values from `userFormParameters` |
| `{{settings.key}}` | App settings values (API keys, etc.) |
| `{{conversationId.referenceId}}` | Conversation reference ID |
| `{{metadata.key}}` | Conversation metadata |

### For Event Triggers

| Variable | Description |
|----------|-------------|
| `{{feedback.type}}` | Feedback type: THUMBS_UP, THUMBS_DOWN, INSERT, HANDOFF |
| `{{feedback.text}}` | Feedback text content |
| `{{conversationId.referenceId}}` | Conversation reference ID |
| `{{settings.key}}` | App settings values |
| `{{organizationId}}` | Maven organization ID |
| `{{agentId}}` | Maven agent ID |

## Webhook Configuration Schema

```typescript
interface WebhookConfig {
  name: string;                    // Unique identifier
  description: string;             // Guides LLM or documents the trigger
  triggerMode: 'llm_action' | 'event_trigger';
  eventType?: string;              // Required for event_trigger mode
  url: string;                     // HTTP endpoint
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  bodyTemplate?: string;           // Request body with {{variables}}
  userFormParameters?: Array<{     // Only for llm_action mode
    id: string;
    label: string;
    description?: string;
    required?: boolean;
  }>;
}
```

## Development

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Build for production
pnpm build
```

## License

MIT

