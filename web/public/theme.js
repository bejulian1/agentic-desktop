// Runs blocking in <head>, before anything paints, so a stored dark theme never flashes light.
// CSP forbids inline scripts, which is why this is its own file.
(function () {
  var saved = null;
  try {
    saved = localStorage.getItem("ad-theme");
  } catch (err) {
    saved = null;
  }
  var dark = saved === "dark" || (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  // Accent, text size, density and the rest from Innstillinger, as state/look.ts stored them.
  // Only data-* attributes and --* variables, so a damaged copy cannot do anything else.
  try {
    var look = JSON.parse(localStorage.getItem("ad-look") || "{}");
    var name;
    for (name in look.attrs || {}) if (/^data-[a-z-]+$/.test(name)) document.documentElement.setAttribute(name, String(look.attrs[name]));
    for (name in look.vars || {}) if (/^--[a-z-]+$/.test(name)) document.documentElement.style.setProperty(name, String(look.vars[name]));
  } catch (err) {
    // Applied after start instead.
  }
  // Round 14 (SPEC 30.2): the app icon chosen in Innstillinger, on the tab from the start
  // (lib/app-icon.ts stores it). Only a known kind of name, so a damaged copy is ignored.
  try {
    var icon = localStorage.getItem("ad-app-icon");
    var link = document.querySelector('link[rel="icon"]');
    if (icon && /^[a-z-]{1,20}$/.test(icon) && link) link.setAttribute("href", "/app-icons/" + icon + "-tab.svg");
  } catch (err) {
    // The default icon, then the chosen one once the app has started.
  }
})();
