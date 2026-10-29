# Operations

## Deployments

The `http-webhook` app record (owner `mavenagi-apps`) is served by the Vercel project `mavenagi-developer-app-production-http-webhook`, which deploys `main`. Two more Vercel projects also build from `main`: `mavenagi-developer-app-production-webhook` and one customer-specific project. The manifest declares only `targets.main`, so a publish never touches their records.

The manifest publishes on every push to `main` that touches `src/manifest.ts`, `settingsSchema.json`, `docs/**`, or the caller workflow. 
Environment variables (Vercel): `MAVENAGI_APP_ID` and `MAVENAGI_APP_SECRET`, the app's own credentials. The installer's per-webhook API keys live in each install's settings, where the `apiKey` field is HIDDEN.

## Settings the install form does not show

`src/index.ts` reads two keys that `settingsSchema.json` leaves out because Agent Designer cannot render them:

- `defaultHeaders`: a JSON object (or a JSON string of one) of headers sent with every webhook. A webhook's own `headers` override it key by key.
- `webhooks[].userFormParameters`: an array of `{id, label, description?, required?}`. When it is non-empty, the action is registered with `userInteractionRequired`, Maven asks the user for each field before the call, and the values fill `{{parameters.<id>}}`.

Both can be set only by writing the install's settings through the platform API. An install-form save may drop keys the form does not render, so read the settings back after saving an install that uses them.

Any other top-level settings key is readable as `{{settings.<key>}}`.

## How it runs

- `preInstall` rejects settings with no `webhooks`, or a webhook missing `name`, `url`, `method`, or `triggerMode`, or an `event_trigger` with no `eventType`.
- `postInstall` calls `actions.createOrUpdate` for each `llm_action` webhook and `triggers.createOrUpdate` for each `event_trigger` webhook, both keyed by the webhook name. `uninstall` deletes them by name and only logs a failure.
- `executeAction` matches the action ID to the first `llm_action` webhook with that name.
- Conversation dedup is an in-memory map per serverless instance, keyed by conversation ID with a 5-second window.

## Debugging

The app logs with the prefix `[HTTP Webhook]`. URLs in logs have their query string replaced by `?[REDACTED]`. Only `console.warn` and `console.error` reach Datadog, so request lines (`console.log`) are visible only in Vercel runtime logs for the project above.

A trigger request that fails logs `[HTTP Webhook] Error: <status>` or `Request failed:` and is not retried. An unresolved placeholder logs `Interpolation: No value found for {{<path>}}`.

## Development

`pnpm test` runs the Vitest suites. `tsc --noEmit` fails only in test fixtures (`ActionUser`, `EntityType`, and fetch-mock types); `next build` does not type-check them.
