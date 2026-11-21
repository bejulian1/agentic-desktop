// Shared stacked and side-by-side diff renderer with word-level highlights and narrow-width fallback.
import { t } from "../lib/i18n";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { splitDiffRows, stackedDiffSpans, type DiffLine, type InlineSpan } from "../lib/diff";
import { app } from "../state/app";
import type { DiffLayout } from "../../../shared/protocol";

export const SPLIT_MIN_WIDTH = 520;

function SpanText(props: { text: string; spans?: InlineSpan[]; kind: "add" | "del" | "same" }) {
  return (
    <Show when={props.spans && props.kind !== "same"} fallback={<>{props.text}</>}>
      <For each={props.spans!}>
        {(span) =>
          span.changed ? (
            <mark class={props.kind === "add" ? "diff-word-add" : "diff-word-del"}>{span.text}</mark>
          ) : (
            <>{span.text}</>
          )
        }
      </For>
    </Show>
  );
}

// Tracks whether a container is wide enough for side-by-side diffs.
export function useEffectiveDiffLayout(container: () => HTMLElement | undefined, requested?: () => DiffLayout): () => { layout: DiffLayout; autoStacked: boolean } {
  const [width, setWidth] = createSignal(SPLIT_MIN_WIDTH);
  onMount(() => {
    const el = container();
    if (!el) return;
    const measure = () => {
      const next = el.clientWidth;
      if (next > 0) setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });
  return createMemo(() => {
    const want = requested ? requested() : (app.settings.diffLayout ?? "stacked");
    if (want === "split" && width() < SPLIT_MIN_WIDTH) return { layout: "stacked" as DiffLayout, autoStacked: true };
    return { layout: want, autoStacked: false };
  });
}

export function DiffBlock(props: {
  items: Array<DiffLine | { kind: "skip"; count: number }>;
  layout?: DiffLayout;
  ignoreWhitespace?: boolean;
  showLineNumbers?: boolean;
  class?: string;
}) {
  let host!: HTMLDivElement;
  const effective = useEffectiveDiffLayout(() => host, props.layout ? () => props.layout! : undefined);
  const showNumbers = () => props.showLineNumbers !== false;
  const ignoreWs = () => props.ignoreWhitespace ?? (app.settings.diffIgnoreWhitespace === true);
  const splitRows = createMemo(() => effective().layout === "split" ? splitDiffRows(props.items, { ignoreWhitespace: ignoreWs() }) : []);
  const stackedSpans = createMemo(() => effective().layout === "stacked" ? stackedDiffSpans(props.items, { ignoreWhitespace: ignoreWs() }) : new Map<number, InlineSpan[]>());

  return (
    <div
      ref={host}
      class={`diff-lines ${effective().layout === "split" ? "diff-split" : "diff-stacked"} ${props.class ?? ""}`}
      data-diff-layout={effective().layout}
      data-auto-stacked={effective().autoStacked ? "true" : undefined}
    >
      <Show
        when={effective().layout === "split"}
        fallback={
          <For each={props.items}>
            {(line, index) =>
              line.kind === "skip" ? (
                <div class="diff-skip diff-fold">{t("{count} uendrede linjer", { count: line.count })}</div>
              ) : (
                <>
                  <div class={`diff-line ${line.kind} diff-${line.kind}`}>
                    <Show when={showNumbers()}>
                      <span class="diff-no">{line.oldLine ?? ""}</span>
                      <span class="diff-no">{line.newLine ?? ""}</span>
                    </Show>
                    <span class="diff-sign" aria-hidden="true">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span>
                    <span class="diff-text"><SpanText text={line.text} spans={stackedSpans().get(index())} kind={line.kind} /></span>
                  </div>
                  <Show when={line.noNewline}><div class="diff-eof">{t("Ingen linjeskift ved filslutt")}</div></Show>
                </>
              )
            }
          </For>
        }
      >
        <For each={splitRows()}>
          {(row) =>
            row.kind === "skip" ? (
              <div class="diff-skip diff-fold">{t("{count} uendrede linjer", { count: row.count })}</div>
            ) : (
              <div class="diff-split-row">
                <div class={`diff-split-cell diff-split-left ${row.left ? `${row.left.kind} diff-${row.left.kind}` : "empty"}`}>
                  <Show when={showNumbers()}>
                    <span class="diff-no">{row.left?.oldLine ?? ""}</span>
                  </Show>
                  <span class="diff-sign" aria-hidden="true">{row.left?.kind === "del" ? "−" : row.left ? " " : ""}</span>
                  <span class="diff-text">
                    <Show when={row.left}>
                      {(left) => <SpanText text={left().text} spans={row.leftSpans} kind={left().kind} />}
                    </Show>
                  </span>
                </div>
                <div class={`diff-split-cell diff-split-right ${row.right ? `${row.right.kind} diff-${row.right.kind}` : "empty"}`}>
                  <Show when={showNumbers()}>
                    <span class="diff-no">{row.right?.newLine ?? ""}</span>
                  </Show>
                  <span class="diff-sign" aria-hidden="true">{row.right?.kind === "add" ? "+" : row.right ? " " : ""}</span>
                  <span class="diff-text">
                    <Show when={row.right}>
                      {(right) => <SpanText text={right().text} spans={row.rightSpans} kind={right().kind} />}
                    </Show>
                  </span>
                </div>
              </div>
            )
          }
        </For>
      </Show>
    </div>
  );
}
