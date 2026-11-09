// Icons for the v0.5 navigation round, on the same 16-unit grid and 1.5 stroke as icons.tsx. Kept
// in their own file so the round's agents do not edit the same lines. Our own drawings.
import type { JSX } from "solid-js";

function Svg(props: { children: JSX.Element; size?: number }) {
  const size = props.size ?? 16;
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {props.children}
    </svg>
  );
}

type P = { size?: number };

// Menus and panels
export const IconPencil = (p: P) => <Svg {...p}><path d="M10.75 2.75l2.5 2.5L5.5 13H3v-2.5zM9.5 4l2.5 2.5" /></Svg>;
export const IconCalendarClock = (p: P) => <Svg {...p}><path d="M13.5 7V4.5h-11v9h4.5M2.5 7h11M5.5 2.75v2.5M10.5 2.75v2.5" /><circle cx="11.5" cy="11.5" r="2.5" /><path d="M11.5 10.5v1l.75.5" /></Svg>;
export const IconShare = (p: P) => <Svg {...p}><path d="M8 10V2.75M5 5.5l3-3 3 3M3 9v3.75a.75.75 0 0 0 .75.75h8.5a.75.75 0 0 0 .75-.75V9" /></Svg>;
export const IconWindow = (p: P) => <Svg {...p}><rect x="2" y="3" width="12" height="10" rx="1.75" /><path d="M2 6h12M8.5 9.25h3M10 7.75v3" /></Svg>;
export const IconFilter = (p: P) => <Svg {...p}><path d="M2.5 4h11M4.5 8h7M6.5 12h3" /></Svg>;
export const IconFolderPlus = (p: P) => <Svg {...p}><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.5 1.5h4.9A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" /><path d="M8 7v4M6 9h4" /></Svg>;
export const IconChart = (p: P) => <Svg {...p}><path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" /></Svg>;
export const IconPrinter = (p: P) => <Svg {...p}><path d="M4.5 6V2.5h7V6M4.5 11.5H3a.75.75 0 0 1-.75-.75v-4A.75.75 0 0 1 3 6h10a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-.75.75h-1.5M4.5 9.5h7v4h-7z" /></Svg>;
export const IconHistory = (p: P) => <Svg {...p}><path d="M2.75 8a5.25 5.25 0 1 0 1.5-3.7M2.5 2.5v2.25h2.25M8 5v3l2 1.25" /></Svg>;
export const IconDevice = (p: P) => <Svg {...p}><rect x="4.5" y="1.75" width="7" height="12.5" rx="1.5" /><path d="M7.25 12h1.5" /></Svg>;
export const IconImage = (p: P) => <Svg {...p}><rect x="2" y="3" width="12" height="10" rx="1.5" /><circle cx="5.75" cy="6.25" r="1" /><path d="m2.5 11.5 3.25-3 2.75 2.5 2-1.75 3 2.75" /></Svg>;
export const IconPointer = (p: P) => <Svg {...p}><path d="M3.5 2.5l9 4-3.75 1.25L7.5 11.5z" /><path d="m8.75 7.75 3.5 3.5" /></Svg>;
export const IconLink = (p: P) => <Svg {...p}><path d="M6.75 9.25a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.75.75M9.25 6.75a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l.75-.75" /></Svg>;
export const IconSmile = (p: P) => <Svg {...p}><circle cx="8" cy="8" r="5.75" /><path d="M5.75 9.5c.5.75 1.3 1.25 2.25 1.25s1.75-.5 2.25-1.25M6 6.25h.01M10 6.25h.01" /></Svg>;
export const IconSnooze = (p: P) => <Svg {...p}><path d="M13 9.5A5.25 5.25 0 1 1 6.5 3a4.25 4.25 0 0 0 6.5 6.5z" /><path d="M9.5 2.5h3l-3 3.5h3" /></Svg>;
export const IconExpand = (p: P) => <Svg {...p}><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" /></Svg>;
export const IconUndoArrow = (p: P) => <Svg {...p}><path d="M5 3.5 2.5 6 5 8.5M2.5 6h7a4 4 0 0 1 0 8H6" /></Svg>;

