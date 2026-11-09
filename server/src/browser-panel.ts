// SPEC 29.3: in the Electron app, the Browser panel's pages are real views in the window
// (desktop/browser-view.ts), and Playwright here reaches them through a transport over a
// MessagePort that main.ts gives this process. Nothing listens on a port or a socket: the channel
// exists only between the Electron main process and this utility process.
//
// With `npm start`, or when the Electron app does not answer, there is no transport, and
// BrowserManager starts its own headless Chrome as before.
import type { ConnectOverCDPTransport } from "playwright-core";

interface PortMain {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  on(event: "close", listener: () => void): void;
  start(): void;
  close(): void;
}

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown; ports: PortMain[] }) => void): void;
  off(event: "message", listener: (event: { data: unknown; ports: PortMain[] }) => void): void;
}

function parentPort(): ParentPort | undefined {
  return (process as unknown as { parentPort?: ParentPort }).parentPort;
}

// True in the Electron app's server process, where main.ts can give the panel's pages.
export function panelAvailable(): boolean {
  return process.env.AD_SHELL === "electron" && process.env.AD_BROWSER_PANEL !== "chrome" && !!parentPort();
}

// Asks main.ts for a channel to the panel and returns it as a transport for connectOverCDP, or null
// when main.ts does not answer in time.
export function connectPanel(timeoutMs = 5000): Promise<ConnectOverCDPTransport | null> {
  const parent = parentPort();
  if (!parent) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      parent.off("message", onMessage);
      resolve(null);
    }, timeoutMs);
    const onMessage = (event: { data: unknown; ports: PortMain[] }) => {
      if ((event.data as { type?: string })?.type !== "browser-panel:port" || !event.ports?.[0]) return;
      clearTimeout(timer);
      parent.off("message", onMessage);
      resolve(transportOver(event.ports[0]));
    };
    parent.on("message", onMessage);
    parent.postMessage({ type: "browser-panel:connect" });
  });
}

function transportOver(port: PortMain): ConnectOverCDPTransport {
  let closed = false;
  const transport: ConnectOverCDPTransport = {
    send(message) {
      if (!closed) port.postMessage(message);
    },
    close() {
      if (closed) return;
      closed = true;
      port.close();
      transport.onclose?.("Nettleserpanelet ble lukket");
    },
  };
  port.on("message", (event) => {
    if (!closed) transport.onmessage?.(event.data as object);
  });
  port.on("close", () => {
    if (closed) return;
    closed = true;
    transport.onclose?.("Appen lukket nettleserpanelet");
  });
  port.start();
  return transport;
}
