/**
 * Turn a `file.ext:NNN` citation into the name of the unit that sits at that line.
 *
 * The migration away from line numbers is mechanical in principle and not in practice: 3,700-odd
 * citations across 37 documents each need a human judgement about which unit the sentence is
 * actually talking about, and the judgement is the same judgement every time — "which declaration
 * encloses this position". So the mechanical half is done here, once, by reading the target file's
 * real AST rather than its text, and the human half is left to whoever reviews the proposals.
 *
 * Reading the AST is what makes the proposals worth reviewing. A regex over source lines gets
 * confused by a `function` inside a comment, a `const` that is a destructuring pattern with no
 * name, and an object literal whose `key:` is a nested arrow function — all three of which appear
 * in this repository's sources. `typescript` is already a dependency of the project and is used
 * here for nothing more exotic than asking "what encloses this offset", so the resolver needs no
 * new dependency and cannot disagree with the compiler about where a declaration begins.
 *
 * The output is deliberately a PROPOSAL, not an edit. Every function here reports what it found
 * and how confident it is; nothing here writes to a document. A proposal that resolves to the
 * wrong unit has to be wrong in a way a reviewer can see, which is why `kind` is returned rather
 * than flattened into prose.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import ts from 'typescript';

const SCRIPT_KINDS = {
  '.ts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
  '.mts': ts.ScriptKind.TS,
  '.cts': ts.ScriptKind.TS,
  '.js': ts.ScriptKind.JS,
  '.jsx': ts.ScriptKind.JSX,
  '.mjs': ts.ScriptKind.JS,
  '.cjs': ts.ScriptKind.JS,
};

/**
 * A parsed source file, cached by path.
 *
 * The cache is what makes a whole-document sweep affordable: `HANDOFF.md` cites the same dozen
 * modules hundreds of times, and re-parsing a 3,000-line module for each of those citations turns
 * a one-second run into a one-minute one. Parsing is a pure function of the file's bytes, so the
 * cache cannot go stale within a single run, and `clearCache` exists for the test that proves the
 * resolver reads the file rather than a stale snapshot of it.
 */
const parseCache = new Map();

const clearCache = () => parseCache.clear();

const parseFile = (absolutePath) => {
  const cached = parseCache.get(absolutePath);
  if (cached) return cached;
  const text = readFileSync(absolutePath, 'utf8');
  const kind = SCRIPT_KINDS[absolutePath.slice(absolutePath.lastIndexOf('.'))] ?? ts.ScriptKind.TS;
  const parsed = ts.createSourceFile(absolutePath, text, ts.ScriptTarget.Latest, true, kind);
  parseCache.set(absolutePath, parsed);
  return parsed;
};

/** 1-based line and column to a 0-based offset. */
const offsetOf = (sourceFile, line, column = 1) => {
  const lineStarts = sourceFile.getLineStarts();
  const target = Math.min(Math.max(line, 1), lineStarts.length);
  return lineStarts[target - 1] + Math.max(column - 1, 0);
};

