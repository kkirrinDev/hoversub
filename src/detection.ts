import { wordAt } from './shared';
export interface WordTarget { word: string; range: Range; node: Text; snapshot: string; rect: DOMRect }
const EXCLUDED = 'input, textarea, select, button, [contenteditable]:not([contenteditable="false"]), [data-hoversub-ui]:not([data-hoversub-ui="tracks"])';
export function hitWord(x: number, y: number, scope: Element | null = null): WordTarget | null {
  const element = document.elementFromPoint(x, y);
  if (!element || element.closest(EXCLUDED)) return null;
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number, options?: { shadowRoots: ShadowRoot[] }) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null };
  const roots: ShadowRoot[] = [];
  let deep: Element | null = element;
  while (deep?.shadowRoot) { roots.push(deep.shadowRoot); const child: Element | null = deep.shadowRoot.elementFromPoint(x, y); if (!child || child === deep) break; deep = child; }
  const caret = doc.caretPositionFromPoint?.(x, y, { shadowRoots: roots });
  const fallback = caret ? null : doc.caretRangeFromPoint?.(x, y);
  const node = caret?.offsetNode ?? fallback?.startContainer;
  const offset = caret?.offset ?? fallback?.startOffset ?? 0;
  if (!(node instanceof Text) || !node.parentElement || node.parentElement.closest(EXCLUDED)) return null;
  if (scope && !scope.contains(node)) return null;
  const style = getComputedStyle(node.parentElement);
  if (style.visibility !== 'visible' || style.opacity === '0') return null;
  const token = wordAt(node.data, offset);
  if (!token) return null;
  const range = document.createRange(); range.setStart(node, token.start); range.setEnd(node, token.end);
  const rects = Array.from(range.getClientRects());
  const rect = rects.find(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  if (!rect) return null;
  return { word: token.word, range, node, snapshot: node.data, rect };
}
export function stillValid(target: WordTarget) { return target.node.isConnected && target.node.data === target.snapshot && target.range.toString() === target.word; }

// Some caption renderers (including YouTube) set pointer-events:none, so the
// browser's caret hit-test sees the video underneath. Inspect bounded caption
// containers by geometry, without modifying a site's text nodes.
export function hitCaption(x: number, y: number, scope: Element | null): WordTarget | null {
  const containers = scope ? [scope] : Array.from(document.querySelectorAll('.ytp-caption-segment, .vjs-text-track-cue, .jw-text-track-cue, [data-hoversub-ui="tracks"]'));
  let budget = 250;
  for (const container of containers) {
    const box = container.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom || container.closest(EXCLUDED)) continue;
    if (getComputedStyle(container).visibility !== 'visible' || getComputedStyle(container).opacity === '0') continue;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode()) && budget-- > 0) {
      if (!(node instanceof Text) || node.parentElement?.closest(EXCLUDED)) continue;
      for (const match of node.data.matchAll(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu)) {
        const token = wordAt(node.data, match.index);
        if (!token) continue;
        const range = document.createRange(); range.setStart(node, token.start); range.setEnd(node, token.end);
        const rect = Array.from(range.getClientRects()).find(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
        if (rect) return { word: token.word, range, node, snapshot: node.data, rect };
      }
    }
  }
  return null;
}
