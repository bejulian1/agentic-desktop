// The memory upgrade as Innstillinger shows it (SPEC 22.3): a proposal, one row per change, each
// with a check box, the old text struck through and the new one under it, and why. Nothing is
// written before «Lagre valgte». Used for the Kode memories and for Chat's own.
import { plural, t } from "../../lib/i18n";
import { createSignal, For, Show } from "solid-js";
import type { UpgradeProposal } from "../../../../shared/protocol";
import { post } from "../../lib/api";
import { report, toast } from "../../state/app";
import { IconSpark } from "../icons";

const KIND: Record<string, string> = { get merge() { return t("Slå sammen"); }, get remove() { return t("Fjern"); }, get shorten() { return t("Kort ned"); } };

export function UpgradeView(props: { proposal: UpgradeProposal; where: string; onDone: (changed: boolean) => void }) {
  const [chosen, setChosen] = createSignal<Set<number>>(new Set(props.proposal.ops.map((_, i) => i)));
  const [busy, setBusy] = createSignal(false);
  const toggle = (i: number, on: boolean) => {
    const next = new Set(chosen());
    if (on) next.add(i);
    else next.delete(i);
    setChosen(next);
  };
  const apply = async () => {
    setBusy(true);
    try {
      const { changed } = await post<{ changed: number }>("/api/memories/upgrade/apply", { proposal: props.proposal, selected: [...chosen()] });
      toast(changed ? plural(chosen().size, "Minnene er ryddet: én endring.", "Minnene er ryddet: {count} endringer.") : t("Ingenting ble endret."), "info");
      props.onDone(true);
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async () => {
    try {
      await post("/api/memories/upgrade/dismiss", { scope: props.proposal.scope, ...(props.proposal.projectId ? { projectId: props.proposal.projectId } : {}) });
    } catch {
      // Only a pending proposal to forget; the next one replaces it anyway.
    }
    props.onDone(false);
  };
  return (
    <div class="upgrade" data-testid="memory-upgrade">
      <div class="upgrade-head">
        <IconSpark size={15} />
        <div class="setting-text">
          <strong>{t("Forslag til opprydding: {scope}", { scope: props.where })}</strong>
          <span class="muted">
            {props.proposal.ops.length
              ? plural(props.proposal.ops.length, "Én endring, laget av {source}. Ingenting lagres før du velger det.", "{count} endringer, laget av {source}. Ingenting lagres før du velger det.", { source: props.proposal.source === "modell" ? t("modellen") : t("faste regler") })
              : t("Ingenting å rydde: ingen like, nesten like eller utdaterte minner.")}
          </span>
          <Show when={props.proposal.note}><span class="muted upgrade-note">{props.proposal.note}</span></Show>
        </div>
      </div>
      <Show when={props.proposal.ops.length}>
        <ul class="upgrade-list" aria-label={t("Foreslåtte endringer")}>
          <For each={props.proposal.ops}>
            {(op, i) => (
              <li class="upgrade-op" classList={{ off: !chosen().has(i()) }}>
                <label class="upgrade-check">
                  <input type="checkbox" checked={chosen().has(i())} onChange={(e) => toggle(i(), e.currentTarget.checked)} aria-label={`${KIND[op.kind]}: ${op.texts.join(" / ")}`} />
                </label>
                <div class="upgrade-body">
                  <span class={`upgrade-kind upgrade-${op.kind}`}>{KIND[op.kind]}</span>
                  <For each={op.texts}>{(text) => <span class="upgrade-old">{text}</span>}</For>
                  <Show when={op.result}><span class="upgrade-new">{op.result}</span></Show>
                  <span class="muted upgrade-reason">{op.reason}</span>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="form-actions upgrade-actions">
        <button type="button" class="btn btn-small" onClick={() => void dismiss()}>{props.proposal.ops.length ? t("Forkast") : t("Lukk")}</button>
        <Show when={props.proposal.ops.length}>
          <button type="button" class="btn btn-small btn-primary" disabled={busy() || !chosen().size} onClick={() => void apply()}>
            {t("Lagre valgte ({count})", { count: chosen().size })}
          </button>
        </Show>
      </div>
    </div>
  );
}
