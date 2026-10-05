export const LANGUAGES = { ru: 'Русский', en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', uk: 'Українська' } as const;
export type Language = keyof typeof LANGUAGES;
export const PROVIDERS = { google: 'Google Cloud', mymemory: 'MyMemory' } as const;
export type ProviderId = keyof typeof PROVIDERS;
export function isProvider(value: unknown): value is ProviderId { return value === 'google' || value === 'mymemory'; }
export interface Settings {
  provider: ProviderId;
  consents: Record<ProviderId, boolean>;
  enabledOrigins: string[];
  source: Language;
  target: Language;
  consent: boolean;
  autoPause: boolean;
}
export const DEFAULT_SETTINGS: Settings = { provider: 'mymemory', consents: { google: false, mymemory: false }, enabledOrigins: [], source: 'en', target: 'ru', consent: false, autoPause: false };
export const API_ORIGIN = 'https://translation.googleapis.com/*';
export const PROVIDER_VERSION = 'multi-provider-v1';
export function originOf(url?: string): string | null {
  try { const u = new URL(url ?? ''); return ['https:', 'http:'].includes(u.protocol) ? u.origin : null; } catch { return null; }
}
export function pattern(origin: string): string { const url = new URL(origin); return `${url.protocol}//${url.hostname}/*`; }
export function isLanguage(value: unknown): value is Language { return typeof value === 'string' && Object.hasOwn(LANGUAGES, value); }
export function normalizeSettings(value: unknown): Settings {
  const s = (value && typeof value === 'object' ? value : {}) as Partial<Settings>;
  const provider = isProvider(s.provider) ? s.provider : 'mymemory';
  const consents = { google: s.consents?.google === true, mymemory: s.consents?.mymemory === true };
  return {
    provider, consents,
    enabledOrigins: Array.isArray(s.enabledOrigins) ? [...new Set(s.enabledOrigins.filter((v): v is string => typeof v === 'string' && originOf(v) === v))] : [],
    source: isLanguage(s.source) ? s.source : 'en', target: isLanguage(s.target) ? s.target : 'ru', consent: consents[provider], autoPause: s.autoPause === true,
  };
}
export interface ActiveConfig { provider: ProviderId; active: boolean; source: Language; target: Language; autoPause: boolean }
export type TranslationResult = { ok: true; text: string; cached: boolean } | { ok: false; error: string };
export function validWord(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 80 && /^[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*$/u.test(value);
}
export function wordAt(text: string, offset: number): { word: string; start: number; end: number } | null {
  for (const match of text.matchAll(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu)) {
    const start = match.index; const end = start + match[0].length;
    if (offset >= start && offset <= end && validWord(match[0])) return { word: match[0], start, end };
  }
  return null;
}
