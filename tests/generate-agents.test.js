"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const {
  CLAUDE_TOOLS,
  PROVIDERS,
  collectStaleness,
  compareOutputs,
  expectedOutputs,
  parseBaseAgent,
  readBaseAgents,
  renderClaude,
  renderCodex,
  tomlGeneratedMarker,
} = require("../scripts/generate-agents.js");

const ROLE_NAMES = [
  "itixo-builder",
  "itixo-docs-updater",
  "itixo-github-issues",
  "itixo-investigator",
  "itixo-planner",
  "itixo-reviewer",
  "itixo-tester",
];

const CAPABILITIES_BY_ROLE = {
  "itixo-builder": ["read", "edit", "write", "grep", "glob", "bash", "skill"],
  "itixo-docs-updater": ["read", "edit", "write", "grep", "glob", "bash", "skill"],
  "itixo-github-issues": ["read", "grep", "glob", "bash", "skill", "github"],
  "itixo-investigator": ["read", "grep", "glob", "bash"],
  "itixo-planner": ["read", "grep", "glob"],
  "itixo-reviewer": ["read", "grep", "bash"],
  "itixo-tester": ["read", "edit", "write", "grep", "glob", "bash", "skill"],
};

const CONTRACT_HEADINGS = [
  "Role",
  "Required input",
  "Responsibilities",
  "Workflow",
  "Tool boundaries",
  "Refusals and escalation",
  "Output contract",
];

const ROLE_SENTINELS = {
  "itixo-builder": ["Refuse vague scope", "destructive Git actions", "push or release actions"],
  "itixo-docs-updater": ["Refuse code, configuration, or test edits", "unsupported claims"],
  "itixo-github-issues": ["Use GitHub connector or MCP first", "Never implement work or mutate repository files", "unverifiable type, label, or hierarchy evidence"],
  "itixo-investigator": ["Never edit or write files", "mutating shell commands", "Refuse edits, fixes, design, test work"],
  "itixo-planner": ["Never run commands, edit or write files", "Refuse implementation, edits, commands, and assumptions"],
  "itixo-reviewer": ["Never edit files, execute tests, run mutating Git commands", "Refuse edits, test execution, mutating Git operations"],
  "itixo-tester": ["without changing production behavior", "Refuse production edits", "never change production code to make tests pass"],
};

const MODEL_FOOTER = "- Last line of every final report: `model: <exact model identifier you run on, from your environment context>`. If identifier is not available, write `model: unknown`.";

function contractBody(text) {
  return text.replace(/^---\n[\s\S]*?\n---\n(?:\n)?/, "").replace(/\n<!-- Generated[\s\S]*?-->\n?$/, "").replace(/^# Itixo-managed[\s\S]*?developer_instructions = \"\"\"\n/, "").replace(/\n\"\"\"\n?$/, "");
}

function capabilityBoundaryPattern(capability) {
  return capability === "skill" ? /caveman:caveman-commit|prescribed skills/i : new RegExp(`\\b${capability}\\b`, "i");
}

function withTemporaryDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "itixo-agents-"));
  try {
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function readFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "Claude agent must have YAML frontmatter");
  return Object.fromEntries(
    match[1].split("\n").map((line) => {
      const separator = line.indexOf(": ");
      return [line.slice(0, separator), line.slice(separator + 2)];
    }),
  );
}

test("parses canonical metadata and normalizes line endings", () => {
  const agent = parseBaseAgent(
    [
      "---",
      "tier: cheap",
      "description: Looks things up.",
      "capabilities: [read, grep]",
      "---",
      "",
      "Canonical body.",
      "",
    ].join("\r\n"),
    "fixture.md",
  );

  assert.deepEqual(agent, {
    tier: "cheap",
    description: "Looks things up.",
    capabilities: ["read", "grep"],
    body: "Canonical body.",
  });
});

