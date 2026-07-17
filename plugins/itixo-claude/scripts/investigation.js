#!/usr/bin/env node
// Shared classifier: is a tool call investigation-shaped (read-only codebase mapping)?
// Used by investigation-nudge.js (PreToolUse) and delegation-summary.js (Stop).
"use strict";

const INVESTIGATION_TOOLS = new Set(["Grep", "Glob"]);
// Bash commands that map or scan the codebase inline.
const INVESTIGATION_BASH = /(^|[\s;|&(])(ls|find|grep|rg|tree|fd)(\s|$)/;

function isInvestigation(toolName, toolInput) {
  if (INVESTIGATION_TOOLS.has(toolName)) return true;
  if (toolName === "Bash") {
    const command = (toolInput && toolInput.command) || "";
    return INVESTIGATION_BASH.test(command);
  }
  return false;
}

module.exports = { INVESTIGATION_BASH, INVESTIGATION_TOOLS, isInvestigation };
