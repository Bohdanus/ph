import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertPlainTextAtCaret, selectAllIn, setTextSelectionOffsets, textOffsetAt } from '../contenteditable-text.ts';

describe('insertPlainTextAtCaret', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    host.contentEditable = 'true';
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  describe('no active selection', () => {
    it('appends text to empty host when there is no selection', () => {
      const spy = vi.spyOn(window, 'getSelection').mockReturnValue(null);

      const result = insertPlainTextAtCaret(host, 'hello');

      expect(result).toBe('hello');
      expect(host.textContent).toBe('hello');
      expect(spy).toHaveBeenCalled();
    });

    it('appends text to existing text when there is no selection', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);
      host.textContent = 'abc';

      const result = insertPlainTextAtCaret(host, 'def');

      expect(result).toBe('abcdef');
      expect(host.textContent).toBe('abcdef');
    });

    it('handles empty-string insertion with no selection', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);
      host.textContent = 'abc';

      const result = insertPlainTextAtCaret(host, '');

      expect(result).toBe('abc');
      expect(host.textContent).toBe('abc');
    });

    it('does not create a new text node when selection is absent but host is empty', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      insertPlainTextAtCaret(host, 'x');

      // The function sets textContent directly, so there is exactly one text node child.
      expect(host.childNodes).toHaveLength(1);
      expect(host.firstChild?.textContent).toBe('x');
    });
  });

  describe('selection exists but is outside the host', () => {
    it('appends text when selection range is not contained in host', () => {
      const range = document.createRange();
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      outside.textContent = 'outside';
      range.selectNodeContents(outside);

      const selection = {
        rangeCount: 1,
        getRangeAt: () => range,
        removeAllRanges: vi.fn(),
        addRange: vi.fn(),
      };
      vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection);

      const result = insertPlainTextAtCaret(host, 'appended');

      expect(result).toBe('appended');
      expect(host.textContent).toBe('appended');
      expect(selection.removeAllRanges).toHaveBeenCalled();
      expect(selection.addRange).toHaveBeenCalled();

      outside.remove();
    });

    it('appends when range startContainer is sibling, not descendant', () => {
      const range = document.createRange();
      range.selectNodeContents(document.body);
      range.setStart(document.body, 0);

      const selection = {
        rangeCount: 1,
        getRangeAt: () => range,
        removeAllRanges: vi.fn(),
        addRange: vi.fn(),
      };
      vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection);

      const result = insertPlainTextAtCaret(host, 'text');

      expect(result).toBe('text');
    });
  });

  describe('selection inside the host', () => {
    function makeSelection(range: Range): Selection {
      return {
        rangeCount: 1,
        getRangeAt: () => range,
        removeAllRanges: vi.fn(),
        addRange: vi.fn(),
      } as unknown as Selection;
    }

    it('inserts text at the caret position within existing content', () => {
      host.textContent = 'Hello World';
      const range = document.createRange();
      range.setStart(host.firstChild!, 5);
      range.setEnd(host.firstChild!, 5);
      vi.spyOn(window, 'getSelection').mockReturnValue(makeSelection(range));

      const result = insertPlainTextAtCaret(host, ' Beautiful');

      expect(result).toBe('Hello Beautiful World');
      expect(host.textContent).toBe('Hello Beautiful World');
    });

    it('collapses the selection caret to the end of inserted text', () => {
      host.textContent = 'abc';
      const range = document.createRange();
      range.setStart(host.firstChild!, 1);
      range.setEnd(host.firstChild!, 1);
      const selection = makeSelection(range);
      vi.spyOn(window, 'getSelection').mockReturnValue(selection);

      insertPlainTextAtCaret(host, 'XY');

      expect(selection.removeAllRanges).toHaveBeenCalledTimes(1);
      expect(selection.addRange).toHaveBeenCalledTimes(1);

      const caret = vi.mocked(selection.addRange).mock.calls[0][0] as Range;
      expect(caret.startOffset).toBe(3);
      expect(caret.collapsed).toBe(true);
    });

    it('replaces selected content when text is inserted', () => {
      host.textContent = 'Hello World';
      const range = document.createRange();
      range.setStart(host.firstChild!, 0);
      range.setEnd(host.firstChild!, 5);
      vi.spyOn(window, 'getSelection').mockReturnValue(makeSelection(range));

      const result = insertPlainTextAtCaret(host, 'Hi');

      expect(result).toBe('Hi World');
      expect(host.textContent).toBe('Hi World');
    });

    it('inserts at the start when caret is at position 0', () => {
      host.textContent = 'world';
      const range = document.createRange();
      range.setStart(host.firstChild!, 0);
      range.setEnd(host.firstChild!, 0);
      vi.spyOn(window, 'getSelection').mockReturnValue(makeSelection(range));

      const result = insertPlainTextAtCaret(host, 'Hello ');

      expect(result).toBe('Hello world');
    });

    it('inserts at the end when caret is at the last position', () => {
      host.textContent = 'Hello';
      const range = document.createRange();
      const node = host.firstChild!;
      range.setStart(node, node.textContent!.length);
      range.setEnd(node, node.textContent!.length);
      vi.spyOn(window, 'getSelection').mockReturnValue(makeSelection(range));

      const result = insertPlainTextAtCaret(host, ' World');

      expect(result).toBe('Hello World');
    });

    it('handles empty-string insertion (deleteContents is a noop)', () => {
      host.textContent = 'abc';
      const range = document.createRange();
      range.setStart(host.firstChild!, 1);
      range.setEnd(host.firstChild!, 2);
      vi.spyOn(window, 'getSelection').mockReturnValue(makeSelection(range));

      const result = insertPlainTextAtCaret(host, '');

      expect(result).toBe('ac');
      expect(host.textContent).toBe('ac');
    });

    it('handles multi-character insertion across a selection', () => {
      host.textContent = 'abcdef';
      const range = document.createRange();
      range.setStart(host.firstChild!, 1);
      range.setEnd(host.firstChild!, 4);
      vi.spyOn(window, 'getSelection').mockReturnValue(makeSelection(range));

      const result = insertPlainTextAtCaret(host, 'XYZ');

      expect(result).toBe('aXYZef');
    });

    it('handles special characters in inserted text', () => {
      host.textContent = 'a';
      const range = document.createRange();
      range.setStart(host.firstChild!, 1);
      range.setEnd(host.firstChild!, 1);
      vi.spyOn(window, 'getSelection').mockReturnValue(makeSelection(range));

      const result = insertPlainTextAtCaret(host, '<>&"\n\t');

      expect(result).toBe('a<>&"\n\t');
    });

    it('handles insertion into an empty host with an active selection', () => {
      host.textContent = '';
      const range = document.createRange();
      range.selectNodeContents(host);
      range.collapse(true);
      vi.spyOn(window, 'getSelection').mockReturnValue(makeSelection(range));

      const result = insertPlainTextAtCaret(host, 'first');

      expect(result).toBe('first');
      expect(host.textContent).toBe('first');
    });

    it('preserves text node structure when host has existing child nodes', () => {
      const textNode = document.createTextNode('Hello');
      const span = document.createElement('span');
      span.textContent = ' World';
      host.appendChild(textNode);
      host.appendChild(span);

      const range = document.createRange();
      range.setStart(host, 0);
      range.setEnd(host, 0);
      vi.spyOn(window, 'getSelection').mockReturnValue(makeSelection(range));

      const result = insertPlainTextAtCaret(host, 'Hi');

      expect(result).toBe('HiHello World');
    });
  });

  describe('return value', () => {
    it('returns the new textContent after insertion', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      const result = insertPlainTextAtCaret(host, 'test');

      expect(result).toBe('test');
    });

    it('returns empty string when inserting empty text into an empty host', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      const result = insertPlainTextAtCaret(host, '');

      expect(result).toBe('');
    });
  });
});

