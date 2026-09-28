import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { format, resolveConfig } from 'prettier';

import { toolbarMap } from '../toolbar-mapping.ts';
import { eyedropperDrawDescriptions } from '../src/tools/descriptions/eyedropper-draw.ts';
import { focusDescriptions } from '../src/tools/descriptions/focus.ts';
import { paintDescriptions } from '../src/tools/descriptions/paint.ts';
import { penDescriptions } from '../src/tools/descriptions/pen.ts';
import { selectionDescriptions } from '../src/tools/descriptions/selection.ts';
import { shapeDescriptions } from '../src/tools/descriptions/shape.ts';
import { transformDescriptions } from '../src/tools/descriptions/transform.ts';
import { typeCropDescriptions } from '../src/tools/descriptions/type-crop.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(REPO_ROOT, 'docs/TOOLS.md');
const TOOLTIPS_OUTPUT = resolve(REPO_ROOT, 'src/tools/descriptions/tooltips.ts');

/**
 * The eight family modules, in the order they were researched, with the reading order a human
 * wants and the membership each family already owns.
 *
 * Membership is read off the family module rather than off its notes file's headings, because a
 * heading that drifts from the module it documents would silently drop a tool out of this page,
 * and a page that quietly omits a tool is worse than no page. `notes` is only a path, used for
 * the provenance link and for nothing else. The notes sit beside the module they document rather
 * than under `docs/`, because a file about one module is that module's second half — the sourced
 * half that the typed half cannot hold.
 *
 * The record is merged here rather than imported from `index.ts`, because `index.ts` re-exports
 * `descriptionKeyFor` from the very file this script writes. Importing it would mean the
 * generator could not run for the first time.
 */
const FAMILIES = [
  { title: 'Selection', record: selectionDescriptions, notes: 'selection.notes.md' },
  { title: 'Painting and erasing', record: paintDescriptions, notes: 'paint.notes.md' },
  { title: 'Focus and tone', record: focusDescriptions, notes: 'focus.notes.md' },
  { title: 'Shapes', record: shapeDescriptions, notes: 'shape.notes.md' },
  { title: 'Pen and path', record: penDescriptions, notes: 'pen.notes.md' },
  { title: 'Type and crop', record: typeCropDescriptions, notes: 'type-crop.notes.md' },
  { title: 'Move, transform and adjustments', record: transformDescriptions, notes: 'transform.notes.md' },
  { title: 'Eyedropper and draw', record: eyedropperDrawDescriptions, notes: 'eyedropper-draw.notes.md' },
];

const toolDescriptions = Object.assign({}, ...FAMILIES.map(({ record }) => record));

/**
 * The app's own name for a shape figure is not Photoshop's in one place, and the toolbar needs
 * the translation. It is written into the generated module rather than imported, for the same
 * reason the record is merged above: the generated file cannot be an input to generating itself.
 */
const FIGURE_TOOL_NAMES = {
  rectangle: 'rectangle',
  oval: 'ellipse',
  line: 'line',
  triangle: 'triangle',
  polygon: 'polygon',
};

const descriptionKeyFor = (name, figure) => (figure === undefined ? name : FIGURE_TOOL_NAMES[figure]);

const escapeCell = (text) => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');

/** `present` / `partial` / `inert` / `missing`, plus the citation when there is one. */
const statusCell = (option) => {
  const label = `\`${option.status}\``;
  return option.appRef === undefined ? label : `${label} — \`${option.appRef}\``;
};

