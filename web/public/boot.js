// The first two requests, started while the app's code is still loading (SPEC 29.5). This runs
// blocking in <head> like theme.js, before the stylesheet and the app's script are even fetched,
// so the token exchange and /api/bootstrap are done long before main.tsx needs them. main.tsx picks
// up the answer from window.__adEarly; without it, main.tsx makes the same requests itself.
// CSP forbids inline scripts, which is why this is its own file.
//
// The token is in the fragment so it never reaches a log. It leaves the address bar at once.
(function () {
  var match = /^#token=(.+)$/.exec(location.hash);
  var token = match ? decodeURIComponent(match[1]) : null;
  if (match) history.replaceState(null, "", location.pathname + location.search);
  async function start() {
    if (token) {
      var res = await fetch("/api/auth/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: token }), credentials: "same-origin" });
      if (!res.ok) return { url: "/api/auth/exchange", res: res };
    }
    return { url: "/api/bootstrap", res: await fetch("/api/bootstrap", { credentials: "same-origin" }) };
  }
  var early = start();
  early.catch(function () {}); // main.tsx reports it
  window.__adEarly = early;
})();
