import type { JSX } from "solid-js";

function Svg(props: { children: JSX.Element; size?: number; name?: string }) {
  const size = props.size ?? 16;
  return (
    <svg class="icon" data-icon={props.name} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {props.children}
    </svg>
  );
}

type P = { size?: number };

export const IconPlus = (p: P) => <Svg {...p}><path d="M8 3v10M3 8h10" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="m4 4 8 8M12 4l-8 8" /></Svg>;
export const IconSearch = (p: P) => <Svg {...p}><circle cx="7" cy="7" r="4.25" /><path d="m13 13-2.9-2.9" /></Svg>;
export const IconChevron = (p: P) => <Svg {...p}><path d="m6 4 4 4-4 4" /></Svg>;
export const IconChevronDown = (p: P) => <Svg {...p}><path d="m4 6 4 4 4-4" /></Svg>;
export const IconDots = (p: P) => <Svg {...p}><path d="M3.5 8h.01M8 8h.01M12.5 8h.01" stroke-width="2" /></Svg>;
// The sidebar and the side panel: the column they stand for is shaded, so they never read as the
// split icons beside them (Del til høyre is an empty frame with a line down the middle). SPEC 28.
export const IconSidebar = (p: P) => <Svg {...p}><rect x="2.75" y="3.75" width="3.25" height="8.5" rx="1" fill="currentColor" stroke="none" opacity="0.35" /><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M6 3v10" /></Svg>;
export const IconPanel = (p: P) => <Svg {...p}><rect x="10" y="3.75" width="3.25" height="8.5" rx="1" fill="currentColor" stroke="none" opacity="0.35" /><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M10 3v10" /></Svg>;
// A gear with eight teeth, not rays: at 16 px rays read as a sun (round 9, bilde 08).
export const IconSettings = (p: P) => <Svg {...p}><path d="M6.88 3.33 7.06 1.77 8.94 1.77 9.12 3.33 10.51 3.91 11.74 2.93 13.07 4.26 12.09 5.49 12.67 6.88 14.23 7.06 14.23 8.94 12.67 9.12 12.09 10.51 13.07 11.74 11.74 13.07 10.51 12.09 9.12 12.67 8.94 14.23 7.06 14.23 6.88 12.67 5.49 12.09 4.26 13.07 2.93 11.74 3.91 10.51 3.33 9.12 1.77 8.94 1.77 7.06 3.33 6.88 3.91 5.49 2.93 4.26 4.26 2.93 5.49 3.91Z" /><circle cx="8" cy="8" r="2" /></Svg>;
// Fold sammen alle / Fold ut alle: two chevrons that meet, or part.
export const IconFoldAll = (p: P) => <Svg {...p}><path d="m5 2.75 3 3 3-3M5 13.25l3-3 3 3" /></Svg>;
export const IconUnfoldAll = (p: P) => <Svg {...p}><path d="m5 5.5 3-3 3 3M5 10.5l3 3 3-3" /></Svg>;
export const IconFolder = (p: P) => <Svg {...p}><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.5 1.5h4.9A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" /></Svg>;
export const IconFile = (p: P) => <Svg {...p}><path d="M4 2.5h5l3 3v8H4z" /><path d="M9 2.5v3h3" /></Svg>;
export const IconTerminal = (p: P) => <Svg {...p}><rect x="2" y="3" width="12" height="10" rx="2" /><path d="m5 6.5 2 1.5-2 1.5M8.5 10H11" /></Svg>;
export const IconGlobe = (p: P) => <Svg {...p}><circle cx="8" cy="8" r="5.75" /><path d="M2.5 8h11M8 2.25c1.7 1.7 2.4 3.7 2.4 5.75S9.7 12.05 8 13.75C6.3 12.05 5.6 10.05 5.6 8S6.3 3.95 8 2.25Z" /></Svg>;
export const IconDiff = (p: P) => <Svg {...p}><path d="M4.5 2.5v7M1.75 6h5.5M8.75 12.5h5.5M11.5 3.5v5.5" /><path d="M8.75 6.25h5.5" /></Svg>;
export const IconPlay = (p: P) => <Svg {...p}><path d="M5 3.25v9.5l7.5-4.75z" /></Svg>;
export const IconStop = (p: P) => <Svg {...p}><rect x="4" y="4" width="8" height="8" rx="1.25" fill="currentColor" stroke="none" /></Svg>;
export const IconSend = (p: P) => <Svg {...p}><path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" stroke-width="1.75" /></Svg>;
export const IconMenu = (p: P) => <Svg {...p}><path d="M2.75 4.5h10.5M2.75 8h10.5M2.75 11.5h10.5" /></Svg>;
export const IconChat = (p: P) => <Svg {...p}><path d="M8 2.5c3.3 0 5.75 2.1 5.75 4.9S11.3 12.3 8 12.3c-.65 0-1.3-.08-1.9-.24L3 13.5l.6-2.6C2.75 10 2.25 8.75 2.25 7.4 2.25 4.6 4.7 2.5 8 2.5Z" /></Svg>;
export const IconCode = (p: P) =><Svg {...p}><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" /></Svg>;
// Kode Studio: a workspace split into explorer, editor and agent columns.
export const IconStudio = (p: P) => <Svg {...p}><rect x="2" y="2.75" width="12" height="10.5" rx="1.75" /><path d="M5.5 2.75v10.5M10.5 2.75v10.5M5.5 9.75h5" /></Svg>;
export const IconSplitRight = (p: P) => <Svg {...p}><rect x="2" y="3" width="12" height="10" rx="1.75" /><path d="M8 3v10" /></Svg>;
export const IconSplitDown = (p: P) => <Svg {...p}><rect x="2" y="3" width="12" height="10" rx="1.75" /><path d="M2 8h12" /></Svg>;
export const IconDetach = (p: P) => <Svg {...p}><path d="M9.5 2.5h4v4M13.5 2.5 8 8M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" /></Svg>;
export const IconBack = (p: P) => <Svg {...p}><path d="M9.5 3.5 5 8l4.5 4.5" /></Svg>;
export const IconForward = (p: P) => <Svg {...p}><path d="M6.5 3.5 11 8l-4.5 4.5" /></Svg>;
export const IconReload = (p: P) => <Svg {...p}><path d="M13 8a5 5 0 1 1-1.5-3.55M13 2.5v2.75h-2.75" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="m3.5 8.5 3 3 6-7" /></Svg>;
export const IconWarn = (p: P) => <Svg {...p}><path d="M8 2.5 14 13H2zM8 6.5v3M8 11.25h.01" /></Svg>;
export const IconBrain = (p: P) => <Svg {...p}><path d="M8 13.5c-3 0-5.5-2.2-5.5-5.5S5 2.5 8 2.5s5.5 2.2 5.5 5.5c0 1.2-.3 2.2-.9 3.1l.4 2.4-2.4-.5c-.8.3-1.7.5-2.6.5Z" /></Svg>;
export const IconBranch = (p: P) => <Svg {...p}><circle cx="4.5" cy="3.5" r="1.5" /><circle cx="4.5" cy="12.5" r="1.5" /><circle cx="11.5" cy="5.5" r="1.5" /><path d="M4.5 5v6M11.5 7c0 2.5-3 2.5-7 3" /></Svg>;
export const IconAt = (p: P) => <Svg {...p}><circle cx="8" cy="8" r="2.5" /><path d="M10.5 5.5v3.25a1.75 1.75 0 0 0 3.5 0V8a6 6 0 1 0-2.4 4.8" /></Svg>;
export const IconArrowDown = (p: P) => <Svg {...p}><path d="M8 3v9.5M3.75 8.5 8 12.75l4.25-4.25" /></Svg>;
export const IconUser = (p: P) => <Svg {...p}><circle cx="8" cy="5.5" r="2.75" /><path d="M3 13.5c.6-2.6 2.6-3.75 5-3.75s4.4 1.15 5 3.75" /></Svg>;
export const IconSpark = (p: P) => <Svg {...p}><path d="M8 2.5 9.4 6.6 13.5 8 9.4 9.4 8 13.5 6.6 9.4 2.5 8l4.1-1.4z" /></Svg>;
export const IconPin = (p: P) => <Svg {...p}><path d="M6 2.5h4M6.75 2.5v4L4.5 9h7L9.25 6.5v-4M8 9v4.5" /></Svg>;
export const IconNewThread = (p: P) => <Svg {...p}><path d="M13.5 8.5V12a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5h3.5" /><path d="M11.5 1.75v4.5M9.25 4h4.5" /></Svg>;
export const IconTarget = (p: P) => <Svg {...p}><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2.25" /></Svg>;
export const IconList = (p: P) => <Svg {...p}><path d="M5.5 4.5h8M5.5 8h8M5.5 11.5h8M2.5 4.5h.01M2.5 8h.01M2.5 11.5h.01" /></Svg>;
export const IconInfo = (p: P) => <Svg {...p}><circle cx="8" cy="8" r="5.75" /><path d="M8 7.25v3.5M8 5.25h.01" /></Svg>;
export const IconKeyboard = (p: P) => <Svg {...p}><rect x="1.75" y="4" width="12.5" height="8" rx="1.5" /><path d="M4.5 6.75h.01M7 6.75h.01M9.5 6.75h.01M12 6.75h.01M5 9.5h6" /></Svg>;
export const IconPalette = (p: P) => <Svg {...p}><path d="M8 2.25a5.75 5.75 0 1 0 0 11.5c.9 0 1.25-.6 1.25-1.2 0-.75-.6-1.05-.6-1.8 0-.7.55-1.25 1.25-1.25h1.35a2.5 2.5 0 0 0 2.5-2.5c0-2.65-2.6-4.75-5.75-4.75Z" /><path d="M5 7.25h.01M7.25 5h.01M10.25 5.5h.01" /></Svg>;
export const IconShield = (p: P) => <Svg {...p}><path d="M8 1.75 13 3.5v4c0 3.25-2.2 5.6-5 6.75C5.2 13.1 3 10.75 3 7.5v-4z" /></Svg>;
export const IconCpu = (p: P) => <Svg {...p}><rect x="4" y="4" width="8" height="8" rx="1.5" /><path d="M6 1.75V4M10 1.75V4M6 12v2.25M10 12v2.25M1.75 6H4M1.75 10H4M12 6h2.25M12 10h2.25" /></Svg>;
export const IconUsers = (p: P) => <Svg {...p}><circle cx="6" cy="5.5" r="2.25" /><path d="M1.75 13c.5-2.2 2.1-3.25 4.25-3.25S9.75 10.8 10.25 13" /><path d="M10.5 3.5a2.25 2.25 0 0 1 0 4.25M12 9.9c1.1.45 1.9 1.4 2.25 3.1" /></Svg>;
export const IconMonitor = (p: P) => <Svg {...p}><rect x="2" y="2.75" width="12" height="8.5" rx="1.5" /><path d="M5.5 13.75h5M8 11.25v2.5" /></Svg>;
export const IconGamepad = (p: P) => <Svg {...p}><path d="M4.5 4.5h7a3 3 0 0 1 3 3.25l-.35 2.6a1.9 1.9 0 0 1-3.3 1L9.6 10H6.4l-1.25 1.35a1.9 1.9 0 0 1-3.3-1L1.5 7.75a3 3 0 0 1 3-3.25Z" /><path d="M5 6.5v2M4 7.5h2M10.5 7h.01M11.5 8.25h.01" /></Svg>;
export const IconCircle = (p: P) => <Svg {...p}><circle cx="8" cy="8" r="5" /></Svg>;
export const IconArtifact = (p: P) => <Svg {...p}><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M2 5.5h12M6.5 8.5 5 10l1.5 1.5M9.5 8.5 11 10l-1.5 1.5" /></Svg>;
export const IconDownload = (p: P) => <Svg {...p}><path d="M8 2.5v7.5M4.75 7 8 10.25 11.25 7M3 13.25h10" /></Svg>;
export const IconCopy = (p: P) => <Svg {...p}><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" /></Svg>;
export const IconTrash = (p: P) => <Svg {...p}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></Svg>;

