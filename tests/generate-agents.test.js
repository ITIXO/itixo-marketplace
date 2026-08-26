"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const {
  CLAUDE_TOOLS,
  COPILOT_TOOLS,
  PROVIDERS,
  collectStaleness,
  compareOutputs,
  expectedOutputs,
  parseBaseAgent,
  readBaseAgents,
  renderClaude,
  renderCodex,
  renderCopilot,
  tomlGeneratedMarker,
} = require("../scripts/generate-agents.js");

const ROLE_NAMES = [
  "itixo-builder",
  "itixo-docs-updater",
  "itixo-github-issues",
  "itixo-investigator",
  "itixo-planner",
  "itixo-reviewer",
  "itixo-security-reviewer",
  "itixo-tester",
];

const CAPABILITIES_BY_ROLE = {
  "itixo-builder": ["read", "edit", "write", "grep", "glob", "bash", "skill"],
  "itixo-docs-updater": ["read", "edit", "write", "grep", "glob", "bash", "skill"],
  "itixo-github-issues": ["read", "grep", "glob", "bash", "skill", "github"],
  "itixo-investigator": ["read", "grep", "glob", "bash"],
  "itixo-planner": ["read", "grep", "glob", "bash"],
  "itixo-reviewer": ["read", "grep", "bash"],
  "itixo-security-reviewer": ["read", "grep", "bash", "github"],
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
  "itixo-planner": [
    "Never run commands except that end-of-run cleanup, edit or write files",
    "Refuse implementation, edits, commands except the end-of-run cleanup below, and assumptions",
  ],
  "itixo-reviewer": ["Never edit files, execute tests, run mutating Git commands", "Refuse edits, test execution, mutating Git operations"],
  "itixo-security-reviewer": [
    "Never edit, fix, or delegate work.",
    "Report only evidence-backed, actionable security findings. Suppress low-confidence concerns.",
    "Redact secrets, tokens, credentials, and sensitive payloads from all output.",
    "Never install dependencies, mutate files or repository state, run untrusted lifecycle commands, trigger external actions, expose secrets, edit or fix code, or delegate work.",
    "An open PR context is required for publishing.",
    "Without an open PR context, return findings or a clean result only to orchestrator.",
    "An open PR context is required for a review submission.",
    "Without an open PR context, return the review disposition only to orchestrator.",
    "May submit neutral review comments or request changes only in an authorized open PR context.",
    "Never trigger workflows.",
    "Authorized GitHub review submissions in an open PR context are the sole external write exception.",
  ],
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

test("renders every canonical role into Claude agents, Codex TOML templates, and Copilot agents", () => {
  const agents = readBaseAgents(ROOT);
  assert.deepEqual(agents.map(({ name }) => name), ROLE_NAMES);

  const outputs = expectedOutputs(agents, ROOT);
  assert.equal(outputs.length, 24);

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

  const securityReviewer = agents.find(({ name }) => name === "itixo-security-reviewer").agent;
  assert.match(securityReviewer.body, /By default, review the current branch diff from its merge base, staged and unstaged changes, and relevant untracked files\./);
  assert.match(securityReviewer.body, /severity \(`Critical`, `High`, `Medium`, or `Low`\), confidence \(`high` or `medium`\), location, evidence, exploit path or impact, and remediation\./);
  assert.match(securityReviewer.body, /Submit each finding as an inline PR comment when it maps to a changed line; otherwise submit a general PR comment\./);
  assert.match(securityReviewer.body, /Request changes for unresolved Critical or High findings when the review surface supports it; otherwise use a comment, including for self-review\./);
  assert.match(securityReviewer.body, /Use a clean, neutral comment\./);
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

  const securityReviewer = readBaseAgents(ROOT).find(({ name }) => name === "itixo-security-reviewer");
  assert.equal(readFrontmatter(renderClaude("itixo-security-reviewer", securityReviewer.agent)).model, "opus");
  assert.equal(readFrontmatter(renderClaude("itixo-security-reviewer", securityReviewer.agent)).effort, "max");
  assert.match(renderCodex("itixo-security-reviewer", securityReviewer.agent), /^model = "gpt-5\.6-sol"$/m);
  assert.match(renderCodex("itixo-security-reviewer", securityReviewer.agent), /^model_reasoning_effort = "max"$/m);
});

test("renderCopilot produces correct frontmatter for each tier", () => {
  for (const { name, agent } of readBaseAgents(ROOT)) {
    const copilot = renderCopilot(name, agent);
    // must have YAML frontmatter
    assert.match(copilot, /^---\n/);
    assert.match(copilot, /\n---\n/);
    // description required
    assert.match(copilot, /^description: /m);
    // tools required, JSON array format
    assert.match(copilot, /^tools: \[/m);
    // model: orchestrator omits, others present
    if (agent.tier === "orchestrator") {
      assert.doesNotMatch(copilot, /^model:/m);
    } else {
      assert.match(copilot, new RegExp(`^model: ${JSON.stringify(PROVIDERS.copilot.models[agent.tier])}$`, "m"));
    }
    if (agent.tier === "security") {
      assert.match(copilot, /^model: "claude-opus-5"$/m);
      assert.doesNotMatch(copilot, /^effort:/m);
      assert.doesNotMatch(copilot, /^model_reasoning_effort:/m);
    }
    // generated marker present
    assert.ok(copilot.includes(`<!-- Generated from base/agents/${name}.md by scripts/generate-agents.js. Do not edit. -->`));
    // output path uses .agent.md extension
    const outputs = expectedOutputs([{ name, agent }], "/tmp/root");
    const copilotOutput = outputs.find((o) => o.provider === "copilot");
    assert.ok(copilotOutput.path.replace(/\\/g, "/").includes("copilot/itixo/agents/"));
    assert.ok(copilotOutput.path.endsWith(`${name}.agent.md`));
  }
});

test("renderCopilot deduplicates tools mapping to the same alias", () => {
  // grep and glob both map to "search"; write maps to "edit" — each must appear once
  const agent = parseBaseAgent([
    "---",
    "tier: mid",
    "description: Dedup test.",
    "capabilities: [read, edit, write, grep, glob, bash]",
    "---",
    "",
    "Body.",
  ].join("\n"));
  const copilot = renderCopilot("itixo-builder", agent);
  const toolsLine = copilot.match(/^tools: \[(.+)\]$/m)?.[1] ?? "";
  const tools = toolsLine.split(", ").map((t) => t.replace(/"/g, ""));
  assert.deepEqual(tools, ["read", "edit", "search", "execute"]);
});

test("renderCopilot drops null-mapped capabilities (skill)", () => {
  const agent = parseBaseAgent([
    "---",
    "tier: mid",
    "description: Skill drop test.",
    "capabilities: [read, skill]",
    "---",
    "",
    "Body.",
  ].join("\n"));
  const copilot = renderCopilot("itixo-tester", agent);
  assert.doesNotMatch(copilot, /\bnull\b/);
  assert.match(copilot, /^tools: \["read"\]$/m);
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
    const claudePath = path.join(root, "plugins/claude/itixo/agents/itixo-investigator.md");
    const orphanPath = path.join(root, "plugins/codex/itixo/templates/agents/orphan.toml");
    const obsoletePath = path.join(root, "plugins/codex/itixo/agents/itixo-investigator.md");
    fs.mkdirSync(path.dirname(claudePath), { recursive: true });
    fs.mkdirSync(path.dirname(orphanPath), { recursive: true });
    fs.mkdirSync(path.dirname(obsoletePath), { recursive: true });
    fs.writeFileSync(claudePath, "stale", "utf8");
    fs.writeFileSync(orphanPath, "orphan", "utf8");
    fs.writeFileSync(obsoletePath, "obsolete", "utf8");

    const normalizePaths = (s) => {
      const norm = (arr) => arr.map((p) => p.replace(/\\/g, "/"));
      return { missing: norm(s.missing), stale: norm(s.stale), orphan: norm(s.orphan) };
    };
    assert.deepEqual(normalizePaths(collectStaleness(outputs, root)), {
      missing: [
        "plugins/codex/itixo/templates/agents/itixo-investigator.toml",
        "plugins/copilot/itixo/agents/itixo-investigator.agent.md",
      ],
      stale: ["plugins/claude/itixo/agents/itixo-investigator.md"],
      orphan: [
        "plugins/codex/itixo/agents/itixo-investigator.md",
        "plugins/codex/itixo/templates/agents/orphan.toml",
      ],
    });
  });
});
