#!/usr/bin/env node
// PreToolUse hook: one-time, non-blocking, conditional guidance when the main thread runs
// investigation-shaped calls (Grep/Glob, or Bash ls/find/grep/rg/tree/fd)
// that Dirigent would delegate to the itixo-investigator subagent.
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
    // (itixo-investigator especially) are allowed to search — never nudge them.
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
          permissionDecisionReason: "itixo optional delegation guidance (non-blocking)",
          additionalContext:
            "[itixo] Investigation-shaped call detected in the main thread. " +
            "When Dirigent is enabled in this chat, delegate codebase location/mapping " +
            "to itixo-investigator (cheap model) and hand file:line results to the next step " +
            "(rules/agents.md). Otherwise Dirigent delegation checks do not apply. " +
            "This reminder fires once per session.",
        },
      }) + "\n"
    );
  } catch {
    // Never block tool use on nudge errors.
  }
  process.exit(0);
});
