#!/usr/bin/env node

let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    return;
  }

  const model = payload && payload.model;
  if (typeof model !== "string" || !/^[A-Za-z0-9._-]+$/.test(model)) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext:
          `Authoritative runtime model slug: ${model}\n` +
          `Your final response must end with exactly: model: ${model}`,
      },
    }),
  );
});

process.stdin.on("error", () => {});
