import { LOG_LEVEL, LogLevel } from "@ubiquity-os/ubiquity-os-logger";
import { createPlugin } from "@ubiquity-os/plugin-sdk";
import { Manifest } from "@ubiquity-os/plugin-sdk/manifest";
import { ExecutionContext } from "hono";
import manifest from "../manifest.json" with { type: "json" };
import { runPlugin } from "./index";
import { pluginRuntimeSchemas } from "./types/plugin-runtime-options";
import { Env, PluginSettings, SupportedEvents } from "./types/index";

export default {
  async fetch(request: Request, env: Env, executionCtx?: ExecutionContext) {
    return createPlugin<PluginSettings, Env, null, SupportedEvents>(
      (context) => {
        return runPlugin(context);
      },
      manifest as Manifest,
      {
        postCommentOnError: true,
        ...pluginRuntimeSchemas,
        // Keep a direct settingsSchema key until all environments run a spread-aware manifest tool build.
        settingsSchema: pluginRuntimeSchemas.settingsSchema,
        logLevel: (env.LOG_LEVEL as LogLevel) || LOG_LEVEL.INFO,
        kernelPublicKey: env.KERNEL_PUBLIC_KEY,
        bypassSignatureVerification: process.env.NODE_ENV === "local",
      }
    ).fetch(request, env, executionCtx);
  },
};
