#!/usr/bin/env node
// PostToolUse hook: append tool usage to a per-session log.
// Used by delegation-summary.js at session end.

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
    const record = {
      tool: event.tool_name,
      // For Task calls capture which subagent + model was requested.
      subagent: event.tool_input && event.tool_input.subagent_type,
      model: event.tool_input && event.tool_input.model,
      file: event.tool_input && event.tool_input.file_path,
      ts: Date.now(),
    };
    fs.appendFileSync(file, JSON.stringify(record) + "\n");
  } catch {
    // Never block the session on logging errors.
  }
  process.exit(0);
});
