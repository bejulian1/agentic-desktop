import {BUILTIN_MODS} from "../../../shared/ui-mods.ts";
import {randomUUID} from "node:crypto";
// The demo model: a deterministic script behind the same interface as a real provider. It only
// emits stream parts, so everything it does passes through the real loop, tools and approvals.
// It decides from the conversation, the way a model would, and keeps no state of its own.
import type { Block, Message, Provider, ProviderRequest, StreamPart } from "./types.ts";

interface Step {
  thinking?: string;
  slowThinking?: boolean; // round 10: a line at a time, with a pause, so the thinking can be watched
  text?: string;
  call?: { name: string; input: Record<string, unknown> };
}

interface DoneCall {
  name: string;
  input: any;
  result: string;
  isError: boolean;
}

const HELP = `Dette er demo-modellen. Den trenger ingen API-nøkkel, og alt den gjør går gjennom de ekte verktøyene og tillatelsene.

Prøv disse:

- **test spørrekort**: viser et spørsmål med valg, avkryssing og eget svar\n- **lag en side**: skriver \`index.html\`, kjører en kommando og åpner siden i nettleseren
- **godkjenning**: skriver til \`.env.demo\`, som alltid krever godkjenning
- **rediger**: endrer \`index.html\` med \`edit_file\`
- **samarbeid**: lager en hjelpetråd, venter på den og oppsummerer
- **team**: en teamleder lager en oppgaveliste, gir oppgavene til to tråder og krysser av
- **/review** etter en endring: en kodegjennomgang av diffen
- **lang kommando**: kjører en kommando som kan stoppes
- **løkke**: gjentar samme verktøykall for å vise bremsen
- **feil**: viser et verktøy som feiler
- **artifact** eller **html-spill**: et lite HTML-program i én fil, som en artifact du kan åpne og kjøre
- **react-artifact**: en liten React-app i JSX, og **ny versjon av react-appen** for versjon 2 (**react tsx** gir TypeScript)
- **tekstblokk**: et svar med tekst som skal kopieres, i en blokk merket Tekst
- **kommandoblokk**: et svar med skallkommandoer, som kan kjøres med Kjør i Kode
- **lang strøm 200000**: strømmer mye tekst, for ytelsestest
- **vis alle steg**: én tur med alle stegtypene i Kode: lese, søke, nett, kommando, opprette, endre, slette, feil, godkjenning og team
- **søk på nettet etter …** i Chat, med Nettsøk på: demo-kilder som er tydelig merket`;

const PAGE = `<!doctype html>
<html lang="no">
<head>
  <meta charset="utf-8">
  <title>Demo fra Agentic Desktop</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 32rem; line-height: 1.5; }
    button { font: inherit; padding: 0.5rem 1rem; }
  </style>
</head>
<body>
  <h1>Hei fra demo-modellen</h1>
  <p>Denne siden ble laget gjennom de ekte verktøyene.</p>
  <button id="teller">Klikket 0 ganger</button>
  <script>
    let klikk = 0;
    const knapp = document.getElementById("teller");
    knapp.addEventListener("click", () => {
      klikk += 1;
      knapp.textContent = "Klikket " + klikk + " ganger";
      console.log("klikk", klikk);
    });
  </script>
</body>
</html>
`;

// A small canvas game in one file, for the artifact preview. No network, no storage.
export const ARTIFACT_GAME = `<!doctype html>
<html lang="no">
<head>
  <meta charset="utf-8">
  <title>Fang prikken</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #f6f4ef; color: #23211d; display: grid; place-items: center; min-height: 100vh; }
    canvas { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgb(0 0 0 / 0.15); cursor: crosshair; }
    p { margin: 0.5rem 0; }
  </style>
</head>
<body>
  <main>
    <p>Poeng: <strong id="poeng">0</strong>. Klikk på prikken før den flytter seg.</p>
    <canvas id="spill" width="360" height="220"></canvas>
  </main>
  <script>
    const canvas = document.getElementById("spill");
    const ctx = canvas.getContext("2d");
    const poeng = document.getElementById("poeng");
    let score = 0;
    let dot = { x: 180, y: 110, r: 16 };
    function flytt() {
      dot = { x: 20 + Math.random() * 320, y: 20 + Math.random() * 180, r: Math.max(8, 16 - score) };
    }
    function tegn() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#c8663a";
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
      ctx.fill();
      requestAnimationFrame(tegn);
    }
    canvas.addEventListener("click", (e) => {
      const box = canvas.getBoundingClientRect();
      if (Math.hypot(e.clientX - box.left - dot.x, e.clientY - box.top - dot.y) <= dot.r) {
        score += 1;
        poeng.textContent = String(score);
        flytt();
      }
    });
    setInterval(flytt, 1400);
    tegn();
  </script>
</body>
</html>`;

const ARTIFACT_REPLY = `Her er et lite spill i én HTML-fil. Klikk på prikken for å få poeng.

\`\`\`html fang-prikken.html
${ARTIFACT_GAME}
\`\`\`

Åpne boksen for å spille. Du kan lagre det som en artifact og endre det i Artifacts-rommet.`;

// Round 15 (SPEC 31): a small React app in one file, and a second version of it, so the artifact
// box, the panel and its versions can be seen without an API key. Only react, no network.
const REACT_STYLES = `const stil = {
  side: { boxSizing: "border-box", maxWidth: 460, margin: "32px auto", padding: "0 20px", fontFamily: "system-ui, sans-serif", color: "#23211d" },
  tittel: { fontSize: 22, margin: "0 0 4px" },
  status: { margin: "0 0 16px", color: "#6b6860" },
  skjema: { display: "flex", gap: 8, marginBottom: 12 },
  felt: { flex: 1, minWidth: 0, padding: "8px 10px", border: "1px solid #d6d3cc", borderRadius: 8, font: "inherit" },
  knapp: { padding: "8px 14px", whiteSpace: "nowrap", border: 0, borderRadius: 8, background: "#23211d", color: "#fff", font: "inherit", cursor: "pointer" },
  liste: { listStyle: "none", margin: 0, padding: 0 },
  rad: { padding: "8px 2px", borderBottom: "1px solid #ece9e3" },
  etikett: { display: "flex", alignItems: "center", gap: 10, cursor: "pointer" },
  filtre: { display: "flex", gap: 6, margin: "0 0 12px" },
  filter: { padding: "4px 10px", border: "1px solid #d6d3cc", borderRadius: 999, background: "#fff", font: "inherit", fontSize: 13, cursor: "pointer" },
};`;