describe('selectAllIn', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    host.textContent = 'Some selectable text content';
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it('creates a Range over the host contents and selects it', () => {
    const selection = {
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    };
    vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection);

    selectAllIn(host);

    expect(selection.removeAllRanges).toHaveBeenCalledTimes(1);
    expect(selection.addRange).toHaveBeenCalledTimes(1);

    const range = selection.addRange.mock.calls[0][0] as Range;
    expect(range.startContainer).toBe(host);
    expect(range.endContainer).toBe(host);
  });

  it('does nothing when window.getSelection returns null', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(null);

    expect(() => selectAllIn(host)).not.toThrow();
  });

  it('does not throw on an empty host', () => {
    const emptyHost = document.createElement('div');
    document.body.appendChild(emptyHost);
    const selection = {
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    };
    vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection);

    expect(() => selectAllIn(emptyHost)).not.toThrow();

    emptyHost.remove();
  });

  it('does not throw on a host with HTML children (not just text)', () => {
    host.innerHTML = '<span>part1</span><span>part2</span>';
    const selection = {
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    };
    vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection);

    expect(() => selectAllIn(host)).not.toThrow();
    expect(selection.addRange).toHaveBeenCalledTimes(1);
  });

  it('does not call removeAllRanges or addRange when no selection exists', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(null);

    selectAllIn(host);
    // Should return early without error
  });
});