/** The 1-based line a node begins on. */
const startLineOf = (sourceFile, node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

/** The 1-based line a node ends on, counting an end that lands at the next line's start as this one. */
const endLineOf = (sourceFile, node) => {
  const end = node.getEnd();
  const last = sourceFile.text[end - 1];
  return sourceFile.getLineAndCharacterOfPosition(end - (last === '\n' ? 1 : 0)).line + 1;
};

/**
 * The nodes whose SPAN covers a line, innermost first.
 *
 * The unit is the LINE, not the offset, and the difference is the whole of the first draft's
 * behaviour. A citation `draw.ts:1` means "the thing on line 1", but an offset-based lookup resolves
 * `1:1` to column 1 — which on an `export const X` line is the `export` KEYWORD, a token that is a
 * sibling of the declaration and encloses nothing. The resolver reported "no declaration here", fell
 * back to a nearby one, and proposed the wrong symbol while looking like it had found something.
 * Line containment asks the question the document actually asked.
 *
 * The traversal is a full descent filtered by span rather than a walk down from the root, because a
 * downward walk cannot cross a keyword and then come back to the statement it belongs to.
 *
 * Sorting is by width then by start line, ascending and then reversed, so the list reads
 * innermost-first while keeping document order between two nodes that share an extent — the tie a
 * class and its first method have, where taking the outer one would answer `MyClass` to a citation
 * that plainly means `MyClass.render`.
 */
const enclosingChain = (sourceFile, line) => {
  const enclosing = [];
  const visit = (node) => {
    if (startLineOf(sourceFile, node) <= line && line <= endLineOf(sourceFile, node)) {
      enclosing.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return enclosing
    .sort(
      (a, b) =>
        a.getWidth(sourceFile) - b.getWidth(sourceFile) ||
        endLineOf(sourceFile, a) - endLineOf(sourceFile, b) ||
        b.getStart(sourceFile) - a.getStart(sourceFile)
    )
    .reverse();
};

/**
 * A test call: `it(...)`, `test(...)`, `describe(...)`, and every `.skip` / `.only` / `.todo` /
 * `.failing` variant of them.
 *
 * The member-access form is matched by its OWNER rather than excluded, because this repository
 * writes `it.skip(...)` and a check that only matched a bare identifier resolved those lines to
 * the enclosing `describe` — which makes every skipped case in a suite cite the same thing, and
 * makes the citation useless for finding the case.
 */
const TEST_CALLEES = new Set(['it', 'test', 'describe']);

const calleeName = (expression) => {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    return expression.expression.text;
  }
  return undefined;
};

const isTestCall = (node) => ts.isCallExpression(node) && TEST_CALLEES.has(calleeName(node.expression));

/**
 * The string a test call declares itself with.
 *
 * `it.each([...])('...')` names the case in the OUTER call's first argument, so the callee is
 * unwrapped through one `CallExpression` before the literal is read. Reaching through it is what
 * keeps the proposal a real title instead of falling back to the `describe`, which would collapse a
 * whole file's assertions into one citation.
 */
const testTitleOf = (node) => {
  let call = node;
  if (ts.isCallExpression(call) && ts.isCallExpression(call.expression)) call = call.expression;
  const first = call.arguments[0];
  if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) return first.text;
  return undefined;
};

/** `src/a/b.ts` -> `b`; `src/a/b.test.ts` -> `b`. Used only to qualify a member, never on its own. */
const moduleStem = (path) => {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.replace(/\.(test|spec)\.[cm]?[jt]sx?$/, '').replace(/\.[cm]?[jt]sx?$/, '');
};

const DECLARATION_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.ShorthandPropertyAssignment,
  ts.SyntaxKind.EnumMember,
]);

const nameText = (node, sourceFile) => {
  const name = node.name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  // A binding pattern with no name cannot be cited, so the declaration is skipped by the caller.
  return undefined;
};

/**
 * The nearest DECLARATION to a line that sits inside no named declaration at all.
 *
 * This is not a fallback for a resolver that failed. It is the measurement of a known defect: the
 * audit behind the ban found 30 of this repository's citations resolving to a blank line, a comment,
 * a closing brace or an import, which is what a number does the moment anything is inserted above
 * it. A citation that landed there still has an author and an intent, and the intent is the
 * declaration the drifted line used to sit inside.
 *
 * So the search is a widening one, and its result is labelled `nearest` rather than presented as
 * fact — because "the declaration within a few lines of where the citation points" and "the
 * declaration that line was written from" are different claims, and only a reader of the sentence
 * can tell them apart. A blank line under `export const LINE_END_X` is obvious; a comment inside a
 * reducer is not.
 *
 * Backwards is searched before forwards because a drifted citation lands BELOW the thing it names
 * far more often than above it: inserting a line above moves the target down, and the number stays
 * where it was.
 */
const NEAREST_WINDOW = 40;

const DECLARATION_LINE = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:static\s+)?(?:async\s+)?(?:get|set)?\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/,
];