const renderTool = (key, label, shortcut) => {
  const tool = toolDescriptions[key];
  const lines = [`### ${label}`, '', `\`${key}\`${shortcut === undefined ? '' : ` · **${shortcut}**`}`, ''];
  // Only worth saying when the app's label and Adobe's name part company — which is the Draw
  // Tool, since it has no Adobe equivalent, and the five figure tools, where the app splits one
  // Photoshop tool across five tiles.
  if (tool.photoshopName !== label) lines.push(`Photoshop's name for it is **${tool.photoshopName}**.`, '');
  lines.push(tool.summary, '', tool.purpose, '');

  if (tool.options.length > 0) {
    lines.push('**Options bar**', '', '| Control | Photoshop | In this app |', '| --- | --- | --- |');
    for (const option of tool.options) {
      lines.push(`| ${escapeCell(option.control)} | ${escapeCell(option.detail)} | ${statusCell(option)} |`);
    }
    lines.push('');
  } else {
    lines.push('_Photoshop gives this tool no options bar of its own._', '');
  }

  if (tool.modifiers.length > 0) {
    lines.push('**Modifiers**', '');
    for (const modifier of tool.modifiers) lines.push(`- **${modifier.keys}** — ${modifier.action}`);
    lines.push('');
  }

  if (tool.shortcuts.length > 0) {
    lines.push('**Shortcuts**', '');
    for (const entry of tool.shortcuts) lines.push(`- \`${entry.keys}\` — ${entry.action}`);
    lines.push('');
  }

  lines.push(`**In this app:** \`${tool.implementation}\` — ${tool.appNotes}`, '');

  if (tool.implementationRefs.length > 0) {
    lines.push('Implementation:', ...tool.implementationRefs.map((ref) => `- \`${ref}\``), '');
  }

  lines.push('Sources:', ...tool.sources.map((source) => `- <${source}>`), '', '---', '');
  return lines.join('\n');
};

/**
 * Run through Prettier before it is written, and that is not tidiness.
 *
 * `lint:check` formats every tracked markdown and TypeScript file, and
 * `scripts/__tests__/tool-descriptions.test.mjs` asserts the committed output is byte-identical
 * to what this script produces. Both can only hold if the script's output is already
 * Prettier-formatted, so the formatting happens here rather than being left to the next person
 * to run and re-commit. `resolveConfig` is what makes the project's own `.prettierrc` apply
 * instead of Prettier's defaults, which would otherwise disagree on print width alone.
 */
const prettify = async (source, filepath) =>
  format(source, { ...(await resolveConfig(filepath)), filepath, parser: 'markdown' });

export const renderToolDocs = async () => {
  const sections = [];
  const emitted = new Set();

  for (const family of FAMILIES) {
    const owned = Object.keys(family.record);
    if (owned.length === 0) continue;

    // The reading order is Photoshop's: the toolbar decides where a tool sits, and a tool the
    // toolbar cannot reach — the generic Shape Tool, whose five figures all claim the name
    // `shape` — is appended under its own Photoshop name so it is still on the page.
    const entries = [];
    for (const section of toolbarMap) {
      for (const group of section) {
        for (const entry of group) {
          const key = descriptionKeyFor(entry.name, entry.figure);
          if (owned.includes(key) && !entries.some(([existing]) => existing === key)) {
            entries.push([key, entry.label, entry.shortcut]);
          }
        }
      }
    }
    for (const key of owned) {
      if (!entries.some(([existing]) => existing === key)) {
        entries.push([key, toolDescriptions[key].photoshopName, undefined]);
      }
    }

    for (const [key] of entries) emitted.add(key);

    sections.push(
      [
        `## ${family.title}`,
        '',
        `Long-form research, provenance and unverified claims: [\`src/tools/descriptions/${family.notes}\`](../src/tools/descriptions/${family.notes}).`,
        '',
      ]
        .concat(entries.map(([key, label, shortcut]) => renderTool(key, label, shortcut)))
        .join('\n')
    );
  }

  // A tool no family claims has no page, no tooltip and no data. There is no cheap way to
  // notice that, so it is made loud here: the generator refuses to write a page that is
  // missing a tool, rather than writing a plausible-looking one.
  const uncovered = Object.keys(toolDescriptions).filter((key) => !emitted.has(key));
  if (uncovered.length > 0) {
    throw new Error(`docs/TOOLS.md would omit ${uncovered.length} tool(s): ${uncovered.join(', ')}`);
  }

  const header = [
    '# Tools',
    '',
    'Every tool in this editor, described against Adobe Photoshop.',
    '',
    '<!-- GENERATED FILE - DO NOT EDIT. Source: src/tools/descriptions/*.ts -->',
    '<!-- Regenerate with `npm run docs:tools`; a test fails if this file is stale. -->',
    '',
    'The prose below is generated from `src/tools/descriptions/`, which is the single source of',
    'truth. Each tool carries what Photoshop does with it, what this editor does with it, and the',
    'option controls Photoshop puts in its options bar with each one’s status here — `present`,',
    '`partial`, `inert` (declared in the settings but rendered by no component) or `missing`.',
    'Every Photoshop claim is sourced; the per-family notes files carry the long-form research and',
    'the list of what could not be verified.',
    '',
    'The toolbar tooltip shows the one-line summary and, for a tool this editor does not fully',
    'implement, a status line.',
    '',
  ].join('\n');

  return prettify(`${header}${sections.join('\n')}`, OUTPUT);
};

