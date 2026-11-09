// Round 11b (SPEC 25.1): Annoter in the Browser panel. The button freezes the tab on screen: the
// frame on the canvas shows at once, and the server's PNG of the same tab (browser.screenshot)
// replaces it a moment later. Over it lies a layer with numbered markers that each get a short
// comment in a bubble, a pen, a rectangle, free text, Angre and Tøm. Ferdig draws it all into one
// PNG, hands it to the message field of the pane that owns the panel (the focused one, with or
// without a thread) and puts the comments under what is typed there, as a numbered list. Avbryt or
// Esc closes without adding anything. Drawn with SVG on screen and a canvas for the PNG; nothing new
// is loaded.
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { MAX_IMAGE_BYTES } from "../../../shared/protocol";
import { observeResize } from "../lib/resize";
import { focusedThreadId } from "../state/actions";
import { scope, toast } from "../state/app";
import { annotateRequest, listenForAnnotate } from "../state/annotate";
import { gridFor } from "../state/grid";
import { deliverToComposer } from "../ui/Composer";
import { IconCheck, IconClose, IconPencil, IconTrash, IconUndo } from "../ui/icons";

type Tool = "marker" | "pen" | "rect" | "text";
type Point = [number, number];

// Everything is kept in the picture's own pixels. unit is how many of them one screen pixel was when
// the item was made, so sizes stay as they were drawn even if the panel changes size afterwards.
type Item =
  | { kind: "marker"; id: number; x: number; y: number; unit: number; comment: string }
  | { kind: "pen"; id: number; points: Point[]; unit: number }
  | { kind: "rect"; id: number; x: number; y: number; w: number; h: number; unit: number }
  | { kind: "text"; id: number; x: number; y: number; unit: number; text: string };

const MARKER_R = 11;
const MARKER_FONT = 12;
const STROKE = 3;
const HALO = 2;
const TEXT_FONT = 13;
const TEXT_PAD_X = 7;
const TEXT_H = 24;
const MAX_COMMENT = 280;

const TOOLS: Array<{ id: Tool; label: string; key: string; tip: string; hint: string; icon: (p: { size?: number }) => JSX.Element }> = [
  { id: "marker", label: "Klikk", key: "K", tip: "Klikk: en nummerert markør med en kort kommentar", hint: "Klikk der noe skal endres, og skriv en kort kommentar.", icon: IconMarker },
  { id: "pen", label: "Penn", key: "P", tip: "Penn: tegn fritt", hint: "Tegn med musen for å ringe inn eller peke på noe.", icon: IconPencil },
  { id: "rect", label: "Rektangel", key: "R", tip: "Rektangel: ramme inn et område", hint: "Dra for å ramme inn et område.", icon: IconRect },
  { id: "text", label: "Tekst", key: "T", tip: "Tekst: en fri kommentar på bildet", hint: "Klikk der teksten skal stå, skriv, og trykk Enter.", icon: IconText },
];

function IconMarker(p: { size?: number }) {
  return (
    <svg class="icon" width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.75" />
      <path d="M7 6.4 8.3 5.5v5" />
    </svg>
  );
}
function IconRect(p: { size?: number }) {
  return (
    <svg class="icon" width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
    </svg>
  );
}
function IconText(p: { size?: number }) {
  return (
    <svg class="icon" width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3.75 4.25h8.5M8 4.25v8.25M6.25 12.5h3.5" />
    </svg>
  );
}
// Corners of a picture with a pen across one of them: mark up what you see.
export function IconAnnotate(p: { size?: number }) {
  return (
    <svg class="icon" width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M2.5 5.5v-2a1 1 0 0 1 1-1h2M10.5 2.5h2a1 1 0 0 1 1 1v2M2.5 10.5v2a1 1 0 0 0 1 1h2" />
      <path d="m8.25 13.75.45-2.05 4.1-4.1 1.6 1.6-4.1 4.1z" />
    </svg>
  );
}

const pathOf = (points: Point[]) => points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");

let measurer: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string): number {
  measurer ??= document.createElement("canvas").getContext("2d");
  if (!measurer) return text.length * 7;
  measurer.font = font;
  return measurer.measureText(text).width;
}

