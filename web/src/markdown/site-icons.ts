// The coloured site marks for links in the conversation (v1.4.0, moved out of render.ts). Pure
// data and lookups without imports, so the tests can load this file without a browser. Each mark is
// a small hand-drawn SVG in the site's own colours; nothing is ever fetched from the web.

export type SiteKind =
  | "github" | "pull" | "issue" | "release" | "commit" | "discussion" | "gitlab" | "youtube" | "npm"
  | "stackoverflow" | "mdn" | "docker" | "huggingface" | "anthropic" | "openai" | "google" | "reddit"
  | "wikipedia" | "figma" | "linear" | "vercel" | "x" | "discord" | "python" | "rust" | "node"
  | "hackernews" | "vite" | "solid" | "typescript" | "tailwind" | "notion" | "slack" | "linkedin"
  | "arxiv" | "ubuntu" | "arch" | "cloudflare" | "aws" | "azure" | "stripe" | "supabase"
  | "playwright" | "electron" | "localhost" | "link";

export interface IconPart { tag: "path" | "circle" | "rect" | "polygon" | "ellipse"; attrs: Record<string, string> }
export interface IconSpec { fill?: string; stroke?: string; strokeWidth?: string; parts: IconPart[] }

export const ICONS: Record<SiteKind, IconSpec> = {

  // GitHub Octocat
  github: { fill: "currentColor", parts: [{ tag: "path", attrs: { d: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" } }] },
  // GitHub Pull Request
  pull: { stroke: "#3FB950", strokeWidth: "1.6", parts: [
    { tag: "circle", attrs: { cx: "4", cy: "3.5", r: "1.75" } },
    { tag: "circle", attrs: { cx: "4", cy: "12.5", r: "1.75" } },
    { tag: "circle", attrs: { cx: "12", cy: "12.5", r: "1.75" } },
    { tag: "path", attrs: { d: "M4 5.25v5.5M12 10.75V6.5a2 2 0 0 0-2-2H8.5M10 2.5 8.5 4.5 10 6.5" } },
  ] },
  // GitHub Issue
  issue: { stroke: "#A371F7", strokeWidth: "1.6", parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "6" } },
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "1.5", fill: "#A371F7", stroke: "none" } },
  ] },
  // GitHub Release (a tag)
  release: { stroke: "#3FB950", strokeWidth: "1.5", parts: [
    { tag: "path", attrs: { d: "M2.25 2.7v4.15c0 .4.16.78.44 1.06l5.4 5.4a1.5 1.5 0 0 0 2.12 0l3.04-3.04a1.5 1.5 0 0 0 0-2.12l-5.4-5.4a1.5 1.5 0 0 0-1.06-.44H2.7a.45.45 0 0 0-.45.45Z" } },
    { tag: "circle", attrs: { cx: "5.25", cy: "5.25", r: "1", fill: "#3FB950", stroke: "none" } },
  ] },
  // GitHub Commit
  commit: { stroke: "currentColor", strokeWidth: "1.6", parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "2.6" } },
    { tag: "path", attrs: { d: "M1.25 8h4.15M10.6 8h4.15" } },
  ] },
  // GitHub Discussions (two speech bubbles)
  discussion: { stroke: "#58A6FF", strokeWidth: "1.4", parts: [
    { tag: "path", attrs: { d: "M2.75 2.5h7a1 1 0 0 1 1 1v4.75a1 1 0 0 1-1 1H6L3.5 11V9.25h-.75a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" } },
    { tag: "path", attrs: { d: "M12.75 6h.5a1 1 0 0 1 1 1v4.75a1 1 0 0 1-1 1h-.5v1.75L10.5 12.75H8.25a1 1 0 0 1-1-1v-.5" } },
  ] },
  // GitLab fox
  gitlab: { parts: [
    { tag: "path", attrs: { d: "M8 14.5 10.7 6.3H5.3L8 14.5Z", fill: "#E24329" } },
    { tag: "path", attrs: { d: "M8 14.5 5.3 6.3H1.5L8 14.5Z", fill: "#FC6D26" } },
    { tag: "path", attrs: { d: "M1.5 6.3.7 8.9c-.1.3 0 .7.3.9L8 14.5 1.5 6.3Z", fill: "#FCA326" } },
    { tag: "path", attrs: { d: "M1.5 6.3h3.8L3.7 1.3c-.1-.3-.5-.3-.6 0L1.5 6.3Z", fill: "#E24329" } },
    { tag: "path", attrs: { d: "M8 14.5 10.7 6.3h3.8L8 14.5Z", fill: "#FC6D26" } },
    { tag: "path", attrs: { d: "M14.5 6.3l.8 2.6c.1.3 0 .7-.3.9L8 14.5l6.5-8.2Z", fill: "#FCA326" } },
    { tag: "path", attrs: { d: "M14.5 6.3h-3.8l1.6-5c.1-.3.5-.3.6 0l1.6 5Z", fill: "#E24329" } },
  ] },
  // YouTube red play badge
  youtube: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "2.5", width: "14.5", height: "11", rx: "3", fill: "#FF0000" } },
    { tag: "polygon", attrs: { points: "6.4,5.4 11.4,8 6.4,10.6", fill: "#FFFFFF" } },
  ] },
  // npm red square
  npm: { parts: [
    { tag: "rect", attrs: { x: "1", y: "1", width: "14", height: "14", rx: "2.2", fill: "#CB3837" } },
    { tag: "path", attrs: { d: "M3.5 12.2V3.8h9v8.4h-2.3V6.1H8v6.1H3.5Z", fill: "#FFFFFF" } },
  ] },
  // Stack Overflow orange stack
  stackoverflow: { parts: [
    { tag: "path", attrs: { d: "M3 10.2v3.3h9.5v-3.3", stroke: "#94A3B8", "stroke-width": "1.5", fill: "none" } },
    { tag: "path", attrs: { d: "M4.8 11.6h6M5.1 9.1l5.8 1.2M5.9 6.5l5.4 2.5M7.5 4.1l4.6 3.8M9.8 2l3.4 4.8", stroke: "#F48024", "stroke-width": "1.35", "stroke-linecap": "round" } },
  ] },
  // MDN Web Docs blue badge
  mdn: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "3", fill: "#0284C7" } },
    { tag: "path", attrs: { d: "M3 11.5V4.5l2.5 3.8L8 4.5v7M10.4 4.5h1.5a2 2 0 0 1 0 7h-1.5V4.5Z", stroke: "#FFFFFF", "stroke-width": "1.35", fill: "none", "stroke-linejoin": "round" } },
  ] },
  // Docker blue containers
  docker: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "3", fill: "#2496ED" } },
    { tag: "rect", attrs: { x: "3", y: "6.4", width: "2.1", height: "1.9", fill: "#FFFFFF" } },
    { tag: "rect", attrs: { x: "5.6", y: "6.4", width: "2.1", height: "1.9", fill: "#FFFFFF" } },
    { tag: "rect", attrs: { x: "8.2", y: "6.4", width: "2.1", height: "1.9", fill: "#FFFFFF" } },
    { tag: "rect", attrs: { x: "5.6", y: "4", width: "2.1", height: "1.9", fill: "#FFFFFF" } },
    { tag: "path", attrs: { d: "M2.3 9c.2 2.4 2 3.8 5.2 3.8 3 0 5.3-1.4 6.1-3.8-.8-.4-1.7-.3-2.3 0H2.3Z", fill: "#FFFFFF" } },
  ] },
  // Hugging Face warm gold badge
  huggingface: { parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "6.8", fill: "#FFD21E" } },
    { tag: "circle", attrs: { cx: "5.8", cy: "6.6", r: "1", fill: "#1F2937" } },
    { tag: "circle", attrs: { cx: "10.2", cy: "6.6", r: "1", fill: "#1F2937" } },
    { tag: "path", attrs: { d: "M5.3 9.7c.7 1.3 1.7 1.8 2.7 1.8s2-.5 2.7-1.8", stroke: "#1F2937", "stroke-width": "1.3", "stroke-linecap": "round", fill: "none" } },
  ] },
  // Anthropic / Claude coral starburst
  anthropic: { stroke: "#D97757", strokeWidth: "1.7", parts: [
    { tag: "path", attrs: { d: "M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" } },
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "1.7", fill: "#D97757", stroke: "none" } },
  ] },
  // OpenAI emerald badge
  openai: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "3.5", fill: "#10A37F" } },
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "4", stroke: "#FFFFFF", "stroke-width": "1.5", fill: "none" } },
    { tag: "path", attrs: { d: "M8 4v8M4.5 6l7 4M11.5 6l-7 4", stroke: "#FFFFFF", "stroke-width": "1.1" } },
  ] },
  // Google 4-colour G badge
  google: { parts: [
    { tag: "path", attrs: { d: "M14.4 8.2c0-.5 0-.9-.1-1.3H8v2.6h3.6a3.1 3.1 0 0 1-1.3 2v1.7h2.2c1.3-1.2 1.9-2.9 1.9-5Z", fill: "#4285F4" } },
    { tag: "path", attrs: { d: "M8 14.8c1.8 0 3.3-.6 4.5-1.6l-2.2-1.7c-.6.4-1.4.7-2.3.7-1.8 0-3.3-1.2-3.8-2.8H2v1.8A6.7 6.7 0 0 0 8 14.8Z", fill: "#34A853" } },
    { tag: "path", attrs: { d: "M4.2 9.4a4 4 0 0 1 0-2.8V4.8H2a6.7 6.7 0 0 0 0 6.4l2.2-1.8Z", fill: "#FBBC05" } },
    { tag: "path", attrs: { d: "M8 3.8c1 0 1.9.3 2.6 1l1.9-1.9A6.6 6.6 0 0 0 8 1.2 6.7 6.7 0 0 0 2 4.8l2.2 1.8C4.7 5 6.2 3.8 8 3.8Z", fill: "#EA4335" } },
  ] },
  // Reddit orange-red circle
  reddit: { parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "7", fill: "#FF4500" } },
    { tag: "circle", attrs: { cx: "8", cy: "9.2", r: "3.7", fill: "#FFFFFF" } },
    { tag: "circle", attrs: { cx: "6.5", cy: "8.8", r: "0.8", fill: "#FF4500" } },
    { tag: "circle", attrs: { cx: "9.5", cy: "8.8", r: "0.8", fill: "#FF4500" } },
    { tag: "path", attrs: { d: "M8 5.5 9.2 3.3 11.4 3.8", stroke: "#FFFFFF", "stroke-width": "1.1", fill: "none", "stroke-linecap": "round" } },
  ] },
  // Wikipedia badge
  wikipedia: { parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "6.8", fill: "#E2E8F0" } },
    { tag: "path", attrs: { d: "M3.4 4.8 5.6 11.4 8 6.4l2.4 5 2.2-6.6", stroke: "#1E293B", "stroke-width": "1.4", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" } },
  ] },
  // Figma multi-colour
  figma: { parts: [
    { tag: "circle", attrs: { cx: "5.8", cy: "3.5", r: "2.3", fill: "#F24E1E" } },
    { tag: "circle", attrs: { cx: "10.2", cy: "3.5", r: "2.3", fill: "#FF7262" } },
    { tag: "circle", attrs: { cx: "5.8", cy: "8", r: "2.3", fill: "#A259FF" } },
    { tag: "circle", attrs: { cx: "10.2", cy: "8", r: "2.3", fill: "#1ABCFE" } },
    { tag: "circle", attrs: { cx: "5.8", cy: "12.5", r: "2.3", fill: "#0ACF83" } },
  ] },
  // Linear indigo
  linear: { parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "6.8", fill: "#5E6AD2" } },
    { tag: "path", attrs: { d: "M3.6 9.5 6.5 12.4M3.3 6.8 9.2 12.7M4.8 4.8l6.4 6.4", stroke: "#FFFFFF", "stroke-width": "1.35", "stroke-linecap": "round" } },
  ] },
  // Vercel triangle
  vercel: { parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "6.8", fill: "#18181B" } },
    { tag: "polygon", attrs: { points: "8,3.6 12.6,11.4 3.4,11.4", fill: "#FFFFFF" } },
  ] },
  // X / Twitter
  x: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "3.2", fill: "#18181B" } },
    { tag: "path", attrs: { d: "M4 3.8 12 12.2M12 3.8 4 12.2", stroke: "#FFFFFF", "stroke-width": "1.6", "stroke-linecap": "round" } },
  ] },
  // Discord blurple
  discord: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "3.5", fill: "#5865F2" } },
    { tag: "path", attrs: { d: "M4.5 10.6c1 .8 2.2 1.1 3.5 1.1s2.5-.3 3.5-1.1l.6-4.5c-.8-.6-1.7-1-2.6-1.1l-.4.8a6 6 0 0 0-2.2 0l-.4-.8c-.9.1-1.8.5-2.6 1.1l.6 4.5Z", fill: "#FFFFFF" } },
    { tag: "circle", attrs: { cx: "6.4", cy: "8.4", r: "0.85", fill: "#5865F2" } },
    { tag: "circle", attrs: { cx: "9.6", cy: "8.4", r: "0.85", fill: "#5865F2" } },
  ] },
  // Python blue & yellow
  python: { parts: [
    { tag: "path", attrs: { d: "M8 1.5c-2.6 0-2.8 1.1-2.8 2.4v1.6h3v.7H4.1C2.6 6.2 1.5 7.2 1.5 9c0 1.9 1.1 2.8 2.6 2.8h1.1V10c0-1.4 1.1-2.5 2.5-2.5h3c1.2 0 2.1-.9 2.1-2.1V3.9c0-1.3-1.1-2.4-2.8-2.4H8Z", fill: "#3776AB" } },
    { tag: "path", attrs: { d: "M11.9 6.2h-1.1V8c0 1.4-1.1 2.5-2.5 2.5h-3c-1.2 0-2.1.9-2.1 2.1v1.5c0 1.3 1.1 2.4 2.8 2.4h2c2.6 0 2.8-1.1 2.8-2.4v-1.6h-3v-.7h4.1c1.5 0 2.6-1 2.6-2.8 0-1.9-1.1-2.8-2.6-2.8Z", fill: "#FFD43B" } },
  ] },
  // Rust orange gear
  rust: { parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "6.2", fill: "#EA580C" } },
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "2.8", fill: "#FFFFFF" } },
  ] },
  // Node.js green hex
  node: { parts: [
    { tag: "polygon", attrs: { points: "8,1.2 14,4.6 14,11.4 8,14.8 2,11.4 2,4.6", fill: "#5FA04E" } },
    { tag: "path", attrs: { d: "M5.8 10.6V5.4l4.4 5.2V5.4", stroke: "#FFFFFF", "stroke-width": "1.5", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" } },
  ] },
  // Hacker News orange Y
  hackernews: { parts: [
    { tag: "rect", attrs: { x: "1", y: "1", width: "14", height: "14", rx: "2.4", fill: "#FF6600" } },
    { tag: "path", attrs: { d: "M5 4.2 8 8.4l3-4.2M8 8.4v3.6", stroke: "#FFFFFF", "stroke-width": "1.6", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" } },
  ] },
  // Vite: lavender shield with a yellow bolt
  vite: { parts: [
    { tag: "path", attrs: { d: "M14.6 2.5 8.4 13.6a.45.45 0 0 1-.78 0L1.4 2.5a.45.45 0 0 1 .47-.66L8 2.95l6.13-1.1a.45.45 0 0 1 .47.65Z", fill: "#8B8FFF" } },
    { tag: "path", attrs: { d: "M10.4 1.1 6.1 2a.2.2 0 0 0-.16.18l-.27 4.5a.2.2 0 0 0 .25.2l1.2-.28a.2.2 0 0 1 .24.23l-.36 1.75a.2.2 0 0 0 .25.23l.74-.22a.2.2 0 0 1 .25.23l-.56 2.73c-.04.17.19.26.28.11l.06-.1 3.2-6.38a.2.2 0 0 0-.22-.29l-1.24.24a.2.2 0 0 1-.23-.25l.81-2.8a.2.2 0 0 0-.23-.25Z", fill: "#FFC517" } },
  ] },
  // SolidJS blue lozenges
  solid: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "3.2", fill: "#2C4F7C" } },
    { tag: "path", attrs: { d: "M3.2 6.6c2-1.9 5.4-2.7 9.6-1.4l-1.3 1.8C8.6 6.2 5.8 6.4 3.2 6.6Z", fill: "#76B3E1" } },
    { tag: "path", attrs: { d: "M12.8 9.4c-2 1.9-5.4 2.7-9.6 1.4l1.3-1.8c2.9.8 5.7.6 8.3.4Z", fill: "#FFFFFF" } },
  ] },
  // TypeScript blue TS badge
  typescript: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "2.6", fill: "#3178C6" } },
    { tag: "path", attrs: { d: "M3.2 7.4h4.2M5.3 7.4v5.1", stroke: "#FFFFFF", "stroke-width": "1.4", fill: "none", "stroke-linecap": "round" } },
    { tag: "path", attrs: { d: "M12.7 7.9c-.3-.4-.8-.6-1.4-.6-.8 0-1.4.4-1.4 1 0 1.4 2.9.8 2.9 2.4 0 .7-.7 1.2-1.6 1.2-.7 0-1.3-.3-1.6-.8", stroke: "#FFFFFF", "stroke-width": "1.3", fill: "none", "stroke-linecap": "round" } },
  ] },
  // Tailwind CSS sky waves
  tailwind: { parts: [
    { tag: "path", attrs: { d: "M8 3.6c-1.9 0-3 .9-3.5 2.8.7-.9 1.5-1.3 2.4-1 .6.1.9.5 1.4 1 .7.8 1.6 1.7 3.5 1.7 1.9 0 3-.9 3.5-2.8-.7.9-1.5 1.3-2.4 1-.6-.1-.9-.5-1.4-1C10.8 4.5 9.9 3.6 8 3.6ZM4.5 8c-1.9 0-3 .9-3.5 2.8.7-.9 1.5-1.3 2.4-1 .6.1.9.5 1.4 1 .7.8 1.6 1.7 3.5 1.7 1.9 0 3-.9 3.5-2.8-.7.9-1.5 1.3-2.4 1-.6-.1-.9-.5-1.4-1C7.3 8.9 6.4 8 4.5 8Z", fill: "#38BDF8" } },
  ] },
  // Notion: black N on white paper
  notion: { parts: [
    { tag: "rect", attrs: { x: "1.6", y: "1.6", width: "12.8", height: "12.8", rx: "2.4", fill: "#FFFFFF", stroke: "#18181B", "stroke-width": "1.2" } },
    { tag: "path", attrs: { d: "M5.3 11.2V4.8l5.4 6.4V4.8", stroke: "#18181B", "stroke-width": "1.45", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" } },
  ] },
  // Slack four-colour pinwheel
  slack: { parts: [
    { tag: "rect", attrs: { x: "1.6", y: "5.4", width: "6.2", height: "2.4", rx: "1.2", fill: "#36C5F0" } },
    { tag: "rect", attrs: { x: "8.2", y: "1.6", width: "2.4", height: "6.2", rx: "1.2", fill: "#2EB67D" } },
    { tag: "rect", attrs: { x: "8.2", y: "8.2", width: "6.2", height: "2.4", rx: "1.2", fill: "#ECB22E" } },
    { tag: "rect", attrs: { x: "5.4", y: "8.2", width: "2.4", height: "6.2", rx: "1.2", fill: "#E01E5A" } },
  ] },
  // LinkedIn blue "in"
  linkedin: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "2.6", fill: "#0A66C2" } },
    { tag: "rect", attrs: { x: "3.5", y: "6.3", width: "1.9", height: "5.9", rx: "0.3", fill: "#FFFFFF" } },
    { tag: "circle", attrs: { cx: "4.45", cy: "4.35", r: "1.1", fill: "#FFFFFF" } },
    { tag: "path", attrs: { d: "M7.2 12.2V6.3h1.8v.8c.4-.6 1.1-1 1.9-1 1.5 0 2.2.9 2.2 2.7v3.4h-1.9V9.3c0-.8-.3-1.3-1-1.3s-1.1.5-1.1 1.3v2.9Z", fill: "#FFFFFF" } },
  ] },
  // arXiv crimson chi
  arxiv: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "2.6", fill: "#B31B1B" } },
    { tag: "path", attrs: { d: "M4.4 4.2 11.6 11.8M11.6 4.2 8.9 7.1M7.1 8.9 4.4 11.8", stroke: "#FFFFFF", "stroke-width": "1.6", fill: "none", "stroke-linecap": "round" } },
  ] },
  // Ubuntu circle of friends
  ubuntu: { parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "7", fill: "#E95420" } },
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "3.1", stroke: "#FFFFFF", "stroke-width": "1.3", fill: "none" } },
    { tag: "circle", attrs: { cx: "8", cy: "3.7", r: "1.25", fill: "#FFFFFF", stroke: "#E95420", "stroke-width": "0.6" } },
    { tag: "circle", attrs: { cx: "4.3", cy: "10.15", r: "1.25", fill: "#FFFFFF", stroke: "#E95420", "stroke-width": "0.6" } },
    { tag: "circle", attrs: { cx: "11.7", cy: "10.15", r: "1.25", fill: "#FFFFFF", stroke: "#E95420", "stroke-width": "0.6" } },
  ] },
  // Arch Linux blue peak
  arch: { parts: [
    { tag: "path", attrs: { d: "M8 1.2c-.6 1.5-1 2.4-1.6 3.7.4.4.9.9 1.7 1.4-.9-.4-1.5-.7-2-1.1C4.9 7.8 3.6 10.6 1.4 14.6c1.8-1 3.1-1.6 4.4-1.9-.1-.3-.1-.6-.1-.9 0-1.5 1-2.7 2.3-2.7s2.3 1.3 2.3 2.8c0 .3 0 .5-.1.8 1.3.3 2.6.9 4.4 1.9-.4-.7-.7-1.3-1-1.9-.6-.4-1.1-.9-2-1.3.6.1 1.1.3 1.5.5C11.4 7.9 10.1 5 8 1.2Z", fill: "#1793D1" } },
  ] },
  // Cloudflare orange cloud
  cloudflare: { parts: [
    { tag: "path", attrs: { d: "M11.3 11.6H2.6a2.2 2.2 0 0 1-.2-4.4 3.5 3.5 0 0 1 6.7-1.3 2.8 2.8 0 0 1 3.6 2.2 1.8 1.8 0 0 1-1.4 3.5Z", fill: "#F38020" } },
    { tag: "path", attrs: { d: "M12.4 11.6h2a1.7 1.7 0 0 0-1.5-2.9", fill: "#FBAD41" } },
  ] },
  // AWS navy badge with the orange smile
  aws: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "2.6", fill: "#232F3E" } },
    { tag: "path", attrs: { d: "M3.6 4.6 4.6 8l1-2.6L6.6 8l1-3.4", stroke: "#FFFFFF", "stroke-width": "1.1", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" } },
    { tag: "path", attrs: { d: "M3 10.1c3 1.8 6.8 1.8 9.8 0M11.4 9.5l1.5.5-.4 1.5", stroke: "#FF9900", "stroke-width": "1.3", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" } },
  ] },
  // Azure blue wedges
  azure: { parts: [
    { tag: "path", attrs: { d: "M6.2 1.8h3.6L4.9 14.2H1.4Z", fill: "#0078D4" } },
    { tag: "path", attrs: { d: "M10.4 4.6 14.6 14.2H6.8l5-1.4-3.3-3.9Z", fill: "#50A8F0" } },
  ] },
  // Stripe blurple S
  stripe: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "3.2", fill: "#635BFF" } },
    { tag: "path", attrs: { d: "M10.6 5.4c-.6-.4-1.5-.6-2.3-.6-1.4 0-2.3.6-2.3 1.6 0 2 4.1 1.4 4.1 3.3 0 1.1-1 1.7-2.4 1.7-.9 0-1.9-.3-2.6-.8", stroke: "#FFFFFF", "stroke-width": "1.5", fill: "none", "stroke-linecap": "round" } },
  ] },
  // Supabase green bolt
  supabase: { parts: [
    { tag: "path", attrs: { d: "M9 1.2 2.4 9.4c-.3.4 0 .9.5.9H8l-.9 4.4c-.1.4.4.7.7.3l6.5-8.1c.3-.4 0-.9-.5-.9H8.7l.9-4.5c.1-.4-.4-.6-.6-.3Z", fill: "#3ECF8E" } },
  ] },
  // Playwright green and red masks
  playwright: { parts: [
    { tag: "circle", attrs: { cx: "6", cy: "9", r: "4.8", fill: "#2EAD33" } },
    { tag: "circle", attrs: { cx: "10.4", cy: "7", r: "4.6", fill: "#D65348" } },
    { tag: "circle", attrs: { cx: "4.6", cy: "8.6", r: "0.8", fill: "#14532D" } },
    { tag: "circle", attrs: { cx: "9.6", cy: "6.4", r: "0.8", fill: "#FFFFFF" } },
    { tag: "circle", attrs: { cx: "12", cy: "6.4", r: "0.8", fill: "#FFFFFF" } },
  ] },
  // Electron teal atom
  electron: { stroke: "#47848F", strokeWidth: "1.2", parts: [
    { tag: "ellipse", attrs: { cx: "8", cy: "8", rx: "6.6", ry: "2.5" } },
    { tag: "ellipse", attrs: { cx: "8", cy: "8", rx: "6.6", ry: "2.5", transform: "rotate(60 8 8)" } },
    { tag: "ellipse", attrs: { cx: "8", cy: "8", rx: "6.6", ry: "2.5", transform: "rotate(120 8 8)" } },
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "1.3", fill: "#9FEAF9", stroke: "none" } },
  ] },
  // Local dev server emerald badge
  localhost: { parts: [
    { tag: "rect", attrs: { x: "0.75", y: "0.75", width: "14.5", height: "14.5", rx: "3.2", fill: "#16A34A" } },
    { tag: "path", attrs: { d: "m4.3 5.5 2.6 2.5-2.6 2.5M8.2 10.5h3.5", stroke: "#FFFFFF", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round" } },
  ] },
  // Generic web globe (accent coloured)
  link: { stroke: "currentColor", strokeWidth: "1.5", parts: [
    { tag: "circle", attrs: { cx: "8", cy: "8", r: "6.25" } },
    { tag: "path", attrs: { d: "M1.75 8h12.5M8 1.75c1.8 1.7 2.7 3.8 2.7 6.25S9.8 12.3 8 14.25C6.2 12.3 5.3 10.2 5.3 8S6.2 3.45 8 1.75z" } },
  ] },
};

// Recognised hosts get their coloured mark on both bare and named links.
export const KNOWN_SITES: Array<[RegExp, SiteKind]> = [
  [/^(?:www\.)?gitlab\.com$/i, "gitlab"],
  [/^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)$/i, "youtube"],
  [/^(?:www\.|docs\.)?npmjs\.(?:com|org)$/i, "npm"],
  [/^(?:[\w-]+\.)?(?:stackoverflow\.com|stackexchange\.com|superuser\.com|serverfault\.com|askubuntu\.com)$/i, "stackoverflow"],
  [/^developer\.mozilla\.org$/i, "mdn"],
  [/^(?:www\.|hub\.|docs\.)?docker\.com$/i, "docker"],
  [/^(?:www\.)?huggingface\.co$/i, "huggingface"],
  [/^(?:www\.|docs\.|console\.|support\.)?(?:anthropic\.com|claude\.ai|claude\.com)$/i, "anthropic"],
  [/^(?:www\.|platform\.|chat\.|community\.|help\.)?(?:openai\.com|chatgpt\.com)$/i, "openai"],
  [/^(?:www\.|docs\.|ai\.|cloud\.|developers\.|support\.|gemini\.)?(?:google\.com|web\.dev)$/i, "google"],
  [/^(?:www\.|old\.)?reddit\.com$/i, "reddit"],
  [/^(?:[a-z]{2,3}\.)?(?:m\.)?wikipedia\.org$/i, "wikipedia"],
  [/^(?:www\.)?figma\.com$/i, "figma"],
  [/^(?:www\.)?linear\.app$/i, "linear"],
  [/^(?:www\.)?(?:vercel\.com|nextjs\.org)$/i, "vercel"],
  [/^(?:www\.|mobile\.)?(?:x\.com|twitter\.com)$/i, "x"],
  [/^(?:www\.)?(?:discord\.com|discord\.gg)$/i, "discord"],
  [/^(?:www\.|docs\.|pypi\.)?(?:python\.org|pypi\.org)$/i, "python"],
  [/^(?:www\.|doc\.|docs\.|blog\.)?(?:rust-lang\.org|crates\.io|docs\.rs)$/i, "rust"],
  [/^(?:www\.)?nodejs\.org$/i, "node"],
  [/^news\.ycombinator\.com$/i, "hackernews"],
  [/^(?:www\.|main\.)?(?:vite\.dev|vitejs\.dev|vitest\.dev)$/i, "vite"],
  [/^(?:www\.|docs\.)?solidjs\.com$/i, "solid"],
  [/^(?:www\.)?typescriptlang\.org$/i, "typescript"],
  [/^(?:www\.|v[0-9]\.)?tailwindcss\.com$/i, "tailwind"],
  [/^(?:[\w-]+\.)?(?:notion\.so|notion\.site|notion\.com)$/i, "notion"],
  [/^(?:[\w-]+\.)?slack\.com$/i, "slack"],
  [/^(?:[a-z]{2,3}\.|www\.)?linkedin\.com$/i, "linkedin"],
  [/^(?:www\.|export\.)?arxiv\.org$/i, "arxiv"],
  [/^(?:www\.|help\.|wiki\.|discourse\.|launchpad\.|packages\.|documentation\.)?(?:ubuntu\.com|launchpad\.net)$/i, "ubuntu"],
  [/^(?:www\.|wiki\.|aur\.|bbs\.)?archlinux\.org$/i, "arch"],
  [/^(?:www\.|developers\.|dash\.|blog\.)?(?:cloudflare\.com|workers\.dev|pages\.dev)$/i, "cloudflare"],
  [/^(?:aws\.amazon\.com|docs\.aws\.amazon\.com|console\.aws\.amazon\.com)$/i, "aws"],
  [/^(?:azure\.microsoft\.com|portal\.azure\.com|learn\.microsoft\.com)$/i, "azure"],
  [/^(?:www\.|docs\.|dashboard\.)?stripe\.com$/i, "stripe"],
  [/^(?:www\.)?supabase\.(?:com|io)$/i, "supabase"],
  [/^(?:www\.)?playwright\.dev$/i, "playwright"],
  [/^(?:www\.)?electronjs\.org$/i, "electron"],
  [/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i, "localhost"],
];

