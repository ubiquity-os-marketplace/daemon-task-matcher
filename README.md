# `@ubiquity-os/daemon-task-matcher`

The purpose of this plugin is to match issues against pull-requests. It will suggest a list of different issues that
would be a good fit, and the user can select 1 or more that will get linked.

## Prerequisites

- copy the `.env.example` to `.env` and populate the required values

## Getting Started

1. `bun install`
2. `NODE_ENV=local bun run dev:bun`

## Local Testing

### Send a test event (POST)

The local server accepts the same request body shape the Ubiquity kernel sends.

1. Start the plugin:

- `NODE_ENV=local bun run dev:bun`

2. In another terminal, send a `pull_request.opened` event:

- `GITHUB_TOKEN=... bun scripts/post-event.ts`

Notes:

- `NODE_ENV=local` enables signature bypass for local development.
- The request payload uses a Brotli+base64 `eventPayload`, matching the plugin SDK input schema.

### Optional e2e (real GitHub data)

If you want to test against a real repository, you can use [Meniole/daemon-task-matcher](https://github.com/Meniole/daemon-task-matcher) and `gh`.

- Create a PR in that repo that should match an existing priced issue.
- Trigger the plugin via your Ubiquity setup (or by sending the kernel-shaped POST to your local server).
- Useful `gh` commands for quick iteration:
  - `gh repo clone Meniole/daemon-task-matcher`
  - `gh pr create --fill`
  - `gh pr view --json number,title,body,headRefName`
  - `gh pr diff`
  - `gh issue list --state open --json number,title,labels`

## Configuration

```yml
plugins:
  http://localhost:4000:
    with:
      confidenceThreshold: 0.5
      maxSuggestions: 5
      requirePriceLabel: true
      maxIssuesPerLlmCall: 40
      # optional: use OpenRouter via OpenAI SDK instead of callLlm
      openRouter:
        endpoint: "https://openrouter.ai/api/v1"
        model: "openai/gpt-4o-mini"
```
