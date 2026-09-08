import { deriveAuthValues } from "./auth-values.mjs";

if (!process.stdin.isTTY) {
  console.error(
    "Run this command in an interactive terminal so the phrase is not echoed or piped through shell history.",
  );
  process.exit(1);
}

process.stderr.write("Mnemonic phrase (input hidden): ");
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");

let phrase = "";
readPhrase: for await (const chunk of process.stdin) {
  for (const key of chunk) {
    if (key === "\u0003") {
      process.stdin.setRawMode(false);
      process.stderr.write("\nCancelled.\n");
      process.exit(130);
    }
    if (key === "\r" || key === "\n") break readPhrase;
    if (key === "\u007f") {
      phrase = phrase.slice(0, -1);
      continue;
    }
    phrase += key;
  }
}
process.stdin.setRawMode(false);
process.stdin.pause();
process.stderr.write("\n");

try {
  const values = await deriveAuthValues(phrase);
  console.log(`AUTH_PHRASE_SALT=${values.AUTH_PHRASE_SALT}`);
  console.log(`AUTH_PHRASE_VERIFIER=${values.AUTH_PHRASE_VERIFIER}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