export const REACT_APP = `import { useState } from "react";

const start = [
  { id: 1, tekst: "Kjøpe melk", ferdig: false },
  { id: 2, tekst: "Svare på e-post", ferdig: true },
  { id: 3, tekst: "Gå en tur", ferdig: false },
];

export default function Oppgaver() {
  const [oppgaver, setOppgaver] = useState(start);
  const [ny, setNy] = useState("");
  const igjen = oppgaver.filter((o) => !o.ferdig).length;

  function leggTil(e) {
    e.preventDefault();
    const tekst = ny.trim();
    if (!tekst) return;
    setOppgaver([...oppgaver, { id: Date.now(), tekst, ferdig: false }]);
    setNy("");
  }

  function veksle(id) {
    setOppgaver(oppgaver.map((o) => (o.id === id ? { ...o, ferdig: !o.ferdig } : o)));
  }

  return (
    <main style={stil.side}>
      <h1 style={stil.tittel}>Oppgaver</h1>
      <p style={stil.status} id="igjen">{igjen} igjen av {oppgaver.length}</p>
      <form onSubmit={leggTil} style={stil.skjema}>
        <input value={ny} onChange={(e) => setNy(e.target.value)} placeholder="Ny oppgave" aria-label="Ny oppgave" style={stil.felt} />
        <button style={stil.knapp}>Legg til</button>
      </form>
      <ul style={stil.liste}>
        {oppgaver.map((o) => (
          <li key={o.id} style={stil.rad}>
            <label style={{ ...stil.etikett, textDecoration: o.ferdig ? "line-through" : "none", color: o.ferdig ? "#8a877f" : "inherit" }}>
              <input type="checkbox" checked={o.ferdig} onChange={() => veksle(o.id)} />
              {o.tekst}
            </label>
          </li>
        ))}
      </ul>
    </main>
  );
}

${REACT_STYLES}
`;

export const REACT_APP_V2 = `import { useState } from "react";

const start = [
  { id: 1, tekst: "Kjøpe melk", ferdig: false },
  { id: 2, tekst: "Svare på e-post", ferdig: true },
  { id: 3, tekst: "Gå en tur", ferdig: false },
];

const FILTRE = { alle: "Alle", igjen: "Igjen", ferdige: "Ferdige" };

export default function Oppgaver() {
  const [oppgaver, setOppgaver] = useState(start);
  const [ny, setNy] = useState("");
  const [filter, setFilter] = useState("alle");
  const igjen = oppgaver.filter((o) => !o.ferdig).length;
  const vist = oppgaver.filter((o) => filter === "alle" || (filter === "ferdige") === o.ferdig);

  function leggTil(e) {
    e.preventDefault();
    const tekst = ny.trim();
    if (!tekst) return;
    setOppgaver([...oppgaver, { id: Date.now(), tekst, ferdig: false }]);
    setNy("");
  }

  function veksle(id) {
    setOppgaver(oppgaver.map((o) => (o.id === id ? { ...o, ferdig: !o.ferdig } : o)));
  }

  return (
    <main style={stil.side}>
      <h1 style={stil.tittel}>Oppgaver</h1>
      <p style={stil.status} id="igjen">{igjen} igjen av {oppgaver.length}</p>
      <form onSubmit={leggTil} style={stil.skjema}>
        <input value={ny} onChange={(e) => setNy(e.target.value)} placeholder="Ny oppgave" aria-label="Ny oppgave" style={stil.felt} />
        <button style={stil.knapp}>Legg til</button>
      </form>
      <div style={stil.filtre} role="group" aria-label="Vis">
        {Object.entries(FILTRE).map(([id, navn]) => (
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}
            style={{ ...stil.filter, background: filter === id ? "#23211d" : "#fff", color: filter === id ? "#fff" : "inherit" }}>
            {navn}
          </button>
        ))}
      </div>
      <ul style={stil.liste}>
        {vist.map((o) => (
          <li key={o.id} style={stil.rad}>
            <label style={{ ...stil.etikett, textDecoration: o.ferdig ? "line-through" : "none", color: o.ferdig ? "#8a877f" : "inherit" }}>
              <input type="checkbox" checked={o.ferdig} onChange={() => veksle(o.id)} />
              {o.tekst}
            </label>
          </li>
        ))}
      </ul>
    </main>
  );
}

${REACT_STYLES}
`;

// The same app in TypeScript, for the TSX path.
export const REACT_APP_TSX = REACT_APP
  .replace('import { useState } from "react";\n', 'import { useState, type CSSProperties, type FormEvent } from "react";\n\ntype Oppgave = { id: number; tekst: string; ferdig: boolean };\n')
  .replace("const start = [", "const start: Oppgave[] = [")
  .replace("useState(start)", "useState<Oppgave[]>(start)")
  .replace("useState(\"\")", "useState<string>(\"\")")
  .replace("function leggTil(e) {", "function leggTil(e: FormEvent) {")
  .replace("function veksle(id) {", "function veksle(id: number) {")
  .replace("const stil = {", "const stil: Record<string, CSSProperties> = {");

const REACT_REPLY = `Her er en liten oppgaveliste i React, i én fil. Den bruker bare \`react\`.

\`\`\`jsx oppgaver.jsx
${REACT_APP}\`\`\`

Åpne boksen for å prøve den, eller se koden under Kode.`;

const REACT_REPLY_V2 = `Her er en ny versjon av oppgavelisten, med filter for alle, de som er igjen og de ferdige.

\`\`\`jsx oppgaver.jsx
${REACT_APP_V2}\`\`\`

Panelet kan bla mellom versjonene.`;

const REACT_REPLY_TSX = `Her er oppgavelisten i TypeScript.

\`\`\`tsx oppgaver.tsx
${REACT_APP_TSX}\`\`\`
`;

// Round 15 (SPEC 31.3): text meant to be copied as it is goes in a text block.
const TEXT_REPLY = `Her er et utkast du kan kopiere:

\`\`\`text
Hei Kari,

Takk for møtet i går. Jeg sender oppsummeringen innen fredag, og foreslår at vi tar neste møte i uke 47.

Vennlig hilsen
Ola
\`\`\`

Si fra hvis tonen skal være mer formell.`;

// Round 10 (SPEC 23.11): «tenk grundig» gives a few seconds of thinking in several lines, so the
// thinking card in Chat can be seen without an API key. No existing reply changes.
const DEEP_THINKING = [
  "Leser spørsmålet nøye og ser hva som egentlig spørres om.",
  "Går gjennom delene én for én.",
  "Veier to måter å forklare det på mot hverandre.",
  "Sjekker at eksemplet stemmer.",
  "Samler svaret i en rolig rekkefølge.",
];
const DEEP_REPLY = `Jeg tenkte meg om før jeg svarte.

1. **Først** det spørsmålet egentlig handler om.
2. **Så** delene, én for én.
3. **Til slutt** et kort svar som henger sammen.

_Dette er demo-modellen. Tenkingen her er laget for å vise tenkevisningen._`;

const CHAT_REPLY = `Her er et lite eksempel, strømmet som Markdown.

## En funksjon i TypeScript

\`\`\`ts
export function hils(navn: string): string {
  return \`Hei, \${navn}!\`;
}
\`\`\`

Og en i Python:

\`\`\`python
def summer(tall):
    return sum(tall)
\`\`\`

| Modus | Verktøy |
|---|---|
| Chat | Ingen |
| Kode | Filer, kommandoer og nettleser |

Skriv **hjelp** for å se hva demo-modellen kan.`;

