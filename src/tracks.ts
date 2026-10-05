// Native WebVTT cues are not DOM text. Mirror only the user's showing track.
// Never start, stop, seek, or otherwise control the media element.
export class TrackLayers {
  private videos = new Map<HTMLVideoElement, { dispose: () => void; refresh: () => void }>();
  private observer: MutationObserver;
  private onFullscreen = () => { for (const state of this.videos.values()) state.refresh(); };
  constructor(onMutation: () => void = () => {}) {
    this.scan(document.documentElement);
    this.observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node instanceof Element && !node.closest('[data-hoversub-ui]')) this.scan(node);
      for (const [video, state] of this.videos) if (!video.isConnected) { state.dispose(); this.videos.delete(video); }
      onMutation();
    });
    this.observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('fullscreenchange', this.onFullscreen);
  }
  private scan(element: Element) {
    if (element instanceof HTMLVideoElement) this.attach(element);
    for (const video of element.querySelectorAll('video')) this.attach(video);
  }
  private attach(video: HTMLVideoElement) {
    if (this.videos.has(video)) return;
    const layer = document.createElement('div'); layer.dataset.hoversubUi = 'tracks';
    layer.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;text-align:center;white-space:pre-line;font:600 clamp(18px,2.2vw,30px)/1.5 "Segoe UI",sans-serif;color:white;text-shadow:0 2px 3px black;';
    const text = document.createElement('span');
    // This span intentionally remains hit-testable text, not excluded extension controls.
    text.style.cssText = 'pointer-events:auto;background:#000b;box-decoration-break:clone;padding:2px 6px;border-radius:3px;';
    layer.append(text);
    let selected: TextTrack | null = null;
    let owned = false;
    let rendering = false;
    const position = () => {
      const r = video.getBoundingClientRect();
      const fullscreen = document.fullscreenElement;
      const nativeVideoFullscreen = fullscreen === video;
      layer.hidden = nativeVideoFullscreen || !text.textContent || !r.width || !r.height;
      if (nativeVideoFullscreen) {
        if (selected && owned) { owned = false; selected.mode = 'showing'; }
        return;
      }
      const parent = fullscreen ?? document.documentElement;
      if (layer.parentNode !== parent) parent.append(layer);
      layer.style.left = `${r.left + r.width * .08}px`; layer.style.width = `${r.width * .84}px`;
      layer.style.top = `${Math.max(r.top, r.bottom - Math.max(70, r.height * .18) - layer.offsetHeight)}px`;
    };
    const render = () => {
      if (rendering) return;
      rendering = true;
      try {
        const showing = Array.from(video.textTracks).find(t => t.mode === 'showing' && ['subtitles', 'captions'].includes(t.kind));
        if (showing && showing !== selected) {
          if (selected) selected.removeEventListener('cuechange', render);
          selected = showing; owned = false; selected.addEventListener('cuechange', render);
        }
        if (selected?.mode === 'disabled') { selected.removeEventListener('cuechange', render); selected = null; owned = false; }
        if (selected && document.fullscreenElement !== video && selected.mode === 'showing') { owned = true; selected.mode = 'hidden'; }
        const cues = selected?.activeCues ? Array.from(selected.activeCues) : [];
        const value = cues.map(cue => cue instanceof VTTCue ? cue.getCueAsHTML().textContent ?? '' : '').join('\n');
        if (text.textContent !== value) text.textContent = value;
        position();
      } finally { rendering = false; }
    };
    const resize = new ResizeObserver(position); resize.observe(video);
    video.textTracks.addEventListener('change', render); video.textTracks.addEventListener('addtrack', render); video.textTracks.addEventListener('removetrack', render);
    video.addEventListener('loadedmetadata', render); video.addEventListener('emptied', render);
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    this.videos.set(video, { refresh: render, dispose: () => {
      video.textTracks.removeEventListener('change', render); video.textTracks.removeEventListener('addtrack', render); video.textTracks.removeEventListener('removetrack', render);
      selected?.removeEventListener('cuechange', render);
      if (selected && owned && selected.mode === 'hidden') selected.mode = 'showing';
      video.removeEventListener('loadedmetadata', render); video.removeEventListener('emptied', render);
      window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); resize.disconnect(); layer.remove();
    } });
    render();
  }
  dispose() { this.observer.disconnect(); document.removeEventListener('fullscreenchange', this.onFullscreen); for (const state of this.videos.values()) state.dispose(); this.videos.clear(); }
}
