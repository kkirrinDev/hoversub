// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackLayers } from '../src/tracks';
class FakeCue {
  getCueAsHTML() { const fragment = document.createDocumentFragment(); fragment.append(document.createTextNode('The dragon flies.')); return fragment; }
}
class FakeTrack extends EventTarget {
  kind = 'subtitles'; mode: TextTrackMode = 'showing'; activeCues = [new FakeCue()];
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('VTTCue', FakeCue);
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function player() {
  const video = document.createElement('video'); document.body.append(video);
  const track = new FakeTrack();
  const list = Object.assign(new EventTarget(), { 0: track, length: 1 });
  Object.defineProperty(video, 'textTracks', { value: list });
  return { video, track, list };
}
describe('native subtitle layer', () => {
  it('mirrors active cues and restores native captions on disable without controlling playback', () => {
    const { video, track } = player(); const pause = vi.spyOn(video, 'pause'); const play = vi.spyOn(video, 'play');
    const layers = new TrackLayers();
    expect(track.mode).toBe('hidden'); expect(document.querySelector('[data-hoversub-ui="tracks"]')?.textContent).toBe('The dragon flies.');
    layers.dispose(); expect(track.mode).toBe('showing'); expect(document.querySelector('[data-hoversub-ui="tracks"]')).toBeNull();
    expect(pause).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled();
  });
  it('does not re-enable subtitles explicitly disabled by the user', () => {
    const { track, list } = player(); const layers = new TrackLayers(); track.mode = 'disabled'; list.dispatchEvent(new Event('change'));
    expect(document.querySelector('[data-hoversub-ui="tracks"]')?.textContent).toBe('');
    layers.dispose(); expect(track.mode).toBe('disabled');
  });
  it('removes stale cues when the source changes', () => {
    const { track } = player(); const layers = new TrackLayers(); track.activeCues = []; track.dispatchEvent(new Event('cuechange'));
    expect(document.querySelector('[data-hoversub-ui="tracks"]')?.textContent).toBe(''); layers.dispose();
  });
});