describe('contenteditable selection offsets', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    host.contentEditable = 'true';
    host.innerHTML = '<span>Alpha </span><strong>beta</strong>';
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    window.getSelection()?.removeAllRanges();
  });

  it('reads offsets across nested text nodes in UTF-16 code units', () => {
    const first = host.querySelector('span')!.firstChild!;
    const second = host.querySelector('strong')!.firstChild!;

    expect(textOffsetAt(host, first, 2)).toBe(2);
    expect(textOffsetAt(host, second, 2)).toBe(8);
    expect(textOffsetAt(host, host, 2)).toBe(10);
    expect(textOffsetAt(host, document.body, 0)).toBeNull();
  });

  it('preserves reverse selection direction when setting flattened offsets', () => {
    expect(setTextSelectionOffsets(host, 8, 2)).toBe(true);

    const selection = host.ownerDocument.getSelection()!;
    expect(textOffsetAt(host, selection.anchorNode, selection.anchorOffset)).toBe(8);
    expect(textOffsetAt(host, selection.focusNode, selection.focusOffset)).toBe(2);
    expect(selection.toString()).toBe('pha be');
  });

  it('preserves reverse direction with Selection.extend when setBaseAndExtent is unavailable', () => {
    const selection = host.ownerDocument.getSelection()!;
    Object.defineProperty(selection, 'setBaseAndExtent', { configurable: true, value: undefined });

    try {
      expect(setTextSelectionOffsets(host, 8, 2)).toBe(true);
      expect(textOffsetAt(host, selection.anchorNode, selection.anchorOffset)).toBe(8);
      expect(textOffsetAt(host, selection.focusNode, selection.focusOffset)).toBe(2);
      expect(selection.toString()).toBe('pha be');
    } finally {
      Reflect.deleteProperty(selection, 'setBaseAndExtent');
    }
  });
});

describe('contenteditable-text: known limitations (tripwires)', () => {
  it.fails('tripwire: insertPlainTextAtCaret does not handle startOffset beyond textContent length gracefully', () => {
    const host = document.createElement('div');
    host.textContent = 'abc';
    document.body.appendChild(host);

    const range = document.createRange();
    range.setStart(host.firstChild!, 100);
    range.setEnd(host.firstChild!, 100);

    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    } as unknown as Selection;

    vi.spyOn(window, 'getSelection').mockReturnValue(selection);

    expect(() => insertPlainTextAtCaret(host, 'x')).not.toThrow();

    host.remove();
  });
});
