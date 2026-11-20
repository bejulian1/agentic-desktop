interface Point {
  label: string;
  value: number;
  group?: string;
}

interface Chart {
  type: "bar" | "line";
  title: string;
  unit?: string;
  data: Point[];
}

function isLabel(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function parseChart(source: string): Chart | null {
  if (source.length > 24_000) return null;
  try {
    const chart = JSON.parse(source);
    if (!chart || (chart.type !== "bar" && chart.type !== "line") || !isLabel(chart.title, 160)) return null;
    if (chart.unit !== undefined && !isLabel(chart.unit, 24)) return null;
    if (!Array.isArray(chart.data) || chart.data.length < (chart.type === "line" ? 2 : 1) || chart.data.length > 48) return null;
    for (const point of chart.data) {
      if (!point || !isLabel(point.label, 100) || !Number.isFinite(point.value)) return null;
      if (point.group !== undefined && (chart.type !== "bar" || !isLabel(point.group, 80))) return null;
    }
    return chart;
  } catch {
    return null;
  }
}

const decimal = new Intl.NumberFormat("nb-NO", { maximumSignificantDigits: 21 });
const scientific = new Intl.NumberFormat("nb-NO", { notation: "scientific", maximumSignificantDigits: 21 });

function measure(value: number, unit?: string): string {
  const abs = Math.abs(value);
  const format = abs >= 1e12 || (abs > 0 && abs < 1e-6) ? scientific : decimal;
  return format.format(value) + (unit ? ` ${unit}` : "");
}

// Normalize first only if opposite extremes overflow the range of a finite number.
function fraction(value: number, min: number, max: number): number {
  if (min === max) return 0.5;
  if (Number.isFinite(max - min)) return (value - min) / (max - min);
  return (value / 2 - min / 2) / (max / 2 - min / 2);
}

function span(className: string, text?: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function bars(chart: Chart, min: number, max: number): HTMLElement {
  // All bars share the same zero baseline, including datasets with negative values.
  min = Math.min(0, min);
  max = Math.max(0, max);
  const zero = min === max ? 0 : fraction(0, min, max);
  const groups = new Map<string, number>();
  const table = document.createElement("table");
  table.className = "chart-bars";
  const body = table.createTBody();
  for (const { label, value, group } of chart.data) {
    const row = body.insertRow();
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = group ? `${group} · ${label}` : label;
    row.appendChild(name);
    const plot = row.insertCell();
    plot.className = "chart-track-cell";
    plot.setAttribute("aria-hidden", "true");
    const track = span("chart-track");
    const bar = span("chart-bar");
    const end = min === max ? zero : fraction(value, min, max);
    bar.style.left = `${100 * Math.min(zero, end)}%`;
    bar.style.width = `${100 * Math.abs(end - zero)}%`;
    const key = group ?? "";
    if (!groups.has(key)) groups.set(key, groups.size);
    bar.dataset.color = String(groups.get(key)! % 4);
    track.appendChild(bar);
    if (min < 0) {
      const baseline = span("chart-zero");
      baseline.style.left = `${zero * 100}%`;
      track.appendChild(baseline);
    }
    plot.appendChild(track);
    row.insertCell().textContent = measure(value, chart.unit);
  }
  return table;
}

function line(chart: Chart, min: number, max: number): HTMLElement {
  const root = document.createElement("div");
  const graph = document.createElement("div");
  graph.className = "chart-line";
  graph.setAttribute("aria-hidden", "true");
  const scale = span("chart-scale");
  if (min === max) scale.classList.add("constant");
  scale.appendChild(span("", measure(max, chart.unit)));
  if (min !== max) scale.appendChild(span("", measure(min, chart.unit)));
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  const path = document.createElementNS(ns, "polyline");
  path.setAttribute("points", chart.data.map((p, i) =>
    `${100 * i / (chart.data.length - 1)},${100 * (1 - fraction(p.value, min, max))}`
  ).join(" "));
  svg.appendChild(path);
  const labels = span("chart-endpoints");
  labels.append(span("", chart.data[0].label), span("", chart.data[chart.data.length - 1].label));
  graph.append(scale, svg, labels);

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Vis verdiene";
  const values = document.createElement("dl");
  for (const point of chart.data) {
    const label = document.createElement("dt");
    label.textContent = point.label;
    const value = document.createElement("dd");
    value.textContent = measure(point.value, chart.unit);
    values.append(label, value);
  }
  details.append(summary, values);
  root.append(graph, details);
  return root;
}

// The format is data only. Labels are text nodes, geometry comes from validated numbers.
export function renderChart(source: string): HTMLElement | null {
  const chart = parseChart(source);
  if (!chart) return null;
  const values = chart.data.map(point => point.value);
  const draw = chart.type === "bar" ? bars : line;
  const figure = document.createElement("figure");
  figure.className = "md-chart";
  const caption = document.createElement("figcaption");
  caption.textContent = chart.title;
  figure.append(caption, draw(chart, Math.min(...values), Math.max(...values)));
  return figure;
}
