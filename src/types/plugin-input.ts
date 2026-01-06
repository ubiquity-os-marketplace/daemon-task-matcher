import { StaticDecode, Type as T } from "@sinclair/typebox";

/**
 * This should contain the properties of the bot config
 * that are required for the plugin to function.
 *
 * The kernel will extract those and pass them to the plugin,
 * which are built into the context object from setup().
 */
export const pluginSettingsSchema = T.Object(
  {
    confidenceThreshold: T.Number({ default: 0.8, minimum: 0, maximum: 1 }),
    maxSuggestions: T.Integer({ default: 5, minimum: 1, maximum: 20 }),
    requirePriceLabel: T.Boolean({ default: true }),
    maxIssuesPerLlmCall: T.Integer({ default: 20, minimum: 5, maximum: 200 }),
    openRouter: T.Optional(
      T.Object({
        endpoint: T.String({ minLength: 1 }),
        model: T.String({ minLength: 1 }),
      })
    ),
  },
  { default: {} }
);

export type PluginSettings = StaticDecode<typeof pluginSettingsSchema>;
