// A project's icon in its colour, for the sidebar and the settings. The icon is one the user picked
// (an icon, an emoji, a monogram badge or an uploaded image), else the project's own favicon when it
// has one, else a folder.
import { createSignal, Show } from "solid-js";
import type { Project } from "../../../shared/protocol";
import { isProjectIcon, isProjectIconFile, PROJECT_COLORS } from "../../../shared/protocol";
import { favicons } from "../state/nav";
import { IconBranch, IconCode, IconFolder, IconFolderOpen, IconGamepad, IconGlobe, IconSpark, IconTerminal, IconUsers } from "./icons";
import { PICKER_ICONS } from "./nav-icons";

const ICONS: Record<string, (p: { size?: number }) => any> = {
  folder: IconFolder,
  code: IconCode,
  globe: IconGlobe,
  terminal: IconTerminal,
  spark: IconSpark,
  game: IconGamepad,
  branch: IconBranch,
  team: IconUsers,
  ...PICKER_ICONS,
};

export function iconFor(id: string): ((p: { size?: number }) => any) | undefined {
  return ICONS[id];
}

export function ProjectGlyph(props: { project: Pick<Project, "icon" | "color"> & { id?: string }; size?: number; open?: boolean }) {
  const size = () => props.size ?? 14;
  const icon = () => props.project.icon ?? null;
  const emoji = () => (icon()?.startsWith("emoji:") ? icon()!.slice(6) : null);
  // A badge with one to three letters, in the project's colour.
  const mono = () => (icon()?.startsWith("mono:") && isProjectIcon(icon()!) ? icon()!.slice(5) : null);
  // An image the user picked, served by the project's own icon route. The file name is the
  // version, so a new image is never shown from the old cache.
  const file = () => (props.project.id && icon() && isProjectIconFile(icon()!) ? `/api/projects/${props.project.id}/icon?v=${encodeURIComponent(icon()!.slice(5))}` : null);
  const [broken, setBroken] = createSignal<string | null>(null);
  const fileSrc = () => (file() && broken() !== file() ? file() : null);
  const favicon = () => (!icon() && props.project.id ? favicons()[props.project.id] : undefined);
  const Icon = () => (props.open && (icon() ?? "folder") === "folder" ? IconFolderOpen : ICONS[icon() ?? "folder"] ?? IconFolder);
  const color = () => PROJECT_COLORS.find((c) => c.id === props.project.color)?.value;
  const image = () => !!favicon() || !!fileSrc();
  return (
    <span class="project-glyph" classList={{ "has-image": image(), "has-emoji": !!emoji(), "has-mono": !!mono() }} data-icon-kind={mono() ? "mono" : emoji() ? "emoji" : fileSrc() ? "file" : favicon() ? "favicon" : "icon"} style={color() ? `color:${color()};--glyph-color:${color()}` : undefined}>
      <Show when={mono()}>
        {(text) => <span class="project-mono" data-length={Array.from(text()).length} style={`width:${size()}px;height:${size()}px;font-size:${Math.max(6, Math.round(size() * (Array.from(text()).length > 2 ? 0.4 : Array.from(text()).length > 1 ? 0.5 : 0.62)))}px`} aria-hidden="true">{text()}</span>}
      </Show>
      <Show when={!mono() && emoji()}>
        {(e) => <span class="project-emoji" style={`font-size:${Math.round(size() * 0.95)}px`}>{e()}</span>}
      </Show>
      <Show when={!mono() && !emoji() && fileSrc()}>
        {(src) => <img class="project-favicon project-file-icon" src={src()} width={size()} height={size()} alt="" draggable={false} onError={() => setBroken(file())} />}
      </Show>
      <Show when={!mono() && !emoji() && !fileSrc()}>
        <Show when={favicon()} fallback={Icon()({ size: size() })}>
          {(version) => <img class="project-favicon" src={`/api/projects/${props.project.id}/favicon?v=${version()}`} width={size()} height={size()} alt="" draggable={false} />}
        </Show>
      </Show>
    </span>
  );
}
