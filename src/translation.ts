import { validWord, type ProviderId, type Language, type TranslationResult } from './shared';

export interface CacheEntry { key: string; text: string; time: number }
const TTL = 7 * 24 * 60 * 60 * 1000;
export class TranslationCache {
  private entries = new Map<string, CacheEntry>();
  constructor(entries: CacheEntry[] = [], private now = () => Date.now()) {
    for (const entry of entries) if (entry && typeof entry.key === 'string' && typeof entry.text === 'string' && Number.isFinite(entry.time) && this.now() - entry.time < TTL) this.entries.set(entry.key, entry);
    this.trim();
  }
  get(key: string): string | undefined {
    const e = this.entries.get(key);
    if (!e) return;
    this.entries.delete(key);
    if (this.now() - e.time >= TTL) return;
    this.entries.set(key, e); return e.text;
  }
  set(key: string, text: string) { this.entries.delete(key); this.entries.set(key, { key, text, time: this.now() }); this.trim(); }
  clear() { this.entries.clear(); }
  clearGoogle() { for (const key of this.entries.keys()) if (key.startsWith('google-v2:')) this.entries.delete(key); }
  dump() {
    for (const [key, entry] of this.entries) if (this.now() - entry.time >= TTL) this.entries.delete(key);
    return [...this.entries.values()];
  }
  private trim() { while (this.entries.size > 1000) this.entries.delete(this.entries.keys().next().value!); }
}
export async function translateWord(word: string, source: Language, target: Language, signal: AbortSignal, apiKey: string): Promise<string> {
  if (!validWord(word)) throw new Error('Выберите одно слово.');
  if (!apiKey) throw new Error('Добавьте Google Cloud API-ключ в настройках HoverSub.');
  if (source === target) return word;
  const response = await fetch('https://translation.googleapis.com/language/translate/v2', {
    method: 'POST', signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Goog-Api-Key': apiKey },
    body: JSON.stringify({ q: word, source, target, format: 'text', model: 'nmt' }),
  });
  const data = await response.json().catch(() => null);
  if (response.status === 429 || data?.error?.errors?.some((e: { reason?: string }) => ['dailyLimitExceeded', 'userRateLimitExceeded', 'rateLimitExceeded'].includes(e.reason ?? ''))) throw new Error('Квота Google Cloud исчерпана. Проверьте квоты в консоли; платного обхода нет.');
  if (response.status === 401) throw new Error('Google не принял API-ключ. Проверьте его в настройках.');
  if (response.status === 403) throw new Error('Google отказал в доступе. Проверьте ключ, включение Cloud Translation API, биллинг и ограничения ключа.');
  if (response.status === 400) throw new Error('Google отклонил запрос. Проверьте API-ключ и выбранные языки.');
  if (!response.ok) throw new Error('Google Cloud Translation недоступен. Попробуйте позже.');
  const text = data?.data?.translations?.[0]?.translatedText;
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('Сервис вернул некорректный ответ.');
  // Decode common Google entities as text; never create HTML or load resources.
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return text.trim().replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (full: string, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? full;
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : full;
  });
}
export async function translateMyMemory(word: string, source: Language, target: Language, signal: AbortSignal): Promise<string> {
  if (!validWord(word)) throw new Error('Выберите одно слово.');
  if (source === target) return word;
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', word); url.searchParams.set('langpair', `${source}|${target}`);
  const response = await fetch(url.href, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  const data = await response.json().catch(() => null);
  if (response.status === 429 || Number(data?.responseStatus) === 429 || data?.quotaFinished === true) throw new Error('Лимит MyMemory исчерпан. Попробуйте позже или выберите другой сервис в настройках.');
  if (!response.ok || Number(data?.responseStatus) !== 200) throw new Error('MyMemory недоступен или отклонил запрос. Попробуйте позже.');
  const text = data?.responseData?.translatedText;
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('Сервис вернул некорректный ответ.');
  return text.trim();
}
type Provider = (word: string, source: Language, target: Language, signal: AbortSignal, provider: ProviderId) => Promise<string>;
interface Job {
  key: string; word: string; source: Language; target: Language; controller: AbortController;
  clients: Map<string, (result: TranslationResult) => void>;
  privateOnly: boolean; providerId: ProviderId;
}
export class TranslationBroker {
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private running = 0;
  constructor(public cache: TranslationCache, private provider: Provider, private save: () => void = () => {}) {}
  request(owner: string, word: string, source: Language, target: Language, privateOnly = false, providerId: ProviderId = 'google'): Promise<TranslationResult> {
    this.cancel(owner);
    const key = `${providerId === 'google' ? 'google-v2' : 'mymemory-v1'}:${source}:${target}:${word.normalize('NFC').toLocaleLowerCase(source)}`;
    const cached = privateOnly ? undefined : this.cache.get(key);
    if (cached !== undefined) return Promise.resolve({ ok: true, text: cached, cached: true });
    const jobKey = `${privateOnly ? 'private' : 'normal'}:${key}`;
    let job = this.jobs.get(jobKey);
    if (!job) {
      if (this.jobs.size >= 16) return Promise.resolve({ ok: false, error: 'Слишком много запросов. Повторите чуть позже.' });
      job = { key: jobKey, word, source, target, controller: new AbortController(), clients: new Map(), privateOnly, providerId };
      this.jobs.set(jobKey, job); this.queue.push(job);
    }
    const result = new Promise<TranslationResult>(resolve => job!.clients.set(owner, resolve));
    this.drain(); return result;
  }
  cancel(owner: string) {
    for (const job of this.jobs.values()) {
      const client = job.clients.get(owner);
      if (!client) continue;
      client({ ok: false, error: 'Запрос отменён.' }); job.clients.delete(owner);
      if (!job.clients.size) { job.controller.abort(); this.jobs.delete(job.key); this.queue = this.queue.filter(j => j !== job); }
    }
  }
  cancelAll() {
    for (const job of [...this.jobs.values()]) for (const owner of [...job.clients.keys()]) this.cancel(owner);
  }
  private drain() {
    while (this.running < 2 && this.queue.length) {
      const job = this.queue.shift()!;
      if (!job.clients.size) continue;
      this.running++;
      void this.run(job).finally(() => { this.running--; this.drain(); });
    }
  }
  private async run(job: Job) {
    const timer = setTimeout(() => job.controller.abort(), 5000);
    let result: TranslationResult;
    try {
      const text = await this.provider(job.word, job.source, job.target, job.controller.signal, job.providerId);
      if (!job.clients.size) return;
      job.controller.signal.throwIfAborted();
      if (!job.privateOnly) { this.cache.set(job.key.slice('normal:'.length), text); this.save(); }
      result = { ok: true, text, cached: false };
    } catch (error) {
      result = { ok: false, error: job.controller.signal.aborted ? 'Перевод не ответил за 5 секунд. Повторите.' : error instanceof TypeError ? 'Нет связи с переводчиком. Проверьте интернет.' : error instanceof Error ? error.message : 'Не удалось получить перевод.' };
    } finally {
      clearTimeout(timer);
      if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    }
    for (const resolve of job.clients.values()) resolve(result);
    job.clients.clear();
  }
}
