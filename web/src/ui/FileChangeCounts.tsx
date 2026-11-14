import { Show } from "solid-js";
import type { ChangedFile } from "../../../shared/protocol";

// Old event logs contain estimates without countsExact. Keep that distinction visible.
export function FileChangeCounts(props: { file: Pick<ChangedFile, "additions" | "deletions" | "binary" | "countsExact">; title?: string }) {
  return (
    <span class="file-change-counts" data-exact={props.file.countsExact === true} title={props.title ?? (props.file.binary ? "Binærfil: linjetall er ikke tilgjengelige" : props.file.countsExact === true ? "Linjer i siste registrerte tur for filen" : "Anslåtte linjetall i den registrerte endringen")}>
      <Show when={!props.file.binary} fallback={<span class="diff-kind">Binærfil</span>}>
        <Show when={props.file.countsExact !== true}><span class="diff-estimate" aria-label="Anslått">≈</span></Show>
        <span class="diff-add">+{props.file.additions}</span>
        <span class="diff-del">−{props.file.deletions}</span>
      </Show>
    </span>
  );
}
