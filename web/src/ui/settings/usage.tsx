// Innstillinger → Bruk: your name, the statistics card with the token history (moved here from the
// Kode start page, SPEC 20), and what it has cost. The profile page has the long view (the year, the
// tiles, per model); this page links there instead of showing the same numbers a second way.
import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import type { HomeStats, ProfileStats, StatsRange } from "../../../../shared/protocol";
import { get } from "../../lib/api";
import { formatCost, formatTokens } from "../../lib/format";
import { app, report, saveSettings, setSettingsOpen } from "../../state/app";
import { closeArtifacts } from "../../state/artifacts";
import { homeStats, loadHomeStats, runsFinished } from "../../state/home";
import { openProfile } from "../../state/nav";
import { IconUser } from "../icons";
import { initials } from "../Sidebar";
import { Group, Page, Row } from "./parts";

// Rough token counts (about 1.35 tokens per word) for the sentence under the map.
const BOOKS: Array<[number, string]> = [
  [1_500, "et langt dikt"],
  [9_000, "en novelle av Tsjekhov"],
  [23_000, "Den lille prinsen"],
  [40_000, "Dyrenes gård"],
  [80_000, "Fluenes herre"],
  [128_000, "Hobbiten"],
  [165_000, "Stolthet og fordom"],
  [280_000, "Moby Dick"],
  [650_000, "Ringenes herre"],
  [790_000, "Krig og fred"],
  [1_460_000, "hele Harry Potter-serien"],
];

function bookLine(tokens: number): string {
  if (tokens <= 0) return "Ingen tokens ennå. Send en melding, så begynner tellingen.";
  if (tokens < BOOKS[0][0]) return `Du har brukt ${formatTokens(tokens)} tokens, omtrent som et kort dikt.`;
  const [biggest, title] = BOOKS.at(-1)!;
  if (tokens >= biggest * 2) return `Du har brukt omtrent ${Math.round(tokens / biggest)} ganger så mange tokens som ${title}.`;
  const book = [...BOOKS].reverse().find(([count]) => tokens >= count)!;
  return `Du har brukt omtrent like mange tokens som ${book[1]}.`;
}

const RANGES: Array<{ id: StatsRange; label: string; title: string }> = [
  { id: "all", label: "Alt", title: "Hele tiden" },
  { id: "30d", label: "30d", title: "De siste 30 dagene" },
  { id: "7d", label: "7d", title: "De siste 7 dagene" },
];

const hourLabel = (hour: number | null) => (hour === null ? "–" : `${String(hour).padStart(2, "0")}:00`);
const days = (n: number) => `${n} d`;

const CELL = 11;
const GAP = 3;

// One SVG for half a year: a column per week, a row per weekday. Levels are quartiles of the days
// that have any use, so one big day does not wash out the rest.
function HeatMap(props: { heat: HomeStats["heat"] }) {
  const levels = () => {
    const used = props.heat.map((d) => d.tokens + d.runs).filter((v) => v > 0).sort((a, b) => a - b);
    const at = (q: number) => used[Math.min(used.length - 1, Math.floor(q * used.length))] ?? 0;
    return [at(0.25), at(0.5), at(0.75)];
  };
  const level = (value: number) => {
    if (value <= 0) return 0;
    const [a, b, c] = levels();
    return value <= a ? 1 : value <= b ? 2 : value <= c ? 3 : 4;
  };
  const weeks = () => Math.ceil(props.heat.length / 7);
  const label = (d: HomeStats["heat"][number]) =>
    `${new Date(`${d.date}T12:00:00`).toLocaleDateString("nb-NO", { day: "numeric", month: "short" })}: ${formatTokens(d.tokens)} tokens, ${d.runs} kjøringer`;
  return (
    <svg class="heat-map" viewBox={`0 0 ${weeks() * (CELL + GAP) - GAP} ${7 * (CELL + GAP) - GAP}`} role="img" aria-label="Aktivitet per dag det siste halve året">
      <For each={props.heat}>
        {(day, i) => (
          <rect x={Math.floor(i() / 7) * (CELL + GAP)} y={(i() % 7) * (CELL + GAP)} width={CELL} height={CELL} rx={2.5} class={`heat-${level(day.tokens + day.runs)}`}>
            <title>{label(day)}</title>
          </rect>
        )}
      </For>
    </svg>
  );
}

