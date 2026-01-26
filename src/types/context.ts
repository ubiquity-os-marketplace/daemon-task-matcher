import { Context as PluginContext } from "@ubiquity-os/plugin-sdk";
import { Env } from "./env";
import { PluginSettings } from "./plugin-input";

/**
 * Update `manifest.json` with any events you want to support like so:
 *
 * ubiquity:listeners: ["pull_request.opened", ...]
 */
export type SupportedEvents = "pull_request.opened" | "pull_request.reopened" | "issue_comment.edited";

export type Context<T extends SupportedEvents = SupportedEvents> = PluginContext<PluginSettings, Env, null, T>;