// Shell blocks for Kjør on code blocks: one command with a $ prompt, and a script of two lines.
const SHELL_REPLY = `Kjør denne for å se at det virker:

\`\`\`bash
$ echo hei-fra-blokken
\`\`\`

Eller begge linjene som ett skript:

\`\`\`sh
echo linje-en
echo linje-to
\`\`\``;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function textOf(blocks: Block[]): string {
  return blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
}

// The latest user text, plus every tool call and result since then.
function readConversation(messages: Message[]): { text: string; done: DoneCall[] } {
  let start = messages.length - 1;
  while (start > 0 && !(messages[start].role === "user" && textOf(messages[start].content))) start--;
  const done: DoneCall[] = [];
  for (const message of messages.slice(start)) {
    for (const block of message.content) {
      if (block.type === "tool_use") done.push({ name: block.name, input: block.input, result: "", isError: false });
      if (block.type === "tool_result") {
        const call = done.findLast((d) => !d.result);
        if (call) Object.assign(call, { result: block.content, isError: block.isError ?? false });
      }
    }
  }
  return { text: textOf(messages[start]?.content ?? []), done };
}

function buildPage(done: DoneCall[]): Step {
  const did = (name: string) => done.some((d) => d.name === name);
  if (!did("list_dir")) return { thinking: "Brukeren vil ha en side. Jeg ser først hva som ligger i prosjektmappen.", call: { name: "list_dir", input: { path: "." } } };
  const exists = done.find((d) => d.name === "list_dir")!.result.split("\n").includes("index.html");
  if (exists && !did("read_file")) return { text: "`index.html` finnes allerede, så jeg leser den før jeg skriver.", call: { name: "read_file", input: { path: "index.html" } } };
  if (!did("write_file")) return { thinking: "Jeg holder siden enkel: én fil, litt stil og en knapp.", text: "Jeg lager `index.html`.", call: { name: "write_file", input: { path: "index.html", content: PAGE } } };
  if (!did("run_command")) return { text: "Så sjekker jeg filen med en kommando.", call: { name: "run_command", input: { command: "wc -c index.html" } } };
  if (!did("browser_navigate")) return { text: "Nå åpner jeg siden i nettleseren.", call: { name: "browser_navigate", input: { url: "index.html" } } };
  if (!did("browser_snapshot")) return { call: { name: "browser_snapshot", input: {} } };
  if (!did("browser_screenshot")) return { call: { name: "browser_screenshot", input: {} } };
  return {
    thinking: "Siden lastet, og knappen vises i tilgjengelighetstreet.",
    text: "Ferdig. `index.html` ligger i prosjektmappen, og siden er åpen i Nettleser-panelet. Knappen teller klikk.",
  };
}

function collaborate(done: DoneCall[]): Step {
  const created = done.find((d) => d.name === "thread_create");
  if (!created) {
    return {
      thinking: "Dette kan deles opp. Jeg lager en hjelpetråd som ser over prosjektet.",
      text: "Jeg lager en hjelpetråd.",
      call: { name: "thread_create", input: { title: "Hjelpetråd", task: "Se over prosjektmappen og gi en kort oversikt." } },
    };
  }
  if (created.isError) return { text: `Fikk ikke laget hjelpetråden: ${created.result}` };
  const threadId = /tråd-id: ([\w-]+)/.exec(created.result)?.[1] ?? "";
  const waited = done.find((d) => d.name === "thread_wait");
  if (!waited) return { text: "Jeg venter på hjelpetråden.", call: { name: "thread_wait", input: { threadId, timeoutSeconds: 120 } } };
  return { thinking: "Hjelpetråden er ferdig, så jeg kan oppsummere.", text: `Samarbeidet er ferdig. Hjelpetråden svarte:\n\n> ${waited.result.replace(/\n+/g, " ")}` };
}

function helper(done: DoneCall[]): Step {
  const listing = done.find((d) => d.name === "list_dir");
  if (!listing) return { thinking: "Jeg ser hva som ligger i mappen.", call: { name: "list_dir", input: { path: "." } } };
  const count = listing.isError || !listing.result.trim() ? 0 : listing.result.trim().split("\n").length;
  return { text: `Oversikt fra hjelpetråden: prosjektmappen har ${count} oppføringer.` };
}

// Plan mode: only read-only tools, so the demo looks around and answers with a plan.
function plan(done: DoneCall[]): Step {
  const listing = done.find((d) => d.name === "list_dir");
  if (!listing) return { thinking: "Planmodus er på. Jeg ser meg rundt før jeg foreslår noe.", call: { name: "list_dir", input: { path: "." } } };
  const files = listing.isError ? [] : listing.result.split("\n").filter(Boolean);
  return {
    thinking: "Jeg har det jeg trenger for en plan.",
    text: `Plan:\n\n1. Les de ${files.length} oppføringene i prosjektmappen og finn inngangspunktet.\n2. Lag eller endre \`index.html\` med det du ba om.\n3. Kjør en kommando som sjekker filen.\n4. Åpne siden i nettleseren og ta et skjermbilde.\n\nSlå av planmodus med **/plan** når du vil at jeg skal gjøre det.`,
  };
}

// /review: reads the file headers and lines from the diff it was given and comments on them.
function review(text: string): Step {
  const files = [...text.matchAll(/^--- (.+?) \((added|modified|deleted)\)$/gm)].map((m) => ({ path: m[1], change: m[2] }));
  const added = (text.match(/^\+/gm) ?? []).length;
  const removed = (text.match(/^-(?!--)/gm) ?? []).length;
  const notes: string[] = [];
  if (/^\+.*<script>/m.test(text)) notes.push("**Inline-skript:** Skriptet ligger rett i HTML-en. Flytt det til en egen fil hvis siden skal ha en streng CSP.");
  if (/^\+.*console\.log/m.test(text)) notes.push("**Logging:** `console.log` bør fjernes eller bak et flagg før noe går i produksjon.");
  if (/^\+.*<button(?![^>]*type=)/m.test(text)) notes.push("**Knapp uten type:** En `<button>` uten `type` blir en submit-knapp i et skjema. Sett `type=\"button\"`.");
  if (!notes.length) notes.push("Ingen tydelige feil i det som er endret.");
  const list = files.map((f) => `- \`${f.path}\` (${f.change === "added" ? "ny" : f.change === "deleted" ? "slettet" : "endret"})`).join("\n");
  return {
    thinking: "Jeg går gjennom diffen fil for fil og ser etter feil og risiko først.",
    text: `## Kodegjennomgang\n\n${files.length === 1 ? "Én fil" : `${files.length} filer`}, ${added} linjer inn og ${removed} ut:\n\n${list}\n\n### Funn\n\n${notes.map((n) => `- ${n}`).join("\n")}\n\n### Bra\n\n- Endringene er små og samlet, så de er lette å angre.\n\nDette er demo-modellen, så gjennomgangen er laget av faste regler.`,
  };
}