// The icon picker in Rediger prosjekt. Ids are in PROJECT_ICONS.
export const PICKER_ICONS: Record<string, (p: P) => JSX.Element> = {
  dollar: (p) => <Svg {...p}><circle cx="8" cy="8" r="5.75" /><path d="M9.75 6c-.35-.6-1-.95-1.8-.95-.95 0-1.75.55-1.75 1.35 0 1.85 3.7 1 3.7 2.9 0 .85-.85 1.45-1.9 1.45-.85 0-1.55-.35-1.95-.95M8 4v1.05M8 10.75V12" /></Svg>,
  book: (p) => <Svg {...p}><path d="M3 3.25A1.25 1.25 0 0 1 4.25 2H13v10H4.25A1.25 1.25 0 0 0 3 13.25zM3 13.25A1.25 1.25 0 0 0 4.25 14.5H13" /></Svg>,
  school: (p) => <Svg {...p}><path d="M1.75 6.25 8 3.25l6.25 3L8 9.25zM4.5 7.75v3c1 .9 2.2 1.35 3.5 1.35s2.5-.45 3.5-1.35v-3M14.25 6.25v3.5" /></Svg>,
  pencil: (p) => <Svg {...p}><path d="M10.75 2.75l2.5 2.5L5.5 13H3v-2.5zM9.5 4l2.5 2.5" /></Svg>,
  pen: (p) => <Svg {...p}><path d="M8 2.25 12 6.75 10 12.25H6L4 6.75zM8 2.25v5M6 14h4" /><circle cx="8" cy="8.25" r="1" /></Svg>,
  braces: (p) => <Svg {...p}><path d="M6 2.75c-1.5 0-2 .6-2 1.75v1.75c0 .9-.5 1.5-1.5 1.75 1 .25 1.5.85 1.5 1.75v1.75c0 1.15.5 1.75 2 1.75M10 2.75c1.5 0 2 .6 2 1.75v1.75c0 .9.5 1.5 1.5 1.75-1 .25-1.5.85-1.5 1.75v1.75c0 1.15-.5 1.75-2 1.75" /></Svg>,
  music: (p) => <Svg {...p}><path d="M6 11.5V3.5l7-1.25v8" /><circle cx="4.25" cy="11.5" r="1.75" /><circle cx="11.25" cy="10.25" r="1.75" /></Svg>,
  cup: (p) => <Svg {...p}><path d="M3 5.5h8.5v4A3.5 3.5 0 0 1 8 13H6.5A3.5 3.5 0 0 1 3 9.5zM11.5 6.5h.75a1.75 1.75 0 0 1 0 3.5h-1M5.5 2v1.5M8.25 2v1.5" /></Svg>,
  brush: (p) => <Svg {...p}><path d="M13.5 2.5 8 8M7.75 8.25c-1.6-.4-3 .6-3 2.25 0 1.25-.75 2-1.75 2.25 2.75.9 5.6.1 5.6-2.1z" /></Svg>,
  palette: (p) => <Svg {...p}><path d="M8 2.25a5.75 5.75 0 1 0 0 11.5c.9 0 1.25-.6 1.25-1.2 0-.75-.6-1.05-.6-1.8 0-.7.55-1.25 1.25-1.25h1.35a2.5 2.5 0 0 0 2.5-2.5c0-2.65-2.6-4.75-5.75-4.75Z" /><path d="M5 7.25h.01M7.25 5h.01M10.25 5.5h.01" /></Svg>,
  health: (p) => <Svg {...p}><path d="M4 2.5v3.75a2.75 2.75 0 0 0 5.5 0V2.5M6.75 9v1.5a3 3 0 0 0 6 0V9" /><circle cx="12.75" cy="7.75" r="1.25" /></Svg>,
  flower: (p) => <Svg {...p}><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="4.5" r="2" /><circle cx="11.5" cy="8" r="2" /><circle cx="8" cy="11.5" r="2" /><circle cx="4.5" cy="8" r="2" /></Svg>,
  bag: (p) => <Svg {...p}><rect x="2" y="5" width="12" height="8.5" rx="1.5" /><path d="M5.75 5V3.75A1.25 1.25 0 0 1 7 2.5h2a1.25 1.25 0 0 1 1.25 1.25V5M2 8.5h12" /></Svg>,
  chart: (p) => <Svg {...p}><path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" /></Svg>,
  dumbbell: (p) => <Svg {...p}><path d="M4 5v6M12 5v6M2 6.5v3M14 6.5v3M4 8h8" /></Svg>,
  notes: (p) => <Svg {...p}><rect x="3.5" y="2" width="9" height="12" rx="1.5" /><path d="M6 5.5h4M6 8h4M6 10.5h2.5" /></Svg>,
  scale: (p) => <Svg {...p}><path d="M8 2.5v11M5 13.5h6M3 4.5h10M3 4.5 1.5 8.5a1.5 1.5 0 0 0 3 0zM13 4.5l-1.5 4a1.5 1.5 0 0 0 3 0z" /></Svg>,
  planet: (p) => <Svg {...p}><circle cx="8" cy="8" r="3.75" /><ellipse cx="8" cy="8" rx="6.5" ry="2" transform="rotate(-25 8 8)" /></Svg>,
  plane: (p) => <Svg {...p}><path d="M13.25 2.75c-.6-.6-1.6-.5-2.25.15L8.75 5.25 3.5 3.75l-1 1 4.25 2.5-2 2.25-1.75-.25-.75.75 2 1.25 1.25 2 .75-.75-.25-1.75 2.25-2 2.5 4.25 1-1-1.5-5.25L13.1 5c.65-.65.75-1.65.15-2.25z" /></Svg>,
  wrench: (p) => <Svg {...p}><path d="M10.5 2.25a3 3 0 0 0-3.1 3.95L2.75 10.9a1.5 1.5 0 0 0 2.1 2.1l4.7-4.65a3 3 0 0 0 3.95-3.1l-1.8 1.8-1.95-.3-.3-1.95z" /></Svg>,
  paw: (p) => <Svg {...p}><circle cx="5" cy="5.75" r="1.1" /><circle cx="8" cy="4.25" r="1.1" /><circle cx="11" cy="5.75" r="1.1" /><circle cx="3.5" cy="8.75" r="1" /><circle cx="12.5" cy="8.75" r="1" /><path d="M8 8.25c-2 0-3.5 2.25-3.5 3.5 0 1.25 1.25 1.75 3.5 1.75s3.5-.5 3.5-1.75c0-1.25-1.5-3.5-3.5-3.5z" /></Svg>,
  flask: (p) => <Svg {...p}><path d="M6.25 2.5h3.5M6.75 2.5v4L3 12.5a.75.75 0 0 0 .65 1.1h8.7a.75.75 0 0 0 .65-1.1L9.25 6.5v-4M4.75 10h6.5" /></Svg>,
  brain: (p) => <Svg {...p}><path d="M8 3.25a2 2 0 0 0-3.75.5A2.25 2.25 0 0 0 2.75 7.5a2.25 2.25 0 0 0 1 3.75A2 2 0 0 0 8 12.5zM8 3.25a2 2 0 0 1 3.75.5 2.25 2.25 0 0 1 1.5 3.75 2.25 2.25 0 0 1-1 3.75A2 2 0 0 1 8 12.5z" /></Svg>,
  heart: (p) => <Svg {...p}><path d="M8 13.25S2.25 10 2.25 6A2.75 2.75 0 0 1 8 4.75 2.75 2.75 0 0 1 13.75 6C13.75 10 8 13.25 8 13.25z" /></Svg>,
  gift: (p) => <Svg {...p}><rect x="2.5" y="6" width="11" height="3" rx=".75" /><path d="M3.5 9v4.5h9V9M8 6v7.5M8 6C6.5 6 4.75 5.25 5.25 3.75S8 4.25 8 6zM8 6c1.5 0 3.25-.75 2.75-2.25S8 4.25 8 6z" /></Svg>,
  rocket: (p) => <Svg {...p}><path d="M9.5 2.5c2.25 0 4 1.75 4 4l-4.75 4.75-4-4zM4.75 7.25 2.5 7l2-2.5h3M8.75 11.25 9 13.5l2.5-2v-3M4.25 10.25c-1.25.5-1.75 2.25-1.75 3.25 1 0 2.75-.5 3.25-1.75" /><circle cx="10.25" cy="5.75" r="1" /></Svg>,
  camera: (p) => <Svg {...p}><rect x="2" y="4.5" width="12" height="9" rx="1.5" /><path d="M5.5 4.5 6.5 2.75h3l1 1.75" /><circle cx="8" cy="9" r="2.25" /></Svg>,
  home: (p) => <Svg {...p}><path d="M2.5 7.25 8 2.75l5.5 4.5V13a.75.75 0 0 1-.75.75H3.25A.75.75 0 0 1 2.5 13zM6.25 13.75V10h3.5v3.75" /></Svg>,
  star: (p) => <Svg {...p}><path d="M8 2.25l1.75 3.6 3.95.55-2.85 2.8.7 3.95L8 11.3l-3.55 1.85.7-3.95-2.85-2.8 3.95-.55z" /></Svg>,
  bug: (p) => <Svg {...p}><rect x="4.75" y="5" width="6.5" height="8.5" rx="3.25" /><path d="M6 5V4a2 2 0 0 1 4 0v1M8 8v5.5M2.25 8.75h2.5M11.25 8.75h2.5M2.75 5.5l2 1M13.25 5.5l-2 1M2.75 12.5l2-1M13.25 12.5l-2-1" /></Svg>,
  database: (p) => <Svg {...p}><ellipse cx="8" cy="4" rx="5" ry="1.75" /><path d="M3 4v8c0 1 2.25 1.75 5 1.75s5-.75 5-1.75V4M3 8c0 1 2.25 1.75 5 1.75s5-.75 5-1.75" /></Svg>,
  lock: (p) => <Svg {...p}><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" /></Svg>,
  leaf: (p) => <Svg {...p}><path d="M3 13c0-6 3.5-9.75 10.5-10.25C13.25 9.5 9.5 13 3.5 13M3 13l6-6" /></Svg>,
  puzzle: (p) => <Svg {...p}><path d="M3 5.5h2.5a1.5 1.5 0 1 1 3 0H11V8a1.5 1.5 0 1 1 0 3v2.5H8.5a1.5 1.5 0 1 0-3 0H3V11a1.5 1.5 0 1 0 0-3z" /></Svg>,
  cloud: (p) => <Svg {...p}><path d="M4.5 12.5a3 3 0 0 1-.4-5.97A4 4 0 0 1 11.8 5.6a3.25 3.25 0 0 1-.05 6.9z" /></Svg>,
  map: (p) => <Svg {...p}><path d="M2 4.25 6 2.75l4 1.5 4-1.5v9l-4 1.5-4-1.5-4 1.5zM6 2.75v9M10 4.25v9" /></Svg>,
};

