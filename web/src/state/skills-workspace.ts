// Kept independent of app state, so every navigation entry can close this room.
import { createSignal } from "solid-js";
import { closeArtifacts } from "./artifacts";
import { closeProfile } from "./nav";

export const [skillsOpen, setSkillsOpen] = createSignal(false);
export const openSkills = () => { closeArtifacts(); closeProfile(); setSkillsOpen(true); };
export const closeSkills = () => setSkillsOpen(false);
