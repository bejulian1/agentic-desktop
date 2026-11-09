// The app's own pages (error, busy, starting). Text from the address goes in with textContent only.
const api = window.agenticDesktop;
const params = new URLSearchParams(location.search);

for (const node of document.querySelectorAll("[data-param]")) {
  const value = params.get(node.dataset.param);
  if (value) node.textContent = value;
  else if (node.dataset.optional !== undefined) node.closest("[data-optional-block]")?.remove();
}
// data-when="name=value …": kept only when every condition holds.
for (const node of document.querySelectorAll("[data-when]")) {
  const holds = node.dataset.when.split(" ").every((condition) => {
    const [name, value] = condition.split("=");
    return params.get(name) === value;
  });
  if (!holds) node.remove();
}
// The busy page: Prøv igjen is the main button when the app cannot stop the other server itself.
const fallback = document.querySelector("[data-fallback-primary]");
if (fallback && !document.querySelector("[autofocus]")) {
  fallback.classList.add("primary");
  fallback.setAttribute("autofocus", "");
}
const status = document.querySelector("[data-status]");
const log = document.querySelector("[data-log]");
if (log) {
  const text = [params.get("code") ? `Avslutningskode: ${params.get("code")}` : "", params.get("message") ?? "", params.get("log") ?? ""].filter(Boolean).join("\n\n");
  if (text) log.textContent = text;
  else log.closest("details")?.remove();
}

for (const button of document.querySelectorAll("[data-action]")) {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "restart") {
      for (const other of document.querySelectorAll("[data-action]")) other.disabled = true;
      button.textContent = button.dataset.busy || "Starter …";
      api?.restartServer();
    } else if (action === "stop-other") {
      const label = button.textContent;
      const buttons = [...document.querySelectorAll(".actions [data-action]")];
      for (const other of buttons) other.disabled = true;
      button.textContent = button.dataset.busy;
      if (status) status.hidden = true;
      // On success the app loads its own UI in this window; only a refusal comes back here.
      api?.stopOtherServer().then((result) => {
        if (result?.ok) return;
        for (const other of buttons) other.disabled = false;
        button.textContent = label;
        if (status) {
          status.textContent = result?.message || "Nettleserversjonen kunne ikke avsluttes.";
          status.hidden = false;
        }
      });
    } else if (action === "quit") api?.quit();
    else if (action === "minimize") api?.window.minimize();
    else if (action === "maximize") api?.window.toggleMaximize();
    else if (action === "close") api?.window.close();
  });
}

// Maksimer and Gjenopprett, as in the app.
const maximize = document.querySelector('[data-action="maximize"]');
const showState = (state) => {
  if (!maximize || !state) return;
  const label = state.maximized ? "Gjenopprett" : "Maksimer";
  maximize.title = label;
  maximize.setAttribute("aria-label", label);
  maximize.querySelector(".max").hidden = state.maximized;
  maximize.querySelector(".restore").hidden = !state.maximized;
};
api?.window.state().then(showState);
api?.window.onState(showState);
document.querySelector("[autofocus]")?.focus();
