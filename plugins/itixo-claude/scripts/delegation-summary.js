#!/usr/bin/env node
// Stop hook: summarize delegation behavior for the session.
// Warns when the orchestrator edited files directly without delegating.

const fs = require("fs");
const os = require("os");
const path = require("path");

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

    const delegations = lines.filter((r) => r.tool === "Task");
    const directEdits = lines.filter((r) => r.tool === "Edit" || r.tool === "Write");

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
  } catch {
    // Never block session end.
  }
  process.exit(0);
});
