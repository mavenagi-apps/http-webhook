# HTTP Webhook App Installation Guide

Send HTTP requests to external endpoints from your Maven agent. Configure webhooks that fire when the AI decides to take an action, or automatically when Maven events occur.

---

## Quick Start

1. Fill out the webhook configuration form below
2. Click **Install**
3. Test your webhook using the chat interface

---

## Configuration Fields

### Global Settings

| Field | Description |
|-------|-------------|
| **Default Headers (JSON)** | Headers applied to ALL webhooks. Per-webhook headers override these. |

### Webhook Settings

| Field | Required | Description |
|-------|----------|-------------|
| **Name** | Yes | Unique identifier using only letters, numbers, dashes, underscores (e.g., `send-to-slack`) |
| **Description** | Recommended | For LLM actions: tells the AI when to use this webhook. A default is generated if omitted. |
| **Trigger Mode** | Yes | `llm_action` (AI decides) or `event_trigger` (automatic) |
| **Event Type** | For triggers | Which Maven event fires this webhook |
| **URL** | Yes | The HTTP endpoint to call |
| **HTTP Method** | Yes | GET, POST, PUT, PATCH, or DELETE |
| **API Key** | No | Secret key available as `{{webhook.apiKey}}` in templates |
| **Headers** | No | JSON object, e.g., `{"Authorization": "Bearer {{webhook.apiKey}}"}`. `Content-Type: application/json` is added automatically when a body is present. |
| **Body Template** | No | Request body with `{{variable}}` interpolation |
| **User Form Parameters** | No | Form fields shown to the user before an LLM action fires (id, label, description, required) |

---

## Trigger Modes

### LLM Action
The AI reads your **Description** and decides when to call the webhook based on conversation context.

**Example:** Set Description to `Create a support ticket when the user needs human help` — the AI will trigger this when users ask for escalation.

### Event Trigger
Webhooks fire automatically on Maven events:

| Event Type | Fires When |
|------------|------------|
| `feedback_created` | User gives thumbs up/down |
| `conversation_created` | Conversation starts or updates |
| `inbox_item_created` | Inbox item is created |
| `event_created` | Custom event occurs |

---

## Variable Interpolation

Use `{{variable}}` syntax in URL, headers, and body:

### Always Available
- `{{webhook.apiKey}}` — Your webhook's API key
- `{{conversationId.referenceId}}` — Conversation ID
- `{{organizationId}}` — Organization ID
- `{{agentId}}` — Agent ID

### LLM Actions Only
- `{{user.email}}` — User's email (if identified)
- `{{user.firstName}}`, `{{user.lastName}}` — User's name
- `{{parameters.fieldName}}` — Form field values

### Feedback Events Only
- `{{feedback.type}}` — `THUMBS_UP`, `THUMBS_DOWN`, `INSERT`, or `HANDOFF`
- `{{feedback.text}}` — Feedback comment
- `{{feedback.id}}` — Feedback ID
- `{{feedback.thumbsUp}}` — `true` or `false`

---

## Examples

### Send Feedback to Analytics

```
Name: feedback-analytics
Description: Send feedback to analytics
Trigger Mode: event_trigger
Event Type: feedback_created
URL: https://analytics.example.com/feedback
Method: POST
Headers: {"Content-Type": "application/json"}
Body:
{
  "type": "{{feedback.type}}",
  "text": "{{feedback.text}}",
  "conversation_id": "{{conversationId.referenceId}}"
}
```

### Notify Slack (LLM Action)

```
Name: notify-slack
Description: Send a notification to Slack when the user wants to alert the team
Trigger Mode: llm_action
URL: https://hooks.slack.com/services/YOUR/WEBHOOK/URL
Method: POST
Headers: {"Content-Type": "application/json"}
Body:
{
  "text": "Message from {{user.email}}: User requested assistance"
}
```

### Create JIRA Ticket (LLM Action)

```
Name: create-jira-ticket
Description: Create a JIRA ticket when the user has an issue needing follow-up
Trigger Mode: llm_action
URL: https://your-company.atlassian.net/rest/api/2/issue
Method: POST
API Key: (your base64 email:token)
Headers: {"Authorization": "Basic {{webhook.apiKey}}", "Content-Type": "application/json"}
Body:
{
  "fields": {
    "project": {"key": "SUPPORT"},
    "summary": "Support request from Maven",
    "issuetype": {"name": "Task"}
  }
}
```

---

## Testing

1. Use [webhook.site](https://webhook.site) or [Pipedream](https://pipedream.com) to get a test URL
2. Configure a webhook with that URL
3. For LLM actions: chat with your agent and trigger the action
4. For event triggers: perform the event (e.g., give feedback)
5. Check the test site to see the payload

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Webhook not firing | Check your Description — AI uses this to decide when to call |
| Name validation error | Use only letters, numbers, dashes, underscores |
| 400 Bad Request | Check body template is valid JSON |
| 401 Unauthorized | Verify API key and Authorization header |
| Empty variables | User may not be identified (for `{{user.email}}`, etc.) |

---

## Support

For help, contact Maven AGI support.
