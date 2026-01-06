import { brotliCompressSync } from "node:zlib";

type PluginRequestBody = {
  stateId: string;
  eventName: string;
  eventPayload: string;
  command: string;
  authToken: string;
  settings: string;
  ref: string;
  signature: string;
  ubiquityKernelToken?: string;
};

function compressEventPayload(payload: unknown): string {
  const json = JSON.stringify(payload);
  const compressed = brotliCompressSync(Buffer.from(json, "utf8"));
  return Buffer.from(compressed).toString("base64");
}

function parseArgs(args: string[]) {
  const out: Record<string, string> = {};
  for (const arg of args) {
    const idx = arg.indexOf("=");
    if (idx === -1) continue;
    const key = arg.slice(0, idx).trim();
    const value = arg.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

async function githubRequest<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub API request failed: ${res.status} ${res.statusText}\n\n${text}`);
  }

  return JSON.parse(text) as T;
}

const args = parseArgs(process.argv.slice(2));
const url = args.url ?? "http://localhost:4000/";
const eventName = args.eventName ?? "pull_request.opened";

const owner = args.owner ?? "ubiquity-os-marketplace";
const repo = args.repo ?? "daemon-task-matcher";
const prNumber = Number(args.prNumber ?? "1");

const authToken = process.env.GITHUB_TOKEN ?? process.env.PLUGIN_GITHUB_TOKEN;
if (!authToken) {
  throw new Error("Missing GITHUB_TOKEN (or PLUGIN_GITHUB_TOKEN) env var. This token is used for GitHub API calls.");
}

const ubiquityKernelToken = args.ubiquityKernelToken ?? process.env.UBIQUITY_KERNEL_TOKEN;

type PullRequestApiResponse = {
  number: number;
  title: string | null;
  body: string | null;
  head?: { sha?: string | null };
};

const pr = await githubRequest<PullRequestApiResponse>(authToken, `/repos/${owner}/${repo}/pulls/${prNumber}`);

const eventPayload = {
  action: eventName === "pull_request.reopened" ? "reopened" : "opened",
  repository: {
    name: repo,
    owner: { login: owner },
  },
  pull_request: {
    number: prNumber,
    title: args.title ?? pr.title ?? "(missing title)",
    body: args.body ?? pr.body ?? null,
    head: { sha: pr.head?.sha ?? null },
  },
  installation: { id: 1 },
};

const settings = {
  confidenceThreshold: Number(args.confidenceThreshold ?? "0.8"),
  maxSuggestions: Number(args.maxSuggestions ?? "5"),
  requirePriceLabel: (args.requirePriceLabel ?? "true") !== "false",
  maxIssuesPerLlmCall: Number(args.maxIssuesPerLlmCall ?? "40"),
  ...(process.env.OPENROUTER_API_KEY
    ? {
        openRouter: {
          endpoint: process.env.OPENROUTER_ENDPOINT ?? "https://openrouter.ai/api/v1",
          model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
        },
      }
    : {}),
};

const body: PluginRequestBody = {
  stateId: args.stateId ?? "local-dev",
  eventName,
  eventPayload: compressEventPayload(eventPayload),
  command: JSON.stringify(null),
  authToken: args.authToken ?? authToken,
  ...(ubiquityKernelToken ? { ubiquityKernelToken } : {}),
  settings: JSON.stringify(settings),
  ref: args.ref ?? "http://localhost:4000",
  signature: args.signature ?? "local",
};

const res = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify(body),
});

const text = await res.text();
if (!res.ok) {
  throw new Error(`Request failed: ${res.status} ${res.statusText}\n\n${text}`);
}

console.log(text);