export function siteOfHost(host: string): SiteKind | null {
  const name = host.toLowerCase();
  for (const [pattern, site] of KNOWN_SITES) if (pattern.test(name)) return site;
  return null;
}

// The colour a site's chip and label lean towards, for light and for dark themes. The label mixes
// it with the theme's own text colour (styles/t3-look.css), so it reads at WCAG AA on every theme;
// web/test/rike-lenker-enhet.test.ts checks that for all 34 themes.
export const SITE_COLORS: Partial<Record<SiteKind, [light: string, dark: string]>> = {
  youtube: ["#c62828", "#ff8a8a"],
  npm: ["#b71c1c", "#ff9190"],
  gitlab: ["#c2410c", "#ff9457"],
  stackoverflow: ["#c2410c", "#ff9f5a"],
  reddit: ["#c2410c", "#ff8a50"],
  hackernews: ["#c2410c", "#ff9a4d"],
  rust: ["#c2410c", "#ff9457"],
  ubuntu: ["#c2410c", "#ff8a5c"],
  cloudflare: ["#c2410c", "#ffa24d"],
  aws: ["#b45309", "#ffb547"],
  anthropic: ["#c2410c", "#eb9375"],
  openai: ["#047857", "#4ade80"],
  node: ["#15803d", "#7ee07a"],
  supabase: ["#047857", "#5ee0a8"],
  playwright: ["#15803d", "#6fd679"],
  localhost: ["#15803d", "#4ade80"],
  mdn: ["#0369a1", "#6cb8ff"],
  docker: ["#1d4ed8", "#6cb8ff"],
  google: ["#1d4ed8", "#7aaeff"],
  python: ["#1e40af", "#7cb7ff"],
  typescript: ["#1d4ed8", "#7aaeff"],
  linkedin: ["#0a66c2", "#70b5f9"],
  azure: ["#0369a1", "#6cc4ff"],
  arch: ["#0369a1", "#62c0ff"],
  solid: ["#1e40af", "#8cc6f0"],
  tailwind: ["#0369a1", "#5fd0ff"],
  electron: ["#0f766e", "#7fd3df"],
  linear: ["#4f46e5", "#a5abff"],
  discord: ["#4f46e5", "#a5abff"],
  figma: ["#7c3aed", "#c4a1ff"],
  vite: ["#6d28d9", "#b6a6ff"],
  stripe: ["#4f46e5", "#a9a4ff"],
  slack: ["#9d174d", "#f58bb6"],
  arxiv: ["#b91c1c", "#ff9494"],
  huggingface: ["#a16207", "#ffd24a"],
};

// Every other web address gets a monogram mark: the first letter of its host on a colour chosen
// from the host, so a site always looks the same. Each colour holds 4.5:1 against the white letter.
export const MONOGRAM_COLORS = [
  "#2563eb", "#7c3aed", "#be185d", "#0f766e", "#15803d", "#b45309", "#c2410c", "#b91c1c",
  "#4f46e5", "#0e7490", "#a21caf", "#475569", "#9333ea", "#0369a1", "#be123c", "#6d28d9",
];

export interface Monogram { letter: string; color: string }

export function monogramFor(host: string): Monogram {
  const name = host.toLowerCase().replace(/^www\./, "").replace(/^\[|\]$/g, "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const letter = (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? "•").toUpperCase();
  return { letter, color: MONOGRAM_COLORS[hash % MONOGRAM_COLORS.length] };
}
