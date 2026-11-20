import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";
import type { CommandInfo } from "../../../shared/protocol";
import { COMMAND_GROUPS, commandGroup } from "../../../shared/slash-commands";

export function CommandList(props: { commands: CommandInfo[]; initialQuery?: string; focusSearch?: boolean }) {
  const [query, setQuery] = createSignal(props.initialQuery ?? "");
  let input!: HTMLInputElement;
  createEffect(() => setQuery(props.initialQuery ?? ""));
  onMount(() => { if (props.focusSearch) input.focus(); });
  const matches = createMemo(() => {
    const input = query().trim();
    const search = input.replace(/^[/$]/, "").toLowerCase();
    const entries = input.startsWith("$") ? props.commands.filter(command => command.kind === "skill") : props.commands;
    if (!search) return entries;
    return entries.filter(command =>
      [command.name, ...(command.aliases ?? []), command.args ?? "", command.description].some(value => value.toLowerCase().includes(search))
    );
  });
  const groups = createMemo(() => Object.entries(COMMAND_GROUPS).flatMap(([id, label]) => {
    const commands = matches().filter(command => commandGroup(command) === id);
    return commands.length ? [{ label, commands }] : [];
  }));
  return (
    <div class="command-guide">
      <input ref={input} type="search" class="input command-guide-search" aria-label="Søk i kommandoer og skills"
        placeholder="Søk etter navn, alias, argument eller handling" value={query()} onInput={event => setQuery(event.currentTarget.value)} />
      <Show when={!query().trim()}>
        <p class="muted">Skriv <kbd>$</kbd> i meldingsfeltet for bare skills.</p>
      </Show>
      <For each={groups()} fallback={<p role="status" class="muted">Ingen kommandoer eller skills funnet.</p>}>
        {group => (
          <section class="command-guide-section">
            <h3>{group.label}</h3>
            <dl>
              <For each={group.commands}>
                {command => (
                  <>
                    <dt><code>{command.kind === "skill" && command.slashReserved ? "$" : "/"}{command.name}</code>
                      <Show when={command.args}> <span class="command-guide-args">{command.args}</span></Show>
                    </dt>
                    <dd>
                      {command.description}
                      <Show when={command.aliases?.length}><div class="muted">Også {command.aliases!.map(alias => `/${alias}`).join(", ")}</div></Show>
                      <Show when={command.slashReserved}><div class="muted">Bruk $ for denne skillen. Skråstrek-navnet tilhører en innebygd kommando.</div></Show>
                    </dd>
                  </>
                )}
              </For>
            </dl>
          </section>
        )}
      </For>
    </div>
  );
}
