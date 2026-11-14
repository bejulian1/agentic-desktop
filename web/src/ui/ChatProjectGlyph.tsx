import type { ChatProject } from "../../../shared/protocol";
import { ProjectGlyph } from "./ProjectGlyph";

// Chat projects have no folders or favicon routes. Legacy icons still use the existing fallback.
export function ChatProjectGlyph(props: { project: Pick<ChatProject, "icon" | "color">; size?: number; open?: boolean }) {
  return <ProjectGlyph project={{ icon: props.project.icon, color: props.project.color }} size={props.size} open={props.open} />;
}
