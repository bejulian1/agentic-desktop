import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { HttpError } from "./errors.ts";

export interface FolderOptions { start?: string; title?: string }

const DIALOG_ENV = new Set(["PATH", "HOME", "USER", "LOGNAME", "LANG", "LANGUAGE", "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "XDG_CURRENT_DESKTOP", "DESKTOP_SESSION", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"]);

function dialogEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([name, value]) => value !== undefined && (DIALOG_ENV.has(name) || /^LC_[A-Z_]+$/.test(name))));
}

export function folderOptions(start: unknown, title: unknown): FolderOptions {
  if (start !== undefined && (typeof start !== "string" || start.length > 4096 || start.includes("\0"))) throw new HttpError(400, "Ugyldig startmappe");
  if (title !== undefined && (typeof title !== "string" || title.length > 200 || title.includes("\0"))) throw new HttpError(400, "Ugyldig tittel");
  return { start: start || undefined, title: title || undefined } as FolderOptions;
}

// One dialog per server. The executable and prefix are injectable only by local tests; requests
// never choose a program or command. Selection does not create a folder or register a project.
export class NativeFolderPicker {
  private active = false;
  private executable: string;
  private prefix: string[];
  private timeoutMs: number;
  private env: () => NodeJS.ProcessEnv;
  private controller: AbortController | undefined;
  private closed = false;

  constructor(options: { executable?: string; prefix?: string[]; timeoutMs?: number; env?: () => NodeJS.ProcessEnv } = {}) {
    this.executable = options.executable ?? "zenity";
    this.prefix = options.prefix ?? [];
    this.timeoutMs = options.timeoutMs ?? 5 * 60_000;
    this.env = options.env ?? (() => process.env);
  }

  close(): void {
    this.closed = true;
    this.controller?.abort();
  }

  async pick(start?: string, title?: string): Promise<string | null> {
    const options = folderOptions(start, title);
    if (this.closed) throw new HttpError(503, "Mappevelgeren er avsluttet");
    if (process.platform !== "linux") throw new HttpError(501, "Systemets mappevelger støttes bare på Linux. Skriv inn mappestien manuelt.");
    if (this.active) throw new HttpError(409, "Mappevelgeren er allerede åpen");
    this.active = true;
    this.controller = new AbortController();
    try {
      const initial = path.resolve(options.start ?? homedir());
      const args = [...this.prefix, "--file-selection", "--directory", `--title=${options.title ?? "Velg prosjektmappe"}`, `--filename=${initial.endsWith(path.sep) ? initial : initial + path.sep}`];
      const selected = await new Promise<string | null>((resolve, reject) => {
        execFile(this.executable, args, { encoding: "utf8", env: dialogEnv(this.env()), signal: this.controller!.signal, timeout: this.timeoutMs, killSignal: "SIGKILL", maxBuffer: 64 * 1024, shell: false }, (error, stdout, stderr) => {
          if (!error) return resolve(stdout.replace(/\r?\n$/, "") || null);
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return reject(new HttpError(501, "Systemets mappevelger er ikke tilgjengelig (zenity mangler). Skriv inn mappestien manuelt."));
          if ((error as NodeJS.ErrnoException).code === "ABORT_ERR") return reject(new HttpError(503, "Mappevelgeren ble avsluttet fordi serveren stopper"));
          if (error.killed) return reject(new HttpError(504, "Mappevelgeren brukte for lang tid. Prøv igjen."));
          if (/cannot open display|failed to open display|cannot connect to display/i.test(stderr)) return reject(new HttpError(501, "Systemets mappevelger har ingen tilgjengelig skjerm. Skriv inn mappestien manuelt."));
          if (error.code === 1) return resolve(null); // Avbryt or closing the dialog.
          reject(new HttpError(503, "Kunne ikke åpne systemets mappevelger. Prøv igjen eller skriv inn mappestien manuelt."));
        });
      });
      if (selected === null) return null;
      if (!path.isAbsolute(selected) || selected.includes("\0")) throw new HttpError(503, "Mappevelgeren returnerte en ugyldig sti");
      try {
        if (!statSync(selected).isDirectory()) throw new Error("not a directory");
      } catch {
        throw new HttpError(400, "Den valgte mappen finnes ikke eller kan ikke åpnes");
      }
      return selected;
    } finally {
      this.active = false;
      this.controller = undefined;
    }
  }
}
