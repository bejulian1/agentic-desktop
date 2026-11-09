// Just what boot.ts uses. React ships no types of its own, and @types/react is not installed: the
// app itself is written in Solid, and only the preview runtime touches React.
declare module "react" {
  export type ComponentType = ((props: Record<string, unknown>) => unknown) | (abstract new (...args: any[]) => unknown);
  export function createElement(type: ComponentType, props?: Record<string, unknown> | null): unknown;
}

declare module "react-dom/client" {
  export interface Root {
    render(element: unknown): void;
    unmount(): void;
  }
  export function createRoot(container: Element, options?: { onUncaughtError?: (error: unknown, info: unknown) => void }): Root;
}
