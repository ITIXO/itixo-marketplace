#!/usr/bin/env node
// PreToolUse hook: one-time, non-blocking nudge when the orchestrator runs
// investigation-shaped calls (Grep/Glob, or Bash ls/find/grep/rg/tree/fd)
// instead of delegating read-only mapping to the investigator subagent.
// Fires once per session, only in the main thread. Never blocks the call.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { isInvestigation } = require("./investigation.js");

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    // Hooks fired inside a subagent carry agent_id/agent_type. Subagents
    // (investigator especially) are allowed to search — never nudge them.
    if (event.agent_id || event.agent_type) process.exit(0);
    if (!isInvestigation(event.tool_name, event.tool_input)) process.exit(0);

    const sessionId = event.session_id || "unknown";
    const flag = path.join(os.tmpdir(), `itixo-investigation-nudge-${sessionId}.flag`);
    if (fs.existsSync(flag)) process.exit(0);
    fs.writeFileSync(flag, String(Date.now()), "utf8");

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "itixo delegation nudge (non-blocking)",
          additionalContext:
            "[itixo] Investigation-shaped call detected in the main thread. " +
            "Rule (rules/agents.md): the orchestrator does NOT run ls/find/grep/glob " +
            "to map the codebase — read-only mapping IS the investigator subagent's job. " +
            "Delegate location/mapping work to investigator (cheap model) and hand " +
            "file:line results to the next step. This reminder fires once per session.",
        },
      }) + "\n"
    );
  } catch {
    // Never block tool use on nudge errors.
  }
  process.exit(0);
});