const nearestDeclaration = (sourceFile, line) => {
  const lines = sourceFile.text.split('\n');
  const inRange = (n) => n >= 1 && n <= lines.length;
  for (let distance = 1; distance <= NEAREST_WINDOW; distance += 1) {
    for (const candidate of [line - distance, line + distance]) {
      if (!inRange(candidate)) continue;
      const text = lines[candidate - 1];
      for (const pattern of DECLARATION_LINE) {
        const match = pattern.exec(text);
        if (match) return { name: match[1], at: candidate, distance };
      }
      const test = /^\s*(?:it|test|describe)(?:\.\w+)?\s*\(\s*(['"`])(.*?)\1/.exec(text);
      if (test) return { name: test[2], at: candidate, distance, test: true };
    }
  }
  return undefined;
};

/**
 * The one name that best describes a position in a source file.
 *
 * Resolution is innermost-first and STOPS at the first node that yields a name, with two
 * exceptions that are ordered above the rest because they are what a reader is actually looking
 * for. A position inside a test case cites that case's title, because "which assertion" is a
 * question about the title and not about the enclosing `describe`. A position on a line that
 * dispatches on a string literal — a reducer `case`, a `switch` arm, an action-type comparison —
 * cites the literal, because that value is the program's own name for the branch and a name is
 * exactly what the citation format is asking for.
 *
 * A position that resolves to nothing is reported as `unresolved` with the raw line, so the caller
 * can send it to a human rather than inventing a name.
 */
export const resolveSymbolAtLine = (absolutePath, line) => {
  if (!existsSync(absolutePath)) return { kind: 'missing-file', file: absolutePath, line };
  let sourceFile;
  try {
    sourceFile = parseFile(absolutePath);
  } catch (error) {
    return { kind: 'unparsed', file: absolutePath, line, detail: String(error && error.message) };
  }
  const chain = enclosingChain(sourceFile, line);

  // 1. The nearest enclosing test case title.
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    if (isTestCall(chain[i])) {
      const title = testTitleOf(chain[i]);
      if (title) return { kind: 'test-title', name: title, file: absolutePath, line };
    }
  }

  // 2. A `switch` arm, cited by the value it dispatches on.
  //
  // The arm's own value is the anchor rather than the switch's subject, because a reducer with
  // twenty arms has one subject and twenty identities, and the sentence that cited a line inside
  // `case 'rename-layer'` is about the rename, not about the switch.
  for (const node of chain) {
    if (ts.isCaseClause(node) && node.expression) {
      return { kind: 'switch-arm', name: node.expression.getText(sourceFile), file: absolutePath, line };
    }
  }

  // 3. The innermost declaration that has a name we can cite.
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const node = chain[i];
    if (DECLARATION_KINDS.has(node.kind)) {
      const own = nameText(node, sourceFile);
      if (own) {
        // A class member is cited as `Class.member`, which is the only form that stays unambiguous
        // once two classes in one module declare a method with the same name.
        const parentClass = node.parent;
        if (parentClass && ts.isClassDeclaration(parentClass) && parentClass.name) {
          return { kind: 'member', name: `${parentClass.name.text}.${own}`, file: absolutePath, line };
        }
        return { kind: 'declaration', name: own, file: absolutePath, line };
      }
      // A bare arrow function assigned to nothing citable, or a destructuring declaration: keep
      // walking outwards, because the enclosing function is still a correct thing to name.
      continue;
    }
    if (
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node)
    ) {
      const viaParent =
        node.parent && ts.isVariableDeclaration(node.parent)
          ? nameText(node.parent, sourceFile)
          : node.name && ts.isIdentifier(node.name)
            ? node.name.text
            : undefined;
      if (viaParent) return { kind: 'declaration', name: viaParent, file: absolutePath, line };
    }
  }

  const nearest = nearestDeclaration(sourceFile, line);
  if (nearest) {
    return {
      kind: 'nearest',
      name: nearest.name,
      at: nearest.at,
      distance: nearest.distance,
      test: Boolean(nearest.test),
      file: absolutePath,
      line,
    };
  }
  return { kind: 'unresolved', file: absolutePath, line };
};

/**
 * The proposal text a document should carry in place of a citation, shaped by what the resolver
 * found.
 *
 * The shapes are not interchangeable and the difference is the difference between a citation that
 * survives the next refactor and one that quietly stops meaning anything: `test-title` becomes an
 * `it('...')` title because a test's identity IS its title; `member` keeps the dot because
 * `Class.method` is how the symbol is written everywhere else; a plain declaration is a call form
 * only when the declaration is callable, because `renderStatus` read as `renderStatus()` is a claim
 * about a call that does not happen.
 */