// v0.4: the redesign. Same 16-unit grid and 1.5 stroke as the rest.
export const IconBell = (p: P) => <Svg {...p}><path d="M4.25 11V7.25a3.75 3.75 0 0 1 7.5 0V11l1.25 1.5H3z" /><path d="M6.75 14h2.5" /></Svg>;
export const IconHelp = (p: P) => <Svg {...p}><circle cx="8" cy="8" r="5.75" /><path d="M6.4 6.3a1.7 1.7 0 0 1 3.25.6c0 1.15-1.65 1.4-1.65 2.6M8 11.4h.01" /></Svg>;
export const IconArchive = (p: P) => <Svg {...p}><rect x="2" y="3" width="12" height="3" rx="1" /><path d="M3 6v6.25A1.25 1.25 0 0 0 4.25 13.5h7.5A1.25 1.25 0 0 0 13 12.25V6M6.5 8.75h3" /></Svg>;
export const IconClock = (p: P) => <Svg {...p}><circle cx="8" cy="8" r="5.75" /><path d="M8 4.75V8l2.25 1.5" /></Svg>;
export const IconLaptop = (p: P) => <Svg {...p}><rect x="3" y="3.5" width="10" height="7" rx="1.25" /><path d="M1.75 12.75h12.5" /></Svg>;
export const IconMic = (p: P) => <Svg {...p}><rect x="6" y="2" width="4" height="7.5" rx="2" /><path d="M3.75 7.75a4.25 4.25 0 0 0 8.5 0M8 12v2" /></Svg>;
export const IconCompose = (p: P) => <Svg {...p}><path d="M13.5 8.75V12A1.5 1.5 0 0 1 12 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5h3.25" /><path d="m11.4 2.6 2 2L8.25 9.75 6 10.25l.5-2.25z" /></Svg>;
export const IconPlusCircle = (p: P) => <Svg {...p}><circle cx="8" cy="8" r="5.75" /><path d="M8 5.5v5M5.5 8h5" /></Svg>;
export const IconSun = (p: P) => <Svg {...p}><circle cx="8" cy="8" r="2.75" /><path d="M8 1.75v1.25M8 13v1.25M1.75 8H3M13 8h1.25M3.6 3.6l.9.9M11.5 11.5l.9.9M3.6 12.4l.9-.9M11.5 4.5l.9-.9" /></Svg>;
export const IconGauge = (p: P) => <Svg {...p}><path d="M2.75 11.5a5.5 5.5 0 1 1 10.5 0" /><path d="m8 9.25 2.5-3" /><circle cx="8" cy="9.5" r=".75" /></Svg>;
export const IconPlug = (p: P) => <Svg {...p}><path d="M5.5 2v3M10.5 2v3M4 5h8v2.5a4 4 0 0 1-8 0zM8 11.5V14" /></Svg>;
export const IconSliders = (p: P) => <Svg {...p}><path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" /><circle cx="10" cy="4.5" r="1.5" /><circle cx="6" cy="11.5" r="1.5" /></Svg>;
export const IconServer = (p: P) => <Svg {...p}><rect x="2.5" y="2.5" width="11" height="4.5" rx="1.25" /><rect x="2.5" y="9" width="11" height="4.5" rx="1.25" /><path d="M5 4.75h.01M5 11.25h.01" /></Svg>;
export const IconAnchor = (p: P) => <Svg {...p}><circle cx="8" cy="3.75" r="1.5" /><path d="M8 5.25V14M5.5 7.5h5M2.75 9.5a5.25 4.5 0 0 0 10.5 0" /></Svg>;
export const IconWorktree = (p: P) => <Svg {...p}><circle cx="4" cy="3.5" r="1.5" /><circle cx="4" cy="12.5" r="1.5" /><circle cx="12" cy="8" r="1.5" /><path d="M4 5v6M4 8h6.5" /></Svg>;
export const IconBook = (p: P) => <Svg {...p}><path d="M3 3.25A1.25 1.25 0 0 1 4.25 2H13v10H4.25A1.25 1.25 0 0 0 3 13.25zM3 13.25A1.25 1.25 0 0 0 4.25 14.5H13" /></Svg>;
export const IconExplore = (p: P) => <Svg {...p}><path d="M3.5 8h.01M8 8h.01M12.5 8h.01" stroke-width="2" /></Svg>;
export const IconFolderOpen = (p: P) => <Svg {...p}><path d="M2 11.5V4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.5 1.5h4A1.5 1.5 0 0 1 13 6v1" /><path d="M2 11.5 3.6 7.6A1 1 0 0 1 4.5 7h9a.75.75 0 0 1 .7 1L12.6 12a1.5 1.5 0 0 1-1.4 1H3.5A1.5 1.5 0 0 1 2 11.5Z" /></Svg>;
export const IconShieldCheck = (p: P) => <Svg {...p}><path d="M8 1.75 13 3.5v4c0 3.25-2.2 5.6-5 6.75C5.2 13.1 3 10.75 3 7.5v-4z" /><path d="m5.75 8 1.5 1.5 3-3" /></Svg>;
export const IconBolt = (p: P) => <Svg {...p}><path d="M8.75 1.75 3.5 9h4l-.75 5.25L12.5 7h-4z" /></Svg>;
// The start page mark: a prompt in a speech bubble. Our own drawing, larger and thinner.
export const IconMark = (p: P) => (
  <svg class="icon" width={p.size ?? 48} height={p.size ?? 48} viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M24 7c9.4 0 17 6.3 17 14.5S33.4 36 24 36c-1.9 0-3.7-.25-5.4-.7L11 40l1.4-7.1C9 30.3 7 26.1 7 21.5 7 13.3 14.6 7 24 7Z" />
    <path d="m17 18 4.5 3.5L17 25M24.5 26H31" />
  </svg>
);

