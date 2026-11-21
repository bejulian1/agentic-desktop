import { t } from "../lib/i18n";
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { audioLimit, defaultSpeechModel, speechTarget } from '../../../shared/dictation';
import { app, report, saveSettings } from '../state/app';
import { IconMic, IconStop } from './icons';
import { Group, Row } from './settings/parts';

const setup = () => t("Velg en leverandør med støtte for tale til tekst under Innstillinger → Modeller og leverandører → Diktering.");
const target = () => speechTarget(app.settings, app.providers);

export function DictationSettings() {
  const [providerId, setProvider] = createSignal('');
  const [model, setModel] = createSignal('');
  createEffect(() => { const chosen = target(); setProvider(chosen?.providerId ?? ''); setModel(chosen?.model ?? ''); });
  return <Group title={t("Diktering")}><Row label={t("Tale til tekst")} text={t("Lyd sendes bare til leverandøren du velger. Den må støtte /audio/transcriptions.")}>
    <label>{t("Leverandør ")}<select class="input" aria-label={t("Taleleverandør")} value={providerId()} onChange={event => { setProvider(event.currentTarget.value); setModel(defaultSpeechModel(app.providers.find(item => item.id === providerId()))); }}>
      <option value="">{t("Av")}</option><For each={app.providers.filter(item => item.kind === 'openai-compatible' && item.baseUrl)}>{item => <option value={item.id} selected={providerId() === item.id}>{item.name}</option>}</For></select></label>
    <Show when={providerId()}><label>{t("Talemodell ")}<input class="input" value={model()} maxLength={200} onInput={event => setModel(event.currentTarget.value)} /></label></Show>
    <button class="btn btn-small" disabled={!!providerId() && !model().trim()} onClick={() => saveSettings({ dictation: providerId() ? { providerId: providerId(), model: model().trim() } : null }).catch(report)}>{t("Lagre diktering")}</button>
  </Row></Group>;
}

export function Dictation(props: { draft: string; disabled: boolean; insert: (text: string) => void; error: (message: string) => void }) {
  const [phase, setPhase] = createSignal<'idle' | 'confirm' | 'opening' | 'recording' | 'sending'>('idle');
  let cancel = () => {};
  createEffect(() => { void props.draft; void props.disabled; onCleanup(() => cancel()); });
  let recorder: MediaRecorder | undefined;
  const record = async () => {
    const chosen = target();
    if (!chosen) { setPhase('idle'); props.error(setup()); return; }
    const controller = new AbortController();
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => { clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); };
    cancel = () => { controller.abort(); if (recorder?.state === 'recording') recorder.stop(); release(); setPhase('idle'); };
    setPhase('opening');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error(t("Nettleseren støtter ikke lydopptak her."));
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (controller.signal.aborted) { release(); return; }
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error(t("Fant ikke et støttet lydformat."));
      const active = recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 });
      const chunks: Blob[] = [];
      let size = 0;
      active.ondataavailable = event => {
        size += event.data.size;
        if (controller.signal.aborted) return;
        if (size > audioLimit) { cancel(); props.error(t("Opptaket er for langt. Prøv en kortere melding.")); } else chunks.push(event.data);
      };
      active.onerror = () => { if (!controller.signal.aborted) { cancel(); props.error(t("Lydopptaket mislyktes. Kontroller mikrofonen.")); } };
      active.onstop = async () => {
        release();
        if (controller.signal.aborted) return;
        setPhase('sending');
        try {
          const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
          if (!bytes.length) throw new Error(t("Opptaket er tomt. Prøv igjen."));
          const res = await fetch('/api/dictation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...chosen, mime: mimeType, audio: bytes.toBase64() }), signal: controller.signal });
          const result = await res.json();
          if (!res.ok) throw new Error(result.error ?? t("Diktering mislyktes."));
          if (!controller.signal.aborted) props.insert(result.text);
        } catch (error) { if (!controller.signal.aborted) props.error(error instanceof TypeError ? t("Fikk ikke kontakt med serveren.") : (error as Error).message); }
        finally { if (!controller.signal.aborted) setPhase('idle'); }
      };
      active.start(1000); setPhase('recording'); timer = setTimeout(() => { if (active.state === 'recording') active.stop(); }, 300_000);
    } catch (error) {
      release(); if (controller.signal.aborted) return;
      setPhase('idle'); props.error(error instanceof DOMException ? t("Fikk ikke åpnet mikrofonen. Kontroller mikrofontillatelsen og lydinngangen.") : (error as Error).message);
    }
  };
  return <Show when={phase() !== 'idle'} fallback={<button type="button" class="foot-icon" aria-label={t("Diktering")} title={t("Dikter meldingen")} disabled={props.disabled} onClick={() => { if (!target()) return props.error(setup()); cancel = () => setPhase('idle'); setPhase('confirm'); }}><IconMic size={16}/></button>}>
    <Show when={phase() === 'confirm'} fallback={<button type="button" class="btn btn-small" onClick={() => phase() === 'recording' ? recorder?.stop() : cancel()}>{phase() === 'recording' ? <><IconStop size={13}/> {t("Tar opp · stopp")}</> : phase() === 'sending' ? t("Transkriberer · avbryt") : t("Åpner mikrofon · avbryt")}</button>}>
      <button type="button" class="btn btn-small" title={target()?.baseUrl} onClick={record}>{t("Ta opp til {provider}", { provider: target()?.name ?? "" })}</button><button type="button" class="btn btn-small" onClick={() => cancel()}>{t("Avbryt")}</button>
    </Show></Show>;
}