export const proposalFor = (resolved, targetDisplay) => {
  switch (resolved.kind) {
    case 'test-title':
      return `\`${targetDisplay}\` — the \`it('${resolved.name}')\` title`;
    case 'member':
      return `\`${targetDisplay}\` — \`${resolved.name}\``;
    case 'switch-arm':
      return `\`${targetDisplay}\` — the \`${resolved.name}\` case`;
    case 'declaration':
      return `\`${targetDisplay}\` — \`${resolved.name}\``;
    case 'nearest':
      // Carries the distance so a reviewer can tell an anchor found by reading the code from one
      // found by looking nearby, which are not the same quality of answer and must not read alike.
      return `\`${targetDisplay}\` — \`${resolved.name}\` (?) near the drifted line ${resolved.distance}`;
    case 'missing-file':
      return undefined;
    default:
      return undefined;
  }
};

/**
 * The anchor a MARKDOWN target's line sits under.
 *
 * A prose target is not a smaller version of the code problem, it is the other half of it, and the
 * user's rule says so directly: documents are cited by paragraph number. `HANDOFF.md` and
 * `docs/DOCUMENTATION.md` number their sections, so a citation into them becomes `§N` — a number
 * that is a STABLE identity, because it is assigned by a heading rather than by a position. Every
 * other document is cited by its heading text, quoted, which is the same stable anchor wearing
 * clothes.
 *
 * The nearest PRECEDING heading is what a reader means. A citation that lands two lines after a
 * heading is about that section, and a reader who follows the heading finds the claim; a citation
 * that landed on the heading line itself would be about the heading.
 */
export const resolveHeadingAtLine = (text, line) => {
  const lines = text.split('\n');
  const limit = Math.min(line, lines.length);
  let heading;
  for (let i = 0; i < limit; i += 1) {
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (match) heading = { depth: match[1].length, title: match[2].trim(), line: i + 1 };
  }
  if (!heading) return { kind: 'heading-unresolved' };
  const numbered = /^(\d+[a-z]?)\.\s+(.*)$/.exec(heading.title);
  if (numbered) return { kind: 'numbered-section', name: numbered[1], title: numbered[2] };
  return { kind: 'heading', name: heading.title };
};

/**
 * The file extensions a citation may name, and the ONE place this list exists.
 *
 * This started as two lists and they had already drifted: the gate in
 * `scripts/__tests__/agents-citations.test.mjs` matched 20 extensions while this resolver matched
 * 13, so `html`, `svg`, `wasm`, `avif`, `webp`, `jpg` and `png` were invisible to the sweep. The
 * consequence is the one that matters and runs the wrong way: the sweep is the tool that builds the
 * migration's worklist, so a document whose only citations were `logo.svg:12` and `bg.png:4`
 * reported CLEAN while the gate rejected it. A checker that under-reports the remainder is worse
 * than no checker, because it converts the gate's red into a green that is not true.
 *
 * Both patterns below are therefore compiled from this one string, and `LINE_NUMBER_CITATION` is
 * exported so the gate uses the very pattern the sweep does. Adding an extension is a one-line
 * change that both sides inherit; the two can no longer disagree, which is the property the drift
 * was losing.
 *
 * The list is deliberately longer than the extensions this repository mostly cites. `node:fs` and
 * `node:path` stay out because there is no dot-extension before the colon, and a URL's port stays
 * out because a port is not a file — the two shapes a looser `\w+:\d+` would report, and the first
 * of which appears in this repository's own import lines.
 */
const CITATION_EXTENSION_SOURCE =
  'ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|scss|css|yml|yaml|html|svg|wasm|avif|webp|jpg|png';

/**
 * The gate's own detection pattern, exported so the gate cannot hold a second copy.
 *
 * No `i` flag, and that is a decision rather than an oversight: an uppercase `README.MD:12` is not
 * a form any document in this repository writes, and matching case-insensitively would report the
 * `.MD` in a sentence that legitimately discusses extensions without catching a drift that has ever
 * existed. The sweep and the gate must agree on what a citation IS before either can be trusted
 * about how many are left.
 */
const LINE_NUMBER_CITATION = new RegExp(`[\\w./@-]+\\.(?:${CITATION_EXTENSION_SOURCE}):\\d+`, 'g');

/**
 * A fenced code block's contents, removed.
 *
 * This is the ONE exemption from the ban, and it lives here beside the pattern because it changes
 * what the pattern SEES rather than what it matches: the gate strips fences before it reads, so a
 * fence is a claim about the form and the prose on either side is still checked. Kept as a second
 * pass for the unterminated fence, which strips to the end of the document — the safe direction,
 * since a document that forgets its closing fence loses the check on everything after it.
 */
