import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import type { LocalModelHardware } from "../../../shared/protocol.ts";

const GiB = 1024 ** 3;
const runFile = promisify(execFile);

export function availableRamGiB(meminfo: string): number | undefined {
  const match = /^MemAvailable:[ \t]+(\d+)[ \t]+kB$/m.exec(meminfo);
  return match ? Number(match[1]) / (1024 ** 2) : undefined;
}

export function largestNvidiaGpuGiB(stdout: string): number | undefined {
  const sizes = stdout.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line)).map((line) => Number(line) / 1024);
  return sizes.length ? Math.max(...sizes) : undefined;
}

async function nvidiaGpu(): Promise<number | undefined> {
  try {
    const { stdout } = await runFile("/usr/bin/nvidia-smi", ["--query-gpu=memory.free", "--format=csv,noheader,nounits"], {
      timeout: 1_500, maxBuffer: 16_384, env: { LANG: "C", PATH: "/usr/bin:/bin" },
    });
    return largestNvidiaGpuGiB(stdout);
  } catch {
    return undefined;
  }
}

async function amdGpu(): Promise<number | undefined> {
  const devices = "/sys/class/drm";
  const cards = (await readdir(devices).catch(() => [])).filter((name) => /^card\d+$/.test(name));
  const sizes = await Promise.all(cards.map(async (card) => {
    const path = `${devices}/${card}/device`;
    try {
      const [vendor, total, used] = await Promise.all(
        ["vendor", "mem_info_vram_total", "mem_info_vram_used"].map((name) => readFile(`${path}/${name}`, "utf8")),
      );
      if (vendor.trim() !== "0x1002" || !/^\d+$/.test(total.trim()) || !/^\d+$/.test(used.trim())) return undefined;
      const bytes = Number(total) - Number(used);
      return Math.max(0, bytes) / GiB;
    } catch {
      return undefined;
    }
  }));
  const known = sizes.filter((value): value is number => value !== undefined);
  return known.length ? Math.max(...known) : undefined;
}

export async function readLocalModelHardware(): Promise<LocalModelHardware> {
  const meminfo = await readFile("/proc/meminfo", "utf8").catch(() => "");
  const ram = availableRamGiB(meminfo);
  if (ram === undefined) throw new Error("Fant ikke tilgjengelig RAM. Velg Oppgi minne selv og skriv inn målingene fra modellserveren.");
  const free = (await Promise.all([nvidiaGpu(), amdGpu()])).filter((value): value is number => value !== undefined);
  // VRAM on different devices is reported separately by the driver. Budget for one device.
  return { availableRamGiB: ram, freeGpuGiB: free.length ? Math.max(...free) : undefined };
}
