# Request templates

The URL, Headers, and Body Template of every webhook accept `{{variable}}` placeholders. Each one is replaced with a value from the request's context when the webhook fires.

## How placeholders are filled

- A dotted path reads into the context: `{{feedback.text}}`, `{{conversationId.referenceId}}`.
- Text, numbers, and booleans are inserted as plain text: `{{feedback.thumbsUp}}` becomes `true` or `false`.
- An object or list is inserted as JSON: `{{conversationId}}` becomes `{"referenceId":"…","appId":"…",…}`.
- A placeholder with no value is left in the request as written, braces included. A body that still contains `{{` reached the endpoint with a value missing.
- Values are not escaped. A double quote or a line break in feedback text breaks a JSON body that wraps it in quotes, so the endpoint should tolerate invalid JSON or the field should not be free text.

## Headers

Headers is a JSON object of header names to values, for example:

```json
{"Authorization": "Bearer {{webhook.apiKey}}", "X-Source": "maven"}
```

Header values must be strings, and take placeholders too. If Headers is not valid JSON, none of its headers are sent and the request goes out without them.

When a webhook sends a body and Headers sets no `Content-Type`, `Content-Type: application/json` is added. Set your own `Content-Type` to send another format.

## Variables by trigger mode

Every webhook can use `{{webhook.apiKey}}` (its own API key, empty if unset) and `{{webhook.name}}`.

### Agent actions (`llm_action`)

| Variable | Value |
|---|---|
| `{{user.email}}` | The user's email address, when the user is identified by email |
| `{{user.phoneNumber}}` | The user's phone number, when the user is identified by phone |
| `{{user.<field>}}` | Any field in the user's default user data, such as `{{user.firstName}}` when it is set |
| `{{conversationId.referenceId}}` | The conversation's ID, when the action runs in a conversation |
| `{{metadata.<key>}}` | A value from the conversation's metadata |

`{{organizationId}}` and `{{agentId}}` are not available to agent actions. Use `{{conversationId.organizationId}}` and `{{conversationId.agentId}}` instead.

The agent does not pass values of its own to a webhook, so a template cannot include something the agent worked out during the conversation, such as a summary. Install-form webhooks have no `{{parameters.*}}` values.

### Feedback (`feedback_created`)

| Variable | Value |
|---|---|
| `{{feedback.id}}` | The feedback's ID |
| `{{feedback.type}}` | `THUMBS_UP`, `THUMBS_DOWN`, `INSERT`, or `HANDOFF` |
| `{{feedback.thumbsUp}}` | `true` for a thumbs up, otherwise `false` |
| `{{feedback.text}}` | The feedback comment, empty if there is none |
| `{{conversationId.referenceId}}` | The conversation the feedback is on |
| `{{conversationMessageId.referenceId}}` | The message the feedback is on |
| `{{organizationId}}`, `{{agentId}}` | The organization and agent |

### Conversations (`conversation_created`)

| Variable | Value |
|---|---|
| `{{conversationId.referenceId}}` | The conversation's ID |
| `{{organizationId}}`, `{{agentId}}` | The organization and agent |

### Inbox items (`inbox_item_created`)

| Variable | Value |
|---|---|
| `{{inboxItemId.referenceId}}` | The inbox item's ID |
| `{{organizationId}}`, `{{agentId}}` | The organization and agent |

### Events (`event_created`)

| Variable | Value |
|---|---|
| `{{events}}` | The events Maven delivered, as JSON |
| `{{organizationId}}`, `{{agentId}}` | The organization and agent |

Conversation and inbox item triggers carry IDs only. To act on a conversation's messages, the endpoint fetches them from the Maven API by ID.
