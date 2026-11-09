// Environment for every child process: commands, terminals, playtest, Chrome and VS Code.

const SECRET_NAME =
  /^AD_|^npm_|API_?KEY|ACCESS_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_?KEY|^OPENAI_|^ANTHROPIC_|^OPENROUTER_|^GROQ_|^AWS_|^GCP_|^AZURE_/i;

export interface EnvScrub {
  names: Iterable<string>; // apiKeyEnv names configured on providers
  values: Iterable<string>; // known secret values, whatever variable they ended up in
}

export function childEnv(scrub: EnvScrub, extra: Record<string, string> = {}): Record<string, string> {
  const names = new Set(scrub.names);
  const values = new Set([...scrub.values].filter(Boolean));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || SECRET_NAME.test(name) || names.has(name) || values.has(value)) continue;
    env[name] = value;
  }
  return { ...env, ...extra };
}