const withoutFencedCode = (markdown) =>
  markdown.replace(/^[ \t]{0,3}```[\s\S]*?^[ \t]{0,3}```[^\n]*$/gm, '').replace(/^[ \t]{0,3}```[\s\S]*$/m, '');

/**
 * The citation forms this repository actually writes, in one pattern.
 *
 * The trailing forms exist because a document that has already been partly migrated still carries
 * a bare `` `:476` `` continuing an earlier `` `AppKeyboardShortcuts.tsx:330` ``, and a sweep that
 * only matched the full form would report the first and silently leave the second. `CONTINUATION`
 * is matched separately and resolved against the last full citation seen on the same line, which is
 * how a reader reads it.
 *
 * The captures are what `citationsIn` needs and the gate does not: the gate only reports the match
 * for a human to look up, while the sweep has to resolve the target, so this pattern captures the
 * target, the first line and the optional range end. Both are compiled from
 * `CITATION_EXTENSION_SOURCE`, so a form one of them can see the other can see.
 */
/**
 * ONE OR MORE numbers, comma-separated, each optionally a range.
 *
 * This is a list because documents write lists inside a single backticked token. `` `:122`, `:390` ``
 * is two tokens and was always caught, but `` `:217,:219-221` `` and `` `x.ts:1,2,3` `` are ONE token
 * holding three positions, and the single-number form matched only the first. Two independent
 * migration sessions found real citations surviving in that shape, which means the gate was green over
 * a hole: a document could carry `` `:217,:219-221` `` indefinitely with neither the sweep nor
 * `LINE_NUMBER_CITATION` reporting anything. A comma is not a reason to stop reading a coordinate.
 */
const NUMBER_LIST = String.raw`\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*`;

/**
 * A continuation's list, where every number keeps its own colon.
 *
 * `` `:217,:219-221` `` is not `` `:217,219-221` `` — the writer repeated the colon because each
 * number reads as its own coordinate, and a reader parses it that way. So the separator between them
 * is `,:` rather than `,`, which is why the first version of this pattern still reported zero for a
 * shape two migration sessions had already found in real documents.
 */
const CONTINUATION_LIST = String.raw`\d+(?:-\d+)?(?:,:\d+(?:-\d+)?)*`;

const FULL_CITATION = new RegExp('`?([\\w./@-]+\\.(?:' + CITATION_EXTENSION_SOURCE + ')):(' + NUMBER_LIST + ')`?', 'g');
const CONTINUATION = new RegExp('`:(' + CONTINUATION_LIST + ')`', 'g');

/**
 * One entry per position in a number list, in the order written.
 *
 * A RANGE stays ONE citation, because the rule says a range names one enclosing unit — that is a
 * judgement about a span, not two citations. A comma list is different: `x.ts:1,2,3` is three
 * positions a reader looks up separately, so it becomes three entries and none of them can hide
 * behind the first. `bare` says whether each part carries its own leading colon to strip.
 */
const expandNumbers = (list, fields, bare = false) =>
  list.split(',').map((part) => {
    const [first, last] = (bare ? part.replace(/^:/, '') : part).split('-');
    return { ...fields, line: Number(first), endLine: last ? Number(last) : undefined };
  });

/**
 * Every citation in a document, in source order, with the target line to resolve.
 *
 * Line order matters for continuations, which is why this is a single forward pass rather than two
 * independent `matchAll` calls: a bare `:476` is only meaningful relative to the full citation it
 * continues, and losing that association is how a proposal ends up pointing at the wrong file.
 *
 * Fences are stripped first, and that is a correctness requirement rather than tidiness. The gate
 * exempts a fenced block as quotation, so a sweep that reported fenced citations would hand a
 * reviewer a worklist item whose correct resolution is "change nothing" — and a worklist that
 * contains items that must not be acted on trains its reader to skim it. Both sides of the
 * migration now read the document through the same strip.
 */
export const citationsIn = (text) => {
  const out = [];
  for (const line of withoutFencedCode(text).split('\n')) {
    // Scoped to the LINE, which is what this function's own doc comment always claimed and what the
    // code did not do: `lastTarget` lived outside the loop, so a bare `:NNN` bound to the last FULL
    // citation anywhere earlier in the document. Three separate migration sessions were misled by it
    // — `docs/TOOLS-INVENTORY.md`'s five continuations all resolved against a `tool-types.ts` line
    // six paragraphs above, and one proposal named `isBedrock` for a `docs/PHOTOSHOP-UX.md` heading.
    // The failure is silent and authoritative-looking, which is the worst combination available: a
    // reviewer has no reason to doubt a proposal that names a real symbol in a real file.
    let lastTarget;
    for (const match of line.matchAll(FULL_CITATION)) {
      const [raw, target, list] = match;
      out.push(...expandNumbers(list, { raw, target, continuation: false }));
      lastTarget = target;
    }
    for (const match of line.matchAll(CONTINUATION)) {
      const [raw, list] = match;
      // Emitted even with no antecedent on the line, and marked, rather than skipped or bound to a
      // document-away guess. Skipping hid nine real line numbers from the sweep; binding them
      // invented an answer. An explicit `no-antecedent` is the one option that leaves the judgement
      // with the reader, whose sentence is what actually decides the target.
      out.push(
        ...expandNumbers(
          list,
          {
            raw,
            target: lastTarget,
            continuation: true,
            unresolvedContinuation: lastTarget === undefined,
          },
          true
        )
      );
    }
  }
  return out;
};

export { FULL_CITATION, CONTINUATION, LINE_NUMBER_CITATION, CITATION_EXTENSION_SOURCE, withoutFencedCode };

const MARKDOWN_TARGET = /\.md$/;

/**
 * The proposal text for a markdown target, which is a section reference rather than a code symbol.
 *
 * A numbered section is cited as `§N` and nothing else, because `§N` is already the notation the
 * repository uses for it and spelling it out twice would be a second answer to one question. An
 * unnumbered heading is cited by its title in quotes, with the level dropped: a reader looking for
 * "Citations" finds it whether it is an `h2` or an `h3`.
 */
const markdownProposal = (resolved, targetDisplay) => {
  if (resolved.kind === 'numbered-section') return `\`${targetDisplay}\` §${resolved.name}`;
  if (resolved.kind === 'heading') return `\`${targetDisplay}\` — "${resolved.name}"`;
  return undefined;
};

