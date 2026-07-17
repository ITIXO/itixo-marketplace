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
} = require("../scripts/generate-agents.js");

const ROLE_NAMES = [
  "builder",
  "docs-updater",
  "github-issues",
  "investigator",
  "planner",
  "reviewer",
  "tester",
];

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

test("renders every canonical role into both provider targets", () => {
  const agents = readBaseAgents(ROOT);
  assert.deepEqual(agents.map(({ name }) => name), ROLE_NAMES);

  const outputs = expectedOutputs(agents, ROOT);
  assert.equal(outputs.length, 14);

  for (const { provider, name, path: outputPath, content } of outputs) {
    assert.ok(fs.existsSync(outputPath), `${provider}/${name} output is missing`);
    assert.equal(fs.readFileSync(outputPath, "utf8"), content, `${provider}/${name} output is stale`);
  }
});

test("renders provider model, header, and tool metadata from each tier", () => {
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
    assert.match(codex, new RegExp(`^# ${name} — model: ${PROVIDERS.codex.models[agent.tier]}$`, "m"));
  }

  const planner = readBaseAgents(ROOT).find(({ name }) => name === "planner");
  assert.equal(readFrontmatter(renderClaude("planner", planner.agent)).model, "inherit");
  assert.match(renderCodex("planner", planner.agent), /^# planner — model: user-selected$/m);
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
        name: "investigator",
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
    const claudePath = path.join(root, "plugins/itixo-claude/agents/investigator.md");
    const orphanPath = path.join(root, "plugins/itixo-codex/agents/orphan.md");
    fs.mkdirSync(path.dirname(claudePath), { recursive: true });
    fs.mkdirSync(path.dirname(orphanPath), { recursive: true });
    fs.writeFileSync(claudePath, "stale", "utf8");
    fs.writeFileSync(orphanPath, "orphan", "utf8");

    assert.deepEqual(collectStaleness(outputs, root), {
      missing: ["plugins/itixo-codex/agents/investigator.md"],
      stale: ["plugins/itixo-claude/agents/investigator.md"],
      orphan: ["plugins/itixo-codex/agents/orphan.md"],
    });
  });
});
