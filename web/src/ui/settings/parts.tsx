// The building blocks of Innstillinger: a page with a title, a group with a heading, and a row
// with a title, an explanation and a control on the right.
import { For, Show, type JSX } from "solid-js";
import type { Settings } from "../../../../shared/protocol";
import { patch } from "../../lib/api";
import { app, report, saveSettings, setApp } from "../../state/app";
import { applyLook } from "../../state/look";
import { Select } from "../Select";

export type Icon = (p: { size?: number }) => JSX.Element;

// Rows of grey lines while a list loads, with the height of real rows, so nothing jumps when it comes.
export function SkeletonRows(props: { label: string; count?: number }) {
  return (
    <div class="skeleton-rows" role="status">
      <span class="sr-only">{props.label}</span>
      <For each={Array.from({ length: props.count ?? 3 })}>
        {() => (
          <div class="skeleton-row" aria-hidden="true">
            <span class="skeleton-text"><span class="skeleton skeleton-line" /><span class="skeleton skeleton-line short" /></span>
            <span class="skeleton skeleton-control" />
          </div>
        )}
      </For>
    </div>
  );
}

export function Page(props: { title: string; intro?: JSX.Element; children: JSX.Element; class?: string }) {
  return (
    <section class={`settings-section ${props.class ?? ""}`}>
      <h1 class="settings-title">{props.title}</h1>
      <Show when={props.intro}><p class="settings-intro">{props.intro}</p></Show>
      {props.children}
    </section>
  );
}

export function Group(props: { title?: string; action?: JSX.Element; children: JSX.Element }) {
  return (
    <div class="settings-group">
      <Show when={props.title || props.action}>
        <div class="settings-group-head"><h2>{props.title}</h2>{props.action}</div>
      </Show>
      <div class="settings-card">{props.children}</div>
    </div>
  );
}

export function Row(props: { label: JSX.Element; text?: JSX.Element; icon?: Icon; badge?: JSX.Element; children?: JSX.Element; as?: "label"; class?: string }) {
  const body = (
    <>
      <Show when={props.icon}>{props.icon!({ size: 16 })}</Show>
      <div class="setting-text">
        <strong>{props.label}{props.badge}</strong>
        <Show when={props.text}><span class="muted">{props.text}</span></Show>
      </div>
      <div class="setting-control">{props.children}</div>
    </>
  );
  return props.as === "label" ? <label class={`setting ${props.class ?? ""}`}>{body}</label> : <div class={`setting ${props.class ?? ""}`}>{body}</div>;
}

export function Toggle(props: { label: string; text: string; checked: boolean; onChange: (value: boolean) => void; icon?: Icon }) {
  return (
    <Row as="label" label={props.label} text={props.text} icon={props.icon}>
      <input type="checkbox" role="switch" class="switch" checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)} />
    </Row>
  );
}

export function BetaBadge(props: { title?: string }) {
  return <span class="beta-badge" title={props.title ?? "Ikke prøvd med en ekte nøkkel ennå"}> Beta</span>;
}

// A choice on the right of a row, in the app's own style (ui/Select.tsx). The label is the row
// title, for screen readers too.
export function Choice<T extends string | number>(props: { active?: boolean; label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return <Select<T> active={props.active} label={props.label} value={props.value} options={props.options} onChange={props.onChange} />;
}

export function Segmented<T extends string | number>(props: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div class="segmented" role="group" aria-label={props.label}>
      <For each={props.options}>
        {(o) => <button type="button" class="segment" aria-pressed={props.value === o.value} onClick={() => props.onChange(o.value)}>{o.label}</button>}
      </For>
    </div>
  );
}

export function save(value: Partial<Settings>): void {
  saveSettings(value).catch(report);
}

// Back to the default: the field is left out on the server, and null says so in the PATCH.
export function reset(key: keyof Settings): void {
  setApp("settings", key, undefined!);
  applyLook({ ...app.settings });
  patch("/api/settings", { [key]: null }).catch(report);
}
