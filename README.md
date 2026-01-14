# HTTP Webhook App

Send HTTP requests to external endpoints from your Maven agent. Configure webhooks that fire when the AI decides to take an action, or automatically when Maven events occur (like feedback or conversation created).

---

## Installation

1. Go to your Maven agent's **Apps** section
2. Find and install the **HTTP Webhook** app
3. Configure your webhooks in the settings form (see below)

---

## How It Works

This app supports two trigger modes:

| Mode | Description | Use Case |
|------|-------------|----------|
| **LLM Action** | AI decides when to call the webhook based on conversation context | "Create a support ticket", "Send to Slack" |
| **Event Trigger** | Webhook fires automatically on Maven events | Send all feedback to analytics, sync conversations |

---

## Configuration

When installing the app, you'll configure one or more webhooks:

### Webhook Fields

| Field | Required | Description |
|-------|----------|-------------|
| **Name** | Yes | Unique identifier (e.g., `send_to_slack`) |
| **Description** | Yes | For LLM actions: tells AI when to use this webhook |
| **Trigger Mode** | Yes | `llm_action` or `event_trigger` |
| **Event Type** | For triggers | Which event fires this webhook |
| **URL** | Yes | The HTTP endpoint to call |
| **HTTP Method** | Yes | GET, POST, PUT, PATCH, or DELETE |
| **API Key** | No | Secret key available as `{{webhook.apiKey}}` |
| **Headers** | No | JSON object with HTTP headers |
| **Body Template** | No | Request body with variable interpolation |
| **Timeout** | No | Request timeout in milliseconds (default: 30000) |

---

## Variable Interpolation

Use `{{variable}}` syntax in your URL, headers, and body template:

### Available Variables

| Variable | Available In | Description |
|----------|--------------|-------------|
| `{{user.email}}` | LLM Actions | User's email address |
| `{{user.firstName}}` | LLM Actions | User's first name |
| `{{user.lastName}}` | LLM Actions | User's last name |
| `{{parameters.fieldName}}` | LLM Actions | Values from action form fields |
| `{{webhook.apiKey}}` | All | The webhook's API key |
| `{{feedback.type}}` | Feedback Triggers | THUMBS_UP, THUMBS_DOWN, INSERT, HANDOFF |
| `{{feedback.text}}` | Feedback Triggers | Feedback comment text |
| `{{feedback.id}}` | Feedback Triggers | Feedback ID |
| `{{conversationId.referenceId}}` | All | Conversation ID |
| `{{organizationId}}` | All | Organization ID |
| `{{agentId}}` | All | Agent ID |

---

## Examples

### Example 1: Send Feedback to Analytics (Event Trigger)

Automatically send all feedback to your analytics endpoint.

| Field | Value |
|-------|-------|
| Name | `send_feedback_analytics` |
| Description | `Send all user feedback to analytics pipeline` |
| Trigger Mode | `event_trigger` |
| Event Type | `feedback_created` |
| URL | `https://analytics.example.com/feedback` |
| Method | `POST` |
| API Key | `your-analytics-api-key` |
| Headers | `{"Authorization": "Bearer {{webhook.apiKey}}", "Content-Type": "application/json"}` |
| Body Template | See below |

```json
{
  "feedback_type": "{{feedback.type}}",
  "feedback_text": "{{feedback.text}}",
  "conversation_id": "{{conversationId.referenceId}}",
  "timestamp": "{{feedback.createdAt}}"
}
```

---

### Example 2: Create JIRA Ticket (LLM Action)

Let the AI create support tickets when users have unresolved issues.

| Field | Value |
|-------|-------|
| Name | `create_jira_ticket` |
| Description | `Create a JIRA support ticket. Use when the user has an issue that needs human follow-up or escalation.` |
| Trigger Mode | `llm_action` |
| URL | `https://your-company.atlassian.net/rest/api/2/issue` |
| Method | `POST` |
| API Key | `your-base64-encoded-email:token` |
| Headers | `{"Authorization": "Basic {{webhook.apiKey}}", "Content-Type": "application/json"}` |
| Body Template | See below |

```json
{
  "fields": {
    "project": {"key": "SUPPORT"},
    "summary": "{{parameters.summary}}",
    "description": "{{parameters.description}}\n\nSubmitted by: {{user.email}}",
    "issuetype": {"name": "Task"}
  }
}
```

> **Note**: For LLM actions, users will be prompted to fill in the `summary` and `description` fields before the webhook fires.

---

### Example 3: Notify Slack (LLM Action)

Send messages to a Slack channel.

| Field | Value |
|-------|-------|
| Name | `notify_slack` |
| Description | `Send a notification to the team Slack channel. Use when the user wants to alert the team about something.` |
| Trigger Mode | `llm_action` |
| URL | `https://hooks.slack.com/services/YOUR/WEBHOOK/URL` |
| Method | `POST` |
| Headers | `{"Content-Type": "application/json"}` |
| Body Template | See below |

```json
{
  "text": "Message from {{user.email}}: {{parameters.message}}"
}
```

---

### Example 4: Sync Conversations to Data Warehouse (Event Trigger)

Automatically sync all conversations to your data warehouse.

| Field | Value |
|-------|-------|
| Name | `sync_conversation` |
| Description | `Sync conversation data to warehouse` |
| Trigger Mode | `event_trigger` |
| Event Type | `conversation_created` |
| URL | `https://api.example.com/ingest/conversation` |
| Method | `POST` |
| API Key | `your-warehouse-api-key` |
| Headers | `{"Authorization": "Bearer {{webhook.apiKey}}", "Content-Type": "application/json"}` |
| Body Template | See below |

```json
{
  "conversation_id": "{{conversationId.referenceId}}",
  "organization_id": "{{organizationId}}",
  "agent_id": "{{agentId}}",
  "source": "maven"
}
```

---

## Event Types

For event triggers, choose which Maven event fires the webhook:

| Event Type | Fires When | Available Data |
|------------|------------|----------------|
| `feedback_created` | User gives feedback (thumbs up/down) | `{{feedback.type}}`, `{{feedback.text}}`, `{{feedback.id}}` |
| `conversation_created` | Conversation is created/updated | `{{conversationId.*}}` |
| `event_created` | Generic event occurs | Event payload |
| `inbox_item_created` | Inbox item is created | `{{inboxItemId.*}}` |

---

## Troubleshooting

### Webhook not firing?

1. **Check trigger mode**: LLM actions require the AI to decide to call them based on conversation context
2. **Check event type**: Event triggers only fire on the specified event
3. **Check logs**: Look at your agent's logs for `[HTTP Webhook]` messages

### Getting errors?

1. **400 Bad Request**: Check your body template is valid JSON
2. **401 Unauthorized**: Verify your API key and Authorization header
3. **Timeout**: Increase the timeout value for slow endpoints

### Testing webhooks

Use a service like [webhook.site](https://webhook.site) or [Pipedream](https://pipedream.com) to see exactly what's being sent.

---

## Support

For questions or issues, contact Maven AGI support.
