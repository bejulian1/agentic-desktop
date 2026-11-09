// Runs in a Web Worker: parses code with the same Lezer grammars CodeMirror uses and hands back
// ranges. Nothing here touches the DOM.
import type { Parser } from "@lezer/common";
import { parser as cssParser } from "@lezer/css";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { parser as htmlParser } from "@lezer/html";
import { parser as jsParser } from "@lezer/javascript";
import { parser as jsonParser } from "@lezer/json";
import { parser as pythonParser } from "@lezer/python";
import { parser as rustParser } from "@lezer/rust";

const ts = jsParser.configure({ dialect: "ts" });
const tsx = jsParser.configure({ dialect: "ts jsx" });
const jsx = jsParser.configure({ dialect: "jsx" });

const PARSERS: Record<string, Parser> = {
  js: jsParser, javascript: jsParser, mjs: jsParser, cjs: jsParser,
  jsx, ts, typescript: ts, tsx,
  py: pythonParser, python: pythonParser,
  html: htmlParser, xml: htmlParser, svg: htmlParser,
  css: cssParser,
  json: jsonParser, jsonc: jsonParser,
  rs: rustParser, rust: rustParser,
};

const SHELL = /(#.*$)|("(?:[^"\\]|\\.)*"|'[^']*')|(\$\{?\w+\}?)|(^|[\s;|&(])(if|then|else|fi|for|in|do|done|while|case|esac|function|export|return)(?=[\s;]|$)/gm;

function shell(text: string): Array<[number, number, string]> {
  const spans: Array<[number, number, string]> = [];
  for (const match of text.matchAll(SHELL)) {
    const at = match.index;
    if (match[1]) spans.push([at, at + match[0].length, "tok-comment"]);
    else if (match[2]) spans.push([at, at + match[0].length, "tok-string"]);
    else if (match[3]) spans.push([at, at + match[0].length, "tok-variableName"]);
    else if (match[5]) spans.push([at + match[4].length, at + match[0].length, "tok-keyword"]);
  }
  return spans;
}

self.onmessage = (event: MessageEvent<{ id: number; lang: string; text: string }>) => {
  const { id, lang, text } = event.data;
  let spans: Array<[number, number, string]> = [];
  if (lang === "sh" || lang === "bash" || lang === "shell" || lang === "zsh") {
    spans = shell(text);
  } else {
    const parser = PARSERS[lang];
    if (parser) highlightTree(parser.parse(text), classHighlighter, (from, to, classes) => spans.push([from, to, classes]));
  }
  self.postMessage({ id, spans });
};
