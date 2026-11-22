// Switches the markdown renderer reads. state/look.ts sets them from Innstillinger, so the renderer
// never has to know about the app's state (and the worker never imports it).
let math = true;

// Innstillinger → Utseende → Vis matte. Off: a formula stays as the text it was written as.
export function setMathRendering(on: boolean): void {
  math = on;
}

export function mathRendering(): boolean {
  return math;
}
