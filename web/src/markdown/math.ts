// Math in answers: $…$, \(…\), $$…$$ and \[…\]. The app has no TeX engine (no KaTeX in the
// project, and nothing new may be installed), so this turns the common part of LaTeX into MathML,
// which Chrome draws natively. Every node is made here with createElementNS and textContent, so a
// formula can never become markup. What this does not know is shown as the formula's own text,
// with a visible label that says so, never silently.

const MATHML = "http://www.w3.org/1998/Math/MathML";

class Unsupported extends Error {}

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι",
  kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ",
  upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const SYMBOLS: Record<string, string> = {
  infty: "∞", partial: "∂", nabla: "∇", emptyset: "∅", varnothing: "∅", ell: "ℓ", hbar: "ℏ", aleph: "ℵ", Re: "ℜ", Im: "ℑ", prime: "′",
  forall: "∀", exists: "∃", nexists: "∄", angle: "∠", triangle: "△", degree: "°", top: "⊤", bot: "⊥",
};

const OPERATORS: Record<string, string> = {
  cdot: "⋅", times: "×", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆", circ: "∘", bullet: "∙",
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", equiv: "≡", sim: "∼", simeq: "≃", cong: "≅", propto: "∝",
  ll: "≪", gg: "≫", to: "→", rightarrow: "→", leftarrow: "←", gets: "←", leftrightarrow: "↔", Rightarrow: "⇒", Leftarrow: "⇐",
  Leftrightarrow: "⇔", implies: "⟹", iff: "⟺", mapsto: "↦", uparrow: "↑", downarrow: "↓",
  in: "∈", notin: "∉", ni: "∋", subset: "⊂", supset: "⊃", subseteq: "⊆", supseteq: "⊇", cup: "∪", cap: "∩", setminus: "∖",
  land: "∧", wedge: "∧", lor: "∨", vee: "∨", neg: "¬", lnot: "¬", oplus: "⊕", otimes: "⊗", perp: "⊥", parallel: "∥", mid: "|",
  ldots: "…", dots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱", colon: ":",
  langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉", lvert: "|", rvert: "|", vert: "|", Vert: "‖", "|": "‖",
  "{": "{", "}": "}", "%": "%", "#": "#", "&": "&", "$": "$", _: "_",
};

// Operators that take their limits above and below in a displayed formula.
const BIG: Record<string, string> = { sum: "∑", prod: "∏", coprod: "∐", bigcup: "⋃", bigcap: "⋂", int: "∫", iint: "∬", iiint: "∭", oint: "∮" };
const LIMIT_NAMES = new Set(["lim", "max", "min", "sup", "inf", "limsup", "liminf", "det", "gcd"]);
const FUNCTIONS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "log", "ln", "lg", "exp", "arg", "deg", "dim", "ker", "hom", "Pr", ...LIMIT_NAMES]);
const ACCENTS: Record<string, string> = { hat: "^", widehat: "^", bar: "¯", overline: "¯", vec: "→", dot: "˙", ddot: "¨", tilde: "~", widetilde: "~", check: "ˇ", acute: "´", grave: "`", breve: "˘" };
const SPACES: Record<string, string> = { ",": "0.1667em", ":": "0.2222em", ">": "0.2222em", ";": "0.2778em", " ": "0.25em", quad: "1em", qquad: "2em", "!": "0em", enspace: "0.5em" };
const FONTS: Record<string, string> = { mathbf: "bold", boldsymbol: "bold-italic", mathit: "italic", mathrm: "normal", mathsf: "sans-serif", mathtt: "monospace", mathcal: "script", mathscr: "script", mathbb: "double-struck", mathfrak: "fraktur" };
const ENVIRONMENTS: Record<string, [string, string]> = { matrix: ["", ""], pmatrix: ["(", ")"], bmatrix: ["[", "]"], Bmatrix: ["{", "}"], vmatrix: ["|", "|"], Vmatrix: ["‖", "‖"], cases: ["{", ""], aligned: ["", ""], align: ["", ""], "align*": ["", ""], gathered: ["", ""], array: ["", ""] };

