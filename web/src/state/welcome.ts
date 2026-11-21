import { createSignal } from "solid-js";

type WelcomeView = "welcome" | "import";
const [welcomeView, setWelcomeView] = createSignal<WelcomeView>();
let opener: HTMLButtonElement | undefined;

export { welcomeView };

export function openWelcome(view: WelcomeView, button?: HTMLButtonElement): void {
  opener = button;
  setWelcomeView(view);
}

export function closeWelcome(): void {
  setWelcomeView(undefined);
  const button = opener;
  opener = undefined;
  queueMicrotask(() => button?.focus());
}
