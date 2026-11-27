import { createEffect, createMemo, createSignal, createUniqueId, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { modelAllowsTools } from "../../../shared/protocol";
import { t } from "../lib/i18n";
import { app, modelDisplayName, modelFor } from "../state/app";
import { IconCheck, IconSearch, IconSliders } from "./icons";
import { ProviderIcon, providerBrand } from "./ProviderIcon";

const FAVORITES_KEY = "ad-favorite-models";

function readFavorites(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

const [favorites, setFavorites] = createSignal<ReadonlySet<string>>(new Set(readFavorites()));
window.addEventListener("storage", (event) => {
  if (event.key === FAVORITES_KEY || event.key === null) setFavorites(new Set(readFavorites()));
});

function toggleFavorite(id: string): void {
  const ids = new Set(favorites());
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  setFavorites(ids);
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...ids]));
  } catch {
    // The picker remains usable when storage is unavailable.
  }
}

export function ModelMenu(props: { chosen: string | null; onPick: (id: string) => void; onManage: () => void; children: JSX.Element }) {
  const listId = `model-list-${createUniqueId()}`;
  const providers = createMemo(() => {
    const modelsByProvider = Map.groupBy(app.models, (model) => model.providerId);
    return app.providers.map((provider) => {
      const models = modelsByProvider.get(provider.id);
      return { provider, models: models ?? [] };
    });
  });
  const [tab, setTab] = createSignal<string | null>(
    props.chosen && favorites().has(props.chosen) ? null : modelFor(props.chosen)?.providerId ?? providers().find((group) => group.models.length)?.provider.id ?? providers()[0]?.provider.id ?? null,
  );
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal<string | null>(props.chosen);
  const favoriteCount = () => providers().reduce((count, group) => count + group.models.filter((m) => favorites().has(m.id)).length, 0);
  const rows = createMemo(() => {
    const words = query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    return providers().flatMap(({ provider, models }) => {
      if (tab() !== null && tab() !== provider.id) return [];
      return models.filter((model) => {
        if (tab() === null && !favorites().has(model.id)) return false;
        const text = `${modelDisplayName(model)} ${model.model} ${provider.name}`.toLowerCase();
        return words.every((word) => text.includes(word));
      }).map((model) => ({ provider, model }));
    });
  });
  const optionId = (id: string) => `${listId}-${encodeURIComponent(id)}`;
  let search!: HTMLInputElement;
  let list!: HTMLDivElement;
  let frame = 0;
  const reveal = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const row = document.getElementById(optionId(active() ?? ""));
      if (!row) return;
      const box = list.getBoundingClientRect();
      const item = row.getBoundingClientRect();
      if (item.top < box.top) list.scrollTop -= box.top - item.top;
      else if (item.bottom > box.bottom) list.scrollTop += item.bottom - box.bottom;
    });
  };
  createEffect(() => {
    const options = rows();
    setActive((current) => options.some(({ model }) => model.id === current)
      ? current
      : options.find(({ model }) => model.id === props.chosen)?.model.id ?? options[0]?.model.id ?? null);
    reveal();
  });
  onMount(() => search.focus({ preventScroll: true }));
  onCleanup(() => cancelAnimationFrame(frame));

  const onSearchKey = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    const options = rows();
    if (!options.length) return;
    const index = options.findIndex(({ model }) => model.id === active());
    if (event.key === "Enter") {
      event.preventDefault();
      if (index >= 0) props.onPick(options[index].model.id);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      if (index >= 0) toggleFavorite(options[index].model.id);
      return;
    }
    let next: number;
    if (event.key === "ArrowDown") next = (index + 1) % options.length;
    else if (event.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
    else if (!query() && event.key === "Home") next = 0;
    else if (!query() && event.key === "End") next = options.length - 1;
    else return;
    event.preventDefault();
    setActive(options[next].model.id);
    reveal();
  };

  const showTab = (id: string | null) => {
    setActive(props.chosen);
    setTab(id);
    search.focus({ preventScroll: true });
  };

  return (
    <div class="model-menu" role="dialog" aria-label={t("Velg modell")} data-testid="model-menu">
      <div class="model-extra">{props.children}</div>
      <div class="model-middle">
        <label class="model-search">
          <IconSearch size={14} />
          <input
            ref={search}
            type="text"
            role="combobox"
            aria-label={t("Søk etter modeller")}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active() ? optionId(active()!) : undefined}
            placeholder={t("Søk etter modeller")}
            spellcheck={false}
            autocomplete="off"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={onSearchKey}
          />
        </label>
        <div class="model-list" ref={list}>
          <div role="listbox" aria-label={t("Modeller")} id={listId}>
            <For each={rows()}>{({ provider, model }) => {
              const starred = () => favorites().has(model.id);
              return <div class="model-menu-row" role="presentation">
                <button
                  type="button"
                  role="option"
                  tabindex="-1"
                  id={optionId(model.id)}
                  class="menu-item model-option"
                  classList={{ active: active() === model.id }}
                  aria-selected={props.chosen === model.id}
                  title={model.model === "mock" ? modelDisplayName(model) : `${model.name} (${model.model})`}
                  onPointerMove={() => setActive(model.id)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => props.onPick(model.id)}
                >
                  <ProviderIcon brand={providerBrand(provider, model)} size={14} decorative />
                  <span class="menu-name">{modelDisplayName(model)}</span>
                  <Show when={provider.localKind}><span class="model-tools">{modelAllowsTools(model, provider.localKind) ? t("Verktøy på") : t("Verktøy av")}</span></Show>
                  <span class="menu-check"><Show when={props.chosen === model.id}><IconCheck size={14} /></Show></span>
                </button>
                <button
                  type="button"
                  tabindex="-1"
                  class="icon-button model-favorite"
                  aria-label={t("Favoritt: {model}", { model: modelDisplayName(model) })}
                  aria-pressed={starred()}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (tab() === null) search.focus({ preventScroll: true });
                    toggleFavorite(model.id);
                  }}
                >{starred() ? "★" : "☆"}</button>
              </div>;
            }}</For>
          </div>
          <Show when={!rows().length}>
            <p class="model-none" role="status">{tab() === null && !favoriteCount()
              ? t("Ingen favoritter ennå. Bruk stjernen ved en modell for å legge den til.")
              : query().trim() ? t("Ingen modeller passer «{query}».", { query: query().trim() }) : t("Ingen modeller")}</p>
          </Show>
        </div>
        <div class="model-foot">
          <button type="button" class="menu-item model-manage" onClick={props.onManage}><IconSliders size={15} /><span class="menu-name">{t("Administrer modeller")}</span></button>
        </div>
      </div>
      <div class="model-providers" role="group" aria-label={t("Leverandører")}>
        <button type="button" class="menu-item model-provider" aria-pressed={tab() === null} onClick={() => showTab(null)}>
          <span class="model-provider-star" aria-hidden="true">★</span><span class="menu-name">{t("Favoritter")}</span><span class="model-count">{favoriteCount()}</span>
        </button>
        <div class="model-provider-list">
          <For each={providers()}>{({ provider, models }) => (
            <button type="button" class="menu-item model-provider" title={provider.name} aria-pressed={tab() === provider.id} onClick={() => showTab(provider.id)}>
              <ProviderIcon brand={providerBrand(provider)} size={16} decorative />
              <span class="menu-name">{provider.name}</span><span class="model-count">{models.length}</span>
            </button>
          )}</For>
        </div>
      </div>
    </div>
  );
}