// Norwegian names, so the icon search finds them.
export const ICON_NAMES: Record<string, string> = {
  folder: "mappe", code: "kode", globe: "verden nett", terminal: "terminal", spark: "gnist ki", game: "spill", branch: "gren git", team: "team folk",
  dollar: "penger dollar økonomi", book: "bok", school: "skole utdanning", pencil: "blyant skriv", pen: "penn design", braces: "klammer json",
  music: "musikk", cup: "kopp kaffe", brush: "pensel", palette: "palett farge kunst", health: "helse lege", flower: "blomst", bag: "veske jobb",
  chart: "diagram statistikk", dumbbell: "trening", notes: "notater", scale: "vekt jus", planet: "planet rom", plane: "fly reise",
  wrench: "verktøy fiks", paw: "pote dyr", flask: "kolbe forskning", brain: "hjerne", heart: "hjerte", gift: "gave", rocket: "rakett",
  camera: "kamera bilde", home: "hjem hus", star: "stjerne", bug: "feil insekt", database: "database", lock: "lås sikkerhet", leaf: "blad natur",
  puzzle: "puslespill", cloud: "sky", map: "kart",
};

// A small set for the emoji tab, with Norwegian search words.
export const EMOJIS: Array<[string, string]> = [
  ["🚀", "rakett"], ["🎮", "spill"], ["🧩", "puslespill"], ["⚙️", "tannhjul"], ["🛠️", "verktøy"], ["🧪", "forsøk"], ["📚", "bøker"], ["📝", "notat"],
  ["💡", "ide lys"], ["🔥", "ild"], ["⭐", "stjerne"], ["🌍", "verden"], ["🌱", "plante"], ["🌸", "blomst"], ["🍕", "pizza mat"], ["☕", "kaffe"],
  ["🎵", "musikk"], ["🎨", "kunst"], ["📷", "kamera"], ["🎬", "film"], ["🏠", "hjem"], ["🏔️", "fjell"], ["🌊", "bølge hav"], ["❄️", "snø"],
  ["🐱", "katt"], ["🐶", "hund"], ["🦊", "rev"], ["🐉", "drage"], ["🤖", "robot"], ["👾", "romvesen"], ["🧠", "hjerne"], ["❤️", "hjerte"],
  ["💰", "penger"], ["📈", "graf"], ["🔒", "lås"], ["🔑", "nøkkel"], ["🧭", "kompass"], ["🗺️", "kart"], ["⚡", "lyn"], ["🎯", "mål blink"],
  ["🏆", "pokal"], ["⛏️", "hakke minecraft"], ["🪐", "planet"], ["🌙", "måne"], ["☀️", "sol"], ["🍀", "kløver"], ["🎲", "terning"], ["🧱", "murstein"],
];
// Round 10: full view for the panel (four corners), and back from it (corners turned in).
export const IconFullView = (p: P) => <Svg {...p}><path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" /></Svg>;
export const IconExitFullView = (p: P) => <Svg {...p}><path d="M6 2.5V5a1 1 0 0 1-1 1H2.5M10 2.5V5a1 1 0 0 0 1 1h2.5M13.5 10H11a1 1 0 0 0-1 1v2.5M2.5 10H5a1 1 0 0 1 1 1v2.5" /></Svg>;

// Informasjonskapsler (round 12), moved here from CookieImport.tsx so the command palette can show
// it without loading the import dialog.
// Our own drawing: a cookie with a bite out of it. No browser's logo.
export const IconCookie = (p: { size?: number }) => (
  <svg class="icon" width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M13.9 7.4A6 6 0 1 1 8.6 2.1a2 2 0 0 0 2.4 2.4 2 2 0 0 0 2.9 2.9z" />
    <path d="M5.5 6.5h.01M9.5 10h.01M6 10.5h.01M8 8h.01" stroke-width="1.9" />
  </svg>
);
