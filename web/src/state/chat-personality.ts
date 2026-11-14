// Settings uses the focused Chat composer's existing choice, including its unsent draft.
// Only the mounted owner may clear its registration when panes change focus or close.
import { createSignal, type Accessor } from "solid-js";

export interface ChatPersonalityContext {
  threadId: Accessor<string | null>;
  title: Accessor<string | undefined>;
  personality: Accessor<string>;
  setPersonality: (value: string) => Promise<void>;
}

const [activeChatPersonality, setActiveChatPersonality] = createSignal<ChatPersonalityContext | null>(null);
export { activeChatPersonality };

export function registerChatPersonality(context: ChatPersonalityContext): () => void {
  setActiveChatPersonality(context);
  return () => setActiveChatPersonality((current) => current === context ? null : current);
}

export const PERSONALITY_TEXT: Record<string, string> = {
  standard: "Vanlige svar, uten egen stil",
  kort: "Korte svar, med så få ord som oppgaven tillater",
  grundig: "Forklarer resonnementet og avveiningene",
  vennlig: "Varm og oppmuntrende, med enkle ord",
  lærer: "Forklarer hvorfor, og foreslår hva du kan prøve",
};
