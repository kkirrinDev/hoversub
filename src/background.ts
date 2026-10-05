import { API_ORIGIN, PROVIDER_VERSION, DEFAULT_SETTINGS, isProvider, isLanguage, normalizeSettings, originOf, pattern, validWord, type Settings } from './shared';
import { TranslationBroker, TranslationCache, translateMyMemory, translateWord } from './translation';
import { MONTHLY_LIMIT, MonthlyBudget } from './usage';

let settings: Settings = DEFAULT_SETTINGS;
let apiKey = '';
let budget: MonthlyBudget;
let persistence = Promise.resolve();
const broker = new TranslationBroker(new TranslationCache(), async (word, source, target, signal, provider) => {
  if (provider !== settings.provider || !settings.consents[provider]) throw new Error('Разрешите передачу слова выбранному сервису.');
  signal.throwIfAborted();
  if (provider === 'mymemory') return translateMyMemory(word, source, target, signal);
  const key = apiKey;
  if (!key) throw new Error('Добавьте Google Cloud API-ключ в настройках HoverSub.');
  if (!settings.consent) throw new Error('Разрешите передачу слова в Google Cloud.');
  signal.throwIfAborted();
  if (source !== target) await budget.reserve(word);
  signal.throwIfAborted();
  return translateWord(word, source, target, signal, key);
}, () => {
  const snapshot = broker.cache.dump();
  persistence = persistence.then(() => browser.storage.local.set({ cache: snapshot })).catch(() => {});
});
const ready = browser.storage.local.get(['settings', 'cache', 'providerVersion', 'googleApiKey', 'googleUsage']).then(async data => {
  settings = normalizeSettings(data.providerVersion === 'google-cloud-v2' ? { ...data.settings, provider: 'google', consents: { google: data.settings?.consent === true, mymemory: false } } : data.settings);
  apiKey = typeof data.googleApiKey === 'string' ? data.googleApiKey : '';
  budget = new MonthlyBudget(data.googleUsage, usage => browser.storage.local.set({ googleUsage: usage }));
  if (data.providerVersion !== PROVIDER_VERSION) {
    // Consent for the previous provider is not consent to disclose text to Google.
    if (data.providerVersion !== 'google-cloud-v2') settings = normalizeSettings({ ...settings, consents: {} });
    await browser.storage.local.set({ settings, providerVersion: PROVIDER_VERSION, cache: [] });
    await browser.storage.local.remove('cache');
  } else broker.cache = new TranslationCache(Array.isArray(data.cache) ? data.cache : []);
});
let registration = Promise.resolve();
function syncRegistration() {
  registration = registration.catch(() => {}).then(async () => {
    const granted = await browser.permissions.getAll();
    const matches = (granted.origins ?? []).filter(p => p !== API_ORIGIN && !p.includes('mymemory.translated.net') && /^https?:/.test(p));
    const existing = await browser.scripting.getRegisteredContentScripts({ ids: ['hoversub'] });
    if (existing.length) await browser.scripting.unregisterContentScripts({ ids: ['hoversub'] });
    if (matches.length) await browser.scripting.registerContentScripts([{ id: 'hoversub', matches, js: ['content.js'], allFrames: true, runAt: 'document_idle', persistAcrossSessions: true }]);
  });
  return registration;
}
async function activeFor(sender: browser.runtime.MessageSender) {
  await ready;
  const topOrigin = originOf(sender.tab?.url);
  const frameOrigin = originOf(sender.url);
  return Boolean(settings.consent && topOrigin && frameOrigin && settings.enabledOrigins.includes(topOrigin)
    && await browser.permissions.contains({ origins: [pattern(topOrigin), pattern(frameOrigin)] }));
}
async function broadcast() {
  const tabs = await browser.tabs.query({});
  await Promise.allSettled(tabs.filter(t => t.id !== undefined).map(t => browser.tabs.sendMessage(t.id!, { type: 'refresh' })));
}
async function inject(tabId: number) {
  // One inaccessible advertising/embedded frame must not block the top frame.
  const frames = await browser.webNavigation.getAllFrames({ tabId }).catch(() => null);
  const results = await Promise.allSettled((frames ?? []).map(async frame => {
    const origin = originOf(frame.url);
    if (!origin || !await browser.permissions.contains({ origins: [pattern(origin)] })) return false;
    await browser.scripting.executeScript({ target: { tabId, frameIds: [frame.frameId] }, files: ['content.js'] });
    return true;
  }));
  try { await browser.tabs.sendMessage(tabId, { type: 'refresh' }); } catch { /* No accessible document yet. */ }
  return results.some(result => result.status === 'fulfilled' && result.value);
}
async function saveSettings(next: Settings) {
  settings = normalizeSettings(next);
  broker.cancelAll();
  await browser.storage.local.set({ settings });
  await broadcast();
}
const ownPage = (sender: browser.runtime.MessageSender) => !sender.tab && Boolean(sender.url?.startsWith(browser.runtime.getURL('')));
browser.runtime.onMessage.addListener((raw: unknown, sender) => {
  if (!raw || typeof raw !== 'object' || !('type' in raw)) return undefined;
  const msg = raw as Record<string, unknown>;
  return (async () => {
    await ready;
    const owner = `${sender.tab?.id}:${sender.frameId ?? 0}`;
    if (msg.type === 'active') return { provider: settings.provider, active: (settings.provider !== 'google' || Boolean(apiKey)) && await activeFor(sender), source: settings.source, target: settings.target, autoPause: settings.autoPause };
    if (msg.type === 'cancel') { broker.cancel(owner); return { ok: true }; }
    if (msg.type === 'translate') {
      if (!validWord(msg.word) || !await activeFor(sender)) return { ok: false, error: 'Перевод выключен или нет разрешения.' };
      if (settings.provider === 'google' && !apiKey) return { ok: false, error: 'Добавьте Google Cloud API-ключ в настройках HoverSub.' };
      // Language and endpoint come from trusted settings, never from page messages.
      return broker.request(owner, msg.word, settings.source, settings.target, sender.tab?.incognito === true, settings.provider);
    }
    if (!ownPage(sender)) return { ok: false, error: 'Недоступная команда.' };
    if (msg.type === 'test') {
      if (!settings.consent) return { ok: false, error: 'Сначала разрешите отправку слова выбранному сервису.' };
      return broker.request('options-test', 'dragon', 'en', 'ru', false, settings.provider);
    }
    if (msg.type === 'state') return { settings, cacheSize: broker.cache.dump().length, hasApiKey: Boolean(apiKey), usage: budget.snapshot(), monthlyLimit: MONTHLY_LIMIT };
    if (msg.type === 'google-key') {
      if (typeof msg.key !== 'string') return { ok: false, error: 'Некорректный ключ.' };
      const key = msg.key.trim();
      if (key && !/^[A-Za-z0-9_-]{20,200}$/.test(key)) return { ok: false, error: 'Введите API-ключ Google Cloud, без пробелов и JSON-файла.' };
      broker.cancelAll();
      await browser.storage.local.set({ googleApiKey: key }); apiKey = key;
      broker.cache.clearGoogle(); await persistence; await browser.storage.local.set({ cache: broker.cache.dump() });
      await broadcast();
      return { ok: true };
    }
    if (msg.type === 'provider' && isProvider(msg.provider)) {
      await saveSettings({ ...settings, provider: msg.provider });
      return { ok: true };
    }
    if (msg.type === 'settings') {
      if (msg.provider !== settings.provider) return { ok: false, error: 'Сервис изменён в другом окне. Откройте настройки заново.' };
      await saveSettings({ ...settings, source: isLanguage(msg.source) ? msg.source : settings.source, target: isLanguage(msg.target) ? msg.target : settings.target, consents: { ...settings.consents, [settings.provider]: typeof msg.consent === 'boolean' ? msg.consent : settings.consent }, autoPause: typeof msg.autoPause === 'boolean' ? msg.autoPause : settings.autoPause });
      return { ok: true };
    }
    if (msg.type === 'toggle' && typeof msg.origin === 'string' && originOf(msg.origin) === msg.origin && typeof msg.enabled === 'boolean') {
      if (msg.enabled && (!settings.consent || !await browser.permissions.contains({ origins: [pattern(msg.origin)] }))) return { ok: false, error: 'Разрешите перевод и доступ к сайту.' };
      const origins = settings.enabledOrigins.filter(o => o !== msg.origin);
      if (msg.enabled) origins.push(msg.origin);
      await saveSettings({ ...settings, enabledOrigins: origins });
      await syncRegistration();
      const injected = typeof msg.tabId === 'number' ? await inject(msg.tabId) : true;
      return { ok: true, warning: msg.enabled && !injected ? 'Скрипт недоступен на этой странице. Перезагрузите её; защищённые страницы Firefox не поддерживаются.' : undefined };
    }
    if (msg.type === 'frames' && typeof msg.tabId === 'number') {
      const frames = await browser.webNavigation.getAllFrames({ tabId: msg.tabId });
      return [...new Set((frames ?? []).map(f => originOf(f.url)).filter((o): o is string => Boolean(o)))];
    }
    if (msg.type === 'inject' && typeof msg.tabId === 'number') { await syncRegistration(); await inject(msg.tabId); return { ok: true }; }
    if (msg.type === 'clear') {
      broker.cancelAll(); broker.cache.clear(); await persistence;
      await browser.storage.local.remove('cache'); return { ok: true };
    }
    return { ok: false, error: 'Неизвестная команда.' };
  })().catch(() => ({ ok: false, error: 'Не удалось выполнить действие. Откройте расширение заново.' }));
});
browser.permissions.onAdded.addListener(() => { void syncRegistration().then(broadcast).catch(() => {}); });
browser.permissions.onRemoved.addListener(() => { broker.cancelAll(); void syncRegistration().then(broadcast).catch(() => {}); });
browser.tabs.onRemoved.addListener(tabId => {
  // Cancelling every request is conservative and avoids retaining closed-tab work.
  void tabId; broker.cancelAll();
});
browser.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete') void ready.then(() => {
    const origin = originOf(tab.url);
    if (origin && settings.enabledOrigins.includes(origin)) return inject(tabId);
  });
});
void ready.then(syncRegistration).catch(() => {});
