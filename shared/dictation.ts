import type { ProviderConfig, Settings } from './protocol.ts';

type Provider = Pick<ProviderConfig, 'id' | 'name' | 'baseUrl' | 'kind'>;
export const audioLimit = 3 * 1024 * 1024;
export function defaultSpeechModel(provider?: Provider) {
  return provider?.baseUrl?.replace(/\/+$/, '') === 'https://api.groq.com/openai/v1' ? 'whisper-large-v3-turbo' : 'whisper-1';
}
export function speechTarget(settings: Settings, providers: Provider[]) {
  const compatible = providers.filter(provider => provider.kind === 'openai-compatible' && provider.baseUrl);
  const choice = settings.dictation;
  const provider = choice === undefined ? compatible.find(provider => /^https:\/\/(?:api\.openai\.com\/v1|api\.groq\.com\/openai\/v1)\/?$/.test(provider.baseUrl!)) : compatible.find(provider => provider.id === choice?.providerId);
  return provider ? { providerId: provider.id, name: provider.name, baseUrl: provider.baseUrl!, model: choice?.model ?? defaultSpeechModel(provider) } : null;
}
