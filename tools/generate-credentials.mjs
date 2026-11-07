#!/usr/bin/env node
// Local credential generator (run on your own machine; nothing is uploaded).
//
//   node tools/generate-credentials.mjs
//
// Prompts for a username and password (password input is hidden), then prints
// the AUTH_CONFIG block to paste into assets/js/auth.js. Requires Node 18+.
//
// Non-interactive (e.g. scripts): TP_USERNAME=tenant TP_PASSWORD=... node tools/generate-credentials.mjs

import { webcrypto, randomBytes } from "node:crypto";
import readline from "node:readline";

const ITERATIONS = 600000;

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const username = (process.env.TP_USERNAME ?? (await ask("Username: "))).trim();
const password = process.env.TP_PASSWORD ?? (await ask("Password: ", { hidden: true }));

if (!username || !password) {
  console.error("Username and password are required.");
  process.exit(1);
}
if (password.length < 10) {
  console.warn("Warning: use a longer password (10+ characters) if this will protect real data.");
}

const salt = randomBytes(16);
const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
const bits = await webcrypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);

console.log("\nReplace AUTH_CONFIG in assets/js/auth.js with:\n");
console.log("const AUTH_CONFIG = Object.freeze({");
console.log(`  username: ${JSON.stringify(username)},`);
console.log(`  salt: ${JSON.stringify(salt.toString("base64"))},`);
console.log(`  hash: ${JSON.stringify(Buffer.from(bits).toString("base64"))},`);
console.log(`  iterations: ${ITERATIONS},`);
console.log("});\n");
console.log("Also delete the demo hint (#demo-hint) from index.html.");
