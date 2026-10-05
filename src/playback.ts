/** Own only pauses we initiated. User/player actions always take precedence. */
export class HoverPause {
  private video: HTMLVideoElement | null = null;
  private owned = false;
  private source = '';
  private stream: HTMLVideoElement['srcObject'] = null;
  private revoke = () => { this.owned = false; };
  private events = ['play', 'playing', 'seeking', 'emptied', 'ended', 'abort', 'ratechange'];
  retain(video: HTMLVideoElement | null) { if (video !== this.video) this.release(); }
  hold(video: HTMLVideoElement | null) {
    if (video === this.video) return;
    this.release();
    if (!video || !video.isConnected || video.ended) return;
    this.video = video; this.source = video.currentSrc; this.stream = video.srcObject;
    for (const event of this.events) video.addEventListener(event, this.revoke);
    if (!video.paused && !video.seeking) {
      this.owned = true;
      try { video.pause(); } catch { this.owned = false; }
    }
  }
  userAction() { this.revoke(); }
  release(resume = true) {
    const video = this.video;
    const shouldResume = Boolean(resume && this.owned && video?.isConnected && video.paused && !video.ended && !video.seeking && video.currentSrc === this.source && video.srcObject === this.stream);
    if (video) for (const event of this.events) video.removeEventListener(event, this.revoke);
    this.video = null; this.owned = false;
    if (video && shouldResume) {
      try { void video.play().catch(() => {}); } catch { /* Autoplay denial: leave paused, never retry. */ }
    }
  }
}

// Do not pause an unrelated player just because ordinary page text is hovered.
export function videoAtWord(node: Text, rect: DOMRect): HTMLVideoElement | null {
  const root = node.getRootNode();
  const videos = root instanceof Document || root instanceof ShadowRoot ? Array.from(root.querySelectorAll('video')) : [];
  const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2;
  const matches = videos.filter(video => {
    const r = video.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  return matches.length === 1 ? matches[0] : null;
}
