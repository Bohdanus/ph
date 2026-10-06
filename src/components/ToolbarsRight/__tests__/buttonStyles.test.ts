import { describe, expect, it } from 'vitest';
import * as buttonStyles from '../buttonStyles.ts';

const STYLE_NAMES = [
  'PRIMARY_BUTTON',
  'PRIMARY_BUTTON_LARGE',
  'SECONDARY_BUTTON',
  'SECONDARY_BUTTON_LARGE',
  'TOGGLE_BUTTON_ACTIVE',
  'TOGGLE_BUTTON_INACTIVE',
  'ICON_BUTTON',
  'SMALL_TOGGLE_BUTTON_ACTIVE',
  'SMALL_TOGGLE_BUTTON_INACTIVE',
  'TEXT_LINK_BUTTON',
  'ICON_TOGGLE_BUTTON_VISIBLE',
  'ICON_TOGGLE_BUTTON_HIDDEN',
  'DELETE_BUTTON_ICON',
  'TOOLBAR_MENU_BUTTON_ACTIVE',
  'TOOLBAR_MENU_BUTTON_INACTIVE',
  'MENU_ITEM_BUTTON',
  'DIALOG_SECONDARY_BUTTON',
  'TRANSPARENT_DARK_ICON_BUTTON',
] as const;

type StyleName = (typeof STYLE_NAMES)[number];

const ENTRIES = STYLE_NAMES.map((name) => [name, buttonStyles[name] as string] as const);

/** Paired state constants: switching state must be a real visual change. */
const STATE_PAIRS: ReadonlyArray<readonly [active: StyleName, inactive: StyleName]> = [
  ['TOGGLE_BUTTON_ACTIVE', 'TOGGLE_BUTTON_INACTIVE'],
  ['SMALL_TOGGLE_BUTTON_ACTIVE', 'SMALL_TOGGLE_BUTTON_INACTIVE'],
  ['ICON_TOGGLE_BUTTON_VISIBLE', 'ICON_TOGGLE_BUTTON_HIDDEN'],
  ['TOOLBAR_MENU_BUTTON_ACTIVE', 'TOOLBAR_MENU_BUTTON_INACTIVE'],
];

/** These constants are the *only* interactive control styles, so they need disabled styling. */
const DISABLED_CAPABLE: ReadonlyArray<readonly [name: StyleName, base: StyleName]> = [
  ['PRIMARY_BUTTON', 'PRIMARY_BUTTON'],
  ['TRANSPARENT_DARK_ICON_BUTTON', 'TRANSPARENT_DARK_ICON_BUTTON'],
  // A disabled secondary button used to render pixel-for-pixel as an enabled one, because no style
  // in this file that could be disabled carried a `disabled:` variant except the two above — and a
  // `disabled` attribute is invisible to a sighted user and to a screenshot. The Type tool's Clear
  // is secondary, and it is disabled for the whole of a session in which no box has been dragged.
  ['SECONDARY_BUTTON', 'SECONDARY_BUTTON'],
];

const classesOf = (name: StyleName) => (buttonStyles[name] as string).trim().split(/\s+/);
const FOCUS_VISIBLE_BUTTONS = STYLE_NAMES.filter((name) => classesOf(name).includes('focus:outline-none'));

describe('buttonStyles public surface', () => {
  it('exports exactly the documented style constants and nothing else', () => {
    expect(Object.keys(buttonStyles).sort()).toEqual([...STYLE_NAMES].sort());
  });

  it('exports every constant as a plain non-empty string', () => {
    for (const [name, value] of ENTRIES) {
      expect(typeof value, name).toBe('string');
      expect(value.length, name).toBeGreaterThan(0);
    }
  });

  it('is consumed as a `className` string, so it stays synchronised with its module specifier', async () => {
    // A stale relative specifier here would silently hand the components a different module.
    const specifier = import.meta.resolve('../buttonStyles.ts');
    expect(specifier).toContain('buttonStyles');
  });
});

