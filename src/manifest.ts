import settingsSchema from "../settingsSchema.json";

// `defaultHeaders` and `webhooks[].userFormParameters` stay out of settingsSchema.json: Agent Designer
// cannot render them. src/index.ts still reads both.
export const manifest = {
  schemaVersion: 4,

  organizationId: "mavenagi-apps",

  documentation: { public: "docs/public", private: "docs/private" },

  targets: {
    main: { appId: "http-webhook", branch: "main", visibility: "PUBLIC" },
  },

  name: "HTTP Webhook",
  shortDescription: "Send HTTP requests to external endpoints",
  description: {
    long: "Send HTTP requests to external endpoints from your Maven agent. Configure webhooks that fire when the agent decides to take an action, or automatically when Maven events occur.",
    features: [
      {
        title: "Agent actions",
        description:
          "A webhook in `llm_action` mode becomes an action named after the webhook. The agent calls it when the webhook's description fits the conversation and receives the endpoint's response.",
      },
      {
        title: "Event triggers",
        description:
          "A webhook in `event_trigger` mode fires on its own when feedback, a conversation, an event, or an inbox item is created.",
      },
      {
        title: "Templated requests",
        description:
          "The URL, headers, and body accept `{{variable}}` placeholders filled from the user, the conversation, the feedback, or the webhook's own API key.",
      },
      {
        title: "Per-webhook API key",
        description:
          "Each webhook stores its own API key, hidden after saving, and inserts it wherever `{{webhook.apiKey}}` appears.",
      },
    ],
  },

  categories: ["COMMUNICATION"],

  installation: {
    prerequisites: [
      {
        title: "A public endpoint",
        description:
          "Each webhook calls a URL reachable from the internet, preferably over HTTPS. URLs whose host is `localhost` or a private IPv4 address are refused.",
      },
    ],
    steps: [
      {
        title: "Add a webhook",
        description:
          "Give it a unique name, a trigger mode, the URL, and the HTTP method. For `event_trigger`, also pick the event type.",
      },
      {
        title: "Describe it",
        description:
          "For an agent action, write a description that tells the agent when to call it. A default naming the URL is used if you leave it blank.",
      },
      {
        title: "Add authentication and a body",
        description:
          "Store the endpoint's key in API Key, reference it as `{{webhook.apiKey}}` in Headers (a JSON object), and write the Body Template with `{{variable}}` placeholders.",
      },
      {
        title: "Install",
        description:
          "Installing registers an action for each `llm_action` webhook and a trigger for each `event_trigger` webhook, each named after its webhook.",
      },
    ],
    postInstallInstructions:
      "Test each webhook against a request inspector such as [webhook.site](https://webhook.site) before pointing it at a real endpoint, with a placeholder API Key while it points at the inspector. For an agent action, ask the agent to do what the description says; for an event trigger, cause the event, such as leaving feedback.\n\nThe placeholders each trigger mode supports, and how requests are sent, are in the [HTTP Webhook docs](https://docs.mavenagi.com/integrations/app-directory/http-webhook/docs/templates).",
  },

  settingsSchema,
};
