// Runs only on an explicit manual annotation request, inside the page. It neither installs
// handlers nor changes DOM/styles. Inputs, editable content, hidden nodes and scripts are omitted.
import type { AnnotationElement } from "../../shared/protocol.ts";
export function annotationElements(): { width: number; height: number; elements: AnnotationElement[] } {
  const width = innerWidth, height = innerHeight;
  const elements: AnnotationElement[] = [];
  const nodes = document.querySelectorAll("body,body *");
  for (let index = 0; index < Math.min(nodes.length, 12000) && elements.length < 1200; index++) {
    const node = nodes[index];
    const tag = node.tagName.toLowerCase();
    if (["script", "style", "noscript", "template", "input", "textarea", "select", "option"].includes(tag) || (node as HTMLElement).isContentEditable) continue;
    const box = node.getBoundingClientRect(), css = getComputedStyle(node);
    if (box.width < 2 || box.height < 2 || box.right <= 0 || box.bottom <= 0 || box.left >= width || box.top >= height || css.visibility !== "visible" || Number(css.opacity) === 0) continue;
    const x = Math.max(0, box.x), y = Math.max(0, box.y);
    const rect = { x, y, w: Math.min(width, box.right) - x, h: Math.min(height, box.bottom) - y };
    const selector = node.id ? `${tag}#${CSS.escape(node.id)}` : `${tag}${[...node.classList].slice(0, 3).map((name) => `.${CSS.escape(name)}`).join("")}`;
    const text = node.querySelector("input,textarea,select,[contenteditable]") ? "" : ((node as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
    elements.push({ tag, selector: selector.slice(0, 180), text, color: css.color.slice(0, 80), font: `${css.fontSize} ${css.fontFamily}`.slice(0, 120), rect });
  }
  return { width, height, elements };
}