// Round 13 (SPEC 27.1): one turn with every kind of step, so the conversation view can be seen and
// tested without a key. Each step is one call; what is done decides the next, like a model would.
const DEMO_FILES: Array<[string, string]> = [
  ["demo/app.js", "// Et lite demo-program.\nfunction hils(navn) {\n  return `Hei, ${navn}!`;\n}\n\nconsole.log(hils(\"verden\"));\n"],
  ["demo/stil.css", "body {\n  font-family: system-ui, sans-serif;\n  margin: 2rem;\n}\n"],
  ["demo/LESMEG.md", "# Demo\n\nFiler laget av demo-modellen for å vise alle stegtypene.\n"],
];

function allSteps(done: DoneCall[], tools: string[]): Step {
  const count = (name: string) => done.filter((d) => d.name === name).length;
  if (done.some((d) => d.isError && d.result.includes("avslo"))) return { text: "Du avslo skrivingen, så jeg stopper her. Resten av stegene er vist." };
  if (!count("list_dir")) return { thinking: "Brukeren vil se alle stegtypene. Jeg begynner med å se hva som ligger i mappen.", text: "Jeg ser meg rundt i prosjektet først.", call: { name: "list_dir", input: { path: "." } } };
  const created = done.filter((d) => d.name === "write_file" && !String(d.input?.path).startsWith(".env")).length;
  if (created < DEMO_FILES.length) {
    const [path, content] = DEMO_FILES[created];
    return { ...(created ? {} : { text: "Så lager jeg tre små filer å jobbe med." }), call: { name: "write_file", input: { path, content } } };
  }
  const read = count("read_file");
  if (read < DEMO_FILES.length) return { ...(read ? {} : { thinking: "Filene finnes nå. Jeg leser dem før jeg endrer noe." }), call: { name: "read_file", input: { path: DEMO_FILES[read][0] } } };
  if (!count("search")) return { text: "Jeg søker etter funksjoner i koden.", call: { name: "search", input: { pattern: "function", path: "demo" } } };
  if (tools.includes("web_search") && !count("web_search")) return { text: "Og et raskt søk på nettet.", call: { name: "web_search", input: { query: "hilsefunksjon i JavaScript" } } };
  if (!count("edit_file")) return { thinking: "Hilsenen kan være litt varmere.", text: "Jeg endrer hilsenen.", call: { name: "edit_file", input: { path: "demo/app.js", old_string: "return `Hei, ${navn}!`;", new_string: "const tid = new Date().getHours() < 12 ? \"God morgen\" : \"Hei\";\n  return `${tid}, ${navn}!`;" } } };
  if (!count("run_command")) return { text: "Så sjekker jeg mappen med en kommando.", call: { name: "run_command", input: { command: "ls -1 demo && echo \"Alt ser bra ut\"" } } };
  const missing = done.find((d) => d.name === "read_file" && d.input?.path === "demo/mangler.txt");
  if (!missing) return { text: "Her prøver jeg en fil som ikke finnes, for å vise en feil.", call: { name: "read_file", input: { path: "demo/mangler.txt" } } };
  if (!count("delete_file")) return { text: "LESMEG-filen trengs ikke, så jeg sletter den.", call: { name: "delete_file", input: { path: "demo/LESMEG.md" } } };
  if (!done.some((d) => d.name === "write_file" && String(d.input?.path).startsWith(".env"))) {
    return { text: "Filer som `.env*` krever alltid godkjenning, så denne venter på deg.", call: { name: "write_file", input: { path: ".env.demo", content: "DEMO=1\n" } } };
  }
  if (tools.includes("thread_create")) {
    const made = done.find((d) => d.name === "thread_create");
    if (!made) return { text: "Til slutt ber jeg en underagent se over mappen.", call: { name: "thread_create", input: { title: "Underagent: se over demo-mappen", task: "Se over prosjektmappen og gi en kort oversikt." } } };
    const threadId = /tråd-id: ([\w-]+)/.exec(made.result)?.[1] ?? "";
    if (!made.isError && !count("thread_wait")) return { call: { name: "thread_wait", input: { threadId, timeoutSeconds: 120 } } };
  }
  return {
    thinking: "Alle stegtypene er vist. Jeg oppsummerer.",
    text: "Ferdig med alle stegtypene: lese, søke, nett, kommando, opprette, endre, slette, en feil, en godkjenning og en underagent. Trykk på oppsummeringen under for å se endringene.",
  };
}

