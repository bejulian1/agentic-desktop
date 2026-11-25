import type { ChatProject } from "../../../shared/protocol";
import { ProjectGlyph } from "./ProjectGlyph";

// Chat projects have no folders or favicon routes. Legacy icons still use the existing fallback.
// v1.4.0: like Kode projects, a Chat project without a colour gets one picked from its id.
export function ChatProjectGlyph(props: { project: Pick<ChatProject, "icon" | "color"> & { id?: string }; size?: number; open?: boolean }) {
  return <ProjectGlyph project={{ icon: props.project.icon, color: props.project.color }} seed={props.project.id ? `chat:${props.project.id}` : undefined} size={props.size} open={props.open} />;
}
