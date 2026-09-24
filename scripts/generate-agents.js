#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { PROVIDERS: PROVIDER_IDS } = require("./providers.js");
const MODEL_CATALOG = require("../plugins/codex/itixo/scripts/model-catalog.json");

const ROOT = path.resolve(__dirname, "..");
const BASE_DIR = path.join(ROOT, "base", "agents");
const MODEL_ALIASES = catalogAliases(MODEL_CATALOG.aliases);

function catalogAliases(aliases) {
  if (!aliases || typeof aliases !== "object") throw new Error("model catalog: invalid aliases.");
  for (const [name, alias] of Object.entries(aliases)) {
    if (!alias || typeof alias !== "object" || !alias.providers || typeof alias.providers !== "object"
      || Object.keys(alias.providers).length === 0 || (alias.pinned !== undefined && typeof alias.pinned !== "boolean")) {
      throw new Error(`model catalog: invalid alias '${name}'.`);
    }
    for (const [providerId, definition] of Object.entries(alias.providers)) {
      if (!PROVIDER_IDS.includes(providerId) || !definition || typeof definition !== "object"
        || typeof definition.default !== "string" || !Array.isArray(definition.versions)
        || definition.versions.length === 0 || !definition.versions.includes(definition.default)) {
        throw new Error(`model catalog: invalid alias '${name}' for '${providerId}'.`);
      }
    }
  }
  return aliases;
}

function resolveAlias(providerId, alias) {
  const definition = MODEL_ALIASES[alias]?.providers?.[providerId];
  if (!definition) throw new Error(`model catalog: alias '${alias}' is unavailable for '${providerId}'.`);
  return definition;
}

function catalogProvider(id) {
  const provider = MODEL_CATALOG.providers?.[id];
  if (!provider || typeof provider !== "object" || !provider.models || !provider.efforts
    || typeof provider.models !== "object" || typeof provider.efforts !== "object"
    || Object.values(provider.models).some((model) => typeof model !== "string")
    || Object.values(provider.efforts).some((effort) => typeof effort !== "string")) {
    throw new Error(`model catalog: invalid '${id}' provider.`);
  }
  for (const tier of ["cheap", "mid", "security"]) {
    if (!provider.models[tier]) throw new Error(`model catalog: '${id}' has no '${tier}' model.`);
  }
  if (id === "claude") {
    if (provider.models.orchestrator !== "inherit" || !provider.efforts.security) {
      throw new Error("model catalog: invalid Claude orchestrator or security effort.");
    }
  }
  const models = Object.fromEntries(Object.entries(provider.models).map(([tier, alias]) => [
    tier,
    tier === "orchestrator" && alias === "inherit" ? alias : resolveAlias(id, alias).default,
  ]));
  if (id === "codex") {
    if (!provider.effortsByModel || typeof provider.effortsByModel !== "object"
      || Object.values(MODEL_ALIASES).flatMap((alias) => alias.providers.codex?.versions || [])
        .some((model) => !Array.isArray(provider.effortsByModel[model]))
      || ["cheap", "mid", "security"].some((tier) => !provider.effortsByModel[models[tier]].includes(provider.efforts[tier]))) {
      throw new Error("model catalog: invalid Codex model effort.");
    }
    return { ...provider, models };
  } else if (id === "copilot" && Object.keys(provider.efforts).length !== 0) {
    throw new Error("model catalog: Copilot must not declare efforts.");
  }
  return { ...provider, models };
}

const PROVIDER_CONFIG = {
  claude: { ...catalogProvider("claude"), directory: path.join(ROOT, "plugins", "claude", "itixo", "agents") },
  codex: {
    ...catalogProvider("codex"),
    directory: path.join(ROOT, "plugins", "codex", "itixo", "templates", "agents"),
    obsoleteDirectory: path.join(ROOT, "plugins", "codex", "itixo", "agents"),
  },
  copilot: { ...catalogProvider("copilot"), directory: path.join(ROOT, "plugins", "copilot", "itixo", "agents"), fileExtension: ".agent.md" },
};
const PROVIDERS = Object.freeze(
  Object.fromEntries(PROVIDER_IDS.map((id) => [id, PROVIDER_CONFIG[id]]))
);
const CLAUDE_TOOLS = Object.freeze({
  read: "Read",
  edit: "Edit",
  write: "Write",
  grep: "Grep",
  glob: "Glob",
  bash: "Bash",
  skill: "Skill",
  github: "mcp__github__*",
});
// Copilot CLI tool aliases. null = capability has no direct alias; drop from tools list.
// grep and glob both map to "search" — deduplicated in renderCopilot.
// write is an alias of edit — deduplicated.
// skill has no Copilot alias — dropped.
const COPILOT_TOOLS = Object.freeze({
  read: "read",
  edit: "edit",
  write: "edit",
  grep: "search",
  glob: "search",
  bash: "execute",
  skill: null,
  github: "github/*",
});