type Tok = { kind: "cmd" | "char" | "num" | "space"; value: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      const word = /^\\([A-Za-z]+\*?|.)/.exec(src.slice(i));
      if (!word) throw new Unsupported("\\");
      out.push({ kind: "cmd", value: word[1] });
      i += word[0].length;
    } else if (/\s/.test(c)) {
      while (i < src.length && /\s/.test(src[i])) i++;
      out.push({ kind: "space", value: " " });
    } else if (/[0-9]/.test(c)) {
      const num = /^[0-9]+(?:[.,][0-9]+)?/.exec(src.slice(i))![0];
      out.push({ kind: "num", value: num });
      i += num.length;
    } else {
      out.push({ kind: "char", value: c });
      i += 1;
    }
  }
  return out;
}

function node(tag: string, children: Array<Element | string> = [], attrs: Record<string, string> = {}): Element {
  const element = document.createElementNS(MATHML, tag);
  for (const [k, v] of Object.entries(attrs)) element.setAttribute(k, v);
  for (const child of children) element.append(typeof child === "string" ? document.createTextNode(child) : child);
  return element;
}

const row = (items: Element[]): Element => (items.length === 1 ? items[0] : node("mrow", items));

// Mathematical alphanumeric symbols: where each style starts, and the letters that were in Unicode
// before the block and live elsewhere.
const STYLE_START: Record<string, [number, number]> = {
  bold: [0x1d400, 0x1d41a], "bold-italic": [0x1d468, 0x1d482], script: [0x1d49c, 0x1d4b6], fraktur: [0x1d504, 0x1d51e],
  "double-struck": [0x1d538, 0x1d552], "sans-serif": [0x1d5a0, 0x1d5ba], monospace: [0x1d670, 0x1d68a],
};
const STYLE_HOLES: Record<string, Record<string, string>> = {
  script: { B: "ℬ", E: "ℰ", F: "ℱ", H: "ℋ", I: "ℐ", L: "ℒ", M: "ℳ", R: "ℛ", e: "ℯ", g: "ℊ", o: "ℴ" },
  fraktur: { C: "ℭ", H: "ℌ", I: "ℑ", R: "ℜ", Z: "ℨ" },
  "double-struck": { C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ" },
};

function styleLetters(text: string, style: string): string {
  const start = STYLE_START[style];
  if (!start) return text;
  return [...text].map((c) => {
    const hole = STYLE_HOLES[style]?.[c];
    if (hole) return hole;
    if (c >= "A" && c <= "Z") return String.fromCodePoint(start[0] + c.charCodeAt(0) - 65);
    if (c >= "a" && c <= "z") return String.fromCodePoint(start[1] + c.charCodeAt(0) - 97);
    return c;
  }).join("");
}

class Parser {
  private at = 0;
  constructor(private toks: Tok[], private display: boolean) {}

  private peek(): Tok | undefined {
    return this.toks[this.at];
  }

  private skipSpace(): void {
    while (this.peek()?.kind === "space") this.at++;
  }

  parseAll(): Element {
    const items = this.parseList(() => false);
    if (this.at < this.toks.length) throw new Unsupported("rest");
    return row(items);
  }

  // Atoms until stop says so, with ^ and _ joined to the atom before them.
  private parseList(stop: (t: Tok) => boolean): Element[] {
    const items: Element[] = [];
    while (this.at < this.toks.length) {
      const t = this.peek()!;
      if (t.kind === "space") {
        this.at++;
        continue;
      }
      if (stop(t)) break;
      if (t.kind === "char" && (t.value === "^" || t.value === "_")) {
        const base = items.pop() ?? node("mrow");
        items.push(this.scripts(base));
        continue;
      }
      items.push(this.atom());
    }
    return items;
  }

  private scripts(base: Element): Element {
    let sub: Element | null = null;
    let sup: Element | null = null;
    for (let round = 0; round < 2; round++) {
      this.skipSpace();
      const t = this.peek();
      if (t?.kind !== "char" || (t.value !== "^" && t.value !== "_")) break;
      this.at++;
      const arg = this.argument();
      if (t.value === "^") sup = arg;
      else sub = arg;
    }
    const limits = this.display && base.getAttribute("data-limits") === "1";
    if (sub && sup) return node(limits ? "munderover" : "msubsup", [base, sub, sup]);
    if (sub) return node(limits ? "munder" : "msub", [base, sub]);
    return node(limits ? "mover" : "msup", [base, sup!]);
  }

  // One argument: a {group} or a single atom. Digits count one at a time, as in TeX.
  private argument(): Element {
    this.skipSpace();
    const t = this.peek();
    if (!t) throw new Unsupported("argument");
    if (t.kind === "char" && t.value === "{") return this.group();
    if (t.kind === "num") {
      this.at++;
      if (t.value.length > 1) this.toks.splice(this.at, 0, { kind: "num", value: t.value.slice(1) });
      return node("mn", [t.value[0]]);
    }
    return this.atom();
  }

  private group(): Element {
    this.at++; // {
    const items = this.parseList((t) => t.kind === "char" && t.value === "}");
    if (this.peek()?.value !== "}") throw new Unsupported("}");
    this.at++;
    return row(items.length ? items : [node("mrow")]);
  }

  private text(): string {
    this.skipSpace();
    if (this.peek()?.value !== "{") throw new Unsupported("text");
    this.at++;
    let depth = 1;
    let out = "";
    while (this.at < this.toks.length) {
      const t = this.toks[this.at++];
      if (t.kind === "char" && t.value === "{") depth++;
      if (t.kind === "char" && t.value === "}" && --depth === 0) return out;
      out += t.kind === "cmd" ? (OPERATORS[t.value] ?? t.value) : t.value;
    }
    throw new Unsupported("text }");
  }

  private delimiter(): string {
    this.skipSpace();
    const t = this.toks[this.at++];
    if (!t) throw new Unsupported("delimiter");
    if (t.kind === "char") return t.value === "." ? "" : t.value;
    if (t.kind === "cmd" && OPERATORS[t.value] !== undefined) return OPERATORS[t.value];
    throw new Unsupported(t.value);
  }

  private atom(): Element {
    const t = this.toks[this.at++];
    if (t.kind === "num") return node("mn", [t.value]);
    if (t.kind === "char") {
      if (t.value === "{") {
        this.at--;
        return this.group();
      }
      if (/[A-Za-z]/.test(t.value)) return node("mi", [t.value]);
      if (t.value === "'") return node("mo", ["′"]);
      if (t.value === "}" || t.value === "&") throw new Unsupported(t.value);
      if (t.value === "~") return node("mspace", [], { width: "0.25em" });
      // Bars around a value sit tight against it, as |x| is written.
      if (t.value === "|") return node("mo", ["|"], { lspace: "0", rspace: "0" });
      return node("mo", [t.value === "-" ? "−" : t.value === "*" ? "∗" : t.value]);
    }
    return this.command(t.value);
  }

  private command(name: string): Element {
    if (GREEK[name]) return node("mi", [GREEK[name]], /^[A-Z]/.test(name) ? { mathvariant: "normal" } : {});
    if (SYMBOLS[name]) return node("mi", [SYMBOLS[name]], { mathvariant: "normal" });
    if (OPERATORS[name] !== undefined) return node("mo", [OPERATORS[name]]);
    if (SPACES[name]) return node("mspace", [], { width: SPACES[name] });
    if (BIG[name]) return node("mo", [BIG[name]], { "data-limits": name.endsWith("int") ? "0" : "1", largeop: "true" });
    if (FUNCTIONS.has(name)) return node("mi", [name], { mathvariant: "normal", "data-limits": LIMIT_NAMES.has(name) ? "1" : "0" });
    if (name === "operatorname") return node("mi", [this.text()], { mathvariant: "normal" });
    if (FONTS[name]) {
      // Chrome only knows mathvariant="normal", so the letters become the Unicode math letters.
      const arg = this.argument();
      for (const mi of [arg, ...arg.querySelectorAll("mi")]) {
        if (mi.localName !== "mi") continue;
        const styled = styleLetters(mi.textContent ?? "", FONTS[name]);
        mi.textContent = styled;
        if (FONTS[name] !== "italic") mi.setAttribute("mathvariant", "normal");
      }
      return arg;
    }
    if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac") return node("mfrac", [this.argument(), this.argument()]);
    if (name === "binom") return node("mrow", [node("mo", ["("]), node("mfrac", [this.argument(), this.argument()], { linethickness: "0" }), node("mo", [")"])]);
    if (name === "sqrt") {
      this.skipSpace();
      if (this.peek()?.value === "[") {
        this.at++;
        const index = this.parseList((t) => t.kind === "char" && t.value === "]");
        if (this.peek()?.value !== "]") throw new Unsupported("]");
        this.at++;
        const base = this.argument();
        return node("mroot", [base, row(index)]);
      }
      return node("msqrt", [this.argument()]);
    }
    if (ACCENTS[name]) return node("mover", [this.argument(), node("mo", [ACCENTS[name]], { stretchy: "true" })], { accent: "true" });
    if (name === "underline") return node("munder", [this.argument(), node("mo", ["_"], { stretchy: "true" })]);
    if (name === "text" || name === "textrm" || name === "textit" || name === "textbf" || name === "mbox") {
      return node("mtext", [this.text()], name === "textbf" ? { mathvariant: "bold" } : name === "textit" ? { mathvariant: "italic" } : {});
    }
    if (name === "left" || name === "right" || name === "bigl" || name === "bigr" || name === "big" || name === "Big" || name === "Bigl" || name === "Bigr") {
      const d = this.delimiter();
      return d ? node("mo", [d], { stretchy: name === "left" || name === "right" ? "true" : "false" }) : node("mrow");
    }
    if (name === "displaystyle" || name === "textstyle" || name === "limits" || name === "nolimits") return node("mrow");
    if (name === "begin") return this.environment(this.text());
    throw new Unsupported(name);
  }

  // matrix, pmatrix, bmatrix, cases, aligned and friends: rows split by \\ and cells by &.
  private environment(name: string): Element {
    const fence = ENVIRONMENTS[name];
    if (!fence) throw new Unsupported(name);
    if (name === "array") this.text(); // the column spec
    const rows: Element[][] = [[]];
    let cell: Element[] = [];
    while (true) {
      const items = this.parseList((t) => (t.kind === "cmd" && (t.value === "\\" || t.value === "end")) || (t.kind === "char" && t.value === "&"));
      cell.push(...items);
      const t = this.toks[this.at++];
      if (!t) throw new Unsupported("end");
      if (t.kind === "char") {
        rows.at(-1)!.push(node("mtd", [row(cell)]));
        cell = [];
      } else if (t.value === "\\") {
        rows.at(-1)!.push(node("mtd", [row(cell)]));
        cell = [];
        rows.push([]);
      } else {
        if (this.text() !== name) throw new Unsupported("end");
        rows.at(-1)!.push(node("mtd", [row(cell)]));
        break;
      }
    }
    const table = node("mtable", rows.filter((r) => r.length && r.some((c) => c.textContent)).map((r) => node("mtr", r)), name.startsWith("align") || name === "aligned" || name === "cases" ? { columnalign: "left" } : {});
    const [open, close] = fence;
    return open || close ? node("mrow", [node("mo", [open], { stretchy: "true" }), table, node("mo", [close], { stretchy: "true" })]) : table;
  }
}

// The formula as MathML, or null when it uses something this does not know.
export function latexToMathML(source: string, display: boolean): Element | null {
  try {
    const body = new Parser(tokenize(source), display).parseAll();
    for (const el of body.querySelectorAll("[data-limits]")) el.removeAttribute("data-limits");
    if (body.hasAttribute("data-limits")) body.removeAttribute("data-limits");
    const math = node("math", [node("semantics", [body, node("annotation", [source], { encoding: "application/x-tex" })])], display ? { display: "block" } : {});
    return math;
  } catch (err) {
    if (err instanceof Unsupported) return null;
    throw err;
  }
}

// A formula in a message: drawn when it can be, else its own text with a label that says why.
export function renderMath(source: string, display: boolean): HTMLElement {
  const wrap = document.createElement(display ? "div" : "span");
  wrap.className = display ? "md-math md-math-block" : "md-math";
  wrap.dataset.tex = source;
  const math = latexToMathML(source, display);
  if (math) {
    wrap.title = source;
    wrap.append(math);
    return wrap;
  }
  wrap.classList.add("md-math-raw");
  const label = document.createElement("span");
  label.className = "md-math-label";
  label.textContent = "Formel som tekst";
  label.title = "Appen tegner bare vanlig matte. Denne formelen bruker noe den ikke kan tegne ennå, så den vises slik modellen skrev den.";
  const code = document.createElement("code");
  code.textContent = source;
  wrap.append(label, code);
  return wrap;
}
