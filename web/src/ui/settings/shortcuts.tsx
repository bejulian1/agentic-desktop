// Hurtigtaster: every action with a shortcut, grouped and searchable. Click a shortcut and press
// the new keys. Esc cancels, Backspace removes it. A clash offers to swap, and keys the browser
// keeps for itself are refused. Rebinds are stored in settings.shortcuts on the server.
import { language, t } from "../../lib/i18n";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { app } from "../../state/app";
import { comboOf, displayKeys, keysFor, SHORTCUTS, type ShortcutDef } from "../../state/shortcuts";
import { IconSearch } from "../icons";
import { Group, Page, save } from "./parts";

// Chrome handles these before the page sees them, so a binding could never fire in a tab.
const RESERVED = new Set([
  "Mod+W", "Mod+T", "Mod+N", "Mod+Q", "Mod+Shift+N", "Mod+Shift+T", "Mod+Shift+W", "Mod+Shift+Q",
  "Mod+Tab", "Mod+Shift+Tab", "Mod+PageUp", "Mod+PageDown", "Alt+F4",
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `Mod+${n}`),
]);

const GROUPS: Array<{ id: ShortcutDef["group"]; label: string }> = [
  { id: "Vindu", get label() { return t("Generelt"); } },
  { id: "Tråder", get label() { return t("Tråder"); } },
  { id: "Visning", get label() { return t("Visning"); } },
  { id: "Panel", get label() { return t("Panel"); } },
];

// Fixed keys in the message field, shown so the list is complete. They cannot be changed.
const FIXED: Array<{ label: string; keys: string }> = [
  { get label() { return t("Send meldingen"); }, keys: "Enter" },
  { get label() { return t("Ny linje"); }, keys: "Shift+Enter" },
  { get label() { return t("Kommandoer"); }, keys: "/" },
  { get label() { return t("Nevn en fil"); }, keys: "@" },
  { get label() { return t("Kjør i skallet"); }, keys: "!" },
];

interface Problem {
  id: string;
  combo: string;
  text: string;
  swapWith?: ShortcutDef;
}

