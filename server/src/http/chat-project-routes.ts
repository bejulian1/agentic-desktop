// Chat projects have no folder and never use the Kode configuration or memory store.
import type { IncomingMessage, ServerResponse } from "node:http";
import { CHAT_PROJECT_ICONS, MAX_CHAT_FIELD, MAX_CHAT_WORDS, PROJECT_COLORS, countChatWords, type ChatProject, type ChatProjectMemoryList } from "../../../shared/protocol.ts";
import { HttpError } from "../errors.ts";
import { looksSecret } from "../memory.ts";
import { cleanName } from "../names.ts";
import type { ApiDeps } from "./api.ts";

interface Ctx { req: IncomingMessage; res: ServerResponse; params: Record<string, string>; query: URLSearchParams; body: any }
type Route = (method: string, spec: string, handler: (ctx: Ctx) => unknown) => void;
type ProjectPatch = Partial<Pick<ChatProject, "name" | "pinned" | "color" | "icon" | "instructions" | "memoryMode" | "autoMemory">>;

function projectPatch(body: any): ProjectPatch {
  const patch: ProjectPatch = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !cleanName(body.name)) throw new HttpError(400, "Navnet er tomt");
    patch.name = cleanName(body.name);
  }
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== "boolean") throw new HttpError(400, "pinned må være sann eller usann");
    patch.pinned = body.pinned;
  }
  if (body.color !== undefined) {
    if (body.color !== null && !PROJECT_COLORS.some((c) => c.id === body.color)) throw new HttpError(400, "Ukjent farge");
    patch.color = body.color;
  }
  if (body.icon !== undefined) {
    if (body.icon !== null && (typeof body.icon !== "string" || !CHAT_PROJECT_ICONS.includes(body.icon))) throw new HttpError(400, "Velg et av de 15 Chat-prosjektikonene");
    patch.icon = body.icon;
  }
  if (body.instructions !== undefined) {
    if (typeof body.instructions !== "string") throw new HttpError(400, "Prosjektinstruksjonene må være tekst");
    const text = body.instructions.replace(/\r\n/g, "\n").trim();
    if (text.length > MAX_CHAT_FIELD || countChatWords(text) > MAX_CHAT_WORDS) throw new HttpError(400, `Prosjektinstruksjonene er for lange: maks ${MAX_CHAT_WORDS} ord og ${MAX_CHAT_FIELD} tegn.`);
    if (looksSecret(text)) throw new HttpError(400, "Prosjektinstruksjonene ser ut til å inneholde en nøkkel, et token eller et passord, og blir ikke lagret.");
    patch.instructions = text;
  }
  if (body.memoryMode !== undefined) {
    if (body.memoryMode !== "project" && body.memoryMode !== "shared") throw new HttpError(400, "Minnemodusen må være project eller shared");
    patch.memoryMode = body.memoryMode;
  }
  if (body.autoMemory !== undefined) {
    if (typeof body.autoMemory !== "boolean") throw new HttpError(400, "autoMemory må være sann eller usann");
    patch.autoMemory = body.autoMemory;
  }
  return patch;
}

export function chatProjectRoutes(route: Route, deps: ApiDeps): void {
  const { store, runner, publish, threadChanged } = deps;
  const projectFor = (id: string, expectedMode?: unknown): ChatProject => {
    const project = store.chatProject(id);
    if (!project) throw new HttpError(404, "Fant ikke Chat-prosjektet");
    if (expectedMode !== undefined && expectedMode !== project.memoryMode) throw new HttpError(409, "Minnemodusen er endret. Last minnene på nytt.");
    return project;
  };
  const changed = (id: string) => {
    const project = projectFor(id);
    publish({ type: "chat-project.changed", project });
    return project;
  };

  route("GET", "/api/chat-projects", () => store.chatProjects());
  route("GET", "/api/chat-projects/:id", ({ params }) => projectFor(params.id));
  route("POST", "/api/chat-projects", ({ body }) => {
    const patch = projectPatch(body);
    if (!patch.name) throw new HttpError(400, "Navnet er tomt");
    const project = store.createChatProject(patch.name);
    store.updateChatProject(project.id, patch);
    return changed(project.id);
  });
  route("PATCH", "/api/chat-projects/:id", ({ params, body }) => {
    const current = projectFor(params.id);
    if (body.expected !== undefined) {
      const expected = body.expected;
      if (!expected || typeof expected !== "object" || Array.isArray(expected)) throw new HttpError(400, "Ugyldig prosjektversjon");
      const fields = ["name", "icon", "color", "instructions", "memoryMode", "autoMemory"] as const;
      if (fields.some((field) => expected[field] !== current[field])) throw new HttpError(409, "Prosjektet er endret i et annet vindu. Lukk og åpne innstillingene på nytt for å hente siste versjon. Utkastet ditt er beholdt.");
    }
    // Saved legacy icons remain valid on a rename; every newly selected icon is from the 15.
    const patch = projectPatch(body.icon === current.icon ? { ...body, icon: undefined } : body);
    if ((patch.instructions !== undefined && patch.instructions !== current.instructions) ||
        (patch.memoryMode !== undefined && patch.memoryMode !== current.memoryMode) ||
        (patch.autoMemory !== undefined && patch.autoMemory !== current.autoMemory)) runner.assertChatProjectIdle(params.id);
    store.updateChatProject(params.id, patch);
    return changed(params.id);
  });
  route("DELETE", "/api/chat-projects/:id", ({ params }) => {
    projectFor(params.id);
    runner.assertChatProjectIdle(params.id);
    const moved = store.deleteChatProject(params.id); // FK cascade deletes only this project's private notes
    publish({ type: "chat-project.deleted", projectId: params.id });
    for (const id of moved) threadChanged(id);
  });

  route("GET", "/api/chat-projects/:id/memories", ({ params }): ChatProjectMemoryList => {
    const project = projectFor(params.id);
    return { memoryMode: project.memoryMode, items: runner.chatProjectMemoryItems(project) };
  });
  route("POST", "/api/chat-projects/:id/memories", ({ params, body }) => runner.saveChatProjectMemory(projectFor(params.id, body.memoryMode), body.text));
  route("PUT", "/api/chat-projects/:id/memories/:memoryId", ({ params, body }) => runner.saveChatProjectMemory(projectFor(params.id, body.memoryMode), body.text, params.memoryId));
  route("DELETE", "/api/chat-projects/:id/memories/:memoryId", ({ params, query }) => {
    const project = projectFor(params.id, query.get("memoryMode") ?? undefined);
    if (project.memoryMode === "shared") runner.chatMemories.remove("global", undefined, params.memoryId);
    else {
      if (!store.chatProjectMemories(project.id).some((item) => item.id === params.memoryId)) throw new HttpError(404, "Fant ikke minnet");
      store.removeChatProjectMemory(project.id, params.memoryId);
    }
  });
  route("POST", "/api/chat-projects/:id/memories/clear", ({ params, body }) => {
    const project = projectFor(params.id, body.memoryMode);
    return { removed: project.memoryMode === "shared" ? runner.chatMemories.clear("global") : store.clearChatProjectMemories(project.id) };
  });
}
