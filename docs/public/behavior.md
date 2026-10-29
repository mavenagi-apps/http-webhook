# How requests are sent

## Agent actions

Each `llm_action` webhook is registered as an action whose ID and name are the webhook's Name. The agent decides when to call it from the Description; with no Description, the action is described by the webhook's full URL, so always set one when the URL contains a secret. The agent does not supply any values, so the request is built entirely from the template.

What the agent receives back:

| Outcome | Result passed to the agent |
|---|---|
| 2xx response | `Successfully executed webhook "<name>". Response: <body>`, with a JSON body pretty-printed |
| Any other status | `Webhook failed: <status> <status text> - <body>` |
| Timeout or network error | `Webhook error: <message>` |

The agent can relay any of these to the user, so a response body should not contain anything the user must not see.

## Event triggers

Each `event_trigger` webhook is registered as a trigger named after the webhook. When its event occurs, every webhook for that event type fires, one after another, in the order they appear in settings.

| Event type | One request per |
|---|---|
| `feedback_created` | feedback item |
| `conversation_created` | conversation |
| `inbox_item_created` | inbox item |
| `event_created` | delivery, with all of its events in `{{events}}` |

Maven can notify the app again when a conversation, feedback item, or inbox item is updated, so an endpoint can receive the same ID more than once. Repeat calls for one conversation within 5 seconds are usually collapsed, but not always. Deduplicate on the ID at the receiving end.

A failed trigger request is not retried, and nothing reports the failure to the agent or the user.

## Limits

- **Timeout:** every request is cancelled after 60 seconds. An endpoint that does slow work should acknowledge with a 2xx and finish afterwards.
- **GET sends no body.** The Body Template of a GET webhook is ignored; put values in the URL instead.
- **Blocked addresses:** a URL whose host is written as `localhost` or a private IPv4 address is refused. The action fails, or for a trigger, the remaining webhooks for that event are skipped.
- **Names:** the Name is the action or trigger ID, so keep it unique among this app's webhooks. Letters, numbers, dashes, and underscores are safest.

Uninstalling the app deletes the actions and triggers of the webhooks in its current settings.

## Troubleshooting

| Symptom | Check |
|---|---|
| The endpoint receives `{{…}}` text | That variable has no value in this trigger mode, or for this user. See [Request templates](templates.md). |
| 400 Bad Request | The body is not valid JSON. A quote or line break inside an inserted value is the usual cause. |
| 401 or 403 | The API Key and the `Authorization` header that uses it. If Headers is not valid JSON, no headers are sent. |
| The agent never calls the action | The Description: it must say plainly when the action applies. |
| The same event arrives twice | Expected; deduplicate on the ID. |
| `Webhook error: The operation was aborted due to timeout` | The endpoint took longer than 60 seconds. |
| The action fails and nothing reaches the endpoint | The URL may point at a blocked address (see Limits). |

If a webhook still misbehaves, contact Maven support with the webhook's name and the time it fired.
