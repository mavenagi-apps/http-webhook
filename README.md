# HTTP Webhook

A Maven app that sends HTTP requests to external endpoints, either as agent actions or on Maven events.

- Customer docs: [`docs/public`](docs/public), published to docs.mavenagi.com with the overview generated from [`src/manifest.ts`](src/manifest.ts).
- Operations: [`docs/private/operations.md`](docs/private/operations.md).
- The install form is [`settingsSchema.json`](settingsSchema.json), which the manifest imports.

## Development

```bash
pnpm install
pnpm test
pnpm build
```

A push to `main` that changes the manifest, `settingsSchema.json`, or `docs/` republishes the app record and its docs through `.github/workflows/publish-manifest.yml`.
