import type { Attachment } from "../../../shared/protocol";
import { createSignal } from "solid-js";

export interface ComposerDelivery {
  images: File[];
  attachments?: Attachment[];
  text: string;
}

// A thread's field takes deliveries immediately, or when its pane next mounts. Keep every
// delivery when a field is not mounted yet (for example while a new side chat opens).
export const [composerDeliveries, setComposerDeliveries] = createSignal<Record<string, ComposerDelivery>>({});
export function deliverToComposer(key: string, delivery: ComposerDelivery): void {
  const pending = composerDeliveries()[key];
  setComposerDeliveries({
    ...composerDeliveries(),
    [key]: pending ? {
      images: [...pending.images, ...delivery.images],
      attachments: [...(pending.attachments ?? []), ...(delivery.attachments ?? [])],
      text: [pending.text, delivery.text].filter(Boolean).join("\n\n"),
    } : delivery,
  });
}
