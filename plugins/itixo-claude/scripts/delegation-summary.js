#!/usr/bin/env node
// Stop hook: summarize delegation behavior for the session.
// Warns when the orchestrator edited files directly without delegating,
// or ran inline investigation (Grep/Glob/investigation-shaped Bash)
// without ever delegating to the investigator subagent.
//
// Records carry agentId/agentType when the call came from a subagent
// (agent-identity fields in hook input). Orchestrator counts use only
// main-thread records. On older Claude Code versions without these
// fields, falls back to suppressing the investigation warning once an
// investigator delegation exists.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { isInvestigation } = require("./investigation.js");

// Inline investigations tolerated before warning when investigator was never used.
const INVESTIGATION_THRESHOLD = 3;

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const sessionId = event.session_id || "unknown";
    const file = path.join(os.tmpdir(), `itixo-delegation-${sessionId}.jsonl`);
    if (!fs.existsSync(file)) process.exit(0);

    const lines = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const fromSubagent = (r) => Boolean(r.agentId || r.agentType);
    const hasAgentIdentity = lines.some(fromSubagent);
    const orchestratorLines = lines.filter((r) => !fromSubagent(r));

    const delegations = orchestratorLines.filter((r) => r.tool === "Task");
    const directEdits = orchestratorLines.filter((r) => r.tool === "Edit" || r.tool === "Write");
    const investigations = orchestratorLines.filter((r) => isInvestigation(r.tool, { command: r.command }));
    const investigatorRuns = delegations.filter((d) => (d.subagent || "").includes("investigator"));

    // Keep the log so repeated Stop events in one session stay cumulative;
    // tmpdir cleanup handles removal.

    if (directEdits.length > 0 && delegations.length === 0) {
      console.error(
        `[itixo] Delegation check: ${directEdits.length} direct edit(s), 0 delegations this session. ` +
          `Orchestrator should delegate precise steps to subagents (builder/tester/docs-updater). See rules/agents.md.`
      );
    } else if (delegations.length > 0) {
      const bySubagent = {};
      for (const d of delegations) {
        const key = d.subagent || "unknown";
        bySubagent[key] = (bySubagent[key] || 0) + 1;
      }
      const detail = Object.entries(bySubagent)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      console.error(
        `[itixo] Delegation summary: ${delegations.length} delegation(s) (${detail}), ${directEdits.length} direct edit(s).`
      );
    }

    // With agent identity, orchestrator counts are exact — warn on threshold
    // regardless of investigator use. Without it (legacy), subagent calls are
    // indistinguishable, so suppress once an investigator delegation exists.
    const legacySuppressed = !hasAgentIdentity && investigatorRuns.length > 0;
    if (investigations.length >= INVESTIGATION_THRESHOLD && !legacySuppressed) {
      console.error(
        `[itixo] Investigation check: ${investigations.length} inline investigation call(s) ` +
          `(Grep/Glob/ls/find/grep/rg) in the main thread, ${investigatorRuns.length} investigator delegation(s). ` +
          `Read-only codebase mapping is the investigator subagent's job. See rules/agents.md.`
      );
    }
  } catch {
    // Never block session end.
  }
  process.exit(0);
});