export function Shortcuts() {
  const [query, setQuery] = createSignal("");
  const [recording, setRecording] = createSignal<string | null>(null);
  const [problem, setProblem] = createSignal<Problem | null>(null);
  let stopRecording: (() => void) | undefined;
  onCleanup(() => stopRecording?.());

  const rebinds = () => app.settings.shortcuts ?? {};
  const store = (next: Record<string, string>) => save({ shortcuts: next });
  const changed = (id: string) => rebinds()[id] !== undefined;
  const defaultOf = (id: string) => SHORTCUTS.find((s) => s.id === id)?.keys ?? "";
  // A rebind that equals the default is left out, so Tilbakestill and «Endret» stay honest.
  const withKeys = (next: Record<string, string>, id: string, keys: string) => {
    if (keys === defaultOf(id)) delete next[id];
    else next[id] = keys;
    return next;
  };

  const assign = (id: string, combo: string) => store(withKeys({ ...rebinds() }, id, combo));

  const swap = (p: Problem) => {
    const mine = keysFor(p.id);
    const next = withKeys({ ...rebinds() }, p.id, p.combo);
    store(withKeys(next, p.swapWith!.id, mine));
    setProblem(null);
  };

  const record = (id: string) => {
    stopRecording?.();
    setProblem(null);
    setRecording(id);
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") return stop();
      if ((event.key === "Backspace" || event.key === "Delete") && !event.ctrlKey && !event.metaKey && !event.altKey) {
        assign(id, "");
        return stop();
      }
      const combo = comboOf(event);
      if (!combo) return;
      if (!/^(Mod|Alt)\+/.test(combo) && !/^(Shift\+)?F\d{1,2}$/.test(combo)) {
        setProblem({ id, combo, text: t("Bruk Ctrl eller Alt sammen med en tast, så snarveien ikke tar bokstaver du skriver.") });
        return;
      }
      if (RESERVED.has(combo)) {
        setProblem({ id, combo, text: t("{shortcut} brukes av nettleseren og kan ikke brukes her.", { shortcut: displayKeys(combo) }) });
        return;
      }
      const clash = SHORTCUTS.find((s) => s.id !== id && keysFor(s.id) === combo);
      if (clash) {
        setProblem({ id, combo, swapWith: clash, text: t("{shortcut} brukes allerede til «{label}».", { shortcut: displayKeys(combo), label: clash.label }) });
        return stop(true);
      }
      assign(id, combo);
      stop();
    };
    const stop = (keepProblem = false) => {
      window.removeEventListener("keydown", onKey, true);
      setRecording(null);
      if (!keepProblem) setProblem(null);
      stopRecording = undefined;
    };
    window.addEventListener("keydown", onKey, true);
    stopRecording = () => stop();
  };

  const reset = (id: string) => {
    const next = { ...rebinds() };
    delete next[id];
    store(next);
    setProblem(null);
  };

  const fold = (text: string) => text.toLocaleLowerCase(language());
  const hit = (label: string, keys: string, group: string) => {
    const q = fold(query().trim());
    return !q || fold(`${label} ${displayKeys(keys)} ${keys} ${group}`).includes(q);
  };
  const groups = createMemo(() =>
    GROUPS.map((g) => ({ ...g, items: SHORTCUTS.filter((s) => s.group === g.id && hit(s.label, keysFor(s.id), g.label)) })).filter((g) => g.items.length),
  );
  const fixed = createMemo(() => FIXED.filter((f) => hit(f.label, f.keys, t("Meldingsfelt"))));

  return (
    <Page title={t("Hurtigtaster")} intro={t("Klikk på en snarvei og trykk den nye kombinasjonen. Esc avbryter, og Backspace fjerner snarveien.")}>
      <div class="shortcut-tools">
        <div class="settings-search shortcut-search">
          <IconSearch size={14} />
          <input type="search" class="settings-search-input" placeholder={t("Søk i hurtigtaster")} aria-label={t("Søk i hurtigtaster")} value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
        </div>
        <button type="button" class="btn btn-small" disabled={!Object.keys(rebinds()).length} title={t("Sett alle hurtigtaster tilbake til standard")} onClick={() => { store({}); setProblem(null); }}>{t("Tilbakestill alle")}</button>
      </div>
      <For each={groups()}>
        {(group) => (
          <Group title={group.label}>
            <For each={group.items}>
              {(s) => (
                <div class="setting shortcut-row" data-shortcut={s.id}>
                  <div class="setting-text">
                    <strong>{s.label}<Show when={changed(s.id)}> <span class="key-tag">{t("Endret")}</span></Show></strong>
                    <Show when={problem()?.id === s.id}>
                      <span class="shortcut-problem" role="alert">
                        {problem()!.text}
                        <Show when={problem()!.swapWith}>
                          {" "}
                          <button type="button" class="link-button" onClick={() => swap(problem()!)}>{t("Bytt med «{label}»", { label: problem()!.swapWith!.label })}</button>
                          {" "}
                          <button type="button" class="link-button" onClick={() => setProblem(null)}>{t("Avbryt")}</button>
                        </Show>
                      </span>
                    </Show>
                  </div>
                  <div class="setting-control shortcut-actions">
                    <Show when={changed(s.id)}>
                      <button type="button" class="btn btn-small btn-quiet" title={t("Tilbake til {shortcut}", { shortcut: displayKeys(defaultOf(s.id)) || t("ingen") })} aria-label={t("Tilbakestill {label}", { label: s.label })} onClick={() => reset(s.id)}>{t("Tilbakestill")}</button>
                    </Show>
                    <button
                      type="button"
                      class="shortcut-key"
                      classList={{ recording: recording() === s.id }}
                      aria-label={t("Endre hurtigtast for {label}", { label: s.label })}
                      title={t("Klikk og trykk den nye kombinasjonen")}
                      onClick={() => (recording() === s.id ? stopRecording?.() : record(s.id))}
                    >
                      <kbd classList={{ recording: recording() === s.id, empty: !keysFor(s.id) }}>{recording() === s.id ? t("Trykk tastene…") : displayKeys(keysFor(s.id)) || t("Ingen")}</kbd>
                    </button>
                  </div>
                </div>
              )}
            </For>
          </Group>
        )}
      </For>
      <Show when={fixed().length}>
        <Group title={t("Meldingsfelt")}>
          <For each={fixed()}>
            {(f) => (
              <div class="setting shortcut-row">
                <div class="setting-text"><strong>{f.label}</strong></div>
                <div class="setting-control"><kbd class="fixed" title={t("Kan ikke endres")}>{displayKeys(f.keys)}</kbd></div>
              </div>
            )}
          </For>
        </Group>
      </Show>
      <Show when={!groups().length && !fixed().length}><p class="muted">{t("Ingen hurtigtaster passer til «{query}».", { query: query().trim() })}</p></Show>
      <p class="muted small">{t("Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Tab og Ctrl+1 til 9 tas av nettleseren og kan ikke brukes. I Electron-versjonen blir de ledige.")}</p>
    </Page>
  );
}