test("rejects malformed canonical agent sources", () => {
  const valid = [
    "---",
    "tier: cheap",
    "description: Looks things up.",
    "capabilities: [read, grep]",
    "---",
    "",
    "Canonical body.",
  ];
  const cases = [
    { source: "body only", expected: "expected YAML frontmatter" },
    {
      source: valid.map((line) => line.replace("tier: cheap", "tier: cheap\ntier: mid")).join("\n"),
      expected: "duplicate 'tier'",
    },
    {
      source: valid.filter((line) => !line.startsWith("description:")).join("\n"),
      expected: "missing 'description'",
    },
    { source: valid.join("\n").replace("tier: cheap", "tier: unknown"), expected: "unsupported tier" },
    {
      source: valid.join("\n").replace("capabilities: [read, grep]", "capabilities: read, grep"),
      expected: "capabilities must use",
    },
    {
      source: valid.join("\n").replace("capabilities: [read, grep]", "capabilities: []"),
      expected: "capabilities cannot be empty",
    },
    {
      source: valid.join("\n").replace("capabilities: [read, grep]", "capabilities: [read, fly]"),
      expected: "unsupported capability 'fly'",
    },
    {
      source: valid.join("\n").replace("capabilities: [read, grep]", "capabilities: [read, read]"),
      expected: "capabilities must not repeat",
    },
    {
      source: `${valid.slice(0, 5).join("\n")}\n\n`,
      expected: "body cannot be empty",
    },
  ];

  for (const { source, expected } of cases) {
    assert.throws(() => parseBaseAgent(source, "invalid.md"), new RegExp(expected));
  }
});

test("renders every canonical role into Claude agents and Codex TOML templates", () => {
  const agents = readBaseAgents(ROOT);
  assert.deepEqual(agents.map(({ name }) => name), ROLE_NAMES);

  const outputs = expectedOutputs(agents, ROOT);
  assert.equal(outputs.length, 14);

  for (const { provider, name, path: outputPath, content } of outputs) {
    assert.ok(fs.existsSync(outputPath), `${provider}/${name} output is missing`);
    assert.equal(fs.readFileSync(outputPath, "utf8"), content, `${provider}/${name} output is stale`);
  }
});

test("canonical roles keep structured, capability-scoped contracts", () => {
  const agents = readBaseAgents(ROOT);
  assert.deepEqual(agents.map(({ name }) => name), ROLE_NAMES);

  for (const { name, agent } of agents) {
    assert.deepEqual(agent.capabilities, CAPABILITIES_BY_ROLE[name], `${name}: capability order changed`);

    let previousHeading = -1;
    for (const heading of CONTRACT_HEADINGS) {
      const position = agent.body.indexOf(`## ${heading}`);
      assert.ok(position > previousHeading, `${name}: '${heading}' heading missing or out of order`);
      previousHeading = position;
    }

    const boundaries = agent.body.slice(
      agent.body.indexOf("## Tool boundaries"),
      agent.body.indexOf("## Refusals and escalation"),
    );
    for (const capability of agent.capabilities) {
      assert.match(boundaries, capabilityBoundaryPattern(capability), `${name}: '${capability}' missing from tool boundaries`);
    }
    for (const sentinel of ROLE_SENTINELS[name]) {
      assert.ok(agent.body.includes(sentinel), `${name}: missing contract sentinel '${sentinel}'`);
    }
    assert.equal(agent.body.trimEnd().split("\n").at(-1), MODEL_FOOTER, `${name}: model footer must be final nonblank line`);
  }

  const builder = agents.find(({ name }) => name === "itixo-builder").agent;
  assert.ok(builder.capabilities.includes("bash"));
  assert.doesNotMatch(builder.body, /\b(?:one|1)\s*(?:-|to)?\s*2\s*files?\b/i);
});

test("generated provider bodies retain canonical structured contracts", () => {
  for (const { name, agent } of readBaseAgents(ROOT)) {
    for (const rendered of [renderClaude(name, agent), renderCodex(name, agent)]) {
      const body = contractBody(rendered);
      for (const heading of CONTRACT_HEADINGS) assert.ok(body.includes(`## ${heading}`), `${name}: provider body missing '${heading}'`);
      assert.equal(body.trimEnd().split("\n").at(-1), MODEL_FOOTER, `${name}: provider model footer must be final nonblank line`);
    }
  }
});

