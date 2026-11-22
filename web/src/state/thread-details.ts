// Tråddetaljer: the small floating card under its button in the top bar (Kode). It does not open
// the side panel; it only shows where the thread works and shortcuts to what belongs to it.
import { createSignal } from "solid-js";

export const [threadDetailsOpen, setThreadDetailsOpen] = createSignal(false);
export const toggleThreadDetails = () => setThreadDetailsOpen(!threadDetailsOpen());