/**
 * The one thing from the description record that the application actually ships.
 *
 * ## Why this is generated rather than hand-written
 *
 * Measured on this branch: importing the full record from the toolbar tooltip added **215 kB
 * raw / 58 kB gzipped** to the main bundle — a 34% increase — to render one line of text per
 * tool. The other 95% (`purpose`, `options`, `modifiers`, `shortcuts`, `implementationRefs`,
 * `appNotes`, `sources`) has no runtime consumer at all: it exists for `docs/TOOLS.md` and for
 * the tests, and a test file is not shipped.
 *
 * So the record is split by *consumer* rather than by convenience, and the small half is
 * generated from the large one. A hand-written projection would be a second place to edit
 * every summary; a generated one is edited in exactly one place and a test fails if the
 * committed file stops matching its source.
 *
 * `descriptionKeyFor` is emitted here rather than living in `index.ts` so that the toolbar
 * imports one module and only that module. `index.ts` pulls in the whole record.
 */
export const renderTooltips = async () => {
  const entries = Object.entries(toolDescriptions)
    .map(
      ([key, tool]) =>
        `  ${JSON.stringify(key)}: { summary: ${JSON.stringify(tool.summary)}, implementation: ${JSON.stringify(tool.implementation)} },`
    )
    .join('\n');

  return `// GENERATED FILE - DO NOT EDIT. Source: src/tools/descriptions/*.ts
// Regenerate with \`npm run docs:tools\`; a test fails if this file is stale.

import type { ToolName } from '../../contexts/tool-types.ts';
import type { FigureType } from '../shape.ts';
import type { ToolImplementationStatus } from './types.ts';

/**
 * The two fields the toolbar tooltip reads, and the only part of the description record that
 * reaches the browser. Everything else — the purpose prose, the options tables, the
 * modifiers, the citations — exists for \`docs/TOOLS.md\` and for the tests, and importing it
 * here cost 215 kB raw / 58 kB gzipped for one line of text per tool.
 */
export type ToolTooltipProjection = {
  /** One sentence, what the tooltip shows under the tool's name. */
  summary: string;
  /** How much of the tool this editor implements. Drives the tooltip's status line. */
  implementation: ToolImplementationStatus;
};

export const toolTooltips: Record<ToolName, ToolTooltipProjection> = {
${entries}
};

/**
 * The five shape figures, each of which is a \`ToolName\` in its own right.
 *
 * \`satisfies\` is load-bearing in the other direction from the merge in \`index.ts\`.
 * \`toolbarMap\` registers all five figures under the single name \`shape\` and carries the figure
 * separately, so a figure added there with no entry here resolves to \`undefined\` at runtime
 * and renders a tooltip with no description; this turns that into a compile error instead.
 */
const FIGURE_TOOL_NAMES = {
  rectangle: 'rectangle',
  oval: 'ellipse',
  line: 'line',
  triangle: 'triangle',
  polygon: 'polygon',
} satisfies Record<FigureType, ToolName>;

/**
 * Which description a toolbar entry shows.
 *
 * \`ToolbarTool.name\` is \`'shape'\` for all five shape tiles, so the name alone would put the
 * generic Shape Tool's summary under the Rectangle Tool. The \`figure\` is what distinguishes
 * them, and the app's own naming disagrees with Photoshop's in exactly one place —
 * \`FigureType\` calls it \`oval\` and \`ToolName\` calls it \`ellipse\` — which is what this
 * indirection exists to absorb, so the caller never spells a figure-specific name out.
 */
export const descriptionKeyFor = (name: ToolName, figure?: FigureType): ToolName =>
  figure === undefined ? name : FIGURE_TOOL_NAMES[figure];
`;
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(OUTPUT, await renderToolDocs());
  writeFileSync(
    TOOLTIPS_OUTPUT,
    await format(await renderTooltips(), { ...(await resolveConfig(TOOLTIPS_OUTPUT)), filepath: TOOLTIPS_OUTPUT })
  );
  process.stdout.write(`wrote ${OUTPUT}\nwrote ${TOOLTIPS_OUTPUT}\n`);
}
