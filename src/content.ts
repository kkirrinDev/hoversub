import { type ProviderId, type ActiveConfig, type TranslationResult } from './shared';
import { hitCaption, hitWord, stillValid, type WordTarget } from './detection';
import { TranslationCard } from './card';
import { TrackLayers } from './tracks';
import { HoverPause, videoAtWord } from './playback';

// Injection is repeated on enable/navigation: one listener/controller per frame.
const global = globalThis as typeof globalThis & { __hoverSubInstalled?: boolean };
if (!global.__hoverSubInstalled) {
  global.__hoverSubInstalled = true;
  let dispose: (() => void) | undefined;
  let configKey = '';
  let generation = 0;
  let controller: ReturnType<typeof activate> | undefined;
  async function refresh() {
    const version = ++generation;
    const config = await browser.runtime.sendMessage({ type: 'active' }) as ActiveConfig;
    if (version !== generation) return;
    const key = JSON.stringify(config);
    if (key === configKey) return;
    configKey = key; dispose?.(); dispose = undefined; controller = undefined;
    if (config.active) { controller = activate(config.autoPause, config.provider); dispose = controller.dispose; }
  }
  browser.runtime.onMessage.addListener((msg: unknown) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return undefined;
    if (msg.type === 'refresh') { void refresh().catch(() => {}); return Promise.resolve({ ok: true }); }
    if (msg.type === 'select-region' && controller) { controller.pick(); return Promise.resolve({ ok: true }); }
    if (msg.type === 'reset-region' && controller) { controller.reset(); return Promise.resolve({ ok: true }); }
    if (msg.type === 'status') return Promise.resolve({ active: Boolean(controller), frame: location.origin });
    return undefined;
  });
  window.addEventListener('pageshow', () => { void refresh().catch(() => {}); });
  window.addEventListener('pagehide', () => { dispose?.(); dispose = undefined; controller = undefined; configKey = ''; });
  void refresh().catch(() => {});
}

