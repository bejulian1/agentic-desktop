// Address-like input keeps the server's URL/project-path handling. Free text uses the same
// search page as the app's browser search, with DuckDuckGo as the default for manual browsing.
export function browserDestination(value: string, searchTemplate = "https://duckduckgo.com/?q={q}"): string {
  const text = value.trim();
  if (!text) return "";
  // Keep explicit schemes and project paths with spaces for server-side validation/resolution.
  if (/^[a-z][a-z\d+.-]*:/i.test(text) || /^(?:\.?\.?\/)/.test(text)) return text;
  const address = /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[\da-f:]+\])(?::\d+)?(?:[/?#]|$)/i.test(text)
    || /^[^\s/?#]+\.[^\s/?#]+(?:[/?#]|$)/.test(text);
  if (address && !/\s/.test(text)) return text;
  return searchTemplate.replaceAll("{q}", encodeURIComponent(text));
}