// v0.5 (Kode): steps, the goal line and the composer menus.
// Round 14 (SPEC 30.1): the eye with a stroke through it, for «Skjul nøkkelen».
export const IconEyeOff = (p: P) => <Svg {...p}><path d="M6.2 4.05A6.4 6.4 0 0 1 8 3.75C12 3.75 14.25 8 14.25 8a11.6 11.6 0 0 1-1.6 2.2M10.1 11.85a6.4 6.4 0 0 1-2.1.4C4 12.25 1.75 8 1.75 8a11.7 11.7 0 0 1 2.4-2.9" /><path d="M6.6 6.6a2 2 0 0 0 2.8 2.8M2.5 2.5l11 11" /></Svg>;
export const IconEye = (p: P) => <Svg {...p}><path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8Z" /><circle cx="8" cy="8" r="2" /></Svg>;
export const IconPencil = (p: P) => <Svg {...p}><path d="m10.75 2.75 2.5 2.5L6 12.5l-3.25.75L3.5 10z" /><path d="m9.25 4.25 2.5 2.5" /></Svg>;
export const IconPause = (p: P) => <Svg {...p}><path d="M5.75 3.75v8.5M10.25 3.75v8.5" /></Svg>;
export const IconUndo = (p: P) => <Svg {...p}><path d="M5.5 3.5 2.75 6.25 5.5 9" /><path d="M2.75 6.25h6.5a3.5 3.5 0 0 1 0 7H6.5" /></Svg>;
export const IconImage = (p: P) => <Svg {...p}><rect x="2" y="2.75" width="12" height="10.5" rx="1.75" /><circle cx="5.75" cy="6.25" r="1.25" /><path d="m2.5 11.5 3.5-3.25 2.5 2.25 2-1.75 3 2.75" /></Svg>;
export const IconHand = (p: P) => <Svg {...p}><path d="M5.5 8V3.75a1 1 0 0 1 2 0V7.5M7.5 7V2.75a1 1 0 0 1 2 0V7.5M9.5 7.25V4a1 1 0 0 1 2 0v5c0 2.75-1.75 4.75-4.25 4.75-1.6 0-2.6-.75-3.5-2.1L2.4 9.4a1 1 0 0 1 1.6-1.2L5.5 10" /></Svg>;
export const IconAlert = (p: P) => <Svg {...p}><circle cx="8" cy="8" r="5.75" /><path d="M8 4.75v3.75M8 10.9h.01" /></Svg>;
export const IconWrench = (p: P) => <Svg {...p}><path d="M10.25 2.25a3 3 0 0 0-2.9 3.8L2.5 10.9a1.4 1.4 0 0 0 2 2l4.85-4.85a3 3 0 0 0 3.8-2.9l-1.65 1.1-1.6-.4-.4-1.6z" /></Svg>;
export const IconAgent = (p: P) => <Svg {...p}><rect x="3" y="4.5" width="10" height="8" rx="2.5" /><path d="M8 2.25v2.25M6 8.25h.01M10 8.25h.01" stroke-width="1.9" /></Svg>;
export const IconReset = (p: P) => <Svg {...p}><path d="M3 8a5 5 0 1 0 1.5-3.55M3 2.5v2.75h2.75" /></Svg>;
export const IconBookmark = (p: P) => <Svg {...p}><path d="M4.5 2.5h7v11L8 10.75 4.5 13.5z" /></Svg>;
// Round 11: a side panel to add (a rounded square with +), sorting, and a section in the sidebar.
export const IconPanelAdd = (p: P) => <Svg {...p}><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" /><path d="M8 5.5v5M5.5 8h5" /></Svg>;
export const IconSort = (p: P) => <Svg {...p}><path d="M5 3v10M2.75 5.25 5 3l2.25 2.25M11 13V3M8.75 10.75 11 13l2.25-2.25" /></Svg>;
export const IconSection = (p: P) => <Svg {...p}><path d="M2.5 4.5h11M2.5 8h7M2.5 11.5h7M12 9.5v4M10 11.5h4" /></Svg>;
// Round 13 (SPEC 27.1 and 27.2): a new file, and the tool menu in Chat (a toolbox with a handle).
export const IconFilePlus = (p: P) => <Svg {...p}><path d="M9 2.5H4v11h8v-8z" /><path d="M9 2.5v3h3M8 8v3.5M6.25 9.75h3.5" /></Svg>;
export const IconTools = (p: P) => <Svg {...p}><rect x="2" y="5.5" width="12" height="7.5" rx="1.5" /><path d="M6 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M2 9h12M7 9v1.25M9 9v1.25" /></Svg>;
// A thought cloud with two detached trail dots: distinct from a conversation's speech bubble.
export const IconThought = (p: P) => <Svg {...p} name="thought"><path d="M4.75 9.75A2.75 2.75 0 0 1 3.8 4.42a3.1 3.1 0 0 1 5.75-1.5 2.8 2.8 0 0 1 3.85 3.35 2.45 2.45 0 0 1-2.2 4.13 3.05 3.05 0 0 1-4.05-.05 2.65 2.65 0 0 1-2.4-.6Z" /><circle cx="4.5" cy="12" r=".8" stroke-width="1.1" /><circle cx="2.2" cy="14" r=".45" fill="currentColor" stroke="none" /></Svg>;
// Round 15: Åpne stort and back to normal size, for the artifact panel. Arrows out to the corners,
// and in from them.
export const IconExpand = (p: P) => <Svg {...p}><path d="M9.5 2.75h3.75V6.5M13.25 2.75 9.25 6.75M6.5 13.25H2.75V9.5M2.75 13.25l4-4" /></Svg>;
export const IconCollapse = (p: P) => <Svg {...p}><path d="M13.25 6.5H9.5V2.75M9.5 6.5l3.75-3.75M2.75 9.5H6.5v3.75M6.5 9.5l-3.75 3.75" /></Svg>;