describe('buttonStyles class-list hygiene', () => {
  it.each(ENTRIES)('%s is a well formed, de-duplicated class list safe for a className attribute', (name, value) => {
    const classes = classesOf(name);

    // Trimmed, single line, no runs of whitespace: the value is pasted straight into a
    // `className` attribute and a stray newline would silently drop the tail of the list.
    expect(value, name).toBe(value.trim());
    expect(value, name).not.toMatch(/\s\s/);
    expect(value, name).not.toMatch(/[\n\r\t]/);

    // A real class list, not a single stray utility.
    expect(classes.length, name).toBeGreaterThan(1);

    // No duplicate tokens: they only add weight and hide a stale copy-paste.
    expect(new Set(classes).size, `${name} repeats a token: ${classes.join(' ')}`).toBe(classes.length);

    // Quotes, backslashes, angle brackets and rule punctuation would either break the attribute
    // or let a hand-edited token smuggle arbitrary CSS through a shared style constant.
    expect(value, name).not.toMatch(/["'\\<>]/);
    expect(value, name).not.toMatch(/[{};]/);
  });
});

describe('buttonStyles state pairs', () => {
  it.each(STATE_PAIRS)('%s and %s are different declarations', (active, inactive) => {
    expect(buttonStyles[active]).not.toBe(buttonStyles[inactive]);
  });

  it.each(STATE_PAIRS)('%s is not a prefix subset of %s, so the active state always wins', (active, inactive) => {
    const activeClasses = new Set(classesOf(active));
    const inactiveClasses = new Set(classesOf(inactive));

    // If the active style were a strict subset of the inactive one, the later class in the
    // merged `className` would decide the colour and the toggle would look stuck.
    expect([...activeClasses].filter((token) => inactiveClasses.has(token))).not.toEqual([...activeClasses]);
  });

  it.each(STATE_PAIRS)('%s and %s disagree on their colour tokens', (active, inactive) => {
    const colorTokens = (name: StyleName) => classesOf(name).filter((token) => /(?:bg|text|border)-/.test(token));
    expect(colorTokens(active)).not.toEqual(colorTokens(inactive));
  });
});

describe('buttonStyles disabled affordance', () => {
  it.each(DISABLED_CAPABLE)('%s declares an explicit disabled variant', (name) => {
    const disabledTokens = classesOf(name).filter((token) => token.startsWith('disabled:'));
    expect(disabledTokens.length, `${name} has no disabled: styling`).toBeGreaterThan(0);
  });

  it.each(DISABLED_CAPABLE)('%s dims a disabled control below its enabled and hover opacity', (name) => {
    const tokens = classesOf(name);
    const opacityValues = (prefix: string) =>
      tokens
        .filter((token) => token.startsWith(prefix))
        .map((token) => token.slice(prefix.length))
        .filter((rest) => rest.startsWith('opacity-'))
        .map((rest) => Number(rest.slice('opacity-'.length)));

    const disabledOpacity = opacityValues('disabled:');
    expect(disabledOpacity.length, `${name} never dims a disabled control`).toBeGreaterThan(0);

    // The enabled and hover opacities are either implicit (Tailwind's default 1) or explicit.
    const enabledOpacity = opacityValues('');
    const hoverOpacity = opacityValues('hover:');
    for (const reference of [...enabledOpacity, ...hoverOpacity]) {
      expect(Math.min(...disabledOpacity), name).toBeLessThan(reference);
    }
  });

  it('gives PRIMARY_BUTTON a disabled opacity without a hover reset, because it never changes background while disabled', () => {
    const tokens = classesOf('PRIMARY_BUTTON');
    expect(tokens.filter((token) => token.startsWith('disabled:'))).toEqual(['disabled:opacity-50']);
  });

  it('resets the hover background of TRANSPARENT_DARK_ICON_BUTTON while disabled', () => {
    const tokens = classesOf('TRANSPARENT_DARK_ICON_BUTTON');
    expect(tokens.filter((token) => token.startsWith('disabled:'))).toEqual([
      'disabled:opacity-25',
      'disabled:hover:bg-transparent',
    ]);
  });

  it('leaves the toggle pair without disabled variants because toggles are never disabled by the toolbars', () => {
    // Pinning the absence guards against a well-meaning edit that bolts a `disabled:opacity-50`
    // onto a toggle style, which would fade a *pressed* button rather than a disabled one.
    for (const name of ['TOGGLE_BUTTON_ACTIVE', 'TOGGLE_BUTTON_INACTIVE', 'SMALL_TOGGLE_BUTTON_ACTIVE']) {
      expect(
        classesOf(name as StyleName).filter((token) => token.startsWith('disabled:')),
        name
      ).toEqual([]);
    }
  });
});

describe('buttonStyles keyboard focus affordance', () => {
  it.each(FOCUS_VISIBLE_BUTTONS)('%s provides a focus-visible ring', (name) => {
    const tokens = classesOf(name);

    expect(tokens).toContain('focus-visible:ring-2');
    expect(tokens).toContain('focus-visible:ring-blue-500');
    expect(tokens).toContain('focus-visible:ring-offset-2');
    expect(tokens).not.toContain('focus:ring-2');
  });
});