function activate(autoPause: boolean, provider: ProviderId) {
  const playback = new HoverPause();
  const card = new TranslationCard(provider);
  let target: WordTarget | null = null;
  let scope: Element | null = null;
  let hoverTimer = 0;
  let closeTimer = 0;
  let raf = 0;
  let sequence = 0;
  let insideCard = false;
  let picking = false;
  let pointer = { x: 0, y: 0 };
  let destroyed = false;
  const tracks = new TrackLayers(() => { if (target && !stillValid(target)) clear(); if (scope && !scope.isConnected) scope = null; });
  const banner = document.createElement('div');
  banner.dataset.hoversubUi = 'picker';
  banner.textContent = 'HoverSub · Нажмите на область субтитров. Esc — отмена.';
  banner.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#182b2a;color:#ddf7b1;padding:14px 20px;border-radius:10px;font:15px "Segoe UI",sans-serif;pointer-events:none;';
  const outline = document.createElement('div');
  outline.dataset.hoversubUi = 'selection';
  outline.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #b9e779;border-radius:4px;box-sizing:border-box;';
  const observer = new MutationObserver(() => { if (target && !stillValid(target)) clear(); if (scope && !scope.isConnected) scope = null; });
  const cancel = () => { void browser.runtime.sendMessage({ type: 'cancel' }).catch(() => {}); };
  function clear(keepPause = false, resume = true) {
    if (!keepPause) playback.release(resume);
    sequence++; window.clearTimeout(hoverTimer); window.clearTimeout(closeTimer);
    hoverTimer = 0; closeTimer = 0; target = null; insideCard = false;
    observer.disconnect(); card.hide(); outline.remove(); cancel();
  }
  function scheduleClose() {
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => { if (!insideCard) clear(); }, 300);
  }
  function highlight(rect: DOMRect) {
    outline.style.left = `${rect.left}px`; outline.style.top = `${rect.top}px`;
    outline.style.width = `${rect.width}px`; outline.style.height = `${rect.height}px`;
    (document.fullscreenElement ?? document.documentElement).append(outline);
  }
  async function translate() {
    const current = target;
    if (!current || !stillValid(current)) { clear(); return; }
    const version = ++sequence;
    if (autoPause) playback.hold(videoAtWord(current.node, current.rect));
    highlight(current.rect);
    card.show(current.word, 'Переводим…', current.rect);
    try {
      const result = await browser.runtime.sendMessage({ type: 'translate', word: current.word }) as TranslationResult;
      if (destroyed || version !== sequence || target !== current || !stillValid(current)) return;
      card.show(current.word, result.ok ? result.text : result.error, current.rect, !result.ok, result.ok && result.cached);
    } catch {
      if (!destroyed && version === sequence && target === current) card.show(current.word, 'Расширение обновилось. Перезагрузите страницу.', current.rect, true);
    }
  }
  function move(event: PointerEvent) {
    if (card.contains(event)) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (picking) {
        const element = document.elementFromPoint(pointer.x, pointer.y);
        if (element) highlight(element.getBoundingClientRect());
        return;
      }
      // Caption geometry takes precedence over text rendered beneath a caption.
      const found = hitCaption(pointer.x, pointer.y, scope) ?? hitWord(pointer.x, pointer.y, scope);
      if (!found) { window.clearTimeout(hoverTimer); hoverTimer = 0; if (target) scheduleClose(); return; }
      window.clearTimeout(closeTimer);
      if (target?.node === found.node && target.range.startOffset === found.range.startOffset && stillValid(target)) {
        if (!hoverTimer && !outline.isConnected) hoverTimer = window.setTimeout(() => { hoverTimer = 0; void translate(); }, 250);
        return;
      }
      // Moving between words in one player keeps the same pause session.
      clear(true); target = found;
      if (autoPause) playback.retain(videoAtWord(found.node, found.rect));
      // Observe the local caption container, not the entire document.
      const parent = found.node.parentElement!;
      observer.observe(parent.parentElement ?? parent, { childList: true, subtree: true, characterData: true });
      hoverTimer = window.setTimeout(() => { hoverTimer = 0; void translate(); }, 250);
    });
  }
  function endPick() { picking = false; banner.remove(); outline.remove(); }
  function click(event: MouseEvent) {
    if (!picking) return;
    const element = event.composedPath().find(n => n instanceof Element) as Element | undefined;
    if (!element || element.closest('[data-hoversub-ui]')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    scope = element; endPick(); clear();
  }
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape') { endPick(); clear(); return; }
    if (event.isTrusted && [' ', 'k', 'K', 'MediaPlayPause', 'ArrowLeft', 'ArrowRight'].includes(event.key)) playback.userAction();
  }
  const userAction = (event: PointerEvent) => { if (event.isTrusted && !card.contains(event)) playback.userAction(); };
  const leave = (event: MouseEvent) => { if (!event.relatedTarget) clear(); };
  const hide = () => clear(false, false);
  const visibility = () => { if (document.hidden) clear(false, false); };
  card.onEnter = () => { insideCard = true; window.clearTimeout(closeTimer); };
  card.onLeave = () => { insideCard = false; scheduleClose(); };
  card.onRetry = () => { void translate(); };
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerdown', userAction, true);
  document.addEventListener('mouseout', leave);
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', key, true);
  document.addEventListener('fullscreenchange', hide);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('yt-navigate-start', hide);
  window.addEventListener('popstate', hide);
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);
  window.addEventListener('scroll', hide, true);
  return {
    pick() { clear(); picking = true; (document.fullscreenElement ?? document.documentElement).append(banner); },
    reset() { scope = null; endPick(); clear(); },
    dispose() {
      destroyed = true; clear(false, false); endPick(); cancelAnimationFrame(raf); card.destroy(); tracks.dispose();
      document.removeEventListener('pointermove', move); document.removeEventListener('mouseout', leave);
      document.removeEventListener('pointerdown', userAction, true);
      document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true);
      document.removeEventListener('fullscreenchange', hide); document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('yt-navigate-start', hide); window.removeEventListener('popstate', hide);
      window.removeEventListener('blur', hide); window.removeEventListener('resize', hide); window.removeEventListener('scroll', hide, true);
    },
  };
}
