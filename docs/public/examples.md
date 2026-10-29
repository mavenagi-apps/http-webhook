# Examples

Each example lists the webhook's fields as entered in the install form. Replace the URLs and keys with your own. Inserted values are not escaped, so a quote in an email address or ID would break these JSON bodies.

## Send feedback to an analytics endpoint

| Field | Value |
|---|---|
| Name | `send_feedback_analytics` |
| Description | `Send user feedback to the analytics pipeline` |
| Trigger Mode | `event_trigger` |
| Event Type | `feedback_created` |
| URL | `https://analytics.example.com/feedback` |
| HTTP Method | `POST` |
| API Key | your analytics API key |
| Headers (JSON) | `{"Authorization": "Bearer {{webhook.apiKey}}"}` |

Body Template:

```json
{
  "feedback_id": "{{feedback.id}}",
  "feedback_type": "{{feedback.type}}",
  "thumbs_up": {{feedback.thumbsUp}},
  "conversation_id": "{{conversationId.referenceId}}",
  "agent_id": "{{agentId}}"
}
```

Feedback text is left out because a quote in a comment would break the JSON. Send it only to an endpoint that accepts a raw text body, with a matching `Content-Type` in Headers.

## Create a Jira issue when the user asks for a person

| Field | Value |
|---|---|
| Name | `create_jira_ticket` |
| Description | `Create a Jira support ticket. Use when the user has an issue that needs human follow-up.` |
| Trigger Mode | `llm_action` |
| URL | `https://your-company.atlassian.net/rest/api/2/issue` |
| HTTP Method | `POST` |
| API Key | the Base64 encoding of `email:api-token` for a Jira account |
| Headers (JSON) | `{"Authorization": "Basic {{webhook.apiKey}}"}` |

Body Template:

```json
{
  "fields": {
    "project": {"key": "SUPPORT"},
    "summary": "Maven follow-up for {{user.email}}",
    "description": "Conversation {{conversationId.referenceId}} needs human follow-up.",
    "issuetype": {"name": "Task"}
  }
}
```

The agent cannot pass a summary of its own, so the issue identifies the conversation and an agent reads it from there.

## Post to a Slack channel

| Field | Value |
|---|---|
| Name | `notify_slack` |
| Description | `Alert the support team in Slack. Use when the user reports an outage.` |
| Trigger Mode | `llm_action` |
| URL | your Slack incoming webhook URL |
| HTTP Method | `POST` |

Body Template:

```json
{"text": "Outage reported by {{user.email}} in conversation {{conversationId.referenceId}}"}
```

## Record every new conversation

| Field | Value |
|---|---|
| Name | `sync_conversation` |
| Description | `Record new conversations in the warehouse` |
| Trigger Mode | `event_trigger` |
| Event Type | `conversation_created` |
| URL | `https://api.example.com/ingest/conversation` |
| HTTP Method | `POST` |
| API Key | your warehouse API key |
| Headers (JSON) | `{"Authorization": "Bearer {{webhook.apiKey}}"}` |

Body Template:

```json
{
  "conversation_id": "{{conversationId.referenceId}}",
  "organization_id": "{{organizationId}}",
  "agent_id": "{{agentId}}",
  "source": "maven"
}
```

The endpoint can receive the same conversation more than once, so it should upsert on `conversation_id`.