function normalizeLf(text) {
  return text.replace(/\r\n?/g, "\n");
}

function parseBaseAgent(text, source = "base agent") {
  const normalized = normalizeLf(text);
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n(?:\n)?([\s\S]*)$/);
  if (!match) throw new Error(`${source}: expected YAML frontmatter followed by a body`);

  const fields = Object.create(null);
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([a-z][a-z-]*):\s*(.+)$/);
    if (!field) throw new Error(`${source}: invalid metadata line '${line}'`);
    if (fields[field[1]] !== undefined) throw new Error(`${source}: duplicate '${field[1]}' metadata`);
    fields[field[1]] = field[2];
  }

  for (const key of ["tier", "description", "capabilities"]) {
    if (!fields[key]) throw new Error(`${source}: missing '${key}' metadata`);
  }
  if (!PROVIDERS.claude.models[fields.tier]) {
    throw new Error(`${source}: unsupported tier '${fields.tier}'`);
  }

  const capabilitiesMatch = fields.capabilities.match(/^\[([^\]]*)\]$/);
  if (!capabilitiesMatch) throw new Error(`${source}: capabilities must use [a, b] syntax`);
  const capabilities = capabilitiesMatch[1]
    .split(",")
    .map((capability) => capability.trim())
    .filter(Boolean);
  if (capabilities.length === 0) throw new Error(`${source}: capabilities cannot be empty`);
  for (const capability of capabilities) {
    if (!CLAUDE_TOOLS[capability]) throw new Error(`${source}: unsupported capability '${capability}'`);
  }
  if (new Set(capabilities).size !== capabilities.length) {
    throw new Error(`${source}: capabilities must not repeat`);
  }

  const body = match[2].replace(/\n+$/, "");
  if (!body) throw new Error(`${source}: body cannot be empty`);

  return Object.freeze({
    tier: fields.tier,
    description: fields.description,
    capabilities: Object.freeze(capabilities),
    body,
  });
}

function yamlQuote(value) {
  return JSON.stringify(value);
}

function generatedMarker(name) {
  return `<!-- Generated from base/agents/${name}.md by scripts/generate-agents.js. Do not edit. -->`;
}

function tomlGeneratedMarker(name) {
  return [
    "# Itixo-managed custom agent. Do not edit.",
    `# Generated from base/agents/${name}.md by scripts/generate-agents.js.`,
  ].join("\n");
}

