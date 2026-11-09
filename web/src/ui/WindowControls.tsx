// Minimer, Maksimer (Gjenopprett when maximized) and Lukk at the right end of the top bar, in the
// Electron app (SPEC 29.1). In a browser the place stays empty and takes no width. Lukk does what
// Innstillinger → Generelt says: into the status area, or quit.
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { connectDesktop, desktop } from "../lib/desktop";
import "../styles/window-controls.css";

const Svg = (props: { children: any }) => (
  <svg class="icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {props.children}
  </svg>
);

export function WindowControls() {
  if (!desktop) return <div class="window-controls" data-testid="window-controls" aria-hidden="true" />;
  const bridge = desktop;
  const [maximized, setMaximized] = createSignal(false);
  onMount(() => {
    connectDesktop();
    void bridge.window.state().then((state) => state && setMaximized(state.maximized));
    onCleanup(bridge.window.onState((state) => setMaximized(state.maximized)));
  });
  return (
    <div class="window-controls" data-testid="window-controls" data-shell="electron" role="group" aria-label="Vindu">
      <button type="button" class="window-control" data-control="minimize" title="Minimer" aria-label="Minimer" onClick={() => bridge.window.minimize()}>
        <Svg><path d="M3.5 8.5h9" /></Svg>
      </button>
      <button
        type="button"
        class="window-control"
        data-control="maximize"
        title={maximized() ? "Gjenopprett" : "Maksimer"}
        aria-label={maximized() ? "Gjenopprett" : "Maksimer"}
        onClick={() => bridge.window.toggleMaximize()}
      >
        <Svg>
          <Show when={maximized()} fallback={<rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />}>
            <rect x="3.5" y="5.5" width="7" height="7" rx="1.25" />
            <path d="M5.75 3.5h5.25a1.5 1.5 0 0 1 1.5 1.5v5.25" />
          </Show>
        </Svg>
      </button>
      <button type="button" class="window-control close" data-control="close" title="Lukk" aria-label="Lukk" onClick={() => bridge.window.close()}>
        <Svg><path d="m4.5 4.5 7 7m0-7-7 7" /></Svg>
      </button>
    </div>
  );
}
