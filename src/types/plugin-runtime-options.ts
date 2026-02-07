import type { Options } from "@ubiquity-os/plugin-sdk";
import { envSchema } from "./env";
import { pluginSettingsSchema } from "./plugin-input";

// The SDK schema option types are broader than our inferred TypeBox schema types.
// Keep this cast in one shared place so action/worker stay consistent.
export const pluginRuntimeSchemas = {
  settingsSchema: pluginSettingsSchema as unknown as Options["settingsSchema"],
  envSchema: envSchema as unknown as Options["envSchema"],
};