// The statistics card: sessions, messages, tokens and streaks for a period, the half-year map,
// and the models. It fetches only while it is shown, and again when a run has ended.
export function UsageStatsCard() {
  const [tab, setTab] = createSignal<"overview" | "models">("overview");
  const [range, setRange] = createSignal<StatsRange>("all");
  createEffect(() => {
    runsFinished();
    loadHomeStats(range());
  });
  const stats = () => homeStats(range());
  // Short labels, so nothing is cut at the card's width; the tip has the whole value.
  const tiles = (s: HomeStats): Array<[string, string]> => [
    ["Økter", String(s.sessions)],
    ["Meldinger", String(s.messages)],
    ["Tokens", formatTokens(s.totalTokens)],
    ["Aktive dager", String(s.activeDays)],
    ["Rekke nå", days(s.currentStreak)],
    ["Lengste rekke", days(s.longestStreak)],
    ["Topptime", hourLabel(s.peakHour)],
    ["Mest brukt", s.favoriteModel?.name ?? "–"],
  ];
  const maxModel = () => Math.max(1, ...(stats()?.byModel ?? []).map((m) => m.tokens));
  return (
    <section class="stats-card usage-stats" data-testid="stats-card" aria-label="Statistikk">
      <div class="stats-head">
        <div class="stats-tabs" role="tablist" aria-label="Visning">
          <button type="button" role="tab" class="stats-tab" aria-selected={tab() === "overview"} onClick={() => setTab("overview")}>Oversikt</button>
          <button type="button" role="tab" class="stats-tab" aria-selected={tab() === "models"} onClick={() => setTab("models")}>Modeller</button>
        </div>
        <div class="stats-ranges" role="group" aria-label="Periode">
          <For each={RANGES}>
            {(r) => <button type="button" class="stats-range" title={r.title} aria-pressed={range() === r.id} onClick={() => setRange(r.id)}>{r.label}</button>}
          </For>
        </div>
      </div>
      <Show
        when={stats()}
        fallback={
          <div class="stats-loading" role="status">
            <span class="sr-only">Henter statistikk…</span>
            <div class="stats-grid" aria-hidden="true"><For each={Array.from({ length: 8 })}>{() => <div class="stats-tile skeleton" />}</For></div>
            <div class="skeleton stats-heat-skeleton" aria-hidden="true" />
          </div>
        }
      >
        {(s) => (
          <Show
            when={tab() === "overview"}
            fallback={
              <ul class="stats-models">
                <For each={s().byModel} fallback={<li class="muted">Ingen bruk i perioden.</li>}>
                  {(m) => (
                    <li class="stats-model">
                      <span class="stats-model-name" title={m.name}>{m.name}</span>
                      <span class="stats-bar"><span style={`transform:scaleX(${Math.max(0.02, m.tokens / maxModel())})`} /></span>
                      <span class="stats-model-num">{formatTokens(m.tokens)} · {m.runs} kj.</span>
                    </li>
                  )}
                </For>
              </ul>
            }
          >
            <div class="stats-grid">
              <For each={tiles(s())}>
                {([label, value]) => (
                  <div class="stats-tile">
                    <span class="stats-label">{label}</span>
                    <span class="stats-value" title={value}>{value}</span>
                  </div>
                )}
              </For>
            </div>
            <div class="heat-wrap"><HeatMap heat={s().heat} /></div>
            <p class="stats-fun">{bookLine(s().totalTokens)}</p>
          </Show>
        )}
      </Show>
    </section>
  );
}

export function Usage() {
  const [profile] = createResource(() => get<ProfileStats>("/api/profile"));
  const [name, setName] = createSignal(app.settings.profileName ?? "");
  const goProfile = () => {
    setSettingsOpen(null);
    closeArtifacts();
    openProfile();
  };
  return (
    <Page title="Bruk" intro="Tallene regnes ut fra databasen på denne maskinen. Ingenting sendes noe sted.">
      <div class="profile-card">
        <span class="avatar" aria-hidden="true">{initials(name())}</span>
        <label class="field"><span>Navn</span>
          <input class="input" value={name()} placeholder="Ditt navn" onInput={(e) => setName(e.currentTarget.value)} onChange={() => saveSettings({ profileName: name().trim() }).catch(report)} />
        </label>
      </div>
      <Group title="Statistikk">
        <div class="setting setting-block usage-stats-row"><UsageStatsCard /></div>
      </Group>
      <Group title="Kostnad og profil">
        <Row
          label="Kostnad"
          text={profile()?.costUsd == null ? "Ingen modell med pris er brukt. Pris settes per modell under Modeller." : "Et øvre estimat, bare for modeller med pris. Inn- og ut-tokens telles sammen."}
        >
          <span class="usage-cost" data-testid="usage-cost">{profile() ? (profile()!.costUsd == null ? "–" : formatCost(profile()!.costUsd!)) : "…"}</span>
        </Row>
        <Row label="Profil" text="Tokens per dag, uke og totalt, et år med aktivitet, rekker og bruk per modell." icon={IconUser}>
          <button type="button" class="btn btn-small" onClick={goProfile}>Åpne profil</button>
        </Row>
      </Group>
    </Page>
  );
}
