import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_VERSION } from '../src/shared';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const website = { url: 'https://video.example/frame', tab: { id: 1, url: 'https://video.example/' }, frameId: 0 };
const options = { url: 'moz-extension://test/options.html' };
async function setup(initial: Record<string, unknown>) {
  vi.resetModules(); const data = { ...initial };
  let listener: (message: unknown, sender: object) => Promise<unknown>;
  const addListener = vi.fn();
  vi.stubGlobal('browser', {
    storage: { local: { get: vi.fn().mockResolvedValue(data), set: vi.fn(async values => { Object.assign(data, values); }), remove: vi.fn(async key => { delete data[key]; }) } },
    permissions: { getAll: vi.fn().mockResolvedValue({ origins: [] }), contains: vi.fn().mockResolvedValue(true), onAdded: { addListener }, onRemoved: { addListener } },
    scripting: { getRegisteredContentScripts: vi.fn().mockResolvedValue([]) },
    runtime: { getURL: () => 'moz-extension://test/', onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
    tabs: { query: vi.fn().mockResolvedValue([]), onRemoved: { addListener }, onUpdated: { addListener } },
  });
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); await import('../src/background');
  return { send: (message: unknown, sender = options) => listener!(message, sender), data, fetcher };
}
describe('background authorization', () => {
  it('resets old-provider consent and cache, preserving languages and site choices', async () => {
    const { send, data, fetcher } = await setup({ settings: { consent: true, target: 'de', enabledOrigins: ['https://video.example'] }, cache: [{ key: 'en:de:dragon', text: 'old', time: Date.now() }] });
    const result = await send({ type: 'state' });
    expect(result).toMatchObject({ settings: { consent: false, target: 'de', enabledOrigins: ['https://video.example'] }, cacheSize: 0, hasApiKey: false });
    expect(data.providerVersion).toBe(PROVIDER_VERSION); expect(fetcher).not.toHaveBeenCalled();
  });
  it('never exposes the saved key in state or active messages, and denies page key writes', async () => {
    const secret = 'FAKE_TEST_KEY_123456789012345';
    const { send, data } = await setup({ providerVersion: PROVIDER_VERSION, googleApiKey: secret, settings: { provider: 'google', consents: { google: true }, consent: true, enabledOrigins: ['https://video.example'] } });
    const state = await send({ type: 'state' }); const active = await send({ type: 'active' }, website);
    expect(state).toMatchObject({ hasApiKey: true }); expect(active).toMatchObject({ active: true });
    expect(JSON.stringify([state, active])).not.toContain(secret);
    expect(await send({ type: 'google-key', key: '' }, website)).toMatchObject({ ok: false }); expect(data.googleApiKey).toBe(secret);
  });
  it('deleting the key clears cache but preserves usage; no network without a key', async () => {
    const usage = { month: new Date().toISOString().slice(0, 7), characters: 123 };
    const { send, data, fetcher } = await setup({ providerVersion: PROVIDER_VERSION, googleApiKey: 'FAKE_TEST_KEY_123456789012345', googleUsage: usage, settings: { provider: 'google', consents: { google: true }, consent: true, enabledOrigins: ['https://video.example'] } });
    expect(await send({ type: 'google-key', key: '' })).toMatchObject({ ok: true });
    expect(data.googleUsage).toEqual(usage); expect(data.googleApiKey).toBe('');
    expect(await send({ type: 'translate', word: 'dragon' }, website)).toMatchObject({ ok: false }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects content-script settings changes and translation without consent', async () => {
    vi.resetModules();
    let listener: (message: unknown, sender: object) => Promise<unknown>;
    const addListener = vi.fn();
    vi.stubGlobal('browser', {
      storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn() } },
      permissions: { getAll: vi.fn().mockResolvedValue({ origins: [] }), contains: vi.fn().mockResolvedValue(true), onAdded: { addListener }, onRemoved: { addListener } },
      scripting: { getRegisteredContentScripts: vi.fn().mockResolvedValue([]) },
      runtime: { getURL: () => 'moz-extension://test/', onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
      tabs: { onRemoved: { addListener }, onUpdated: { addListener } },
    });
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await import('../src/background');
    const sender = { url: 'https://video.example/frame', tab: { id: 1, url: 'https://video.example/' }, frameId: 0 };
    expect(await listener!({ type: 'settings', consent: true }, sender)).toMatchObject({ ok: false });
    expect(await listener!({ type: 'translate', word: 'dragon' }, sender)).toMatchObject({ ok: false });
    expect(await listener!({ type: 'active' }, sender)).toMatchObject({ active: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('provider selection', () => {
  it('migrates Google selection, key and consent without granting MyMemory consent', async () => {
    const { send } = await setup({ providerVersion: 'google-cloud-v2', googleApiKey: 'FAKE_TEST_KEY_123456789012345', settings: { consent: true } });
    expect(await send({ type: 'state' })).toMatchObject({ hasApiKey: true, settings: { provider: 'google', consent: true, consents: { google: true, mymemory: false } } });
    await send({ type: 'provider', provider: 'mymemory' });
    expect(await send({ type: 'state' })).toMatchObject({ settings: { provider: 'mymemory', consent: false } });
    expect(await send({ type: 'settings', provider: 'google', consent: true })).toMatchObject({ ok: false });
    await send({ type: 'provider', provider: 'google' });
    expect(await send({ type: 'state' })).toMatchObject({ settings: { consent: true } });
  });
  it('routes only to the selected service, isolates cache, and counts only Google usage', async () => {
    const secret = 'FAKE_TEST_KEY_123456789012345';
    const { send, fetcher } = await setup({ providerVersion: PROVIDER_VERSION, googleApiKey: secret, settings: { provider: 'google', consents: { google: true, mymemory: true } } });
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { translations: [{ translatedText: 'google result' }] } }) });
    expect(await send({ type: 'test' })).toMatchObject({ ok: true, text: 'google result', cached: false });
    await send({ type: 'provider', provider: 'mymemory' });
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'memory result' } }) });
    expect(await send({ type: 'test' })).toMatchObject({ ok: true, text: 'memory result', cached: false });
    expect(fetcher.mock.calls[1][0]).toContain('https://api.mymemory.translated.net/get?');
    expect(JSON.stringify(fetcher.mock.calls[1])).not.toContain(secret);
    expect(await send({ type: 'state' })).toMatchObject({ usage: { characters: 6 } });
    await send({ type: 'provider', provider: 'google' });
    expect(await send({ type: 'test' })).toMatchObject({ text: 'google result', cached: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('works without a Google key and does not fall back on MyMemory quota failure', async () => {
    const { send, fetcher } = await setup({ providerVersion: PROVIDER_VERSION, settings: { provider: 'mymemory', consents: { mymemory: true } } });
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ responseStatus: 429, quotaFinished: true, responseData: { translatedText: 'quota text must not become a translation' } }) });
    expect(await send({ type: 'test' })).toMatchObject({ ok: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await send({ type: 'state' })).toMatchObject({ cacheSize: 0, usage: { characters: 0 } });
    expect(await send({ type: 'provider', provider: 'google' }, website)).toMatchObject({ ok: false });
  });
});

it('switching providers aborts pending work and prevents an old result entering cache', async () => {
  const { send, fetcher } = await setup({ providerVersion: PROVIDER_VERSION, settings: { provider: 'mymemory', consents: { mymemory: true } } });
  let signal: AbortSignal | undefined;
  let finish: ((value: unknown) => void) | undefined;
  fetcher.mockImplementation((_url, init) => { signal = init.signal; return new Promise(resolve => { finish = resolve; }); });
  const pending = send({ type: 'test' });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await send({ type: 'provider', provider: 'google' });
  expect(signal?.aborted).toBe(true);
  expect(await pending).toMatchObject({ ok: false });
  finish!({ ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'stale' } }) });
  await Promise.resolve(); await Promise.resolve();
  expect(await send({ type: 'state' })).toMatchObject({ cacheSize: 0, settings: { provider: 'google', consent: false } });
});
