// The profile page in the middle of the window: initials, name, five key numbers and the token
// activity for a year, per day, per week or added up. All numbers come from the database through
// /api/profile, fetched when the page opens and again when a run has finished.
import { createEffect, createMemo, createResource, createSignal, For, on, Show } from "solid-js";
import type { ProfileStats } from "../../../shared/protocol";
import { get } from "../lib/api";
import { formatTokens } from "../lib/format";
import { app, setSettingsOpen } from "../state/app";
import { runsFinished } from "../state/home";
import { closeProfile } from "../state/nav";
import { IconClose } from "./icons";
import { initials } from "./Sidebar";

const CELL = 11;
const GAP = 3;
const MONTHS = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];
type Day = ProfileStats["year"][number];

export function formatLongDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "–";
  if (ms < 1000) return "under 1 s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  const h = Math.floor(m / 60);
  return `${h} t ${m % 60} min`;
}

const days = (n: number) => `${n} ${n === 1 ? "dag" : "dager"}`;
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });

// Months along the bottom, at the first week that starts in a new month.
function monthMarks(year: Day[]): Array<{ week: number; label: string }> {
  const marks: Array<{ week: number; label: string }> = [];
  let last = -1;
  for (let i = 0; i < year.length; i += 7) {
    const month = Number(year[i].date.slice(5, 7)) - 1;
    if (month !== last) {
      // Not in the last two weeks, where the label would be cut off.
      if (i / 7 < year.length / 7 - 2) marks.push({ week: i / 7, label: MONTHS[month] });
      last = month;
    }
  }
  return marks;
}

function Daily(props: { year: Day[] }) {
  const levels = createMemo(() => {
    const used = props.year.map((d) => d.tokens).filter((v) => v > 0).sort((a, b) => a - b);
    const at = (q: number) => used[Math.min(used.length - 1, Math.floor(q * used.length))] ?? 0;
    return [at(0.25), at(0.5), at(0.75)];
  });
  const level = (d: Day) => {
    const value = d.tokens || (d.runs ? 1 : 0);
    if (value <= 0) return 0;
    const [a, b, c] = levels();
    return value <= a ? 1 : value <= b ? 2 : value <= c ? 3 : 4;
  };
  const weeks = () => Math.ceil(props.year.length / 7);
  const width = () => weeks() * (CELL + GAP) - GAP;
  return (
    <svg class="profile-chart" viewBox={`0 0 ${width()} ${7 * (CELL + GAP) + 14}`} role="img" aria-label="Tokens per dag det siste året" data-testid="profile-daily">
      <For each={props.year}>
        {(day, i) => (
          <rect x={Math.floor(i() / 7) * (CELL + GAP)} y={(i() % 7) * (CELL + GAP)} width={CELL} height={CELL} rx={2.5} class={`heat-${level(day)}`}>
            <title>{`${dateLabel(day.date)}: ${formatTokens(day.tokens)} tokens, ${day.runs} kjøringer`}</title>
          </rect>
        )}
      </For>
      <For each={monthMarks(props.year)}>
        {(m) => <text class="profile-axis" x={m.week * (CELL + GAP)} y={7 * (CELL + GAP) + 11}>{m.label}</text>}
      </For>
    </svg>
  );
}

function Weekly(props: { year: Day[] }) {
  const weeks = createMemo(() => {
    const out: Array<{ start: string; tokens: number }> = [];
    for (let i = 0; i < props.year.length; i += 7) {
      const slice = props.year.slice(i, i + 7);
      out.push({ start: slice[0].date, tokens: slice.reduce((sum, d) => sum + d.tokens, 0) });
    }
    return out;
  });
  const max = () => Math.max(1, ...weeks().map((w) => w.tokens));
  const height = 7 * (CELL + GAP);
  return (
    <svg class="profile-chart" viewBox={`0 0 ${weeks().length * (CELL + GAP) - GAP} ${height + 14}`} role="img" aria-label="Tokens per uke det siste året" data-testid="profile-weekly">
      <For each={weeks()}>
        {(w, i) => {
          const h = () => (w.tokens ? Math.max(2, (w.tokens / max()) * height) : 1);
          return (
            <rect x={i() * (CELL + GAP)} y={height - h()} width={CELL} height={h()} rx={2} class={w.tokens ? "heat-3" : "heat-0"}>
              <title>{`Uken fra ${dateLabel(w.start)}: ${formatTokens(w.tokens)} tokens`}</title>
            </rect>
          );
        }}
      </For>
      <For each={monthMarks(props.year)}>
        {(m) => <text class="profile-axis" x={m.week * (CELL + GAP)} y={height + 11}>{m.label}</text>}
      </For>
    </svg>
  );
}

