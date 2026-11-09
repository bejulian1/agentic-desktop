// Focus for layers that open over the app: the command palette, Innstillinger and the menus.
// Call it when the layer opens; the function it returns gives focus back to where it was when the
// layer closes. It waits a frame, because the app under the layer is inert until the layer is
// gone, and focus() on an inert element does nothing. If something else took focus meanwhile (a
// dialog, a rename field, a page the layer opened), that wins.
//
// Innstillinger loads on first use and makes the app inert at once, which takes focus away before
// the page exists. So the last element that had focus is kept here, and used when focus is on
// nothing when the layer opens.
let lastFocused: HTMLElement | null = null;
document.addEventListener("focusin", (event) => {
  const target = event.target as HTMLElement | null;
  if (target && target !== document.body) lastFocused = target;
});

export function rememberFocus(): () => void {
  const active = document.activeElement as HTMLElement | null;
  const before = active && active !== document.body ? active : lastFocused;
  return () => {
    if (!before) return;
    requestAnimationFrame(() => {
      const now = document.activeElement;
      if (now && now !== document.body && now !== document.documentElement) return;
      if (before.isConnected && !before.closest("[inert]")) before.focus({ preventScroll: true });
    });
  };
}