// A CSS colour as the canvas can take it, whatever form the theme gives it in (hex, rgb, color-mix).
function resolveColor(el: HTMLElement, variable: string, fallback: string): string {
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const ctx = probe.getContext("2d");
  if (!ctx) return fallback;
  const raw = getComputedStyle(el).getPropertyValue(variable).trim();
  ctx.fillStyle = fallback;
  if (raw) ctx.fillStyle = raw;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

function hostAndPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

export function AnnotateButton(props: { projectId: string; tab: () => string | null; ready: () => boolean; url: () => string }) {
  let button!: HTMLButtonElement;
  const [open, setOpen] = createSignal(false);
  onCleanup(listenForAnnotate());
  const start = () => {
    if (open()) return;
    if (!props.ready()) return toast("Åpne en side i nettleseren først, så kan du annotere den.", "info");
    setOpen(true);
  };
  createEffect(on(annotateRequest, (seq) => seq && start(), { defer: true }));
  return (
    <>
      <button
        ref={button}
        type="button"
        class="icon-button browser-annotate-button"
        aria-label="Annoter"
        data-tip={props.ready() ? "Annoter: marker, tegn og skriv på et bilde av siden, og legg det ved meldingen" : "Annoter: åpne en side først"}
        data-keys="browser.annotate"
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-disabled={!props.ready()}
        classList={{ dim: !props.ready() }}
        onClick={start}
      >
        <IconAnnotate size={15} />
      </button>
      <Show when={open()}>
        <Portal mount={button.closest(".browser-panel") ?? document.body}>
          <AnnotateLayer
            projectId={props.projectId}
            tab={props.tab() ?? ""}
            url={props.url()}
            frame={button.closest(".browser-panel")?.querySelector<HTMLCanvasElement>(".browser-canvas") ?? null}
            onClose={(handedOver) => {
              setOpen(false);
              // After Ferdig the message field has the focus; after Avbryt the button gets it back.
              if (!handedOver) requestAnimationFrame(() => button.focus({ preventScroll: true }));
            }}
          />
        </Portal>
      </Show>
    </>
  );
}

interface Editing {
  id: number;
  kind: "marker" | "text";
  fresh: boolean; // made by this click: an empty one goes away again when it is left
  x: number;
  y: number;
  unit: number;
}

function AnnotateLayer(props: { projectId: string; tab: string; url: string; frame: HTMLCanvasElement | null; onClose: (handedOver: boolean) => void }) {
  let root!: HTMLDivElement;
  let stage!: HTMLDivElement;
  let preview: HTMLCanvasElement | undefined;
  let image: HTMLImageElement | undefined;
  let objectUrl = "";
  const [tool, setTool] = createSignal<Tool>("marker");
  const [items, setItems] = createSignal<Item[]>([]);
  const [past, setPast] = createSignal<Item[][]>([]);
  const [draft, setDraft] = createSignal<Item | null>(null);
  const [editing, setEditing] = createSignal<Editing | null>(null);
  const [peek, setPeek] = createSignal<number | null>(null);
  const [size, setSize] = createSignal({ w: props.frame?.width || 1, h: props.frame?.height || 1 });
  const [stageBox, setStageBox] = createSignal({ w: 0, h: 0 });
  const [source, setSource] = createSignal<"frame" | "png" | null>(null);
  const [closing, setClosing] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  let nextId = 1;

  // The picture fits the stage, the way the page did.
  const scale = createMemo(() => {
    const { w, h } = size();
    const box = stageBox();
    if (!box.w || !box.h) return 1;
    return Math.min(box.w / w, box.h / h);
  });
  const unit = () => 1 / scale();
  const ready = () => source() !== null && !busy();
  const markers = createMemo(() => items().filter((i): i is Extract<Item, { kind: "marker" }> => i.kind === "marker"));
  const numberOf = (id: number) => markers().findIndex((m) => m.id === id) + 1;

  const commit = (next: Item[]) => {
    batch(() => {
      setPast([...past(), items()]);
      setItems(next);
    });
  };
  const undo = () => {
    const stack = past();
    if (!stack.length) return;
    batch(() => {
      setEditing(null);
      setItems(stack.at(-1)!);
      setPast(stack.slice(0, -1));
    });
  };
  const clear = () => {
    if (!items().length) return;
    setEditing(null);
    commit([]);
  };

  // Freeze at once with the frame on screen, then take the server's PNG of the same tab.
  onMount(() => {
    if (props.frame && props.frame.width && preview) {
      preview.width = props.frame.width;
      preview.height = props.frame.height;
      preview.getContext("2d")?.drawImage(props.frame, 0, 0);
    }
    const stop = observeResize(stage, (entry) => setStageBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    onCleanup(stop);
    const params = new URLSearchParams({ projectId: props.projectId, tabId: props.tab });
    let alive = true;
    onCleanup(() => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    });
    fetch(`/api/browser/screenshot?${params}`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (!alive) return;
          image = img;
          batch(() => {
            setSize({ w: img.naturalWidth, h: img.naturalHeight });
            setSource("png");
          });
        };
        img.onerror = () => alive && useFrame();
        img.src = objectUrl;
      })
      .catch(() => alive && useFrame());
    requestAnimationFrame(() => root.focus({ preventScroll: true }));
  });
  // The server could not take the picture: the frame on screen is the picture.
  const useFrame = () => {
    if (!props.frame?.width) {
      toast("Fikk ikke tatt et bilde av siden.");
      return close();
    }
    batch(() => {
      setSize({ w: props.frame!.width, h: props.frame!.height });
      setSource("frame");
    });
  };

  const close = (handedOver = false) => {
    if (closing()) return;
    setClosing(true);
    // The fade out; with reduced motion it ends at once. The timer is the net under it.
    let ended = false;
    const done = () => {
      if (ended) return;
      ended = true;
      props.onClose(handedOver);
    };
    root.addEventListener("animationend", (e) => e.target === root && done());
    setTimeout(done, 400);
  };

  // A point in the picture's pixels.
  const toImage = (event: PointerEvent | MouseEvent): Point => {
    const frame = stage.querySelector<HTMLElement>(".annotate-frame")!.getBoundingClientRect();
    const s = scale();
    const { w, h } = size();
    return [Math.max(0, Math.min(w, (event.clientX - frame.left) / s)), Math.max(0, Math.min(h, (event.clientY - frame.top) / s))];
  };

  let drawing: { pointer: number } | null = null;
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !ready()) return;
    const current = editing();
    if (current) {
      // A click outside the open bubble ends it first; the click itself still counts.
      finishEditing(current);
    }
    const [x, y] = toImage(event);
    const id = nextId++;
    const u = unit();
    if (tool() === "marker") {
      commit([...items(), { kind: "marker", id, x, y, unit: u, comment: "" }]);
      setEditing({ id, kind: "marker", fresh: true, x, y, unit: u });
      event.preventDefault();
    } else if (tool() === "text") {
      setEditing({ id, kind: "text", fresh: true, x, y, unit: u });
      event.preventDefault();
    } else {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      drawing = { pointer: event.pointerId };
      setDraft(tool() === "pen" ? { kind: "pen", id, points: [[x, y]], unit: u } : { kind: "rect", id, x, y, w: 0, h: 0, unit: u });
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drawing || event.pointerId !== drawing.pointer) return;
    const d = draft();
    if (!d) return;
    const [x, y] = toImage(event);
    if (d.kind === "pen") {
      const [lx, ly] = d.points.at(-1)!;
      if (Math.hypot(x - lx, y - ly) < 1.5 * d.unit) return;
      setDraft({ ...d, points: [...d.points, [x, y]] });
    } else if (d.kind === "rect") {
      const start = d as Extract<Item, { kind: "rect" }> & { ox?: number; oy?: number };
      const ox = start.ox ?? d.x;
      const oy = start.oy ?? d.y;
      setDraft({ ...d, x: Math.min(ox, x), y: Math.min(oy, y), w: Math.abs(x - ox), h: Math.abs(y - oy), ox, oy } as Item);
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!drawing || event.pointerId !== drawing.pointer) return;
    drawing = null;
    const d = draft();
    setDraft(null);
    if (!d) return;
    if (d.kind === "pen" && d.points.length > 1) commit([...items(), d]);
    if (d.kind === "rect" && d.w > 4 * d.unit && d.h > 4 * d.unit) {
      const { kind, id, x, y, w, h, unit: u } = d;
      commit([...items(), { kind, id, x, y, w, h, unit: u }]);
    }
  };

  const openMarker = (id: number, event: PointerEvent) => {
    if (tool() !== "marker" || !ready()) return;
    event.stopPropagation();
    event.preventDefault();
    const current = editing();
    if (current) finishEditing(current);
    const marker = markers().find((m) => m.id === id);
    if (marker) setEditing({ id, kind: "marker", fresh: false, x: marker.x, y: marker.y, unit: marker.unit });
  };

  // The bubble or the text field is left: keep what was written. An empty new text is nothing; an
  // empty new marker stays, as a marker without a comment.
  let editorValue = "";
  const finishEditing = (current: Editing, keep = true) => {
    if (editing()?.id !== current.id) return;
    const value = editorValue.trim().slice(0, MAX_COMMENT);
    setEditing(null);
    if (current.kind === "text") {
      if (keep && value) commit([...items(), { kind: "text", id: current.id, x: current.x, y: current.y, unit: current.unit, text: value }]);
      return;
    }
    const marker = markers().find((m) => m.id === current.id);
    if (!marker || marker.comment === value || !keep) return;
    // Writing the comment of a marker just made is part of making it, so Angre takes both at once.
    const next = items().map((i) => (i.id === current.id ? { ...marker, comment: value } : i));
    if (current.fresh) setItems(next);
    else commit(next);
  };
  const cancelEditing = (current: Editing) => {
    if (editing()?.id !== current.id) return;
    if (current.kind === "marker" && current.fresh) {
      setEditing(null);
      undo();
      return;
    }
    finishEditing(current, false);
  };

  const fontFamily = () => getComputedStyle(root).fontFamily || "system-ui, sans-serif";
  const textFont = (u: number) => `600 ${TEXT_FONT * u}px ${fontFamily()}`;

  // Ferdig: one PNG of the picture and the marks, the comments as a numbered list, into the field.
  const finish = async () => {
    if (!ready()) return;
    const current = editing();
    if (current) finishEditing(current);
    setBusy(true);
    try {
      const blob = await compose();
      const file = new File([blob], `annotering-${hostAndPath(props.url).split("/")[0].replace(/[^a-z0-9.-]+/gi, "-") || "side"}.png`, { type: "image/png" });
      const key = focusedThreadId() ?? gridFor(scope()).focused();
      deliverToComposer(key, { images: [file], text: listText() });
      close(true);
    } catch {
      toast("Fikk ikke laget bildet.");
      setBusy(false);
    }
  };

  const listText = (): string => {
    const lines: string[] = [];
    const list = markers();
    const texts = items().filter((i): i is Extract<Item, { kind: "text" }> => i.kind === "text");
    if (!list.length && !texts.length) return "";
    lines.push(props.url ? `Kommentarer til skjermbildet (${hostAndPath(props.url)}):` : "Kommentarer til skjermbildet:");
    list.forEach((m, i) => lines.push(`${i + 1}. ${m.comment || "(ingen kommentar)"}`));
    for (const t of texts) lines.push(`Tekst på bildet: «${t.text}»`);
    return lines.join("\n");
  };

  const compose = async (): Promise<Blob> => {
    const { w, h } = size();
    const accent = resolveColor(root, "--accent", "#2f6fe4");
    const onAccent = resolveColor(root, "--on-accent", "#ffffff");
    const halo = "rgba(255, 255, 255, 0.8)";
    const draw = (factor: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * factor);
      canvas.height = Math.round(h * factor);
      const ctx = canvas.getContext("2d")!;
      ctx.scale(factor, factor);
      const src = source() === "png" && image ? image : preview!;
      ctx.drawImage(src, 0, 0, w, h);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const ink = (path: Path2D, u: number) => {
        ctx.strokeStyle = halo;
        ctx.lineWidth = (STROKE + HALO * 2) * u;
        ctx.stroke(path);
        ctx.strokeStyle = accent;
        ctx.lineWidth = STROKE * u;
        ctx.stroke(path);
      };
      for (const item of items()) {
        if (item.kind === "pen") ink(new Path2D(pathOf(item.points)), item.unit);
        else if (item.kind === "rect") {
          const path = new Path2D();
          path.roundRect(item.x, item.y, item.w, item.h, 4 * item.unit);
          ink(path, item.unit);
        } else if (item.kind === "text") {
          const font = textFont(item.unit);
          const tw = textWidth(item.text, font) + TEXT_PAD_X * 2 * item.unit;
          const th = TEXT_H * item.unit;
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.roundRect(item.x, item.y - th / 2, tw, th, th / 2);
          ctx.fill();
          ctx.fillStyle = onAccent;
          ctx.font = font;
          ctx.textBaseline = "middle";
          ctx.textAlign = "left";
          ctx.fillText(item.text, item.x + TEXT_PAD_X * item.unit, item.y + item.unit);
        }
      }
      // Markers last, so a line never covers a number.
      markers().forEach((m, i) => {
        const r = MARKER_R * m.unit;
        ctx.beginPath();
        ctx.arc(m.x, m.y, r + HALO * m.unit, 0, Math.PI * 2);
        ctx.fillStyle = onAccent;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.fillStyle = onAccent;
        ctx.font = `700 ${MARKER_FONT * m.unit}px ${fontFamily()}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), m.x, m.y + 0.5 * m.unit);
      });
      return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
    };
    // The image limit in the field: a very large panel gives a smaller picture, never an error.
    let factor = 1;
    for (let attempt = 0; attempt < 4; attempt++) {
      const blob = await draw(factor);
      if (blob.size <= MAX_IMAGE_BYTES) return blob;
      factor *= Math.sqrt(MAX_IMAGE_BYTES / blob.size) * 0.92;
    }
    throw new Error("for stort");
  };

  // Keys while the layer is open. A field in a bubble handles its own Enter and Esc.
  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (closing()) return;
      const target = event.target as HTMLElement | null;
      // Only keys meant for the layer: the rest of the app (the message field, say) stays usable.
      if (target && target !== document.body && !root.contains(target)) return;
      if (target?.closest(".annotate-editor")) return;
      const mod = event.ctrlKey || event.metaKey;
      let handled = true;
      if (event.key === "Escape") close();
      else if (mod && event.key === "Enter") void finish();
      else if (mod && !event.shiftKey && event.key.toLowerCase() === "z") undo();
      else if (!mod && !event.altKey && TOOLS.some((t) => t.key === event.key.toUpperCase())) setTool(TOOLS.find((t) => t.key === event.key.toUpperCase())!.id);
      else if (event.key === "Tab") handled = trapTab(event);
      else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    addEventListener("keydown", onKey, true);
    onCleanup(() => removeEventListener("keydown", onKey, true));
  });
  // Tab stays inside the layer.
  const trapTab = (event: KeyboardEvent): boolean => {
    const list = [...root.querySelectorAll<HTMLElement>("button:not(:disabled), input")];
    if (!list.length) return false;
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? (at <= 0 ? list.length - 1 : at - 1) : at === list.length - 1 ? 0 : at + 1;
    list[next].focus();
    return true;
  };

  const hint = () => TOOLS.find((t) => t.id === tool())!.hint;
  const frameStyle = () => ({ width: `${size().w * scale()}px`, height: `${size().h * scale()}px` });

  return (
    <div
      ref={root}
      class="annotate"
      classList={{ closing: closing() }}
      role="dialog"
      aria-modal="true"
      aria-label="Annoter siden"
      tabindex="-1"
      data-testid="annotate"
      data-tool={tool()}
    >
      <div class="annotate-bar" role="toolbar" aria-label="Annoteringsverktøy">
        <div class="annotate-tools" role="group" aria-label="Verktøy">
          <For each={TOOLS}>
            {(t) => (
              <button
                type="button"
                class="icon-button annotate-tool"
                aria-label={t.label}
                aria-pressed={tool() === t.id}
                data-tip={t.tip}
                data-keys={t.key}
                onClick={() => setTool(t.id)}
              >
                <t.icon size={15} />
              </button>
            )}
          </For>
        </div>
        <span class="annotate-sep" aria-hidden="true" />
        <button type="button" class="icon-button" aria-label="Angre" data-tip="Angre" data-keys="Ctrl+Z" disabled={!past().length} onClick={undo}><IconUndo size={15} /></button>
        <button type="button" class="icon-button" aria-label="Tøm" data-tip="Tøm: fjern alle markeringene" disabled={!items().length} onClick={clear}><IconTrash size={15} /></button>
        <span class="annotate-spacer" />
        <button type="button" class="btn btn-small btn-ghost annotate-cancel" aria-label="Avbryt" data-tip="Avbryt uten å legge til noe" data-keys="Esc" onClick={() => close()}>
          <IconClose size={14} /><span class="annotate-label">Avbryt</span>
        </button>
        <button type="button" class="btn btn-small btn-primary annotate-done" data-tip="Legg bildet og kommentarene i meldingsfeltet" data-keys="Ctrl+Enter" disabled={!ready()} onClick={() => void finish()}>
          <IconCheck size={14} />Ferdig
        </button>
      </div>
      <div class="annotate-stage" ref={stage}>
        <div
          class="annotate-frame"
          style={frameStyle()}
          onPointerDown={onPointerDown}
          onMouseDown={(e) => e.preventDefault()}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <canvas ref={preview} class="annotate-picture" classList={{ hidden: source() === "png" }} aria-hidden="true" />
          <Show when={source() === "png" && image}>
            <img class="annotate-picture" src={image!.src} alt="Skjermbilde av siden" draggable={false} />
          </Show>
          <svg class="annotate-marks" viewBox={`0 0 ${size().w} ${size().h}`} aria-hidden="true">
            <For each={items()}>{(item) => <Mark item={item} number={numberOf(item.id)} font={textFont} onMarker={openMarker} onPeek={setPeek} />}</For>
            <Show when={draft()} keyed>{(d) => <Mark item={d} number={0} font={textFont} onMarker={openMarker} onPeek={setPeek} />}</Show>
          </svg>
          <Show when={editing()} keyed>
            {(current) => (
              <Editor
                editing={current}
                scale={scale()}
                frameWidth={size().w * scale()}
                number={current.kind === "marker" ? numberOf(current.id) : 0}
                initial={current.kind === "marker" ? markers().find((m) => m.id === current.id)?.comment ?? "" : ""}
                onValue={(v) => (editorValue = v)}
                onDone={() => finishEditing(current)}
                onCancel={() => cancelEditing(current)}
              />
            )}
          </Show>
          <Show when={!editing() && peek() !== null && markers().find((m) => m.id === peek())}>
            {(m) => (
              <Show when={m().comment}>
                <div class="annotate-note" style={bubbleStyle(m().x * scale(), m().y * scale(), size().w * scale())} role="tooltip">
                  <span class="annotate-num" aria-hidden="true">{numberOf(m().id)}</span>{m().comment}
                </div>
              </Show>
            )}
          </Show>
        </div>
        <Show when={source() === null}>
          <div class="annotate-status" role="status"><span class="spinner" aria-hidden="true" />Fryser siden…</div>
        </Show>
        <Show when={source() !== null && !items().length && !editing() && !draft()}>
          <div class="annotate-status annotate-hint" role="status">{hint()}</div>
        </Show>
      </div>
    </div>
  );
}

// Where a bubble goes: to the right of the point, to the left when the right is too tight, and under
// it, kept inside the picture, when neither side has room (a narrow panel).
const BUBBLE_W = 262;
function bubbleStyle(x: number, y: number, frameWidth: number): JSX.CSSProperties {
  const gap = 18;
  if (x + gap + BUBBLE_W <= frameWidth) return { left: `${x + gap}px`, top: `${y}px`, "transform-origin": "left center" };
  if (x - gap - BUBBLE_W >= 0) return { right: `${frameWidth - x + gap}px`, top: `${y}px`, "transform-origin": "right center" };
  const left = Math.max(4, Math.min(x - BUBBLE_W / 2, frameWidth - BUBBLE_W - 4));
  return { left: `${left}px`, top: `${y + gap}px`, translate: "0 0", "max-width": `${frameWidth - 8}px`, "transform-origin": "center top" };
}

function Editor(props: {
  editing: Editing;
  scale: number;
  frameWidth: number;
  number: number;
  initial: string;
  onValue: (v: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  let input!: HTMLInputElement;
  let settled = false;
  props.onValue(props.initial);
  // At once, so the first letters typed after the click land in the field.
  onMount(() => input.focus({ preventScroll: true }));
  const end = (fn: () => void) => {
    if (settled) return;
    settled = true;
    fn();
  };
  const x = () => props.editing.x * props.scale;
  const y = () => props.editing.y * props.scale;
  const marker = () => props.editing.kind === "marker";
  return (
    <div
      class="annotate-editor"
      classList={{ "annotate-bubble": marker(), "annotate-text-editor": !marker() }}
      style={marker() ? bubbleStyle(x(), y(), props.frameWidth) : { left: `${x()}px`, top: `${y()}px` }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Show when={marker()}><span class="annotate-num" aria-hidden="true">{props.number}</span></Show>
      <input
        ref={input}
        class="annotate-input"
        aria-label={marker() ? `Kommentar til markør ${props.number}` : "Tekst på bildet"}
        placeholder={marker() ? "Skriv en kort kommentar" : "Skriv en tekst"}
        maxlength={MAX_COMMENT}
        value={props.initial}
        spellcheck={true}
        onInput={(e) => props.onValue(e.currentTarget.value)}
        onBlur={() => end(props.onDone)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            end(props.onDone);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            end(props.onCancel);
          }
        }}
      />
    </div>
  );
}

function Mark(props: { item: Item; number: number; font: (u: number) => string; onMarker: (id: number, e: PointerEvent) => void; onPeek: (id: number | null) => void }) {
  const item = props.item;
  const u = item.unit;
  if (item.kind === "pen") {
    return (
      <g class="annotate-ink">
        <path class="halo" d={pathOf(item.points)} stroke-width={(STROKE + HALO * 2) * u} />
        <path class="ink" d={pathOf(item.points)} stroke-width={STROKE * u} />
      </g>
    );
  }
  if (item.kind === "rect") {
    return (
      <g class="annotate-ink">
        <rect class="halo" x={item.x} y={item.y} width={item.w} height={item.h} rx={4 * u} stroke-width={(STROKE + HALO * 2) * u} />
        <rect class="ink" x={item.x} y={item.y} width={item.w} height={item.h} rx={4 * u} stroke-width={STROKE * u} />
      </g>
    );
  }
  if (item.kind === "text") {
    const font = props.font(u);
    const w = textWidth(item.text, font) + TEXT_PAD_X * 2 * u;
    const h = TEXT_H * u;
    return (
      <g class="annotate-label-mark">
        <rect x={item.x} y={item.y - h / 2} width={w} height={h} rx={h / 2} />
        <text x={item.x + TEXT_PAD_X * u} y={item.y + u} style={{ font }} dominant-baseline="middle">{item.text}</text>
      </g>
    );
  }
  const r = MARKER_R * u;
  return (
    <g
      class="annotate-marker"
      data-testid="annotate-marker"
      onPointerDown={(e) => props.onMarker(item.id, e)}
      onPointerEnter={() => props.onPeek(item.id)}
      onPointerLeave={() => props.onPeek(null)}
    >
      <circle class="halo" cx={item.x} cy={item.y} r={r + HALO * u} />
      <circle class="dot" cx={item.x} cy={item.y} r={r} />
      <text x={item.x} y={item.y + 0.5 * u} font-size={String(MARKER_FONT * u)} text-anchor="middle" dominant-baseline="central">{props.number}</text>
    </g>
  );
}
