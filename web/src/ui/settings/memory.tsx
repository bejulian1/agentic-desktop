// Personalisering og minner: the personality hint, the switch for memories, and the memories
// themselves (global, and per project) with search, add, edit, delete and Slett alle. The memories
// are lines in MEMORY.md files, so they can also be edited in an editor.
import { plural, t } from "../../lib/i18n";
import { Select } from "../Select";
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import type { HarnessInfo, MemoryItem, MemoryList, UpgradeProposal } from "../../../../shared/protocol";
import { del, get, patch, post, put } from "../../lib/api";
import { app, mode as activeMode, report, settingsOpen, toast } from "../../state/app";
import { confirmDialog } from "../dialogs";
import { IconAlert, IconPencil, IconPlus, IconSearch, IconSpark, IconTrash } from "../icons";
import { Rich, Group, Page, Row, save, Segmented, SkeletonRows, Toggle } from "./parts";
import { UpgradeView } from "./memory-upgrade";
import { ChatPersonalSettings } from "./chat-personal";

interface Shown extends MemoryItem {
  where: string; // "Global" or the project's name
}

const MAX_CHARS = 300;

export function Memories(props: { target?: string | null }) {
  const chatTargets = new Set(["Systeminstruks", "Om deg", "Tone", "Oppdater minnet av seg selv", "Lagrede Chat-minner", "Lokal dato og tid", "Modell og leverandør", "Omtrentlig posisjon"]);
  const [memoryMode, setMemoryMode] = createSignal<"chat" | "code">(props.target ? (chatTargets.has(props.target) ? "chat" : "code") : settingsOpen() === "chat-personal" ? "chat" : activeMode());
  createEffect(() => {
    if (props.target) setMemoryMode(chatTargets.has(props.target) ? "chat" : "code");
  });
  const [list, { refetch }] = createResource(() => get<MemoryList>("/api/memories"));
  const [query, setQuery] = createSignal("");
  const [scope, setScope] = createSignal("all"); // all, global or a project id
  const [adding, setAdding] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [draftScope, setDraftScope] = createSignal("global");
  const [editing, setEditing] = createSignal<string | null>(null);
  const [editText, setEditText] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const all = createMemo<Shown[]>(() => {
    const value = list();
    if (!value) return [];
    return [
      ...value.global.items.map((i) => ({ ...i, where: t("Global") })),
      ...value.projects.flatMap((p) => p.items.map((i) => ({ ...i, where: p.name }))),
    ];
  });
  const shown = createMemo(() => {
    const words = query().toLocaleLowerCase("nb").split(/\s+/).filter(Boolean);
    return all().filter((item) => {
      if (scope() === "global" && item.scope !== "global") return false;
      if (scope() !== "all" && scope() !== "global" && item.projectId !== scope()) return false;
      const hay = `${item.text} ${item.where}`.toLocaleLowerCase("nb");
      return words.every((w) => hay.includes(w));
    });
  });
  const key = (item: MemoryItem) => `${item.scope}:${item.projectId ?? ""}:${item.id}`;
  const target = (item: MemoryItem) => ({ scope: item.scope, ...(item.projectId ? { projectId: item.projectId } : {}) });

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await work();
      await refetch();
      if (done) toast(done, "info");
      return true;
    } catch (err) {
      report(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const text = draft().trim();
    if (!text) return;
    const where = draftScope();
    const ok = await run(() => post("/api/memories", where === "global" ? { scope: "global", text } : { scope: "project", projectId: where, text }), t("Minnet er lagret."));
    if (ok) {
      setDraft("");
      setAdding(false);
    }
  };

  const saveEdit = async (item: MemoryItem) => {
    const text = editText().trim();
    if (!text || text === item.text) return setEditing(null);
    if (await run(() => put(`/api/memories/${item.id}`, { ...target(item), text }))) setEditing(null);
  };

  const remove = (item: MemoryItem) =>
    run(() => del(`/api/memories/${item.id}?${new URLSearchParams(target(item) as Record<string, string>)}`), t("Minnet er slettet."));

  const clearAll = async () => {
    const count = all().length;
    if (!count) return;
    const ok = await confirmDialog({
      title: t("Slette alle Kode-minner?"),
      text: plural(count,
        "Ett Kode-minne slettes fra MEMORY.md-filen der det er lagret. Det kan ikke angres. Chat-minnene og annen tekst i filene blir stående.",
        "Alle {count} minnene, globale og i alle Kode-prosjekter, slettes fra MEMORY.md-filene. Det kan ikke angres. Chat-minnene og annen tekst i filene blir stående."),
      confirm: t("Slett alle"),
      danger: true,
    });
    if (ok) await run(() => post("/api/memories/clear", {}), t("Alle minner er slettet."));
  };

  const projects = () => list()?.projects ?? [];

  // Round 9b (SPEC 22.3): the memory upgrade. Proposals made by themselves wait in harness.json.
  const [harness, { refetch: refetchHarness, mutate: setHarness }] = createResource(() => get<HarnessInfo>("/api/harness"));
  const [upgradeScope, setUpgradeScope] = createSignal("global");
  const [useModel, setUseModel] = createSignal(false);
  const [proposal, setProposal] = createSignal<UpgradeProposal | null>(null);
  const [proposing, setProposing] = createSignal(false);
  const realModel = () => {
    const model = app.models.find((m) => m.id === app.settings.defaultModelId);
    const provider = model && app.providers.find((p) => p.id === model.providerId);
    return model && provider && provider.kind !== "mock" ? model : undefined;
  };
  const whereOf = (p: UpgradeProposal) => (p.scope === "project" ? (projects().find((x) => x.projectId === p.projectId)?.name ?? t("prosjektet")) : p.scope === "chat" ? t("Chat") : t("globale minner"));
  const pending = () => (harness()?.pending ?? []).filter((p) => p.scope !== "chat" && p.ops.length);
  const propose = async () => {
    setProposing(true);
    try {
      const scope = upgradeScope();
      setProposal(await post<UpgradeProposal>("/api/memories/upgrade", scope === "global" ? { scope, useModel: useModel() && !!realModel() } : { scope: "project", projectId: scope, useModel: useModel() && !!realModel() }));
    } catch (err) {
      report(err);
    } finally {
      setProposing(false);
    }
  };
  const upgradeDone = (changed: boolean) => {
    setProposal(null);
    void refetchHarness();
    if (changed) void refetch();
  };

  return (
    <Page title={t("Personalisering og minner")} intro="Tilpass svarene og administrer minner på ett sted. Chat og Kode har hvert sitt innhold og sine egne minnevalg.">
      <Group title={t("Tilpass modus")}>
        <Row label={memoryMode() === "chat" ? t("Chat") : t("Kode")} text={memoryMode() === "chat" ? t("Personlig profil, skrivestil og minner for Chat. Endringene deles ikke med Kode.") : t("Minner for kodearbeid, globalt og per prosjekt. Chat har sin egen profil og sine egne minner.")}>
          <Segmented<"chat" | "code"> label={t("Personalisering for")} value={memoryMode()} options={[{ value: "chat", label: t("Chat") }, { value: "code", label: t("Kode") }]} onChange={setMemoryMode} />
        </Row>
      </Group>
      {/* Keep both panels mounted so switching modes preserves unsaved edits. */}
      <div hidden={memoryMode() !== "chat"}><ChatPersonalSettings /></div>
      <section aria-label={t("Kode-minner")} hidden={memoryMode() !== "code"}>
      <Group title={t("Kode")}>
        <Row label={t("Personlighet")} text={t("Velg personlighet per Kode-tråd med /personality. Standard for nye Kode-tråder kan settes med personality i settings.json under Konfigurasjon. Minnene under brukes bare i Kode.")} icon={IconSpark} />
      </Group>
      <Group title={t("Minner")}>
        <Toggle
          label={t("Minner på tvers av tråder")}
          text={t("Kode kan lagre korte notater om deg og prosjektene, og får dem i nye Kode-tråder. Av betyr at Kode verken lagrer eller laster inn minner. Velg Chat over for å endre Chat-minnene. Nøkler, tokens og passord blir aldri lagret.")}
          checked={app.settings.memories !== false}
          onChange={(v) => save({ memories: v })}
        />
      </Group>
      <Group title={t("Minneoppgradering")}>
        <Toggle
          label={t("Foreslå opprydding av seg selv")}
          text={t("Når en minnefil har mange minner, lager appen av og til et forslag om å slå sammen like minner, fjerne utdaterte og korte ned. Det lagres aldri før du har sett det.")}
          checked={harness()?.autoUpgrade !== false}
          onChange={(v) => patch<HarnessInfo>("/api/harness", { autoUpgrade: v }).then(setHarness).catch(report)}
        />
        <Row label={t("Rydd i minnene nå")} text={realModel() ? t("Faste regler virker uten nøkkel. {model} kan også lage forslaget.", { model: realModel()!.name }) : t("Faste regler finner like, nesten like og utdaterte minner. Virker uten API-nøkkel.")}>
          <Show when={realModel()}>
            <Segmented<string> label={t("Hvem lager forslaget")} value={useModel() ? "model" : "rules"} options={[{ value: "rules", label: t("Regler") }, { value: "model", label: t("Modellen") }]} onChange={(v) => setUseModel(v === "model")} />
          </Show>
          <Select<string>
            label={t("Hvilke minner")}
            value={upgradeScope()}
            options={[{ value: "global", label: t("Globale") }, ...projects().map((p) => ({ value: p.projectId, label: p.name }))]}
            onChange={setUpgradeScope}
          />
          <button type="button" class="btn btn-small" disabled={proposing()} onClick={() => void propose()}>{proposing() ? t("Lager forslag…") : t("Lag forslag")}</button>
        </Row>
        <Show when={proposal()}>{(p) => <UpgradeView proposal={p()} where={whereOf(p())} onDone={upgradeDone} />}</Show>
        <Show when={!proposal()}>
          <For each={pending()}>{(p) => <UpgradeView proposal={p} where={whereOf(p)} onDone={upgradeDone} />}</For>
        </Show>
      </Group>
      <Group
        title={t("Lagrede minner")}
        action={
          <div class="memory-actions">
            <button type="button" class="btn btn-small" onClick={() => setAdding(!adding())}><IconPlus size={13} />{t("Legg til")}</button>
            <button type="button" class="btn btn-small btn-danger" disabled={!all().length || busy()} onClick={() => void clearAll()}>{t("Slett alle")}</button>
          </div>
        }
      >
        <Show when={adding()}>
          <form class="setting setting-block memory-form" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <label class="field"><span>{t("Nytt minne")}</span>
              <textarea class="input memory-input" rows={2} maxLength={MAX_CHARS} placeholder={t("For eksempel: Jeg vil ha svar på norsk, og kode-kommentarer på engelsk.")} value={draft()} onInput={(e) => setDraft(e.currentTarget.value)} />
            </label>
            <div class="memory-form-row">
              <div class="field memory-scope"><span>{t("Gjelder")}</span>
                <Select<string>
                  label={t("Gjelder")}
                  class="field-select"
                  value={draftScope()}
                  options={[{ value: "global", label: t("Alle prosjekter (globalt)") }, ...projects().map((p) => ({ value: p.projectId, label: p.name }))]}
                  onChange={setDraftScope}
                />
              </div>
              <span class="muted small memory-count">{draft().trim().length} / {MAX_CHARS}</span>
              <button type="button" class="btn btn-small" onClick={() => setAdding(false)}>{t("Avbryt")}</button>
              <button type="submit" class="btn btn-small btn-primary" disabled={!draft().trim() || busy()}>{t("Lagre")}</button>
            </div>
          </form>
        </Show>
        <div class="setting memory-tools">
          <div class="memory-search">
            <IconSearch size={14} />
            <input type="search" class="memory-search-input" placeholder={t("Søk i minner")} aria-label={t("Søk i minner")} value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
          </div>
          <Select<string>
            label={t("Vis minner fra")}
            value={scope()}
            options={[{ value: "all", label: t("Alle") }, { value: "global", label: t("Globale") }, ...projects().map((p) => ({ value: p.projectId, label: p.name }))]}
            onChange={setScope}
          />
        </div>
        <Show when={list()} fallback={<SkeletonRows label={t("Henter minner…")} />}>
          <Show
            when={shown().length}
            fallback={
              <div class="setting memory-empty">
                <span class="muted">{all().length ? t("Ingen minner passer til «{query}».", { query: query().trim() }) : t("Ingen minner ennå. Modellen lagrer dem når du forteller noe som er verdt å huske, eller du kan legge dem til selv.")}</span>
              </div>
            }
          >
            <ul class="memory-list" aria-label={t("Minner")}>
              <For each={shown()}>
                {(item) => (
                  <li class="setting memory-row" data-scope={item.scope}>
                    <Show
                      when={editing() === key(item)}
                      fallback={
                        <>
                          <div class="setting-text">
                            <strong class="memory-text">{item.text}</strong>
                            <span class="memory-meta">
                              <span class="pill">{item.where}</span>
                              <Show when={item.flagged}><span class="badge" title={t("Lastes ikke inn i tråder")}><IconAlert size={11} />{t("Ser ut som en hemmelighet")}</span></Show>
                            </span>
                          </div>
                          <div class="setting-control">
                            <button type="button" class="icon-button" aria-label={t("Endre «{memory}»", { memory: item.text })} title={t("Endre")} onClick={() => { setEditText(item.text); setEditing(key(item)); }}><IconPencil size={14} /></button>
                            <button type="button" class="icon-button" aria-label={t("Slett «{memory}»", { memory: item.text })} title={t("Slett")} disabled={busy()} onClick={() => void remove(item)}><IconTrash size={14} /></button>
                          </div>
                        </>
                      }
                    >
                      <form class="memory-edit" onSubmit={(e) => { e.preventDefault(); void saveEdit(item); }}>
                        <textarea
                          class="input memory-input"
                          rows={2}
                          maxLength={MAX_CHARS}
                          aria-label={t("Endre minnet")}
                          value={editText()}
                          onInput={(e) => setEditText(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(null); }
                            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveEdit(item); }
                          }}
                          ref={(el) => requestAnimationFrame(() => el.focus())}
                        />
                        <div class="memory-form-row">
                          <span class="pill">{item.where}</span>
                          <span class="spacer" />
                          <button type="button" class="btn btn-small" onClick={() => setEditing(null)}>{t("Avbryt")}</button>
                          <button type="submit" class="btn btn-small btn-primary" disabled={!editText().trim() || busy()}>{t("Lagre")}</button>
                        </div>
                      </form>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </Group>
      <p class="muted small memory-files">
        <Rich text={t("Globale minner lagres som tekstlinjer i {globalFile}, og prosjektminner i {projectFile}. Du kan også endre filene i en editor. Nye tråder får de nyeste minnene, opptil omtrent 3000 tegn, og prosjektets minner først.")} parts={{ globalFile: <code>{list()?.global.file ?? "MEMORY.md"}</code>, projectFile: <code>.agentic/MEMORY.md</code> }} />
      </p>
      </section>
    </Page>
  );
}
