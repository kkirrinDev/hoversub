import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationBroker, TranslationCache, translateWord } from '../src/translation';
import { normalizeSettings, originOf, pattern, validWord, wordAt } from '../src/shared';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('word selection and settings validation', () => {
  it('keeps contractions and hyphens, ignores punctuation and spaces', () => {
    expect(wordAt("don't, well-known!", 3)?.word).toBe("don't");
    expect(wordAt("don't, well-known!", 10)?.word).toBe('well-known');
    expect(wordAt('word   next', 6)).toBeNull();
    expect(validWord('<img src=x>')).toBe(false);
    expect(validWord('two words')).toBe(false);
    expect(validWord('étoile')).toBe(true);
  });
  it('rejects nonweb origins and untrusted settings', () => {
    expect(originOf('about:config')).toBeNull();
    expect(pattern('http://localhost:4173')).toBe('http://localhost/*');
    expect(normalizeSettings({ consent: 'true', target: '__proto__', enabledOrigins: ['https://example.org/path', 'https://example.org', 'https://example.org'] })).toEqual({ provider: 'mymemory', consents: { google: false, mymemory: false }, consent: false, autoPause: false, source: 'en', target: 'ru', enabledOrigins: ['https://example.org'] });
  });
});
describe('bounded cache', () => {
  it('expires, preserves recency and limits persistence to 1000 entries', () => {
    let now = 0; const cache = new TranslationCache([], () => now);
    for (let i = 0; i < 1000; i++) cache.set(String(i), String(i));
    cache.get('0'); cache.set('1000', 'new');
    expect(cache.get('1')).toBeUndefined(); expect(cache.get('0')).toBe('0'); expect(cache.dump()).toHaveLength(1000);
    now = 7 * 24 * 3600 * 1000;
    expect(cache.get('0')).toBeUndefined();
  });
});
describe('real provider contract', () => {
  it('sends only a word and languages, without cookies or referrer', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { translations: [{ translatedText: 'дракон' }] } }) });
    vi.stubGlobal('fetch', fetcher);
    expect(await translateWord('dragon', 'en', 'ru', new AbortController().signal, 'test-key')).toBe('дракон');
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://translation.googleapis.com/language/translate/v2');
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', headers: { 'X-Goog-Api-Key': 'test-key' } });
    expect(JSON.parse(options.body)).toEqual({ q: 'dragon', source: 'en', target: 'ru', format: 'text', model: 'nmt' });
    expect(options.body).not.toContain('test-key');
  });
  it('recognizes Google daily quota errors returned as HTTP 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { errors: [{ reason: 'dailyLimitExceeded' }] } }) }));
    await expect(translateWord('dragon', 'en', 'ru', new AbortController().signal, 'test-key')).rejects.toThrow('Квота');
  });
  it('rejects malformed responses rather than showing undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ responseStatus: 200 }) }));
    await expect(translateWord('dragon', 'en', 'ru', new AbortController().signal, 'test-key')).rejects.toThrow('некорректный');
  });
  it('does not send a request without a key', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(translateWord('dragon', 'en', 'ru', new AbortController().signal, '')).rejects.toThrow('API-ключ');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not echo API error details or credentials to the content script', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { message: 'secret-key-and-user-data' } }) }));
    await expect(translateWord('dragon', 'en', 'ru', new AbortController().signal, 'secret-key')).rejects.toThrow('отказал в доступе');
  });
  it('decodes entities as text without interpreting HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { translations: [{ translatedText: 'don&#39;t &amp; &lt;img&gt;' }] } }) }));
    expect(await translateWord('dragon', 'en', 'ru', new AbortController().signal, 'test-key')).toBe("don't & <img>");
  });
});
function deferredProvider() {
  const pending: { word: string; signal: AbortSignal; resolve: (s: string) => void }[] = [];
  const provider = vi.fn((word: string, _source: string, _target: string, signal: AbortSignal) => new Promise<string>((resolve, reject) => {
    pending.push({ word, signal, resolve }); signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  return { pending, provider };
}
describe('request lifecycle', () => {
  it('deduplicates simultaneous requests and caches subsequent translations', async () => {
    const { pending, provider } = deferredProvider(); const broker = new TranslationBroker(new TranslationCache(), provider);
    const a = broker.request('frame1', 'dragon', 'en', 'ru'); const b = broker.request('frame2', 'dragon', 'en', 'ru');
    expect(provider).toHaveBeenCalledTimes(1); pending[0].resolve('дракон');
    expect((await a).ok).toBe(true); expect((await b).ok).toBe(true);
    expect(await broker.request('frame3', 'dragon', 'en', 'ru')).toEqual({ ok: true, text: 'дракон', cached: true });
  });
  it('cancels the old word without cancelling another frame using it', async () => {
    const { pending, provider } = deferredProvider(); const broker = new TranslationBroker(new TranslationCache(), provider);
    const a = broker.request('frame1', 'dragon', 'en', 'ru'); const shared = broker.request('frame2', 'dragon', 'en', 'ru');
    const next = broker.request('frame1', 'castle', 'en', 'ru');
    expect((await a).ok).toBe(false); expect(pending[0].signal.aborted).toBe(false);
    pending[1].resolve('замок'); pending[0].resolve('дракон');
    expect(await next).toMatchObject({ text: 'замок' }); expect(await shared).toMatchObject({ text: 'дракон' });
  });
  it('limits concurrency to two and never runs a cancelled queued request', async () => {
    const { pending, provider } = deferredProvider(); const broker = new TranslationBroker(new TranslationCache(), provider);
    const a = broker.request('a', 'dragon', 'en', 'ru'); const b = broker.request('b', 'castle', 'en', 'ru'); const c = broker.request('c', 'queen', 'en', 'ru');
    expect(provider).toHaveBeenCalledTimes(2); broker.cancel('c'); expect((await c).ok).toBe(false);
    pending[0].resolve('дракон'); pending[1].resolve('замок'); await Promise.all([a, b]);
    expect(provider).toHaveBeenCalledTimes(2);
  });
  it('never persists private translations or mixes language pairs', async () => {
    const provider = vi.fn().mockResolvedValue('translation'); const cache = new TranslationCache(); const save = vi.fn(); const broker = new TranslationBroker(cache, provider, save);
    await broker.request('private', 'dragon', 'en', 'ru', true); expect(cache.dump()).toHaveLength(0); expect(save).not.toHaveBeenCalled();
    await broker.request('normal', 'dragon', 'en', 'ru'); await broker.request('normal', 'dragon', 'en', 'de'); expect(provider).toHaveBeenCalledTimes(3);
  });
  it('times out instead of retaining a loading card forever', async () => {
    vi.useFakeTimers(); const { provider } = deferredProvider(); const broker = new TranslationBroker(new TranslationCache(), provider);
    const result = broker.request('frame', 'dragon', 'en', 'ru'); await vi.advanceTimersByTimeAsync(5001);
    expect(await result).toMatchObject({ ok: false, error: expect.stringContaining('5 секунд') });
  });
  it('revoking consent cancels outstanding work and prevents cache writes', async () => {
    const { pending, provider } = deferredProvider(); const cache = new TranslationCache(); const broker = new TranslationBroker(cache, provider);
    const result = broker.request('frame', 'dragon', 'en', 'ru'); broker.cancelAll();
    expect(pending[0].signal.aborted).toBe(true); expect((await result).ok).toBe(false); expect(cache.dump()).toHaveLength(0);
  });
});
