// One image at a time, over everything (moved out of rows.tsx in round 13, so the step views can
// use it without importing the rows).
// Click or Esc closes it. Built on demand, so nothing has to be mounted per pane.
export function showImage(src: string, alt: string): void {
  document.querySelector(".image-viewer")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "image-viewer";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", alt);
  const image = document.createElement("img");
  image.src = src;
  image.alt = alt;
  overlay.append(image);
  const close = () => {
    overlay.remove();
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    close();
  };
  overlay.addEventListener("click", close);
  window.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
}

export const imageUrl = (id: string) => `/api/images/${encodeURIComponent(id)}`;