// Round 13 (SPEC 27.2): Chat with its tools. Search when asked to, read an address that is pasted,
// and say plainly when a tool is off in this chat.
const URL_IN_TEXT = /https?:\/\/[^\s<>()"']+/i;

function searchQuery(text: string): string {
  const cleaned = text.replace(/^(kan du\s+)?(søk|søke|finn|let)(\s+(på|i)\s+nettet)?(\s+(etter|om|på))?\s*/i, "").replace(/[?.!]+$/, "").trim();
  return (cleaned || text).slice(0, 120);
}

function chatWithTools(text: string, done: DoneCall[], tools: string[], system: string): Step | null {
  const lower = text.toLowerCase();
  const document = /lag.*(?:word|excel|powerpoint|markdown|tekstfil|xlsx|docx|pptx)/.test(lower);
  if(document){
    if(!tools.includes("create_document"))return {text:"Lag filer er slått av i denne chatten. Aktiver det med verktøyknappen i meldingsfeltet."};
    const made=done.find(d=>d.name==="create_document");
    if(made)return {text:made.isError?`Filen ble ikke laget: ${made.result}`:"Filen er klar for nedlasting i filkortet under verktøysteget. Dette er et eksempel fra demo-modellen."};
    const input=/excel|xlsx/.test(lower)?{name:"budsjett.xlsx",sheets:[{name:"Budsjett",headers:["Post","Beløp"],rows:[["Utstyr",1200],["Programvare",800],["Totalt",{formula:"SUM(B2:B3)",result:2000}]]}]}:/powerpoint|pptx/.test(lower)?{name:"presentasjon.pptx",slides:[{title:"Analyse i Chat",body:"Et eksempel laget i Agentic Desktop.",bullets:["Nedlastbare dokumenter","Egne Chat-verktøy"]}]}:/word|docx/.test(lower)?{name:"rapport.docx",title:"Rapport",sections:[{heading:"Oppsummering",text:"Dette er et eksempel laget av demo-modellen i Agentic Desktop.",bullets:["Ekte Word-dokument","Klar for nedlasting"]}]}:{name:/markdown/.test(lower)?"notat.md":"notat.txt",text:"Et eksempel fra Agentic Desktop."};
    return {text:"Jeg lager et eksempeldokument.",call:{name:"create_document",input}};
  }
  if(/python-analyse|beregn med python/.test(lower)){
    if(!tools.includes("run_python"))return {text:"Python-analyse er slått av eller utilgjengelig. Du kan velge det med verktøyknappen i Chat."};
    const ran=done.find(d=>d.name==="run_python");if(ran)return {text:ran.isError?`Kjøringen feilet: ${ran.result}`:`Beregningen er kjørt i chattens isolerte arbeidsområde.\n\n${ran.result}`};
    return {call:{name:"run_python",input:{code:'import statistics\nvalues=[12,24,36]\nprint("Gjennomsnitt:",statistics.mean(values))\nwith open("analyse.csv","w") as f: f.write("verdi\\n"+"\\n".join(map(str,values)))'}}};
  }
  const wantsSearch = /\b(søk|søke|nettsøk|nettet|google)\b/.test(lower);
  const url = URL_IN_TEXT.exec(text)?.[0];
  if (url && tools.includes("web_fetch")) {
    const read = done.find((d) => d.name === "web_fetch");
    if (!read) return { text: "Jeg leser siden.", call: { name: "web_fetch", input: { url } } };
    if (read.isError) return { text: `Fikk ikke lest siden: ${read.result}` };
    const title = /^Tittel: (.*)$/m.exec(read.result)?.[1] ?? url;
    const body = read.result.split("\n\n").slice(1).join(" ").replace(/\s+/g, " ").trim().slice(0, 240);
    return { text: `Siden heter **${title}**. Den begynner slik:\n\n> ${body}\n\n_Dette er demo-modellen. Den leste siden med appens egen nettleser._` };
  }
  if (url && !tools.includes("web_fetch")) return { text: "Les nettsider er slått av i denne chatten, så jeg kan ikke åpne adressen. Slå det på med verktøyknappen ved + i meldingsfeltet." };
  if (wantsSearch && tools.includes("web_search")) {
    const searched = done.find((d) => d.name === "web_search");
    if (!searched) return { thinking: "Dette krever ferske kilder. Jeg søker på nettet.", call: { name: "web_search", input: { query: searchQuery(text) } } };
    if (searched.isError) return { text: `Nettsøket feilet: ${searched.result}` };
    const demo = /demo-kilder/.test(searched.result);
    // Demo sources point nowhere, so they are named, not linked.
    const found = [...searched.result.matchAll(/^\d+\. (.+)\n {3}(\S+)/gm)].map((m) => (demo ? `- ${m[1]}` : `- [${m[1]}](${m[2]})`));
    if (!found.length) return { text: "Søket ga ingen treff." };
    return { text: `Jeg fant ${found.length} kilder:\n\n${found.join("\n")}\n\n${demo ? "_Dette er demo-modellen, og kildene er laget for å vise hvordan nettsøk ser ut. De er ikke ekte sider._" : "_Dette er demo-modellen. Kildene kom fra søkesiden i Innstillinger._"}` };
  }
  if (wantsSearch && !/^Web search is on/m.test(system)) return { text: "Nettsøk er slått av i denne chatten. Slå det på med verktøyknappen ved + i meldingsfeltet, så søker jeg." };
  return null;
}

// Agent Teams: a lead adds tasks, gives each to a helper thread, waits for both and ticks them off.
function team(done: DoneCall[]): Step {
  const tasks = done.filter((d) => d.name === "task_add" && !d.isError).map((d) => /Oppgave-id: (\S+)/.exec(d.result)?.[1] ?? "");
  const titles = ["Kartlegg prosjektmappen", "Skriv en kort oversikt"];
  if (done.some((d) => d.isError)) return { text: `Teamet stoppet: ${done.find((d) => d.isError)!.result}` };
  if (tasks.length < titles.length) {
    return {
      ...(tasks.length ? {} : { thinking: "Dette er en teamoppgave. Jeg deler den i to og gir hver del til en egen tråd.", text: "Jeg lager oppgavelisten for teamet." }),
      call: { name: "task_add", input: { title: titles[tasks.length] } },
    };
  }
  const created = done.filter((d) => d.name === "thread_create");
  if (created.length < titles.length) {
    const i = created.length;
    return { text: i ? undefined : "Så lager jeg to hjelpetråder.", call: { name: "thread_create", input: { title: `Team: ${titles[i]}`, task: `${titles[i]}. Oppgave-id ${tasks[i]} i teamets oppgaveliste.` } } };
  }
  const ids = created.map((c) => /tråd-id: ([\w-]+)/.exec(c.result)?.[1] ?? "");
  const owners = done.filter((d) => d.name === "task_update" && d.input?.status === "doing").length;
  if (owners < tasks.length) return { call: { name: "task_update", input: { id: tasks[owners], status: "doing", owner: ids[owners] } } };
  const waited = done.filter((d) => d.name === "thread_wait");
  if (waited.length < ids.length) return { text: waited.length ? undefined : "Nå venter jeg på teamet.", call: { name: "thread_wait", input: { threadId: ids[waited.length], timeoutSeconds: 120 } } };
  const finished = done.filter((d) => d.name === "task_update" && d.input?.status === "done").length;
  if (finished < tasks.length) return { call: { name: "task_update", input: { id: tasks[finished], status: "done" } } };
  return {
    thinking: "Begge oppgavene er ferdige.",
    text: `Teamet er ferdig. Begge oppgavene er krysset av i Team-panelet.\n\n${waited.map((w, i) => `- **${titles[i]}:** ${w.result.replace(/\n+/g, " ")}`).join("\n")}`,
  };
}

// Round 9b (SPEC 22.6): «hei», «hvem er du» and «hva kan du» are answered from the system prompt
// the model actually got, the way a real model would read it: who it is, where it works, which
// tools are on, and which instruction layers it has. So the harness can be seen working without a
// key. In Chat, a bare «hei» keeps its old demo answer (Markdown and code), which the tests use.
type Intent = "greet" | "who" | "what";

export function identityIntent(text: string): Intent | null {
  const lower = text.trim().toLowerCase();
  if (/\b(hva kan du|hva kan du gjøre|hva kan du hjelpe|what can you do|hva er du god på)\b/.test(lower)) return "what";
  if (/\b(hvem er du|hva er du|who are you|what are you|presenter deg)\b/.test(lower)) return "who";
  if (/^(hei|hallo|heisann|hei hei|hoi|god (morgen|dag|kveld)|hi|hello|hey)( der| du| på deg| alle sammen)?[\s!.,?]*$/.test(lower)) return "greet";
  return null;
}

const TOOL_WORDS: Array<[string[], string]> = [
  [["read_file", "search", "glob", "list_dir"], "lese, søke i og forklare koden"],
  [["edit_file", "write_file"], "skrive og endre kode, rette feil og refaktorere"],
  [["run_command"], "kjøre kommandoer, tester og bygg"],
  [["web_search"], "søke på nettet"],
  [["browser_navigate"], "åpne sider i en usynlig nettleser og ta skjermbilder"],
  [["thread_create"], "starte hjelpetråder som jobber samtidig"],
  [["remember"], "huske ting mellom tråder"],
];

function list(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} og ${words.at(-1)}`;
}

// The tools in groups, so 25 names read as five short lines.
function toolGroups(tools: string[]): Array<[string, string[]]> {
  const groups: Array<[string, (name: string) => boolean]> = [
    ["Filer og søk", (n) => ["read_file", "write_file", "edit_file", "delete_file", "list_dir", "search", "glob"].includes(n)],
    ["Kommandoer", (n) => n === "run_command"],
    ["Nett og nettleser", (n) => n.startsWith("browser_") || n.startsWith("web_")],
    ["Tråder og team", (n) => n.startsWith("thread_") || n.startsWith("task_")],
    ["Plan, minner og skills", (n) => ["update_plan", "remember", "forget", "propose_skill", "propose_skill_edit", "propose_chat_memory", "use_skill"].includes(n)],
  ];
  const out: Array<[string, string[]]> = groups.map(([name, test]) => [name, tools.filter(test)]);
  const rest = tools.filter((t) => !groups.some(([, test]) => test(t)));
  if (rest.length) out.push(["Andre", rest]);
  return out.filter(([, names]) => names.length);
}

function line(system: string, label: string): string | null {
  return new RegExp(`^- ${label}: (.+)$`, "m").exec(system)?.[1]?.trim() ?? null;
}

export function introduce(system: string, tools: string[], intent: Intent): string {
  if (!/^You are the coding agent/m.test(system)) {
    const personal = /^(?:Tone|Personality \([^)]*\)|Style adjustments chosen by the user): |The user's own instructions for Chat:|About the user, written by the user:/m.test(system);
    const memories = /^Notes saved in earlier conversations/m.test(system);
    return [
      `${intent === "greet" ? "Hei! " : ""}Jeg er chat-assistenten i Agentic Desktop. Jeg kan svare på spørsmål, forklare, skrive og se over tekst, og vise kodeeksempler. ${tools.includes("create_document") ? "Jeg kan også lage nedlastbare Word-, Excel-, PowerPoint- og tekstfiler i chatten. " : "Dokumentgeneratoren er slått av. "}${tools.includes("run_python") ? "Python-analyse er på i et isolert arbeidsområde. " : "Python-kjøring er slått av. "}For endringer i eksisterende prosjektfiler og kommandoer på PC-en bytter du til Kode.`,
      "",
      `Fra systemprompten: ${personal ? "personaliseringen din er med" : "ingen personalisering er lagt inn ennå"}, og ${memories ? "jeg har Chat-minner fra før" : "jeg har ingen Chat-minner ennå"}.`,
      "",
      "Hva har du lyst til å snakke om?",
    ].join("\n");
  }
  if (!tools.some(t=>t!=="ui_mod" && t!=="request_user_input")) return `${intent === "greet" ? "Hei! " : ""}Jeg er kodeagenten i Agentic Desktop. Du er i Kode uten et valgt prosjekt. Jeg kan forklare kode og hjelpe deg å planlegge, men har ingen fil- eller kommandoverktøy her. Velg et prosjekt hvis oppgaven krever det. Hva vil du jobbe med?`;
  const name = line(system, "Project") ?? "prosjektet";
  const folder = line(system, "Project folder");
  const git = line(system, "Git repository");
  const branch = git ? /branch (\S+)/.exec(git)?.[1] : undefined;
  const checks = line(system, "Checks");
  const can = TOOL_WORDS.filter(([names]) => names.some((n) => tools.includes(n))).map(([, words]) => words);
  const layers = [
    /^The user's own instructions, for every project:/m.test(system) ? "din globale `AGENTS.md`" : null,
    /^Project instructions:/m.test(system) ? "prosjektets `AGENTS.md`" : null,
    /^Project instructions from \.agentic\/AGENTS\.md:/m.test(system) ? "`.agentic/AGENTS.md`" : null,
  ].filter(Boolean) as string[];
  // The memory layer: a header, a note, a blank line, then the list until the next layer.
  const memoryCount = (/# Memories from earlier threads\n[^\n]*\n\n([\s\S]*?)(?:\n\n|$)/.exec(system)?.[1].match(/^- /gm) ?? []).length;
  const skillCount = (/^# Skills\n[\s\S]*?(?=\n\n|$)/m.exec(system)?.[0].match(/^- /gm) ?? []).length;
  const opening =
    intent === "what"
      ? `Jeg er kodeagenten i Agentic Desktop. Her kan jeg ${list(can)}.`
      : `${intent === "greet" ? "Hei! " : ""}Jeg er kodeagenten i Agentic Desktop, og jobber i **${name}**${folder ? ` (\`${folder}\`)` : ""}${branch ? ` på grenen \`${branch}\`` : ""}. Jeg kan ${list(can)}.`;
  const facts = [
    `- **Verktøy som er på (${tools.length}):**`,
    ...toolGroups(tools).map(([group, names]) => `  - ${group}: ${names.map((t) => `\`${t}\``).join(", ")}`),
    `- **Instruksjoner:** ${layers.length ? list(layers) : "bare den innebygde harnessen"}`,
    `- **Minner:** ${memoryCount || "ingen ennå"}${skillCount ? ` · **Skills:** ${skillCount}` : ""}`,
    ...(checks && !/^none/.test(checks) ? [`- **Sjekker etter endringer:** ${checks}`] : []),
    ...(/wait for the user's yes/.test(system) ? ["- Jeg spør før store endringer."] : []),
  ];
  return [opening, "", "Dette ser jeg i harnessen jeg fikk:", "", ...facts, "", "Hva vil du jobbe med?", "", "_Dette er demo-modellen. Den leser den samme systemprompten som en ekte modell får._"].join("\n");
}

function modStep(text:string,done:DoneCall[],tools:string[]):Step|null{
 const lower=text.toLowerCase(),reset=/tilbake.*standard(?:tema|utseende)|tilbakestill.*tema|fjern.*(?:tema|mod|bakgrunn)/.test(lower),create=/lag.*(?:tema|mod\b|mods\b|bakgrunn|pixelart)|(?:aktiver|bruk|slå på).*(?:nordlys|stjernehimmel|hav|tema)/.test(lower),edit=/gjør.*bakgrunn.*(?:rolig|sakte)|endre.*tema/.test(lower);
 if(!reset&&!create&&!edit)return null;if(!tools.includes('ui_mod'))return {text:'Tema og mods er slått av eller utilgjengelig i denne visningen. Du kan åpne biblioteket med palettknappen øverst.'};
 const calls=done.filter(d=>d.name==='ui_mod');if(calls.some(d=>d.isError))return {text:'Modden ble ikke lastet: '+calls.find(d=>d.isError)!.result};
 if(reset){if(!calls.length)return {call:{name:'ui_mod',input:{action:'reset'}}};return {text:'Denne samtalen går tilbake til standardutseendet når turen er ferdig.'};}
 if(edit){if(!calls.length)return {call:{name:'ui_mod',input:{action:'inspect'}}};if(calls.length===1){let inspected;try{inspected=JSON.parse(calls[0].result);}catch{return {text:'Kunne ikke lese moddefinisjonen.'};}if(!inspected.active)return {text:'Denne samtalen bruker ikke et eget tema ennå.'};const mod=structuredClone(inspected.active);if(BUILTIN_MODS.some(m=>m.id===mod.id))mod.id='min-'+mod.id+'-'+randomUUID().slice(0,8);mod.scene.speed=.2;mod.scene.intensity=.35;return {call:{name:'ui_mod',input:{action:'save',mod}}};}}
 else if(!calls.length){const preset=BUILTIN_MODS.find(m=>lower.includes(m.id))??BUILTIN_MODS[0];if(/klokke|egen|mitt|min |personlig|mod/.test(lower)){const mod=structuredClone(preset);mod.id='min-'+preset.id+'-'+randomUUID().slice(0,8);mod.name='Mitt '+preset.name;if(/klokke/.test(lower))mod.widgets=[{kind:'clock',label:'Lokal tid',text:''}];return {call:{name:'ui_mod',input:{action:'save',mod}}};}return {call:{name:'ui_mod',input:{action:'apply',id:preset.id}}};}
 return {text:'Temaendringen er validert og lastes inn når denne turen er ferdig. Temaet følger hele samtalen. Du kan tilpasse det med palettknappen eller be om en endring her. Jeg har ikke sett resultatet i appen.'};
}

// «mcp-kall <verktøy> {json}»: calls one MCP tool by its exposed name with the given arguments,
// then reports the result. So an MCP server can be tried (and tested) without an API key. The name
// is sent as written, also when it is not offered, the way a confused model might: the app's own
// checks (plan mode, unknown tools, name forgiveness) are what answer.
function mcpStep(text: string, done: DoneCall[]): Step | null {
  const match = /^mcp-kall\s+(\S+)(?:\s+(\{[\s\S]*\}))?\s*$/i.exec(text.trim());
  if (!match) return null;
  const name = match[1];
  if (!done.length) {
    let input: Record<string, unknown> = {};
    try {
      input = match[2] ? JSON.parse(match[2]) : {};
    } catch {
      return { text: "Argumentene må være gyldig JSON." };
    }
    return { text: `Jeg kaller ${name}.`, call: { name, input } };
  }
  const last = done[done.length - 1];
  return { text: `MCP-svar${last.isError ? " (feil)" : ""}: ${last.result}` };
}

function decide(text: string, done: DoneCall[], tools: string[], system = ""): Step {
  const lower = text.toLowerCase();
  const mcp = mcpStep(text, done);
  if (mcp) return mcp;
  if (/^(test spørrekort|spør meg|still meg et spørsmål)\b/i.test(text.trim()) && tools.includes("request_user_input")) {
    const answered = done.find((call) => call.name === "request_user_input");
    if (answered) {
      if (answered.isError) return { text: "Spørsmålet kunne ikke vises. " + answered.result };
      try {
        const result = JSON.parse(answered.result);
        if (result.cancelled) return { text: "Du hoppet over spørsmålet. Ingen alternativer er valgt." };
        const answers = result.answers.map((answer: any) => [...answer.selectedOptions, answer.text].filter(Boolean).join(" · ")).join("\n\n");
        return { text: "Takk! Dette svarte du:\n\n" + answers + "\n\nDette er demo-modellen; ingen eksterne modellkall er gjort." };
      } catch { return { text: "Kunne ikke lese svaret." }; }
    }
    return { text: "Velg et alternativ, eller skriv et eget svar i kortet nedenfor.", call: { name: "request_user_input", input: { questions: [
      { id: "format", header: "Format", question: "Hvordan vil du ha resultatet?", options: [{ label: "Kort oppsummering", description: "Bare hovedpunktene og neste steg." }, { label: "Utfyllende gjennomgang", description: "Forklar valg og vis eksempler." }] },
      { id: "include", header: "Innhold", question: "Hva skal være med?", multiSelect: true, options: [{ label: "Kode" }, { label: "Eksempler" }, { label: "Sjekkliste" }] },
    ] } } };
  }
  const hasTools = tools.some(t=>t!=="ui_mod" && t!=="request_user_input");
  const mod=modStep(text,done,tools);if(mod)return mod;
  if (lower.includes("[kodegjennomgang]\n")) return review(text);
  if (/\bhjelp\b|\bhelp\b/.test(lower)) return { text: HELP };
  if (lower.includes("kommandoblokk")) return { text: SHELL_REPLY };
  if (/tenk grundig|tenk nøye/.test(lower)) return { thinking: DEEP_THINKING.join("\n"), slowThinking: true, text: DEEP_REPLY };
  const chat = /^You are the chat assistant/m.test(system);
  if (chat && /^Artifacts are off in this chat/m.test(system) && /\bartifacts?\b|html-spill|\breact\b/.test(lower)) {
    return { text: "Artifacts er slått av i denne chatten, så jeg lager ikke et helt HTML-program. Slå det på med verktøyknappen ved + i meldingsfeltet, eller be om et kort kodeeksempel." };
  }
  if (chat) {
    const step = chatWithTools(text, done, tools, system);
    if (step) return step;
  }
  if (/\breact\b/.test(lower)) {
    if (/\btsx\b|typescript/.test(lower)) return { thinking: "Brukeren vil ha React i TypeScript. Jeg skriver oppgavelisten i én TSX-fil.", text: REACT_REPLY_TSX };
    if (/ny versjon|versjon 2|forbedr|filter/.test(lower)) return { thinking: "En ny versjon av samme app, med samme filnavn, så den blir versjon 2.", text: REACT_REPLY_V2 };
    return { thinking: "Brukeren vil ha en liten React-app i én fil. Jeg lager en oppgaveliste med useState.", text: REACT_REPLY };
  }
  if (/\bartifacts?\b|html-spill/.test(lower)) return { thinking: "Brukeren vil ha et lite program i én fil. Jeg lager et canvas-spill med poeng.", text: ARTIFACT_REPLY };
  if (/tekstblokk/.test(lower)) return { text: TEXT_REPLY };
  const intent = identityIntent(text);
  if (intent && !done.length && ((!chat && hasTools) || intent !== "greet")) {
    return { thinking: "Brukeren vil vite hvem jeg er. Jeg svarer ut fra systemprompten, uten verktøy.", text: introduce(system, tools, intent) };
  }
  // «husk at …» in Kode: saved with remember, through the normal approvals (SPEC 22.3).
  const remember = /^husk(?: på)?(?: at)?[:,]?\s+(.{3,280})$/is.exec(text.trim());
  if (remember && tools.includes("remember")) {
    if (!done.length) {
      const note = remember[1].trim().replace(/^\p{Ll}/u, (c) => c.toLocaleUpperCase("nb")).replace(/[.!]*$/, ".");
      return { text: "Jeg lagrer det som et minne for prosjektet.", call: { name: "remember", input: { text: note, scope: "project" } } };
    }
    return { text: done[0].isError ? `Minnet ble ikke lagret: ${done[0].result}` : "Lagret. Jeg får det med meg i nye tråder i dette prosjektet." };
  }
  if (!hasTools || chat) return { thinking: "Dette besvares med tekst og kodeblokker.", text: CHAT_REPLY };
  if (!tools.includes("write_file")) return plan(done);
  if (lower.startsWith("[melding fra tråden")) return helper(done);
  if (lower.includes("løkke") || lower.includes("loop")) {
    if (done.length < 5 && !done.some((d) => d.isError)) return { text: "Jeg prøver igjen.", call: { name: "list_dir", input: { path: "." } } };
    return { text: "Her stopper jeg. Gjentatte kall ble fanget av bremsen." };
  }
  if (done.some((d) => d.isError && d.result.includes("avslo"))) return { text: "Du avslo det, så jeg stopper her." };
  if (/\bteam\b/.test(lower)) return team(done);
  if (lower.includes("samarbeid")) return collaborate(done);
  if (/alle (steg|stegtyper|verktøy)/.test(lower)) return allSteps(done, tools);
  if (lower.includes("godkjenning")) {
    if (!done.length) return { text: "Filer som `.env*` krever alltid godkjenning, også i Full tilgang.", call: { name: "write_file", input: { path: ".env.demo", content: "DEMO=1\n" } } };
    return { text: done[0].isError ? `Skrivingen ble ikke gjort: ${done[0].result}` : "Godkjent, og `.env.demo` er skrevet." };
  }
  if (lower.includes("lang kommando")) {
    if (!done.length) return { text: "Denne kommandoen teller i et minutt. Trykk Stopp for å avbryte.", call: { name: "run_command", input: { command: 'for i in $(seq 1 60); do echo "Steg $i"; sleep 1; done' } } };
    return { text: "Kommandoen er ferdig." };
  }
  if (/\bfeil\b/.test(lower)) {
    if (!done.length) return { text: "Jeg prøver å lese en fil som ikke finnes.", call: { name: "read_file", input: { path: "finnes-ikke.txt" } } };
    return { text: `Verktøyet feilet som ventet: ${done[0].result}` };
  }
  if (lower.includes("rediger")) {
    if (!done.length) return { text: "Jeg endrer overskriften.", call: { name: "edit_file", input: { path: "index.html", old_string: "Hei fra demo-modellen", new_string: "Hei igjen fra demo-modellen" } } };
    return { text: done[0].isError ? `Endringen feilet: ${done[0].result}` : "Overskriften er endret." };
  }
  if (/\b(lag|bygg|skriv|create|make|build)\b/.test(lower)) return buildPage(done);
  return { text: `Jeg er demo-modellen. Skriv **lag en side** for å se hele flyten, eller **hjelp** for alt jeg kan.` };
}

function longMarkdown(chars: number): string {
  const section = (n: number) =>
    `## Del ${n}\n\nDette er avsnitt ${n} i en lang strøm for ytelsestest, med **fet** tekst, \`kode\` og en [lenke](https://example.com).\n\n` +
    `\`\`\`ts\nfunction del${n}(verdi: number): number {\n  return verdi * ${n};\n}\n\`\`\`\n\n`;
  let out = "";
  for (let n = 1; out.length < chars; n++) out += section(n);
  return out.slice(0, chars);
}

