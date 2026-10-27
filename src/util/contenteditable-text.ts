/**
 * Caret arithmetic for a `div[contenteditable]`.
 *
 * These are the element's text handling, and they live here rather than beside the
 * component for one reason: **a `contenteditable` keeps its text in the LIGHT DOM.** That is what
 * makes a caret addressable at all. A `<textarea>`'s value lives in a closed shadow root —
 * `document.createElement('textarea').shadowRoot` is `null` — so neither `Range.getClientRects()` per
 * character nor `Selection.anchorOffset` is reachable, and every one of these would have to be
 * inferred from geometry instead of read. MEASURED, headless Chromium 153; the repeatable check is
 * `src/components/Main/__tests__/TextEditOverlay.test.tsx`.
 */

/**
 * Insert plain text at the caret, returning the host's new text.
 *
 * **Every insertion in this editor goes through here**, and the reason is that a `contenteditable`
 * will happily build a DOM tree: `Enter` inserts a `<div>` or a `<br>`, and a paste inserts whatever
 * markup the clipboard carried. Both would put a second source of truth in the element, and the model
 * reads `textContent` — so the ink on screen and the ink in the layer would be different strings. One
 * text node, inserted at a `Range`, is the whole discipline.
 */
export function insertPlainTextAtCaret(host: HTMLElement, text: string): string {
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  if (!range || !host.contains(range.startContainer)) {
    host.textContent = `${host.textContent ?? ''}${text}`;
    const end = host.firstChild;
    if (selection && end) {
      const caret = document.createRange();
      caret.setStart(end, end.textContent?.length ?? 0);
      caret.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caret);
    }
    return host.textContent ?? '';
  }

  // Compute the model offset before mutating the browser's tree. Flattening after insertion avoids
  // Chromium canonicalising a caret between adjacent newline/text nodes back onto the preceding line.
  const before = document.createRange();
  before.selectNodeContents(host);
  before.setEnd(range.startContainer, range.startOffset);
  const startOffset = before.toString().length;
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  const nextText = host.textContent ?? '';
  host.textContent = nextText;

  const node = host.firstChild;
  if (selection && node) {
    const caret = document.createRange();
    caret.setStart(node, Math.min(nextText.length, startOffset + text.length));
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
  }
  return nextText;
}

/**
 * Select every character, which is what Adobe does to a layer that was just entered.
 *
 * On a `contenteditable` this is a `Range` over the host's contents rather than `select()` on the
 * element, because `select()` is a `<textarea>`/`<input>` method that does not exist here.
 */
export function selectAllIn(host: HTMLElement): void {
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(host);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Read a DOM boundary as an offset into the host's flattened text, in UTF-16 code units. */
export function textOffsetAt(host: HTMLElement, node: Node | null, offset: number): number | null {
  if (!node || !host.contains(node)) return null;
  const limit = node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : node.childNodes.length;
  if (!Number.isInteger(offset) || offset < 0 || offset > limit) return null;

  const before = host.ownerDocument.createRange();
  before.selectNodeContents(host);
  before.setEnd(node, offset);
  return before.toString().length;
}

/** Set selection endpoints from flattened UTF-16 offsets while preserving selection direction. */
export function setTextSelectionOffsets(host: HTMLElement, anchorOffset: number, focusOffset: number): boolean {
  const selection = host.ownerDocument.getSelection();
  if (!selection) return false;

  const positionAt = (rawOffset: number): { node: Node; offset: number } => {
    let remaining = Math.max(0, Math.min(host.textContent?.length ?? 0, rawOffset));
    const showText = host.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? NodeFilter.SHOW_TEXT;
    const walker = host.ownerDocument.createTreeWalker(host, showText);
    let node = walker.nextNode();
    while (node) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) return { node, offset: remaining };
      remaining -= length;
      node = walker.nextNode();
    }
    return { node: host, offset: host.childNodes.length };
  };

  const anchor = positionAt(anchorOffset);
  const focus = positionAt(focusOffset);
  if (typeof selection.setBaseAndExtent === 'function') {
    selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    return true;
  }
  if (typeof selection.extend !== 'function') return false;

  selection.removeAllRanges();
  selection.collapse(anchor.node, anchor.offset);
  selection.extend(focus.node, focus.offset);
  return true;
}
