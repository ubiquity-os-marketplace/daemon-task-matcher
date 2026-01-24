import { CommentHandler, type Context as PluginContext } from "@ubiquity-os/plugin-sdk";
import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import { runPlugin } from "../src/index";
import type { Env, PluginSettings, SupportedEvents } from "../src/types/index";

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

const args = parseArgs(process.argv.slice(2));

const token = process.env.GITHUB_TOKEN ?? process.env.PLUGIN_GITHUB_TOKEN;
if (!token) {
  throw new Error("Missing GITHUB_TOKEN (or PLUGIN_GITHUB_TOKEN) env var.");
}

const ubiquityKernelToken = args.ubiquityKernelToken ?? process.env.UBIQUITY_KERNEL_TOKEN ?? null;

const owner = args.owner ?? "Meniole";
const repo = args.repo ?? "daemon-task-matcher";
const prNumber = Number(args.prNumber ?? "2");
const eventName = (args.eventName ?? "pull_request.reopened") as SupportedEvents;

const octokit = new customOctokit({ auth: token });

const pr = await octokit.rest.pulls.get({
  owner,
  repo,
  pull_number: prNumber,
});

const openRouterEndpoint = process.env.OPENROUTER_ENDPOINT ?? "https://openrouter.ai/api/v1";
const openRouterModel = process.env.OPENROUTER_MODEL ?? "xiaomi/mimo-v2-flash:free";

const config: PluginSettings = {
  confidenceThreshold: Number(args.confidenceThreshold ?? "0.8"),
  maxSuggestions: Number(args.maxSuggestions ?? "5"),
  requirePriceLabel: (args.requirePriceLabel ?? "true") !== "false",
  maxIssuesPerLlmCall: Number(args.maxIssuesPerLlmCall ?? "40"),
  ...(process.env.OPENROUTER_API_KEY
    ? {
        openRouter: {
          endpoint: openRouterEndpoint,
          model: openRouterModel,
        },
      }
    : {}),
};

const env: Env = {
  ...(process.env.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY } : {}),
  ...(process.env.KERNEL_PUBLIC_KEY ? { KERNEL_PUBLIC_KEY: process.env.KERNEL_PUBLIC_KEY } : {}),
  ...(process.env.LOG_LEVEL ? { LOG_LEVEL: process.env.LOG_LEVEL as Env["LOG_LEVEL"] } : {}),
};

const context: PluginContext<PluginSettings, Env, null, SupportedEvents> = {
  eventName,
  payload: {
    action: eventName === "pull_request.reopened" ? "reopened" : "opened",
    repository: {
      name: repo,
      owner: { login: owner },
    },
    pull_request: {
      number: prNumber,
      title: pr.data.title ?? "(missing title)",
      body: pr.data.body ?? null,
      head: { sha: pr.data.head?.sha ?? null },
    },
    installation: { id: 1 },
  } as unknown as PluginContext<PluginSettings, Env, null, SupportedEvents>["payload"],
  command: null,
  authToken: token,
  ubiquityKernelToken,
  octokit,
  config,
  env,
  logger: new Logs((process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ?? "info"),
  commentHandler: new CommentHandler(),
};

await runPlugin(context);