function estimateTokens(request: ProviderRequest): number {
  // An attached image counts as a short note, like a real model's image tokens would be small.
  const chars = request.system.length + request.messages.reduce((sum, m) => sum + JSON.stringify(m.content.map((b) => (b.type === "image" ? { type: "image", name: b.name } : b))).length, 0);
  return Math.ceil(chars / 4);
}

export function createMockProvider(options: { delayMs: number }): Provider {
  const { delayMs } = options;

  async function* streamText(type: "text" | "thinking", text: string, signal: AbortSignal, size = 8): AsyncGenerator<StreamPart> {
    for (let i = 0; i < text.length; i += size) {
      if (delayMs > 0) await sleep(delayMs, signal);
      else signal.throwIfAborted();
      yield { type, text: text.slice(i, i + size) };
    }
  }

  async function* stream(request: ProviderRequest): AsyncGenerator<StreamPart> {
    const { signal, messages } = request;
    const inputTokens = estimateTokens(request);

    if (request.purpose === "completion") {
      let draft = "";
      try { draft = JSON.parse(textOf(messages.at(-1)?.content ?? [])).draft ?? ""; } catch { /* no suggestion */ }
      const completion = /kan du\s*$/i.test(draft) ? " forklare dette steg for steg?" : draft ? " og forklar kort hvorfor." : "";
      yield { type: "text", text: completion };
      yield { type: "usage", inputTokens, outputTokens: Math.ceil(completion.length / 4), cachedInputTokens: 0 };
      yield { type: "stop", reason: "end" };
      return;
    }

    if (request.purpose === "summary") {
      const summary = `Sammendrag fra demo-modellen: ${textOf(messages.at(-1)?.content ?? []).slice(0, 200).replace(/\s+/g, " ")}`;
      yield { type: "text", text: summary };
      yield { type: "usage", inputTokens, outputTokens: Math.ceil(summary.length / 4), cachedInputTokens: 0 };
      yield { type: "stop", reason: "end" };
      return;
    }

    const { text, done } = readConversation(messages);
    const long = /lang strøm(?:\s+(\d+))?(\s+rolig)?/i.exec(text);
    if (long && !done.length) {
      const body = longMarkdown(Math.min(Number(long[1] ?? 200_000), 5_000_000));
      // "rolig" is the speed of a fast real model, about 2,5 kB/s. Without it, as fast as possible.
      for (let i = 0; i < body.length; i += 64) {
        if (long[2]) await sleep(25, signal);
        else if (i % 512 === 0) {
          if (delayMs > 0) await sleep(1, signal);
          else await sleep(0, signal);
        }
        yield { type: "text", text: body.slice(i, i + 64) };
      }
      yield { type: "usage", inputTokens, outputTokens: Math.ceil(body.length / 4), cachedInputTokens: 0 };
      yield { type: "stop", reason: "end" };
      return;
    }

    const step = decide(text, done, request.tools.map((t) => t.name), request.system);
    // Round 10 (SPEC 23.10): like a real model, the demo does not reason when thinking is off
    // (Ingen in the effort picker), so the conversation shows no «Tenker».
    const reasons = request.model.effort !== "none" && request.model.thinking !== false;
    if (step.thinking && reasons && step.slowThinking) {
      for (const line of step.thinking.split("\n")) {
        yield* streamText("thinking", `${line}\n`, signal);
        await sleep(900, signal);
      }
    } else if (step.thinking && reasons) yield* streamText("thinking", step.thinking, signal);
    if (step.text) yield* streamText("text", step.text, signal);
    if (step.call) {
      if (delayMs > 0) await sleep(delayMs, signal);
      yield { type: "tool_call", id: `mock_${messages.length}`, name: step.call.name, input: step.call.input };
    }
    const output = (reasons ? (step.thinking?.length ?? 0) : 0) + (step.text?.length ?? 0) + (step.call ? JSON.stringify(step.call.input).length : 0);
    yield { type: "usage", inputTokens, outputTokens: Math.ceil(output / 4), cachedInputTokens: 0 };
    yield { type: "stop", reason: step.call ? "tool_use" : "end" };
  }

  return {
    stream,
    async test() {
      return { ok: true, message: "Demo-modellen er alltid tilgjengelig" };
    },
  };
}
