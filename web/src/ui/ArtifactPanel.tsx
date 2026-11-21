// Round 15 (SPEC 31.1): the artifact panel. A box in an answer opens it beside the conversation, in
// Chat and in Kode (where it stands in for the tool panel while it is open), and as a route of its
// own in a narrow window. Two tabs: Forhåndsvisning, where the app runs, and Kode, the whole file
// with highlighting. Kopier, Last ned, Lagre som artifact (the room of SPEC 14) and Åpne stort. Esc
// and the close button close it. When the model wrote the same app more than once in the thread,
// the panel goes through the versions.
//
// The app only ever runs in an iframe on the preview server's origin, sandboxed without
// allow-same-origin, from a snapshot behind a key made for this run (server/src/preview.ts). React
// is turned into JavaScript and rendered in that frame, never here.
//
// Loaded the first time a box is opened; closing it unmounts it.
import { language, t } from "../lib/i18n";
import { batch, createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { post } from "../lib/api";
import { isDark } from "../lib/theme";
import { onNextFrame } from "../lib/frame";
import { highlightWhenVisible } from "../markdown/highlight";
import { artifactLineLabel, kindIcon } from "../markdown/artifact-card";
import { artifactDisplayTitle, lineCount, versionsIn, type ArtifactDoc } from "../markdown/artifact-detect";
import { report, toast } from "../state/app";
import { createArtifact, openArtifacts, savedArtifactFor } from "../state/artifacts";
import {
  artifactBig, artifactPanel, artifactsWritten, artifactWidth, closeArtifactPanel, maxArtifactWidth, setArtifactBig, setArtifactWidth, setShownVersion, type ArtifactTab,
} from "../state/artifact-panel";
import "../styles/artifact-panel.css";
import { IconArtifact, IconBack, IconCheck, IconClose, IconCollapse, IconCopy, IconDownload, IconExpand, IconForward, IconReload } from "./icons";

const same = (a: ArtifactDoc, b: ArtifactDoc) => a.messageId === b.messageId && a.sourceKey === b.sourceKey;

// A name for the file on disk: the one the model gave, else the title, with the right ending.
export function fileNameFor(doc: ArtifactDoc): string {
  const base = (doc.file ?? doc.title).replace(/\.(html?|jsx|tsx)$/i, "");
  const safe = base.normalize("NFKD").replace(/[^\w .-]+/g, "").trim().replace(/\s+/g, "-").replace(/^[.-]+/, "").slice(0, 60);
  return `${safe || "artifact"}.${doc.lang}`;
}

function CodeView(props: { doc: ArtifactDoc }) {
  let scroller!: HTMLDivElement;
  let code!: HTMLElement;
  const numbers = createMemo(() => Array.from({ length: lineCount(props.doc.code) }, (_, i) => i + 1).join("\n"));
  createEffect(on(() => props.doc, (doc) => {
    code.textContent = doc.code;
    scroller.scrollTop = 0;
    highlightWhenVisible(scroller, code, doc.lang, doc.code);
  }));
  return (
    <div class="artifact-source" ref={scroller} tabindex="0" role="region" aria-label={t("Koden i {title}", { title: artifactDisplayTitle(props.doc) })} data-testid="artifact-source">
      <pre class="artifact-gutter" aria-hidden="true">{numbers()}</pre>
      <pre class="artifact-code-text"><code ref={code} /></pre>
    </div>
  );
}

function Preview(props: { doc: ArtifactDoc; run: number }) {
  // A snapshot on the preview origin, asked for again on every run: the server keeps the same URL
  // for the same code, and makes a new one if it has let the old one go.
  const [url] = createResource(
    () => ({ code: props.doc.code, lang: props.doc.lang, run: props.run }),
    ({ code, lang }) => post<{ url: string }>("/api/previews", { html: code, lang }).then((r) => r.url),
  );
  const [loaded, setLoaded] = createSignal(false);
  // The React preview draws its own messages in the app's light or dark look.
  const src = createMemo(() => {
    const base = url();
    return base ? `${base}#tema=${isDark() ? "mork" : "lys"}${props.doc.lang === "html" ? "" : `&lang=${language()}`}` : undefined;
  });
  // A new frame for every run, also when the address is the same.
  const frame = createMemo(() => (src() ? { address: src()!, run: props.run } : undefined));
  createEffect(on(frame, () => setLoaded(false)));
  return (
    <div class="artifact-stage" data-loaded={loaded() ? "" : undefined}>
      <Show when={!url.error} fallback={
        <div class="artifact-stage-note" role="alert">
          <p>{t("Forhåndsvisningen kunne ikke lages.")}</p>
          <p class="muted">{(url.error as Error)?.message ?? ""}</p>
        </div>
      }>
        <Show when={frame()} keyed>
          {({ address }) => (
            <iframe
              class="artifact-iframe"
              title={t("Forhåndsvisning: {title}", { title: artifactDisplayTitle(props.doc) })}
              sandbox={props.doc.lang === "html" ? "allow-scripts allow-modals" : "allow-scripts allow-modals allow-forms"}
              referrerpolicy="no-referrer"
              allow=""
              src={address}
              onLoad={() => setLoaded(true)}
            />
          )}
        </Show>
        <Show when={!loaded()}>
          <div class="artifact-stage-loading" aria-hidden="true"><span class="artifact-box-spinner" /></div>
        </Show>
      </Show>
    </div>
  );
}

export default function ArtifactPanel() {
  let root!: HTMLElement;

  // The versions of this app in the thread, oldest first. A new one written while the panel is
  // open comes in, and is shown if the newest was.
  const versions = createMemo<ArtifactDoc[]>((before) => {
    artifactsWritten();
    const s = artifactPanel();
    if (!s) return before ?? [];
    const found = versionsIn(s.threadId, s.doc.key);
    return found.some((d) => same(d, s.doc)) ? found : [s.doc];
  });
  const [index, setIndex] = createSignal(0);
  const [tab, setTab] = createSignal<ArtifactTab>("preview");
  const [run, setRun] = createSignal(0);

  // A new open, also of the same box: its version and its tab.
  createEffect(on(() => artifactPanel()?.seq, () => {
    const s = artifactPanel();
    if (!s) return;
    batch(() => {
      setIndex(Math.max(0, versions().findIndex((d) => same(d, s.doc))));
      setTab(s.tab);
    });
    if (s.focus) onNextFrame(() => root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true }));
  }));
  createEffect(on(versions, (list, before) => {
    if (!before) return;
    const wasNewest = index() >= before.length - 1;
    if (list.length > before.length && wasNewest) setIndex(list.length - 1);
    else if (index() > list.length - 1) setIndex(Math.max(0, list.length - 1));
  }, { defer: true }));

  // The last one stays while the panel closes, so nothing reads a state that is gone.
  const doc = createMemo<ArtifactDoc>((last) => versions()[index()] ?? artifactPanel()?.doc ?? last!);
  createEffect(() => setShownVersion({ messageId: doc().messageId, sourceKey: doc().sourceKey }));
  onCleanup(() => setShownVersion(null));

  const saved = createMemo(() => savedArtifactFor(doc().messageId, doc().sourceKey));
  const [saving, setSaving] = createSignal(false);
  const save = async () => {
    const current = doc();
    if (saved()) return openArtifacts(saved()!.id);
    setSaving(true);
    try {
      await createArtifact({ html: current.code, lang: current.lang, threadId: artifactPanel()?.threadId ?? null, messageId: current.messageId, sourceKey: current.sourceKey });
      toast(t("«{title}» er lagret i Artifacts", { title: current.title }), "info");
    } catch (err) {
      report(err);
    } finally {
      setSaving(false);
    }
  };

  const [copied, setCopied] = createSignal(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  const copy = () => {
    void navigator.clipboard?.writeText(doc().code).then(() => {
      setCopied(true);
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => setCopied(false), 1400);
    }).catch(() => toast(t("Fikk ikke kopiert koden")));
  };
  onCleanup(() => clearTimeout(copiedTimer));

  const download = () => {
    const current = doc();
    // A file on disk ends with a line break; the block's text does not.
    const blob = new Blob([current.code.endsWith("\n") ? current.code : `${current.code}\n`], { type: current.lang === "html" ? "text/html;charset=utf-8" : "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileNameFor(current);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  };

  // Esc closes, unless a dialog or a menu is open, or the key is meant for a text field outside.
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("dialog[open], .popover, .context-menu")) return;
      const active = document.activeElement as HTMLElement | null;
      const typing = !!active && active !== document.body && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
      // An empty message field is not in the way: Esc there closes too.
      const emptyField = active instanceof HTMLTextAreaElement && !active.value && !!active.closest(".composer");
      if (typing && !root.contains(active) && !emptyField) return;
      event.preventDefault();
      closeArtifactPanel();
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  // Width, by dragging the left edge like the tool panel.
  let target = artifactWidth();
  const startResize = (event: PointerEvent) => {
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      target = Math.min(Math.max(innerWidth - e.clientX, 340), maxArtifactWidth());
      onNextFrame(() => setArtifactWidth(target));
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      setArtifactWidth(target, true);
    };
    handle.addEventListener("pointermove", move, { passive: true });
    handle.addEventListener("pointerup", end);
  };

  const lines = () => lineCount(doc().code);
  const tabs: Array<{ id: ArtifactTab; label: string }> = [
    { id: "preview", get label() { return t("Forhåndsvisning"); } },
    { id: "code", get label() { return t("Kode"); } },
  ];
  const onTabKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: ArtifactTab = tab() === "preview" ? "code" : "preview";
    setTab(next);
    root.querySelector<HTMLElement>(`[role="tab"][data-tab="${next}"]`)?.focus();
  };

  return (
    <aside class="artifact-panel" ref={root} aria-label={t("Artifact: {title}", { title: artifactDisplayTitle(doc()) })} data-testid="artifact-panel" data-lang={doc().lang} data-tab={tab()}>
      <div class="panel-resize" title={t("Dra for å endre bredden. Dobbeltklikk for standard.")} onPointerDown={startResize} onDblClick={() => setArtifactWidth(Math.round(Math.min(Math.max(innerWidth * 0.44, 420), 760)), true)} />
      <header class="artifact-panel-head">
        <span class="artifact-panel-icon" aria-hidden="true">{kindIcon(doc().lang)}</span>
        <div class="artifact-panel-heading">
          <h2 title={doc().file ?? artifactDisplayTitle(doc())}>{artifactDisplayTitle(doc())}</h2>
          <span class="artifact-panel-meta">
            {artifactLineLabel(doc().lang, lines())}
            <Show when={saved()}>{(a) => <span class="artifact-panel-saved" title={t("Lagret i Artifacts som «{title}»", { title: a().title })}>{" "}{t("· Lagret")}</span>}</Show>
          </span>
        </div>
        <Show when={versions().length > 1}>
          <div class="artifact-versions" role="group" aria-label={t("Versjoner")}>
            <button type="button" class="icon-button" aria-label={t("Forrige versjon")} title={t("Forrige versjon")} disabled={index() === 0} onClick={() => setIndex(index() - 1)}><IconBack size={14} /></button>
            <span class="artifact-versions-label" aria-live="polite">{t("Versjon {current} av {total}", { current: index() + 1, total: versions().length })}</span>
            <button type="button" class="icon-button" aria-label={t("Neste versjon")} title={t("Neste versjon")} disabled={index() >= versions().length - 1} onClick={() => setIndex(index() + 1)}><IconForward size={14} /></button>
          </div>
        </Show>
        <button
          type="button"
          class="icon-button artifact-expand"
          aria-label={artifactBig() ? t("Vanlig størrelse") : t("Åpne stort")}
          title={artifactBig() ? t("Vanlig størrelse") : t("Åpne stort")}
          aria-pressed={artifactBig()}
          onClick={() => setArtifactBig(!artifactBig())}
        >
          <Show when={artifactBig()} fallback={<IconExpand size={15} />}><IconCollapse size={15} /></Show>
        </button>
        <button type="button" class="icon-button" aria-label={t("Lukk artifacten")} title={t("Lukk (Esc)")} onClick={closeArtifactPanel}><IconClose size={15} /></button>
      </header>
      <div class="artifact-panel-bar">
        <div class="segmented artifact-tabs" role="tablist" aria-label={t("Visning")}>
          <For each={tabs}>
            {(item) => (
              <button
                type="button"
                role="tab"
                class="segment"
                data-tab={item.id}
                id={`artifact-tab-${item.id}`}
                aria-controls="artifact-panel-body"
                aria-selected={tab() === item.id}
                tabindex={tab() === item.id ? 0 : -1}
                onClick={() => setTab(item.id)}
                onKeyDown={onTabKey}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
        <span class="spacer" />
        <Show when={tab() === "preview"}>
          <button type="button" class="icon-button" aria-label={t("Last inn på nytt")} title={t("Last inn på nytt")} onClick={() => setRun(run() + 1)}><IconReload size={15} /></button>
        </Show>
        <button type="button" class="btn btn-small artifact-action" data-done={copied() ? "" : undefined} aria-label={copied() ? t("Kopiert") : t("Kopier koden")} title={t("Kopier hele fila")} onClick={copy}>
          <Show when={copied()} fallback={<IconCopy size={14} />}><IconCheck size={14} /></Show>
          <span class="artifact-action-label">{copied() ? t("Kopiert") : t("Kopier")}</span>
        </button>
        <button type="button" class="btn btn-small artifact-action" aria-label={t("Last ned")} title={t("Last ned som {file}", { file: fileNameFor(doc()) })} onClick={download}>
          <IconDownload size={14} /><span class="artifact-action-label">{t("Last ned")}</span>
        </button>
        <button
          type="button"
          class="btn btn-small artifact-action"
          disabled={saving()}
          aria-label={saved() ? t("Åpne i Artifacts") : t("Lagre som artifact")}
          title={saved() ? t("Åpne den lagrede i Artifacts") : t("Lagre i Artifacts, der den kan endres og kjøres senere")}
          onClick={() => void save()}
        >
          <IconArtifact size={14} /><span class="artifact-action-label">{saved() ? t("Åpne i Artifacts") : t("Lagre som artifact")}</span>
        </button>
      </div>
      <div class="artifact-panel-body" id="artifact-panel-body" role="tabpanel" aria-labelledby={`artifact-tab-${tab()}`}>
        <Show when={tab() === "preview"} fallback={<CodeView doc={doc()} />}>
          <Show when={`${doc().messageId}:${doc().sourceKey}`} keyed>
            {(_key) => <Preview doc={doc()} run={run()} />}
          </Show>
        </Show>
      </div>
    </aside>
  );
}