function tomlMultilineBasic(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"""/g, "\\\"\\\"\\\"")
    .replace(/\u0008/g, "\\b")
    .replace(/\t/g, "\\t")
    .replace(/\f/g, "\\f")
    .replace(/\r/g, "\\r");
}

function renderClaude(name, agent) {
  const model = PROVIDERS.claude.models[agent.tier];
  const effort = PROVIDERS.claude.efforts[agent.tier];
  const tools = agent.capabilities.map((capability) => CLAUDE_TOOLS[capability]).join(", ");
  const output = [
    "---",
    `name: ${name}`,
    `description: ${yamlQuote(agent.description)}`,
    `tools: ${tools}`,
    `model: ${model}`,
  ];
  if (effort) output.push(`effort: ${effort}`);
  output.push(
    "---",
    "",
    agent.body,
    "",
    generatedMarker(name),
    "",
  );
  return output.join("\n");
}

function renderCopilot(name, agent) {
  const model = PROVIDERS.copilot.models[agent.tier]; // undefined for orchestrator → omit
  const rawTools = agent.capabilities.map((capability) => COPILOT_TOOLS[capability]).filter(Boolean);
  const tools = [...new Set(rawTools)]; // deduplicate (e.g. grep+glob → search once)
  const lines = [
    "---",
    `description: ${yamlQuote(agent.description)}`,
    `tools: [${tools.map((t) => JSON.stringify(t)).join(", ")}]`,
  ];
  if (model) lines.push(`model: ${JSON.stringify(model)}`);
  lines.push("---", "", agent.body, "", generatedMarker(name), "");
  return lines.join("\n");
}

function renderCodex(name, agent) {
  const model = PROVIDERS.codex.models[agent.tier];
  const output = [
    tomlGeneratedMarker(name),
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(agent.description)}`,
  ];
  if (model) {
    output.push(`model = ${JSON.stringify(model)}`);
    output.push(`model_reasoning_effort = ${JSON.stringify(PROVIDERS.codex.efforts[agent.tier])}`);
  }
  output.push("", 'developer_instructions = """', tomlMultilineBasic(agent.body), '"""', "");
  return output.join("\n");
}

function readBaseAgents(root = ROOT) {
  const baseDirectory = path.join(root, "base", "agents");
  return fs.readdirSync(baseDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.slice(0, -3))
    .sort()
    .map((name) => ({
      name,
      agent: parseBaseAgent(fs.readFileSync(path.join(baseDirectory, `${name}.md`), "utf8"), `base/agents/${name}.md`),
    }));
}

function expectedOutputs(agents, root = ROOT) {
  const outputs = [];
  for (const { name, agent } of agents) {
    outputs.push({ provider: "claude", name, path: path.join(root, "plugins", "claude", "itixo", "agents", `${name}.md`), content: renderClaude(name, agent) });
    outputs.push({ provider: "codex", name, path: path.join(root, "plugins", "codex", "itixo", "templates", "agents", `${name}.toml`), content: renderCodex(name, agent) });
    outputs.push({ provider: "copilot", name, path: path.join(root, "plugins", "copilot", "itixo", "agents", `${name}.agent.md`), content: renderCopilot(name, agent) });
  }
  return outputs;
}

function compareOutputs(expectedOutputs, actualOutputs) {
  const results = { missing: [], stale: [], orphan: [] };
  const expectedByPath = new Map(expectedOutputs.map((output) => [output.path, output.content]));
  const actualByPath = new Map(actualOutputs.map((output) => [output.path, output.content]));

  for (const [outputPath, expectedContent] of expectedByPath) {
    if (!actualByPath.has(outputPath)) {
      results.missing.push(outputPath);
    } else if (actualByPath.get(outputPath) !== expectedContent) {
      results.stale.push(outputPath);
    }
  }
  for (const outputPath of actualByPath.keys()) {
    if (!expectedByPath.has(outputPath)) results.orphan.push(outputPath);
  }

  for (const list of Object.values(results)) list.sort();
  return results;
}

function collectStaleness(outputs, root = ROOT) {
  const actualOutputs = [];
  const directories = [
    { directory: PROVIDERS.claude.directory, extension: ".md" },
    { directory: PROVIDERS.codex.directory, extension: ".toml" },
    { directory: PROVIDERS.codex.obsoleteDirectory, extension: ".md" },
    { directory: PROVIDERS.copilot.directory, extension: ".agent.md" },
  ];
  for (const { directory, extension } of directories) {
    const outputDirectory = path.join(root, path.relative(ROOT, directory));
    if (!fs.existsSync(outputDirectory)) continue;
    for (const entry of fs.readdirSync(outputDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(extension)) continue;
      const candidate = path.join(outputDirectory, entry.name);
      actualOutputs.push({ path: candidate, content: fs.readFileSync(candidate, "utf8") });
    }
  }

  const staleness = compareOutputs(outputs, actualOutputs);
  for (const list of Object.values(staleness)) {
    for (let index = 0; index < list.length; index++) list[index] = path.relative(root, list[index]);
  }
  return staleness;
}

function writeOutputs(outputs, root = ROOT) {
  for (const output of outputs) {
    fs.mkdirSync(path.dirname(output.path), { recursive: true });
    if (!fs.existsSync(output.path) || fs.readFileSync(output.path, "utf8") !== output.content) {
      fs.writeFileSync(output.path, output.content, "utf8");
    }
  }
  const staleness = collectStaleness(outputs, root);
  for (const relativePath of staleness.orphan) fs.unlinkSync(path.join(root, relativePath));
}

function reportStaleness(staleness) {
  for (const [kind, paths] of Object.entries(staleness)) {
    if (paths.length === 0) continue;
    console.error(`${kind}:`);
    for (const relativePath of paths) console.error(`  ${relativePath}`);
  }
}

function main(argv = process.argv.slice(2)) {
  const check = argv.length === 1 && argv[0] === "--check";
  if (!check && argv.length > 0) {
    console.error("Usage: node scripts/generate-agents.js [--check]");
    return 2;
  }

  const agents = readBaseAgents();
  const outputs = expectedOutputs(agents);
  if (check) {
    const staleness = collectStaleness(outputs);
    if (staleness.missing.length || staleness.stale.length || staleness.orphan.length) {
      reportStaleness(staleness);
      return 1;
    }
    console.log(`Agent files current (${agents.length} roles, ${outputs.length} outputs).`);
    return 0;
  }

  writeOutputs(outputs);
  console.log(`Generated ${outputs.length} agent files from ${agents.length} canonical roles.`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  CLAUDE_TOOLS,
  COPILOT_TOOLS,
  PROVIDERS,
  compareOutputs,
  collectStaleness,
  expectedOutputs,
  generatedMarker,
  main,
  normalizeLf,
  parseBaseAgent,
  readBaseAgents,
  renderClaude,
  renderCodex,
  renderCopilot,
  tomlGeneratedMarker,
  tomlMultilineBasic,
  writeOutputs,
};
