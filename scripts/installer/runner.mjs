import { spawnSync } from "node:child_process";

export class CommandError extends Error {
  constructor(message, { ambiguous = false, stderr = "" } = {}) {
    super(message);
    this.name = "CommandError";
    this.ambiguous = ambiguous;
    this.stderr = stderr;
  }
}

export function safeChildEnvironment(base = process.env, additions = {}) {
  const environment = { ...base };
  for (const name of [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "OPENAI_API_KEY",
    "AUTH_PHRASE_SALT",
    "AUTH_PHRASE_VERIFIER",
    "SESSION_SIGNING_KEY",
    "FEEDBACK_EXPORT_TOKEN",
  ])
    delete environment[name];
  return { ...environment, ...additions };
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.timeout ?? 120_000,
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.signal) {
    throw new CommandError(
      `${options.label ?? command} did not return a definite result. Preserve the installation state and verify the named resource in Cloudflare before resuming; do not create it again.`,
      { ambiguous: true },
    );
  }
  if (result.status !== 0) {
    throw new CommandError(
      `${options.label ?? command} failed. Review authentication, permissions, quota, and the named resource; rerun the command manually only when its ownership is known.`,
      { stderr: String(result.stderr ?? "") },
    );
  }
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

export function redactText(text, secretValues) {
  let result = String(text);
  for (const value of secretValues.filter(Boolean))
    result = result.split(value).join("[REDACTED]");
  return result;
}
