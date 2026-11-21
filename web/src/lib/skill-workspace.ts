import { language, t } from "./i18n";
import type { SkillInfo } from "../../../shared/protocol";

export const SKILL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const SKILL_TEMPLATE = "## Når\n\nBeskriv når skillen skal brukes.\n\n## Slik gjør du det\n\n1. Første steg\n2. Neste steg\n";

export function skillSource(skill: SkillInfo): string {
  return skill.source === "app" ? t("Fra appen") : skill.source === "project" ? t("Prosjekt: {name}", { name: skill.projectName ?? t("Ukjent") }) : t("Dine · alle prosjekter");
}

export function filterSkills(skills: SkillInfo[], query: string, source: string, status: string): SkillInfo[] {
  const locale = language();
  const words = query.toLocaleLowerCase(locale).split(/\s+/).filter(Boolean);
  return skills.filter((skill) => {
    if (source !== "all" && (source.startsWith("project:") ? skill.projectId !== source.slice(8) : skill.source !== source)) return false;
    if (status === "on" && !skill.enabled || status === "off" && skill.enabled) return false;
    const hay = `${skill.name} ${skill.description} ${skillSource(skill)} ${skill.path}`.toLocaleLowerCase(locale);
    return words.every((word) => hay.includes(word));
  }).sort((a, b) => a.name.localeCompare(b.name, locale) || skillSource(a).localeCompare(skillSource(b), locale) || a.id.localeCompare(b.id));
}
