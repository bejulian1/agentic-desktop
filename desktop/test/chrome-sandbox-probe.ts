// Started by 10-gnome-start.test.ts as plain "unconfined" (like the app's server when GNOME starts the
// app): starts the server's headless Chrome the way browser.ts and web-browser.ts do (channel
// "chrome", chromiumSandbox: true), opens a page, and prints for each renderer whether it really is
// sandboxed: its seccomp mode, and whether it lives in a user namespace of its own.
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { chromium } from "playwright-core";

function children(pid: number): number[] {
  const out: number[] = [];
  for (const task of readdirSync(`/proc/${pid}/task`)) {
    try {
      out.push(...readFileSync(`/proc/${pid}/task/${task}/children`, "utf8").trim().split(/\s+/).filter(Boolean).map(Number));
    } catch {
      // gone
    }
  }
  return out;
}

function tree(pid: number): number[] {
  const all: number[] = [];
  const queue = [pid];
  while (queue.length) {
    for (const child of children(queue.shift()!)) {
      all.push(child);
      queue.push(child);
    }
  }
  return all;
}

const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true, args: ["--no-first-run", "--disable-sync"] });
try {
  const page = await browser.newPage();
  await page.goto("data:text/html,<p>sandkasse</p>");
  const ownUserNs = readlinkSync("/proc/self/ns/user");
  const renderers = tree(process.pid).flatMap((pid) => {
    try {
      // Chrome rewrites its command line into one string with spaces.
      const cmd = ` ${readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ")} `;
      if (!cmd.includes(" --type=renderer ")) return [];
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      return [{
        pid,
        exe: readlinkSync(`/proc/${pid}/exe`),
        noSandboxSwitch: cmd.includes(" --no-sandbox "),
        seccomp: Number(/^Seccomp:\s+(\d)/m.exec(status)?.[1] ?? -1),
        ownUserNamespace: readlinkSync(`/proc/${pid}/ns/user`) !== ownUserNs,
      }];
    } catch {
      return [];
    }
  });
  const label = readFileSync("/proc/self/attr/current", "utf8").replace(/\0/g, "").trim();
  console.log(JSON.stringify({ label, renderers }));
} finally {
  await browser.close();
}
