// Interactive fallbacks for the admin scripts (Node 18+, no dependencies).
// A value comes from the environment when it is set, so automation keeps
// working; otherwise it is asked for on the terminal, passwords without echo,
// and validated on the spot so a mistake never reaches the server.
import { createInterface } from "node:readline";

export const interactive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readLine(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.on("SIGINT", () => { rl.close(); process.stdout.write("\n"); process.exit(130); });
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

/** Reads a line in raw mode without echoing it. */
function readHidden(question) {
  const { stdin, stdout } = process;
  return new Promise((resolve) => {
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    let value = "";
    const finish = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      resolve(value);
    };
    function onData(chunk) {
      if (chunk.startsWith("\u001b")) return; // arrow keys and other escape sequences
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return finish();
        if (ch === "\u0003") { stdin.setRawMode(false); stdout.write("\n"); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") value = [...value].slice(0, -1).join("");
        else if (ch >= " ") value += ch;
      }
    }
    stdin.on("data", onData);
  });
}

/**
 * The value of environment variable `name`, or the answer to `question`.
 * `validate(v)` returns an error message (or a promise of one) to ask again.
 * `fallback` is used for an empty answer or, without a terminal, a missing variable.
 */
export async function value(name, { question, hidden = false, validate, fallback, confirm = false } = {}) {
  const fromEnv = process.env[name];
  if (fromEnv === "" && fallback !== undefined) return fallback; // set but empty: an optional field left blank
  if (fromEnv !== undefined && fromEnv !== "") {
    const error = await validate?.(fromEnv);
    if (error) fail(`${name}: ${error}`);
    return fromEnv;
  }
  if (!interactive()) {
    if (fallback !== undefined) return fallback;
    fail(`missing ${name} (set it, or run in a terminal to be asked)`);
  }
  for (;;) {
    const raw = hidden ? await readHidden(question) : await readLine(question);
    const answer = hidden ? raw : raw.trim();
    if (!answer && fallback !== undefined) return fallback;
    const error = !answer ? "This is required." : await validate?.(answer);
    if (error) {
      console.log(`  ${error}`);
      continue;
    }
    if (confirm && (await readHidden("  Type it again: ")) !== answer) {
      console.log("  The two entries did not match. Try again.");
      continue;
    }
    return answer;
  }
}

/** Asks a yes/no question; only "yes" (or "y") counts. */
export async function confirmed(question) {
  if (!interactive()) return false;
  return /^(y|yes)$/i.test((await readLine(question)).trim());
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** PocketBase server URL from ZH_PB_URL or the terminal, checked to be reachable. */
export async function serverUrl({ fallback } = {}) {
  const url = await value("ZH_PB_URL", {
    question: `PocketBase URL${fallback ? ` [${fallback}]` : " (https://….liara.run)"}: `,
    fallback,
    validate: async (v) => {
      if (!/^https?:\/\/[^\s/]+/.test(v)) return "Use a full address starting with https:// (or http:// locally).";
      try {
        const res = await fetch(`${v.replace(/\/+$/, "")}/api/health`);
        return res.ok ? undefined : `${v} answered HTTP ${res.status}; is this the PocketBase address?`;
      } catch (err) {
        return `Cannot reach ${v} (${err.cause?.code ?? err.message}).`;
      }
    },
  });
  return url.replace(/\/+$/, "");
}

/**
 * Signs in as a PocketBase superuser (ZH_PB_SUPERUSER_EMAIL / _PASSWORD, or
 * asked for). A wrong answer typed at the terminal is asked again.
 */
export async function superuserLogin(pb) {
  for (let attempt = 1; ; attempt++) {
    const email = await value("ZH_PB_SUPERUSER_EMAIL", {
      question: "Superuser e-mail: ",
      validate: (v) => (/^[^\s@]+@[^\s@]+$/.test(v) ? undefined : "That is not an e-mail address."),
    });
    const password = await value("ZH_PB_SUPERUSER_PASSWORD", { question: "Superuser password: ", hidden: true });
    try {
      await pb.collection("_superusers").authWithPassword(email, password);
      return;
    } catch (err) {
      const asked = !process.env.ZH_PB_SUPERUSER_EMAIL || !process.env.ZH_PB_SUPERUSER_PASSWORD;
      if (err?.status === 429 && attempt < 5) {
        console.log("  Too many sign-in attempts; waiting a few seconds…");
        await wait(5000);
        continue;
      }
      if (err?.status === 400 && asked && interactive() && attempt < 3) {
        console.log("  Wrong e-mail or password. Try again.");
        continue;
      }
      if (err?.status === 400) fail("Superuser sign-in failed: wrong e-mail or password.");
      throw err;
    }
  }
}