/**
 * Every tracked source file, indexed by basename.
 *
 * Documents cite the way a person reads: `toolbar-mapping.ts:114`, not
 * `src/tools/toolbar-mapping.ts:114`, and two thirds of the citations in this repository are written
 * that way. Resolving them requires knowing which of the repository's 600-odd modules the reader
 * meant, and the answer has to be CHECKABLE — a resolver that guessed the first basename match would
 * turn an honest citation into a confidently wrong one, which is the exact failure the migration
 * exists to remove.
 *
 * So the index is strict about the two cases that differ. A unique basename resolves, and a
 * duplicate is reported as `ambiguous-file` with every candidate, for a human to pick. That is not
 * a limitation to work around later; an ambiguous citation is a citation the document should not
 * have written, and naming the candidates is the whole of what is needed to fix it.
 */
let basenameIndexCache;

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.kilo',
  'test-results',
  'playwright-report',
  '.vite',
]);

/**
 * The tracked files, falling back to a filesystem walk.
 *
 * The fallback exists for the resolver's own tests, which build a throwaway repository in a temp
 * directory rather than reading this one — a test that resolved against `src/` would need editing
 * every time the tree moved, and would fail for the same reason a line-number citation does. It is
 * also the honest behaviour for a caller pointing at any directory that is not a checkout, where
 * reporting every basename as untracked would be a lie about files that are sitting right there.
 */
const listSourceFiles = (root) => {
  try {
    // `stdio` pins git's stderr to a discard. Without it a non-checkout directory prints
    // `fatal: not a git repository` on the parent's stderr every time this runs, which is how the
    // fallback below went unnoticed as untested for as long as it existed: the noise looked like
    // incidental test output rather than a branch that had never been asserted. A fallback that is
    // exercised but never checked is a fallback nobody knows works.
    const listed = execFileSync('git', ['ls-files'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean);
    if (listed.length) return listed;
  } catch {
    // Not a checkout, or no git: fall through to the walk.
  }
  const out = [];
  const visit = (dir, prefix) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(dir, entry.name), relative);
      else out.push(relative);
    }
  };
  visit(root, '');
  return out;
};

const buildBasenameIndex = (root) => {
  if (basenameIndexCache) return basenameIndexCache;
  const index = new Map();
  for (const file of listSourceFiles(root)) {
    const base = file.slice(file.lastIndexOf('/') + 1);
    if (!index.has(base)) index.set(base, []);
    index.get(base).push(file);
  }
  basenameIndexCache = index;
  return index;
};

