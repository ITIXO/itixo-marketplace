#!/usr/bin/env node
// Shared Dirigent and Teamlead hook runtime. Copy this file unchanged to every provider package.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const providers = new Set(["claude", "codex", "copilot"]);
const events = { "session-start": "SessionStart", "user-prompt-submit": "UserPromptSubmit", "subagent-start": "SubagentStart" };

function stateDir(provider, override, feature = "dirigent") {
  if (!providers.has(provider)) throw Error("invalid provider");
  if (override) return path.resolve(override);
  const data = provider === "claude" ? process.env.CLAUDE_PLUGIN_DATA : provider === "codex" ? process.env.PLUGIN_DATA : process.env.COPILOT_PLUGIN_DATA;
  if (data) return path.join(data, feature, provider);
  const home = provider === "claude" ? (process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"))
    : provider === "codex" ? (process.env.CODEX_HOME || path.join(os.homedir(), ".codex"))
      : (process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"));
  return path.join(home, "itixo", feature, provider);
}

function paths(provider, sessionId, override, feature = "dirigent") {
  if (typeof sessionId !== "string" || !sessionId.trim()) throw Error("session ID required");
  const dir = stateDir(provider, override, feature);
  return { dir, global: path.join(dir, "default.json"), session: path.join(dir, `session-${crypto.createHash("sha256").update(sessionId).digest("hex")}.json`) };
}

function readState(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return { enabled: data.enabled === true, at: Number.isFinite(data.at) ? data.at : 0 };
  } catch { return { enabled: false, at: 0 }; }
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ enabled: state.enabled, at: state.at }) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp);
  }
  const back = readState(file);
  if (back.enabled !== state.enabled || back.at !== state.at) throw Error(`state readback failed: ${file}`);
}

const features = ["dirigent", "teamlead"];
const other = (feature) => (feature === "dirigent" ? "teamlead" : "dirigent");

// With --state-dir the other feature's dir is the sibling <data>/<other>/<provider>; null if the layout differs.
function overrideFor(provider, override, feature, target) {
  if (!override || feature === target) return override;
  const dir = path.resolve(override);
  return path.basename(dir) === provider && path.basename(path.dirname(dir)) === feature
    ? path.join(path.dirname(path.dirname(dir)), target, provider) : null;
}

function pick(d, t) {
  if (d.enabled && t.enabled) return d.at > t.at ? "dirigent" : t.at > d.at ? "teamlead" : "ask";
  return d.enabled ? "dirigent" : t.enabled ? "teamlead" : "none";
}

function effectiveMode(provider, sessionId) {
  try {
    return pick(readState(paths(provider, sessionId, undefined, "dirigent").session), readState(paths(provider, sessionId, undefined, "teamlead").session));
  } catch { return "none"; }
}

function isEnabled(provider, sessionId) {
  return effectiveMode(provider, sessionId) === "dirigent";
}

function ensureSession(provider, sessionId, feature = "dirigent") {
  const p = paths(provider, sessionId, undefined, feature);
  if (!fs.existsSync(p.session)) writeState(p.session, readState(p.global));
  return { ...readState(p.session), stateDir: p.dir };
}

function setMode(provider, sessionId, feature, enabled, global, override) {
  const p = paths(provider, sessionId, override, feature);
  const now = Date.now();
  const state = { enabled, at: now };
  const o = other(feature);
  const oo = overrideFor(provider, override, feature, o);
  const op = oo === null ? null : paths(provider, sessionId, oo, o);
  if (!enabled && op) {
    const mine = readState(p.session), theirs = readState(op.session);
    const [d, t] = feature === "dirigent" ? [mine, theirs] : [theirs, mine];
    const eff = pick(d, t);
    // No fallback: turning off the effective (or undecided) mode must not revive the other.
    if (eff === feature || eff === "ask") writeState(op.session, { enabled: false, at: now });
  }
  writeState(p.session, state);
  if (global) writeState(p.global, state);
  return { provider, sessionId, feature, enabled, global, stateDir: p.dir };
}

function parseToggle(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/[.!?]+$/, "").trim();
  for (const f of features) {
    const slash = text.match(new RegExp(`^[/$](?:itixo:)?${f}(?:\\s+(on|off))?(?:\\s+(--global))?$`, "i"));
    if (slash) return { feature: f, enabled: (slash[1] || "on").toLowerCase() !== "off", global: Boolean(slash[2]) };
    const natural = text.match(new RegExp(`^(?:please\\s+|(?:can|could|would)\\s+you\\s+)?(turn\\s+(on|off)\\s+${f}|turn\\s+${f}\\s+(on|off)|${f}\\s+(on|off)|(?:enable|disable|start|stop|use)\\s+${f})(?:\\s+(globally|for\\s+(?:all\\s+)?future\\s+sessions|for\\s+futur(?:e)?\\s+use))?(?:\\s+please)?$`, "i"));
    if (!natural) continue;
    const onOff = natural[2] || natural[3] || natural[4];
    const enabled = onOff ? onOff.toLowerCase() === "on" : /^(?:enable|start|use)\b/i.test(natural[1]);
    return { feature: f, enabled, global: Boolean(natural[5]) };
  }
  return null;
}

