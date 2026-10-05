// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hitWord, stillValid } from '../src/detection';
import { TranslationCard } from '../src/card';
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function fixture() {
  document.body.innerHTML = '<div id="caption">A dragon flies.</div><input value="dragon">';
  const div = document.getElementById('caption')!; const node = div.firstChild as Text;
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => div });
  Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true, value: () => ({ offsetNode: node, offset: 4 }) });
  const rect = { left: 20, top: 30, right: 100, bottom: 50, width: 80, height: 20, x: 20, y: 30, toJSON() {} };
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [rect] });
  return { div, node };
}
describe('DOM subtitle hit-testing', () => {
  it('finds the word without rewriting the site and rejects nearby whitespace', () => {
    const { node } = fixture();
    expect(hitWord(40, 40)?.word).toBe('dragon'); expect(node.data).toBe('A dragon flies.');
    expect(hitWord(150, 40)).toBeNull();
  });
  it('rejects editable text and respects a manually selected region', () => {
    const { div } = fixture(); div.setAttribute('contenteditable', 'true');
    expect(hitWord(40, 40)).toBeNull(); div.removeAttribute('contenteditable');
    expect(hitWord(40, 40, document.createElement('div'))).toBeNull();
  });
  it('invalidates translated words after subtitle replacement or removal', () => {
    const { node, div } = fixture(); const target = hitWord(40, 40)!;
    expect(stillValid(target)).toBe(true); node.data = 'The queen returns.'; expect(stillValid(target)).toBe(false);
    node.data = 'A dragon flies.'; const second = hitWord(40, 40)!; div.remove(); expect(stillValid(second)).toBe(false);
  });
});
describe('translation card safety', () => {
  it('renders provider output as text, never executable HTML', () => {
    const card = new TranslationCard();
    card.show('dragon', '<img src=x onerror=alert(1)>', { left: 10, top: 30, width: 50, bottom: 50 } as DOMRect);
    expect(card.root.querySelector('img')).toBeNull(); expect(card.root.querySelector('p')?.textContent).toContain('<img'); card.destroy();
  });
});
