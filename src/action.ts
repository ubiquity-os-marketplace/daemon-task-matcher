import { createActionsPlugin, Options } from "@ubiquity-os/plugin-sdk";
import { LOG_LEVEL, LogLevel } from "@ubiquity-os/ubiquity-os-logger";
import { runPlugin } from "./index";
import { Env, envSchema, PluginSettings, pluginSettingsSchema, SupportedEvents } from "./types/index";

export default createActionsPlugin<PluginSettings, Env, null, SupportedEvents>(
  (context) => {
    return runPlugin(context);
  },
  {
    logLevel: (process.env.LOG_LEVEL as LogLevel) || LOG_LEVEL.INFO,
    settingsSchema: pluginSettingsSchema as unknown as Options["settingsSchema"],
    envSchema: envSchema as unknown as Options["envSchema"],
    ...(process.env.KERNEL_PUBLIC_KEY && { kernelPublicKey: process.env.KERNEL_PUBLIC_KEY }),
    postCommentOnError: true,
    bypassSignatureVerification: process.env.NODE_ENV === "local",
  }
);
