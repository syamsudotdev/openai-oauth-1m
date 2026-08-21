import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(homedir(), ".config/opencode/openai-oauth-1m.json");
const MAX_CONTEXT = 1_050_000;
const MODEL_IDS = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];

function reportConfigurationError() {
  console.error("openai-oauth-1m: invalid configuration");
}

function parseContext(content) {
  let config;

  try {
    config = JSON.parse(content);
  } catch {
    return null;
  }

  if (
    config === null ||
    Array.isArray(config) ||
    typeof config !== "object" ||
    Object.keys(config).length !== 1 ||
    !Object.hasOwn(config, "context") ||
    !Number.isInteger(config.context) ||
    config.context < 0 ||
    config.context > MAX_CONTEXT
  ) {
    return null;
  }

  return config.context;
}

async function loadContext() {
  let content;

  try {
    content = await readFile(CONFIG_PATH, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    reportConfigurationError();
    return null;
  }

  const context = parseContext(content);
  if (context === null) reportConfigurationError();
  return context;
}

export default async function () {
  const context = await loadContext();

  return {
    provider: {
      id: "openai",
      async models(provider) {
        if (!context) return provider.models;

        const targets = MODEL_IDS.map((id) => [id, provider.models[id]]).filter(
          ([, model]) => model !== undefined,
        );

        if (
          targets.some(([, model]) => {
            const output = model?.limit?.output;
            return (
              !Number.isSafeInteger(output) || output < 0 || context <= output
            );
          })
        ) {
          reportConfigurationError();
          return provider.models;
        }

        for (const [id, model] of targets) {
          const { limit } = model;
          const input = context - limit.output;

          if (limit.context >= context && limit.input >= input) continue;

          provider.models[id] = {
            ...model,
            limit: {
              ...limit,
              context: Math.max(limit.context ?? 0, context),
              input: Math.max(limit.input ?? 0, input),
            },
          };
        }

        return provider.models;
      },
    },
  };
}
