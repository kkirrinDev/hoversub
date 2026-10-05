// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HoverPause, videoAtWord } from '../src/playback';
import { normalizeSettings } from '../src/shared';
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function player(initiallyPaused = false) {
  const video = document.createElement('video'); document.body.append(video);
  let paused = initiallyPaused;
  Object.defineProperty(video, 'paused', { get: () => paused });
  const pause = vi.spyOn(video, 'pause').mockImplementation(() => { paused = true; video.dispatchEvent(new Event('pause')); });
  const play = vi.spyOn(video, 'play').mockImplementation(async () => { paused = false; video.dispatchEvent(new Event('play')); });
  return { video, pause, play };
}
describe('optional hover pause', () => {
  it('migrates old settings with pause off and accepts only a boolean', () => {
    expect(normalizeSettings({}).autoPause).toBe(false);
    expect(normalizeSettings({ autoPause: 'true' }).autoPause).toBe(false);
    expect(normalizeSettings({ autoPause: true }).autoPause).toBe(true);
  });
  it('pauses once across adjacent words and resumes exactly once on leave', () => {
    const { video, pause, play } = player(); const controller = new HoverPause();
    controller.hold(video); controller.retain(video); controller.hold(video);
    expect(pause).toHaveBeenCalledTimes(1); expect(play).not.toHaveBeenCalled();
    controller.release(); controller.release(); expect(play).toHaveBeenCalledTimes(1);
  });
  it('never resumes a video that the user had already paused', () => {
    const { video, pause, play } = player(true); const controller = new HoverPause();
    controller.hold(video); controller.release(); expect(pause).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled();
  });
  it('gives control back after manual actions without pausing again on the next word', () => {
    const { video, pause, play } = player(); const controller = new HoverPause();
    controller.hold(video); controller.userAction(); controller.hold(video); controller.release();
    expect(pause).toHaveBeenCalledTimes(1); expect(play).not.toHaveBeenCalled();
  });
  it.each(['seeking', 'emptied', 'ended', 'play', 'ratechange'])('does not resume after %s', event => {
    const { video, play } = player(); const controller = new HoverPause(); controller.hold(video);
    video.dispatchEvent(new Event(event)); controller.release(); expect(play).not.toHaveBeenCalled();
  });
  it('does not resume on disable, blur, or removed video', () => {
    const a = player(); const controller = new HoverPause(); controller.hold(a.video); controller.release(false); expect(a.play).not.toHaveBeenCalled();
    const b = player(); controller.hold(b.video); b.video.remove(); controller.release(); expect(b.play).not.toHaveBeenCalled();
  });
  it('does not resume a replaced source even if no media event was dispatched', () => {
    const { video, play } = player(); const controller = new HoverPause(); controller.hold(video);
    Object.defineProperty(video, 'currentSrc', { value: 'https://other.example/video' }); controller.release(); expect(play).not.toHaveBeenCalled();
  });
  it('handles rejected play without retrying or unhandled rejection', async () => {
    const { video, play } = player(); play.mockRejectedValue(new Error('NotAllowedError'));
    const controller = new HoverPause(); controller.hold(video); controller.release(); await Promise.resolve();
    expect(play).toHaveBeenCalledTimes(1);
  });
  it('does not select an unrelated player or guess between overlapping videos', () => {
    const { video } = player(); const text = document.createTextNode('dragon'); document.body.append(text);
    const rect = { left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 } as DOMRect;
    vi.spyOn(video, 'getBoundingClientRect').mockReturnValue(rect);
    expect(videoAtWord(text, { left: 10, top: 10, width: 60, height: 20 } as DOMRect)).toBe(video);
    expect(videoAtWord(text, { left: 10, top: 300, width: 60, height: 20 } as DOMRect)).toBeNull();
    const second = player(); vi.spyOn(second.video, 'getBoundingClientRect').mockReturnValue(rect);
    expect(videoAtWord(text, { left: 10, top: 10, width: 60, height: 20 } as DOMRect)).toBeNull();
  });
});