const clearIndex = () => {
  basenameIndexCache = undefined;
  clearCache();
};

/**
 * The repo-relative path a citation's target names.
 *
 * Returned as `{ path }` when there is exactly one honest answer, `{ candidates }` when the
 * basename is shared, and `{ path }` with the literal target when the file is not tracked at all —
 * which is itself a finding, because a document citing a file that does not exist is claiming
 * something about code that is not in the tree.
 */
export const locateTarget = (repoRoot, target) => {
  const direct = resolve(repoRoot, target);
  if (existsSync(direct)) return { path: target };
  const base = target.slice(target.lastIndexOf('/') + 1);
  const candidates = buildBasenameIndex(repoRoot).get(base) ?? [];
  if (candidates.length === 1) return { path: candidates[0] };
  if (candidates.length > 1) return { candidates };
  return { path: undefined };
};

/**
 * Resolve a target that several files share, by asking each candidate the same question.
 *
 * A shared basename is not a guess to make but a question with an answer: `Draw.tsx` occurs in one
 * place and `index.ts` in forty, but the citation is only meaningful if the line it names sits
 * inside a declaration SOME candidate actually has. Asking all of them and keeping the ones that
 * answer turns most ambiguities into a fact — and where the fact does not fall out, the candidates
 * come back with their best anchors attached, so a reviewer is choosing between two concrete
 * readings rather than opening forty files to find out which one was meant.
 *
 * Ties are reported rather than broken. Preferring the first candidate would be a coin toss wearing
 * a deterministic hat, and this repository does not want citations that look derived and are not.
 */
const EXACT_KINDS = new Set(['declaration', 'member', 'test-title', 'switch-arm']);

const resolveAmbiguous = (repoRoot, candidates, line) => {
  const resolved = candidates.map((path) => resolveCitationForPath(repoRoot, path, line));
  // Only an EXACT anchor breaks the tie. A `nearest` anchor is a guess about where the citation
  // drifted to, and a guess cannot be evidence that one of two files was meant — every candidate
  // produces one for something within a few lines, so letting them vote would answer `ambiguous`
  // with a coin toss dressed as a derivation.
  const exact = resolved.filter((entry) => EXACT_KINDS.has(entry.kind));
  if (exact.length === 1) return exact[0];
  const withProposal = resolved.filter((entry) => entry.proposal);
  return {
    kind: 'ambiguous-file',
    line,
    candidates: resolved.map((entry) => entry.file),
    proposals: withProposal,
  };
};

export const resolveCitation = (repoRoot, targetPath, line) => {
  // A continuation with no antecedent on its line arrives here with no target at all. That is a real
  // citation the reader must resolve from the sentence, not a crash and not a guess: naming
  // `untracked-file` would send a reviewer looking for a file that plainly exists, because the
  // target was never missing — it was never stated.
  if (targetPath === undefined)
    return { kind: 'no-antecedent', file: undefined, line, proposal: undefined, targetDisplay: `:${line}` };
  const located = locateTarget(repoRoot, targetPath);
  if (located.candidates) return resolveAmbiguous(repoRoot, located.candidates, line);
  if (!located.path) return { kind: 'untracked-file', file: targetPath, line, proposal: undefined };
  return resolveCitationForPath(repoRoot, located.path, line, targetPath.split('/').pop());
};

const resolveCitationForPath = (repoRoot, locatedPath, line, displayOverride) => {
  const absolutePath = resolve(repoRoot, locatedPath);
  const display = displayOverride ?? locatedPath.split('/').pop();
  if (MARKDOWN_TARGET.test(locatedPath)) {
    if (!existsSync(absolutePath)) return { kind: 'missing-file', file: absolutePath, line };
    const resolved = resolveHeadingAtLine(readFileSync(absolutePath, 'utf8'), line);
    return {
      ...resolved,
      file: absolutePath,
      line,
      proposal: markdownProposal(resolved, display),
    };
  }
  const resolved = resolveSymbolAtLine(absolutePath, line);
  return { ...resolved, file: absolutePath, line, proposal: proposalFor(resolved, display), display };
};

export { moduleStem, testTitleOf, offsetOf, enclosingChain, parseFile, DECLARATION_KINDS, clearCache, clearIndex };