// Claude's Bash tool uses Git Bash on Windows; Codex and Copilot use PowerShell there.
function usesPowerShell(provider) {
  return process.platform === "win32" && provider !== "claude";
}

function quoteShell(value, powerShell) {
  const str = String(value);
  return powerShell ? `'${str.replaceAll("'", "''")}'` : `'${str.replaceAll("'", "'\\''")}'`;
}

function helper(provider, sessionId, dir, feature = "dirigent") {
  const powerShell = usesPowerShell(provider);
  const args = [process.execPath, __filename, provider, "set", "on", "--session", sessionId, "--state-dir", dir];
  if (feature === "teamlead") args.push("--feature", "teamlead");
  return (powerShell ? "& " : "") + args.map((arg) => quoteShell(arg, powerShell)).join(" ");
}

function rootContext(provider, sessionId, d, t) {
  const rulesDir = path.join(path.dirname(__dirname), "rules");
  const mode = pick(d, t);
  const label = { dirigent: "Dirigent", teamlead: "Teamlead", none: "none", ask: "undecided" }[mode];
  const onOff = (s) => (s.enabled ? "ON" : "OFF");
  const control = `Dirigent ${onOff(d)}, Teamlead ${onOff(t)} for this chat; effective mode: ${label}. When both are on, the later toggle wins; apply only the effective mode's rules and ignore rules injected earlier in this chat for the other mode. Session ID: ${sessionId}. State directories: Dirigent ${d.stateDir}; Teamlead ${t.stateDir}. Manual control: ${helper(provider, sessionId, d.stateDir)} (replace on with off; add --global to save for future sessions). Teamlead manual control: ${helper(provider, sessionId, t.stateDir, "teamlead")} (same options). The latest chat toggle wins. After a manual enable, read ${path.join(rulesDir, "agents.md")} for Dirigent or ${path.join(rulesDir, "teamlead.md")} for Teamlead before task work. Independent repository instructions still apply.`;
  if (mode === "none") return control;
  if (mode === "ask") return `${control}\n\nDirigent and Teamlead are both on and which was toggled last is unknown. Before task work, ask the user which mode to use, then turn the other off with its manual control command.`;
  // Rules are inlined; keep them under Claude's 10,000-char hook cap (tests enforce).
  const rulesText = fs.readFileSync(path.join(rulesDir, mode === "dirigent" ? "agents.md" : "teamlead.md"), "utf8");
  return `${control}\n\n${label} is enabled. Apply these rules while enabled (rules directory: ${rulesDir}):\n\n${rulesText}`;
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
  let label = "Dirigent";
  try {
    if (event === "session-start") {
      const d = ensureSession(provider, sessionId, "dirigent");
      const t = ensureSession(provider, sessionId, "teamlead");
      output(provider, event, rootContext(provider, sessionId, d, t));
    } else if (event === "user-prompt-submit") {
      const toggle = parseToggle(data.prompt || data.userPrompt);
      if (!toggle) return;
      if (toggle.feature === "teamlead") label = "Teamlead";
      ensureSession(provider, sessionId, "dirigent");
      ensureSession(provider, sessionId, "teamlead");
      setMode(provider, sessionId, toggle.feature, toggle.enabled, toggle.global);
      const d = ensureSession(provider, sessionId, "dirigent");
      const t = ensureSession(provider, sessionId, "teamlead");
      output(provider, event, rootContext(provider, sessionId, d, t));
    } else if (event === "subagent-start") {
      const m = effectiveMode(provider, sessionId);
      if (m === "dirigent") output(provider, event, "Dirigent is enabled in the parent chat. Follow your assigned agent role and task scope; root orchestration and delegation rules belong to the parent.");
      else if (m === "teamlead") output(provider, event, "Teamlead is enabled in the parent chat. Follow your assigned agent role and task scope; return compact results to the parent agent.");
    }
  } catch (error) {
    output(provider, event, `${label} state update failed: ${error.message}. Do not claim the toggle or global preference was saved.`);
    process.stderr.write(`${label} state update failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

async function main(argv) {
  const [provider, action, mode, ...args] = argv;
  if (!providers.has(provider)) throw Error("provider must be claude, codex, or copilot");
  if (action === "set") {
    if (mode !== "on" && mode !== "off") throw Error("mode must be on or off");
    let sessionId, override, feature = "dirigent", global = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--session") sessionId = args[++i];
      else if (args[i] === "--state-dir") override = args[++i];
      else if (args[i] === "--feature") feature = args[++i];
      else if (args[i] === "--global") global = true;
      else throw Error(`unknown option: ${args[i]}`);
    }
    if (!features.includes(feature)) throw Error("feature must be dirigent or teamlead");
    process.stdout.write(JSON.stringify(setMode(provider, sessionId, feature, mode === "on", global, override)) + "\n");
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

module.exports = { isEnabled, effectiveMode, parseToggle, invoke };
if (require.main === module) invoke(process.argv.slice(2));