function Cumulative(props: { year: Day[] }) {
  const width = () => Math.ceil(props.year.length / 7) * (CELL + GAP) - GAP;
  const height = 7 * (CELL + GAP);
  const points = createMemo(() => {
    let sum = 0;
    const totals = props.year.map((d) => (sum += d.tokens));
    const max = Math.max(1, sum);
    const step = width() / Math.max(1, totals.length - 1);
    return totals.map((t, i) => [i * step, height - (t / max) * (height - 2)] as const);
  });
  const line = () => points().map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  const total = () => props.year.reduce((s, d) => s + d.tokens, 0);
  return (
    <svg class="profile-chart" viewBox={`0 0 ${width()} ${height + 14}`} role="img" aria-label={`Tokens lagt sammen det siste året: ${formatTokens(total())}`} data-testid="profile-cumulative">
      <path class="profile-area" d={`${line()}L${width()} ${height}L0 ${height}Z`} />
      <path class="profile-line" d={line()} />
      <For each={monthMarks(props.year)}>
        {(m) => <text class="profile-axis" x={m.week * (CELL + GAP)} y={height + 11}>{m.label}</text>}
      </For>
    </svg>
  );
}

export default function ProfilePage() {
  const [stats, { refetch }] = createResource(() => get<ProfileStats>("/api/profile"));
  const [view, setView] = createSignal<"daily" | "weekly" | "cumulative">("daily");
  // Counted again when a run ends while the page is open, never on a timer.
  createEffect(on(runsFinished, () => void refetch(), { defer: true }));
  const name = () => app.settings.profileName?.trim() || "Profil";

  const tiles = (s: ProfileStats) => [
    { label: "Totalt antall tokens", value: formatTokens(s.totalTokens), title: `${s.totalTokens.toLocaleString("nb-NO")} tokens` },
    { label: "Høyeste antall tokens på en dag", value: s.peakDay ? formatTokens(s.peakDay.tokens) : "–", title: s.peakDay ? dateLabel(s.peakDay.date) : undefined },
    { label: "Lengste oppgave", value: formatLongDuration(s.longestRunMs), title: "Den lengste kjøringen fra start til slutt" },
    { label: "Lengste rekke", value: days(s.longestStreak), title: "Flest dager på rad med bruk" },
    { label: "Nåværende rekke", value: days(s.currentStreak), title: "Dager på rad til i dag" },
  ];

  return (
    <section class="profile-page" aria-label="Profil" data-testid="profile-page">
      <div class="profile-page-bar">
        <button type="button" class="btn btn-small" onClick={() => setSettingsOpen("usage")}>Bruk og navn</button>
        <button type="button" class="icon-button" aria-label="Lukk profilen" title="Lukk" onClick={closeProfile}><IconClose size={15} /></button>
      </div>
      <div class="profile-page-body">
        <div class="profile-hero">
          <span class="avatar profile-avatar" aria-hidden="true">{initials(app.settings.profileName)}</span>
          <h1 class="profile-page-name">{name()}</h1>
          <p class="muted">Lokal profil på denne maskinen</p>
        </div>
        <Show
          when={stats()}
          fallback={
            <div class="profile-tiles profile-loading" role="status">
              <span class="sr-only">Teller…</span>
              <For each={Array.from({ length: 5 })}>
                {() => <div class="profile-tile" aria-hidden="true"><span class="skeleton skeleton-line" /><span class="skeleton skeleton-line short" /></div>}
              </For>
            </div>
          }
        >
          {(s) => (
            <>
              <div class="profile-tiles" data-testid="profile-tiles">
                <For each={tiles(s())}>
                  {(tile) => (
                    <div class="profile-tile" title={tile.title}>
                      <span class="profile-tile-value">{tile.value}</span>
                      <span class="profile-tile-label">{tile.label}</span>
                    </div>
                  )}
                </For>
              </div>
              <div class="profile-section-head">
                <h2>Tokenaktivitet</h2>
                <div class="profile-views" role="tablist" aria-label="Visning">
                  <button type="button" role="tab" aria-selected={view() === "daily"} onClick={() => setView("daily")}>Daglig</button>
                  <button type="button" role="tab" aria-selected={view() === "weekly"} onClick={() => setView("weekly")}>Ukentlig</button>
                  <button type="button" role="tab" aria-selected={view() === "cumulative"} onClick={() => setView("cumulative")}>Akkumulert</button>
                </div>
              </div>
              <div class="profile-activity">
                {view() === "daily" ? <Daily year={s().year} /> : view() === "weekly" ? <Weekly year={s().year} /> : <Cumulative year={s().year} />}
              </div>
              <p class="muted small profile-foot">
                {s().runs} kjøringer i {s().threads} tråder, {days(s().activeDays)} i bruk. Tellingen kommer fra databasen på denne maskinen.
              </p>
              <Show when={s().byModel.length}>
                <div class="profile-section-head"><h2>Modeller</h2></div>
                <div class="profile-models">
                  <For each={s().byModel.slice(0, 5)}>
                    {(m) => (
                      <div class="profile-model">
                        <span class="profile-model-name">{m.name}</span>
                        <span class="profile-model-bar"><span style={`width:${Math.max(2, Math.round((m.tokens / Math.max(1, s().totalTokens)) * 100))}%`} /></span>
                        <span class="profile-model-value">{formatTokens(m.tokens)}</span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </>
          )}
        </Show>
      </div>
    </section>
  );
}
