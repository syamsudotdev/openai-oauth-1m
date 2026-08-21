import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = fileURLToPath(new URL(".", import.meta.url));
const PLUGIN_URL = new URL("./openai-oauth-1m.js", import.meta.url).href;
const CONFIG_FILE = ".config/opencode/openai-oauth-1m.json";
const RUNNER = `
  import plugin from ${JSON.stringify(PLUGIN_URL)}

  const provider = JSON.parse(process.env.PROVIDER)
  const originals = Object.fromEntries(
    Object.entries(provider.models).map(([id, model]) => [id, { model, limit: model?.limit }]),
  )
  const errors = []
  const originalError = console.error
  let result

  console.error = (message) => errors.push(message)
  try {
    const hooks = await plugin()
    result = await hooks.provider.models(provider)
  } finally {
    console.error = originalError
  }

  process.stdout.write(JSON.stringify({
    errors,
    models: provider.models,
    returnedModels: result === provider.models,
    references: Object.fromEntries(
      Object.keys(provider.models).map((id) => [id, {
        model: provider.models[id] === originals[id]?.model,
        limit: provider.models[id]?.limit === originals[id]?.limit,
      }]),
    ),
  }))
`;

function providerWithTargets(overrides = {}) {
  return {
    models: {
      "gpt-5.6-sol": {
        name: "Sol",
        capabilities: { tools: true },
        limit: {
          context: 500_000,
          input: 400_000,
          output: 128_000,
          custom: "sol",
        },
      },
      "gpt-5.6-terra": {
        name: "Terra",
        limit: {
          context: 500_000,
          input: 400_000,
          output: 200_000,
          custom: "terra",
        },
      },
      "gpt-5.6-luna": {
        name: "Luna",
        limit: {
          context: 500_000,
          input: 400_000,
          output: 300_000,
          custom: "luna",
        },
      },
      unrelated: {
        name: "Unrelated",
        limit: { context: 1, input: 1, output: 1 },
      },
      ...overrides,
    },
  };
}

async function run({ config, provider = providerWithTargets() }) {
  const home = await mkdtemp(join(PLUGIN_DIR, ".test-home-"));

  try {
    if (config !== undefined) {
      const path = join(home, CONFIG_FILE);
      await mkdir(join(home, ".config", "opencode"), { recursive: true });
      await writeFile(path, config);
    }

    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", RUNNER],
      {
        env: { ...process.env, HOME: home, PROVIDER: JSON.stringify(provider) },
        encoding: "utf8",
      },
    );

    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function assertUnchanged(
  result,
  ids = Object.keys(providerWithTargets().models),
) {
  assert.deepEqual(result.errors, ["openai-oauth-1m: invalid configuration"]);
  assert.equal(result.returnedModels, true);
  for (const id of ids) {
    assert.equal(result.references[id].model, true, `${id} model changed`);
    assert.equal(result.references[id].limit, true, `${id} limit changed`);
  }
}

test("missing configuration is a silent no-op", async () => {
  const result = await run({});

  assert.deepEqual(result.errors, []);
  for (const reference of Object.values(result.references)) {
    assert.equal(reference.model, true);
    assert.equal(reference.limit, true);
  }
});

test("malformed configuration is rejected", async () => {
  assertUnchanged(await run({ config: "{not json" }));
});

test("the strict configuration schema rejects invalid values", async () => {
  for (const config of [
    "null",
    "[]",
    "{}",
    '{"context":"100"}',
    '{"context":1.5}',
    '{"context":-1}',
    '{"context":1,"extra":true}',
  ]) {
    assertUnchanged(await run({ config }));
  }
});

test("context zero is a silent disabled no-op", async () => {
  const result = await run({ config: '{"context":0}' });

  assert.deepEqual(result.errors, []);
  for (const reference of Object.values(result.references)) {
    assert.equal(reference.model, true);
    assert.equal(reference.limit, true);
  }
});

test("a valid context updates all target models and preserves other fields", async () => {
  const result = await run({ config: '{"context":1000000}' });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.models["gpt-5.6-sol"], {
    name: "Sol",
    capabilities: { tools: true },
    limit: {
      context: 1_000_000,
      input: 872_000,
      output: 128_000,
      custom: "sol",
    },
  });
  assert.deepEqual(result.models["gpt-5.6-terra"].limit, {
    context: 1_000_000,
    input: 800_000,
    output: 200_000,
    custom: "terra",
  });
  assert.deepEqual(result.models["gpt-5.6-luna"].limit, {
    context: 1_000_000,
    input: 700_000,
    output: 300_000,
    custom: "luna",
  });
  assert.equal(result.references.unrelated.model, true);
  assert.equal(result.references.unrelated.limit, true);
});

test("contexts above the maximum are rejected", async () => {
  assertUnchanged(await run({ config: '{"context":1050001}' }));
});

test("a context at or below output rejects all target changes", async () => {
  assertUnchanged(await run({ config: '{"context":128000}' }));
});

test("a missing output limit rejects all target changes", async () => {
  const provider = providerWithTargets({
    "gpt-5.6-luna": { limit: { context: 500_000, input: 400_000 } },
  });

  assertUnchanged(await run({ config: '{"context":1000000}', provider }));
});

test("equal or greater existing limits preserve each target object", async () => {
  const provider = providerWithTargets({
    "gpt-5.6-sol": {
      limit: { context: 1_000_000, input: 872_000, output: 128_000 },
    },
    "gpt-5.6-terra": {
      limit: { context: 1_000_001, input: 800_001, output: 200_000 },
    },
    "gpt-5.6-luna": {
      limit: { context: 1_000_002, input: 700_002, output: 300_000 },
    },
  });
  const result = await run({ config: '{"context":1000000}', provider });

  assert.deepEqual(result.errors, []);
  for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
    assert.equal(result.references[id].model, true);
    assert.equal(result.references[id].limit, true);
  }
});

test("absent target models are ignored", async () => {
  const provider = providerWithTargets();
  delete provider.models["gpt-5.6-terra"];
  const result = await run({ config: '{"context":1000000}', provider });

  assert.deepEqual(result.errors, []);
  assert.equal(result.models["gpt-5.6-terra"], undefined);
  assert.equal(result.references["gpt-5.6-sol"].model, false);
  assert.equal(result.references["gpt-5.6-luna"].model, false);
});
