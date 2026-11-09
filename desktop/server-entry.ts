// The server inside the Electron app. main.ts starts it with utilityProcess.fork(), so it is its own
// process with Electron's Node. It is the same startApp() as `npm start`; only the start and stop
// differ: the port and the token go to main.ts as a message instead of to the terminal, and main.ts
// asks it to stop with a message, so terminals, servers and Chrome are closed the normal way.
import { startApp } from "../server/src/app.ts";

type ToMain =
  | { type: "ready"; port: number; token: string; pid: number }
  | { type: "failed"; code: string | null; message: string };

// AD_DESKTOP_TIMING=1 (see main.ts): the modules are loaded, and the server listens.
const mark = (name: string) => process.env.AD_DESKTOP_TIMING && console.log(`tid: ${name} ${Date.now()}`);
mark("server-moduler");

const parent = process.parentPort;
const send = (message: ToMain) => parent?.postMessage(message);

process.on("unhandledRejection", (reason) => console.error("Uhåndtert feil:", (reason as Error)?.message ?? reason));

let app: Awaited<ReturnType<typeof startApp>> | undefined;
try {
  app = await startApp();
} catch (err) {
  send({ type: "failed", code: (err as NodeJS.ErrnoException).code ?? null, message: (err as Error).message });
  process.exit(1);
}

mark("server-lytter");
// SPEC 29.2: without Chromium's sandbox main.ts keeps web pages out of Electron. Said once, in the log.
if (process.env.AD_BROWSER_PANEL === "chrome") console.log("Nettleserpanelet bruker serverens headless Chrome (AD_BROWSER_PANEL=chrome).");
send({ type: "ready", port: app.port, token: app.security.token, pid: process.pid });

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  void app!.close().finally(() => process.exit(0));
};
parent?.on("message", (event: { data: unknown }) => {
  if ((event.data as { type?: string })?.type === "shutdown") stop();
});
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
process.once("SIGHUP", stop);
