// Kept independent of app state, so every navigation entry can close this room.
import { createSignal } from "solid-js";
import { closeArtifacts } from "./artifacts";
import { closeGitHubRoom, closeProfile } from "./nav";

export const [skillsOpen, setSkillsOpen] = createSignal(false);
export const openSkills = () => { closeArtifacts(); closeGitHubRoom(); closeProfile(); setSkillsOpen(true); };
export const closeSkills = () => setSkillsOpen(false);
