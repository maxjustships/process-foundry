export class CancelledError extends Error {
  constructor() {
    super("Installation cancelled.");
    this.name = "CancelledError";
  }
}

async function readInput({
  input = process.stdin,
  output = process.stderr,
  hidden = false,
  message = "",
} = {}) {
  if (!input.isTTY)
    throw new Error("Run the installer in an interactive terminal.");
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  output.write(message);
  let value = "";
  try {
    read: for await (const chunk of input) {
      for (const key of chunk) {
        if (key === "\u0003") throw new CancelledError();
        if (key === "\r" || key === "\n") break read;
        if (key === "\u007f" || key === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            if (!hidden) output.write("\b \b");
          }
          continue;
        }
        if (key >= " ") {
          value += key;
          if (!hidden) output.write(key);
        }
      }
    }
    output.write("\n");
    return value;
  } finally {
    input.setRawMode(Boolean(wasRaw));
    input.pause();
  }
}

export async function promptText(message, options = {}) {
  const answer = (
    await readInput({ ...options, message: `${message}: ` })
  ).trim();
  if (!answer && options.defaultValue !== undefined)
    return options.defaultValue;
  if (!answer) throw new Error(`${message} is required.`);
  return answer;
}

export async function promptSecret(message, options = {}) {
  return await readInput({
    ...options,
    hidden: true,
    message: `${message} (input hidden): `,
  });
}

export async function promptConfirm(
  message,
  defaultValue = false,
  options = {},
) {
  const marker = defaultValue ? "Y/n" : "y/N";
  const answer = (
    await readInput({ ...options, message: `${message} [${marker}]: ` })
  )
    .trim()
    .toLowerCase();
  if (!answer) return defaultValue;
  if (answer === "y" || answer === "yes") return true;
  if (answer === "n" || answer === "no") return false;
  throw new Error("Answer yes or no.");
}
