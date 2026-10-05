import { PROVIDERS, type ProviderId } from './shared';
export class TranslationCard {
  readonly host = document.createElement('div');
  readonly root: ShadowRoot;
  private box = document.createElement('section');
  private title = document.createElement('strong');
  private body = document.createElement('p');
  private foot = document.createElement('small');
  private retry = document.createElement('button');
  onEnter = () => {};
  onLeave = () => {};
  onRetry = () => {};
  constructor(private provider: ProviderId = 'google') {
    this.host.dataset.hoversubUi = 'card';
    this.host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
    this.root = this.host.attachShadow({ mode: 'open' });
    const css = document.createElement('style');
    css.textContent = `:host{color-scheme:dark}section{position:fixed;box-sizing:border-box;width:max-content;max-width:min(310px,calc(100vw - 16px));padding:15px 18px;background:#182b2a;color:#faf8ef;border:1px solid #58716a;border-radius:13px;box-shadow:0 10px 32px #0006;font:15px/1.4 'Segoe UI',sans-serif;pointer-events:auto;overflow-wrap:anywhere}strong{font:600 13px/1.4 'Segoe UI',sans-serif;color:#c6daa8}p{margin:5px 0 9px;font-size:20px;font-weight:600}small{display:block;font-size:11px;color:#b3c2bb}button{margin-top:10px;color:#182b2a;background:#ddf7b1;border:0;border-radius:6px;padding:6px 10px;cursor:pointer}button:focus-visible{outline:2px solid white;outline-offset:3px}[hidden]{display:none!important}`;
    this.box.setAttribute('role', 'status'); this.box.setAttribute('aria-live', 'polite');
    this.retry.textContent = 'Повторить'; this.retry.addEventListener('click', () => this.onRetry());
    this.box.append(this.title, this.body, this.foot, this.retry); this.root.append(css, this.box);
    this.box.addEventListener('pointerenter', () => this.onEnter()); this.box.addEventListener('pointerleave', () => this.onLeave());
    this.hide();
  }
  mount() {
    const parent = document.fullscreenElement ?? document.documentElement;
    if (this.host.parentNode !== parent) parent.append(this.host);
  }
  show(word: string, text: string, rect: DOMRect, error = false, cached = false) {
    this.mount(); this.box.hidden = false; this.title.textContent = word; this.body.textContent = text;
    this.foot.textContent = error ? 'Можно повторить запрос' : `${cached ? 'Из кэша ' : ''}${PROVIDERS[this.provider]} · без учёта контекста`;
    this.retry.hidden = !error;
    this.box.style.left = '0px'; this.box.style.top = '0px';
    const size = this.box.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - size.width / 2, innerWidth - size.width - 8));
    const top = rect.top - size.height - 10 >= 8 ? rect.top - size.height - 10 : Math.min(rect.bottom + 10, innerHeight - size.height - 8);
    this.box.style.left = `${left}px`; this.box.style.top = `${Math.max(8, top)}px`;
  }
  hide() { this.box.hidden = true; }
  destroy() { this.host.remove(); }
  contains(event: Event) { return event.composedPath().includes(this.host); }
}
