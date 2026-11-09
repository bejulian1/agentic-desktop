// A project's icon in its colour, for the sidebar and the settings. The icon is one the user picked
// (an icon or an emoji), else the project's own favicon when it has one, else a folder.
import { Show } from "solid-js";
import type { Project } from "../../../shared/protocol";
import { PROJECT_COLORS } from "../../../shared/protocol";
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
  const emoji = () => (props.project.icon?.startsWith("emoji:") ? props.project.icon.slice(6) : null);
  const favicon = () => (!props.project.icon && props.project.id ? favicons()[props.project.id] : undefined);
  const Icon = () => (props.open && (props.project.icon ?? "folder") === "folder" ? IconFolderOpen : ICONS[props.project.icon ?? "folder"] ?? IconFolder);
  const color = () => PROJECT_COLORS.find((c) => c.id === props.project.color)?.value;
  return (
    <span class="project-glyph" classList={{ "has-image": !!favicon(), "has-emoji": !!emoji() }} style={color() ? `color:${color()}` : undefined}>
      <Show
        when={emoji()}
        fallback={
          <Show when={favicon()} fallback={Icon()({ size: size() })}>
            {(version) => <img class="project-favicon" src={`/api/projects/${props.project.id}/favicon?v=${version()}`} width={size()} height={size()} alt="" draggable={false} />}
          </Show>
        }
      >
        {(e) => <span class="project-emoji" style={`font-size:${Math.round(size() * 0.95)}px`}>{e()}</span>}
      </Show>
    </span>
  );
}
