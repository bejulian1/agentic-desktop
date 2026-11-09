// Starts the server. Run through `npm start`, or directly with --no-open.
import { spawn } from "node:child_process";
import { startApp } from "./app.ts";

export async function main(argv: string[]): Promise<void> {
  const noOpen = argv.includes("--no-open");
  // A stray failure must not take running terminals and threads down with it.
  process.on("unhandledRejection", (reason) => console.error("Uhåndtert feil:", (reason as Error)?.message ?? reason));
  let app: Awaited<ReturnType<typeof startApp>>;
  // The Electron app may ask this server to stop, with the key from instance.json (SPEC 29.1).
  let shutdown = () => undefined as void;
  try {
    app = await startApp({ onStopRequest: () => shutdown() });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    console.error(code === "EADDRINUSE" ? "Porten er opptatt. Sett AD_PORT til en annen port." : (err as Error).message);
    process.exit(1);
  }

  console.log(`Agentic Desktop kjører: ${app.link}`);
  if (!noOpen) {
    const opener = spawn("xdg-open", [app.link], { detached: true, stdio: "ignore", env: app.childEnv() });
    opener.on("error", () => console.log("Kunne ikke åpne nettleseren. Bruk lenken over."));
    opener.unref();
  }

  shutdown = () => {
    void app.close().then(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("SIGHUP", shutdown);
}

if (import.meta.main) await main(process.argv.slice(2));