test("renders provider model, TOML schema, and tool metadata from each tier", () => {
  for (const { name, agent } of readBaseAgents(ROOT)) {
    const claude = renderClaude(name, agent);
    const codex = renderCodex(name, agent);
    const frontmatter = readFrontmatter(claude);

    assert.equal(frontmatter.name, name);
    assert.equal(frontmatter.model, PROVIDERS.claude.models[agent.tier]);
    assert.equal(
      frontmatter.tools,
      agent.capabilities.map((capability) => CLAUDE_TOOLS[capability]).join(", "),
    );
    assert.match(codex, new RegExp(`^${tomlGeneratedMarker(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
    assert.match(codex, new RegExp(`^name = ${JSON.stringify(name)}$`, "m"));
    assert.match(codex, new RegExp(`^description = ${JSON.stringify(agent.description)}$`, "m"));
    assert.match(codex, /^developer_instructions = """$/m);
    assert.match(codex, /\n"""\n$/);
    if (agent.tier === "orchestrator") {
      assert.doesNotMatch(codex, /^model(?:_reasoning_effort)? =/m);
    } else {
      assert.match(codex, new RegExp(`^model = ${JSON.stringify(PROVIDERS.codex.models[agent.tier])}$`, "m"));
      assert.match(codex, new RegExp(`^model_reasoning_effort = ${JSON.stringify(PROVIDERS.codex.efforts[agent.tier])}$`, "m"));
    }
  }

  const planner = readBaseAgents(ROOT).find(({ name }) => name === "itixo-planner");
  assert.equal(readFrontmatter(renderClaude("itixo-planner", planner.agent)).model, "inherit");
  assert.doesNotMatch(renderCodex("itixo-planner", planner.agent), /^model(?:_reasoning_effort)? =/m);
});

test("escapes TOML multiline instructions safely", () => {
  const agent = parseBaseAgent([
    "---",
    "tier: cheap",
    "description: Quote and slash.",
    "capabilities: [read]",
    "---",
    "",
    "Say \"\"\" then use C:\\\\work.",
  ].join("\n"));
  const codex = renderCodex("itixo-investigator", agent);

  assert.ok(codex.includes(String.raw`Say \"\"\" then use C:\\\\work.`));
});

test("comparison detects stale, missing, and orphan outputs", () => {
  const expected = [
    { path: "/tmp/claude/agent.md", content: "expected Claude" },
    { path: "/tmp/codex/agent.md", content: "expected Codex" },
  ];
  const actual = [
    { path: "/tmp/claude/agent.md", content: "stale Claude" },
    { path: "/tmp/orphan.md", content: "orphan" },
  ];

  assert.deepEqual(compareOutputs(expected, actual), {
    missing: ["/tmp/codex/agent.md"],
    stale: ["/tmp/claude/agent.md"],
    orphan: ["/tmp/orphan.md"],
  });
});

test("filesystem freshness check reports stale, missing, and orphan provider files", () => {
  withTemporaryDirectory((root) => {
    const agents = [
      {
        name: "itixo-investigator",
        agent: parseBaseAgent(
          [
            "---",
            "tier: cheap",
            "description: Read-only code locator.",
            "capabilities: [read]",
            "---",
            "",
            "Find code.",
          ].join("\n"),
        ),
      },
    ];
    const outputs = expectedOutputs(agents, root);
    const claudePath = path.join(root, "plugins/itixo-claude/agents/itixo-investigator.md");
    const orphanPath = path.join(root, "plugins/itixo-codex/templates/agents/orphan.toml");
    const obsoletePath = path.join(root, "plugins/itixo-codex/agents/itixo-investigator.md");
    fs.mkdirSync(path.dirname(claudePath), { recursive: true });
    fs.mkdirSync(path.dirname(orphanPath), { recursive: true });
    fs.mkdirSync(path.dirname(obsoletePath), { recursive: true });
    fs.writeFileSync(claudePath, "stale", "utf8");
    fs.writeFileSync(orphanPath, "orphan", "utf8");
    fs.writeFileSync(obsoletePath, "obsolete", "utf8");

    assert.deepEqual(collectStaleness(outputs, root), {
      missing: ["plugins/itixo-codex/templates/agents/itixo-investigator.toml"],
      stale: ["plugins/itixo-claude/agents/itixo-investigator.md"],
      orphan: [
        "plugins/itixo-codex/agents/itixo-investigator.md",
        "plugins/itixo-codex/templates/agents/orphan.toml",
      ],
    });
  });
});
