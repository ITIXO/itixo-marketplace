#!/usr/bin/env node
// Shared Dirigent hook runtime. Copy this file unchanged to every provider package.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const providers = new Set(["claude", "codex", "copilot"]);
const events = { "session-start": "SessionStart", "user-prompt-submit": "UserPromptSubmit", "subagent-start": "SubagentStart" };

function stateDir(provider, override) {
  if (!providers.has(provider)) throw Error("invalid provider");
  if (override) return path.resolve(override);
  const data = provider === "claude" ? process.env.CLAUDE_PLUGIN_DATA : provider === "codex" ? process.env.PLUGIN_DATA : process.env.COPILOT_PLUGIN_DATA;
  if (data) return path.join(data, "dirigent", provider);
  const home = provider === "claude" ? (process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"))
    : provider === "codex" ? (process.env.CODEX_HOME || path.join(os.homedir(), ".codex"))
      : (process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"));
  return path.join(home, "itixo", "dirigent", provider);
}

function paths(provider, sessionId, override) {
  if (typeof sessionId !== "string" || !sessionId.trim()) throw Error("session ID required");
  const dir = stateDir(provider, override);
  return { dir, global: path.join(dir, "default.json"), session: path.join(dir, `session-${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`) };
}

function readEnabled(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof data.enabled === "boolean" ? data.enabled : false;
  } catch { return false; }
}

function writeEnabled(file, enabled) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ enabled }) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp);
  }
  if (readEnabled(file) !== enabled) throw Error(`state readback failed: ${file}`);
}

function isEnabled(provider, sessionId, override) {
  try { return readEnabled(paths(provider, sessionId, override).session); }
  catch { return false; }
}

function ensureSession(provider, sessionId, override) {
  const p = paths(provider, sessionId, override);
  if (!fs.existsSync(p.session)) writeEnabled(p.session, readEnabled(p.global));
  return { enabled: readEnabled(p.session), stateDir: p.dir };
}

function setMode(provider, sessionId, enabled, global, override) {
  const p = paths(provider, sessionId, override);
  writeEnabled(p.session, enabled);
  if (global) writeEnabled(p.global, enabled);
  return { provider, sessionId, enabled, global, stateDir: p.dir };
}

function parseToggle(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/[.!?]+$/, "").trim();
  const slash = text.match(/^[/$](?:(?:itixo:)?dirigent)(?:\s+(on|off))?(?:\s+(--global))?$/i);
  if (slash) return { enabled: slash[1] !== "off", global: Boolean(slash[2]) };
  const natural = text.match(/^(?:please\s+|(?:can|could|would)\s+you\s+)?(turn\s+(on|off)\s+dirigent|turn\s+dirigent\s+(on|off)|(?:enable|disable|start|stop|use)\s+dirigent)(?:\s+(globally|for\s+(?:all\s+)?future\s+sessions|for\s+futur(?:e)?\s+use))?(?:\s+please)?$/i);
  if (!natural) return null;
  const enabled = natural[2] ? natural[2].toLowerCase() === "on" : natural[3] ? natural[3].toLowerCase() === "on" : /^(?:enable|start|use)\b/i.test(natural[1]);
  return { enabled, global: Boolean(natural[4]) };
}

// Claude's Bash tool uses Git Bash on Windows; Codex and Copilot use PowerShell there.
function usesPowerShell(provider) {
  return process.platform === "win32" && provider !== "claude";
}

function quoteShell(value, powerShell) {
  const str = String(value);
  return powerShell ? `'${str.replaceAll("'", "''")}'` : `'${str.replaceAll("'", "'\\''")}'`;
}

function helper(provider, sessionId, dir) {
  const powerShell = usesPowerShell(provider);
  const args = [process.execPath, __filename, provider, "set", "on", "--session", sessionId, "--state-dir", dir];
  return (powerShell ? "& " : "") + args.map((arg) => quoteShell(arg, powerShell)).join(" ");
}

function rootContext(provider, sessionId, enabled, dir) {
  const rulesDir = path.join(path.dirname(__dirname), "rules");
  const control = `Dirigent ${enabled ? "ON" : "OFF"} for this chat. Session ID: ${sessionId}. State directory: ${dir}. Manual control: ${helper(provider, sessionId, dir)} (replace on with off; add --global to save for future sessions). The latest chat toggle wins. After a manual enable, read ${path.join(rulesDir, "agents.md")} before task work. Independent repository instructions still apply.`;
  if (!enabled) return control;
  // Rules are inlined; keep them under Claude's 10,000-char hook cap (tests enforce).
  const rulesText = fs.readFileSync(path.join(rulesDir, "agents.md"), "utf8");
  return `${control}\n\nDirigent is enabled. Apply these rules while enabled (rules directory: ${rulesDir}):\n\n${rulesText}`;
}

function output(provider, event, context) {
  if (!context || (provider === "copilot" && event === "user-prompt-submit")) return;
  const result = provider === "copilot" ? { additionalContext: context }
    : { hookSpecificOutput: { hookEventName: events[event], additionalContext: context } };
  process.stdout.write(JSON.stringify(result) + "\n");
}

function runHook(provider, event, data) {
  if (typeof data !== "object" || !data) return;
  const sessionId = data.session_id || data.sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) return;
  if (event === "user-prompt-submit" && (data.agent_id || data.agentId || data.agent_type || data.agentType)) return;
  try {
    if (event === "session-start") {
      const current = ensureSession(provider, sessionId);
      output(provider, event, rootContext(provider, sessionId, current.enabled, current.stateDir));
    } else if (event === "user-prompt-submit") {
      const toggle = parseToggle(data.prompt || data.userPrompt);
      if (!toggle) return;
      const current = setMode(provider, sessionId, toggle.enabled, toggle.global);
      output(provider, event, rootContext(provider, sessionId, current.enabled, current.stateDir));
    } else if (event === "subagent-start" && isEnabled(provider, sessionId)) {
      output(provider, event, "Dirigent is enabled in the parent chat. Follow your assigned agent role and task scope; root orchestration and delegation rules belong to the parent.");
    }
  } catch (error) {
    output(provider, event, `Dirigent state update failed: ${error.message}. Do not claim the toggle or global preference was saved.`);
    process.stderr.write(`Dirigent state update failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

async function main(argv) {
  const [provider, action, mode, ...args] = argv;
  if (!providers.has(provider)) throw Error("provider must be claude, codex, or copilot");
  if (action === "set") {
    if (mode !== "on" && mode !== "off") throw Error("mode must be on or off");
    let sessionId, override, global = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--session") sessionId = args[++i];
      else if (args[i] === "--state-dir") override = args[++i];
      else if (args[i] === "--global") global = true;
      else throw Error(`unknown option: ${args[i]}`);
    }
    process.stdout.write(JSON.stringify(setMode(provider, sessionId, mode === "on", global, override)) + "\n");
    return;
  }
  if (!events[action]) throw Error("invalid hook event");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  runHook(provider, action, JSON.parse(input.replace(/^\uFEFF/, "")));
}

function invoke(argv) {
  main(argv).catch((error) => { process.stderr.write(`Dirigent: ${error.message}\n`); process.exitCode = 1; });
}

module.exports = { isEnabled, invoke };
if (require.main === module) invoke(process.argv.slice(2));
