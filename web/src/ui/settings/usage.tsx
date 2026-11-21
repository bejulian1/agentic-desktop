import { useTokenTooltip} from "../TokenTooltip";
// Innstillinger → Bruk: your name, the statistics card with the token history (moved here from the
// Kode start page, SPEC 20), and what it has cost. The profile page has the long view (the year, the
// tiles, per model); this page links there instead of showing the same numbers a second way.
import { createMemo, createEffect, createResource, createSignal, For, Show } from "solid-js";
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

import { t } from "../../lib/i18n";
// Rough token counts (about 1.35 tokens per word) for the sentence under the map.
// A function, so the titles follow the active language.
const books = (): Array<[number, string]> => [
  [1_500, t("et langt dikt")],
  [9_000, t("en novelle av Tsjekhov")],
  [23_000, t("Den lille prinsen")],
  [40_000, t("Dyrenes gård")],
  [80_000, t("Fluenes herre")],
  [128_000, t("Hobbiten")],
  [165_000, t("Stolthet og fordom")],
  [280_000, t("Moby Dick")],
  [650_000, t("Ringenes herre")],
  [790_000, t("Krig og fred")],
  [1_460_000, t("hele Harry Potter-serien")],
];

function bookLine(tokens: number): string {
  const list = books();
  if (tokens <= 0) return t("Ingen tokens ennå. Send en melding, så begynner tellingen.");
  if (tokens < list[0][0]) return t("Du har brukt {tokens} tokens, omtrent som et kort dikt.", { tokens: formatTokens(tokens) });
  const [biggest, title] = list.at(-1)!;
  if (tokens >= biggest * 2) return t("Du har brukt omtrent {times} ganger så mange tokens som {title}.", { times: Math.round(tokens / biggest), title });
  const book = [...list].reverse().find(([count]) => tokens >= count)!;
  return t("Du har brukt omtrent like mange tokens som {title}.", { title: book[1] });
}

const ranges = (): Array<{ id: StatsRange; label: string; title: string }> => [
  { id: "all", label: t("Alt"), title: t("Hele tiden") },
  { id: "30d", label: t("30d"), title: t("De siste 30 dagene") },
  { id: "7d", label: t("7d"), title: t("De siste 7 dagene") },
];

const hourLabel = (hour: number | null) => (hour === null ? "–" : `${String(hour).padStart(2, "0")}:00`);
const days = (n: number) => t("{count} d", { count: n });

const CELL = 11;
const GAP = 3;

// One SVG for half a year: a column per week, a row per weekday. Levels are quartiles of the days
// that have any use, so one big day does not wash out the rest.
function HeatMap(props: { heat: HomeStats["heat"] }) {
  const tip=useTokenTooltip();
  const levels = createMemo(() => {
    const used = props.heat.map((d) => d.tokens + d.runs).filter((v) => v > 0).sort((a, b) => a - b);
    const at = (q: number) => used[Math.min(used.length - 1, Math.floor(q * used.length))] ?? 0;
    return [at(0.25), at(0.5), at(0.75)];
  });
  const level = (value: number) => {
    if (value <= 0) return 0;
    const [a, b, c] = levels();
    return value <= a ? 1 : value <= b ? 2 : value <= c ? 3 : 4;
  };
  const weeks = () => Math.ceil(props.heat.length / 7);
  return (
    <>{tip.tooltip()}<svg class="heat-map" viewBox={`0 0 ${weeks() * (CELL + GAP) - GAP} ${7 * (CELL + GAP) - GAP}`} role="img" aria-label={t("Aktivitet per dag det siste halve året")}>
      <For each={props.heat}>
        {(day, i) => (
          <rect x={Math.floor(i() / 7) * (CELL + GAP)} y={(i() % 7) * (CELL + GAP)} width={CELL} height={CELL} rx={2.5} class={`heat-${level(day.tokens + day.runs)}`} {...tip.bind(day.date,day.tokens,false,i()===0)} />
        )}
      </For>
    </svg></>
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
    [t("Økter"), String(s.sessions)],
    [t("Meldinger"), String(s.messages)],
    [t("Tokens"), formatTokens(s.totalTokens)],
    [t("Aktive dager"), String(s.activeDays)],
    [t("Rekke nå"), days(s.currentStreak)],
    [t("Lengste rekke"), days(s.longestStreak)],
    [t("Topptime"), hourLabel(s.peakHour)],
    [t("Mest brukt"), s.favoriteModel?.name ?? "–"],
  ];
  const maxModel = () => Math.max(1, ...(stats()?.byModel ?? []).map((m) => m.tokens));
  return (
    <section class="stats-card usage-stats" data-testid="stats-card" aria-label={t("Statistikk")}>
      <div class="stats-head">
        <div class="stats-tabs" role="tablist" aria-label={t("Visning")}>
          <button type="button" role="tab" class="stats-tab" aria-selected={tab() === "overview"} onClick={() => setTab("overview")}>{t("Oversikt")}</button>
          <button type="button" role="tab" class="stats-tab" aria-selected={tab() === "models"} onClick={() => setTab("models")}>{t("Modeller")}</button>
        </div>
        <div class="stats-ranges" role="group" aria-label={t("Periode")}>
          <For each={ranges()}>
            {(r) => <button type="button" class="stats-range" title={r.title} aria-pressed={range() === r.id} onClick={() => setRange(r.id)}>{r.label}</button>}
          </For>
        </div>
      </div>
      <Show
        when={stats()}
        fallback={
          <div class="stats-loading" role="status">
            <span class="sr-only">{t("Henter statistikk…")}</span>
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
                <For each={s().byModel} fallback={<li class="muted">{t("Ingen bruk i perioden.")}</li>}>
                  {(m) => (
                    <li class="stats-model">
                      <span class="stats-model-name" title={m.name}>{m.name}</span>
                      <span class="stats-bar"><span style={`transform:scaleX(${Math.max(0.02, m.tokens / maxModel())})`} /></span>
                      <span class="stats-model-num">{t("{tokens} · {runs} kj.", { tokens: formatTokens(m.tokens), runs: m.runs })}</span>
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
    <Page title={t("Bruk")} intro={t("Tallene regnes ut fra databasen på denne maskinen. Ingenting sendes noe sted.")}>
      <div class="profile-card">
        <span class="avatar" aria-hidden="true">{initials(name())}</span>
        <label class="field"><span>{t("Navn")}</span>
          <input class="input" value={name()} placeholder={t("Ditt navn")} onInput={(e) => setName(e.currentTarget.value)} onChange={() => saveSettings({ profileName: name().trim() }).catch(report)} />
        </label>
      </div>
      <Group title={t("Statistikk")}>
        <div class="setting setting-block usage-stats-row"><UsageStatsCard /></div>
      </Group>
      <Group title={t("Kostnad og profil")}>
        <Row
          label={t("Kostnad")}
          text={profile()?.costUsd == null ? t("Ingen modell med pris er brukt. Pris settes per modell under Modeller.") : t("Et øvre estimat, bare for modeller med pris. Inn- og ut-tokens telles sammen.")}
        >
          <span class="usage-cost" data-testid="usage-cost">{profile() ? (profile()!.costUsd == null ? "–" : formatCost(profile()!.costUsd!)) : "…"}</span>
        </Row>
        <Row label={t("Profil")} text={t("Tokens per dag, uke og totalt, et år med aktivitet, rekker og bruk per modell.")} icon={IconUser}>
          <button type="button" class="btn btn-small" onClick={goProfile}>{t("Åpne profil")}</button>
        </Row>
      </Group>
    </Page>
  );
}
