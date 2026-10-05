import { LANGUAGES, PROVIDERS, type Settings } from './shared';
export function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
export async function command<T = { ok: boolean; error?: string }>(message: object): Promise<T> { return browser.runtime.sendMessage(message); }
export async function state(): Promise<{ settings: Settings; cacheSize: number; hasApiKey: boolean; usage: { month: string; characters: number }; monthlyLimit: number }> { return command({ type: 'state' }); }
export function languages(settings: Settings, onChange: () => Promise<void>) {
  renderProvider(settings);
  element('provider').addEventListener('change', () => {
    const select = element<HTMLSelectElement>('provider'); select.disabled = true;
    void command({ type: 'provider', provider: select.value }).then(async result => {
      if (!result.ok) throw new Error(result.error);
      renderProvider((await state()).settings);
      await onChange();
    }).catch(showError).finally(() => { select.disabled = false; });
  });
  for (const id of ['source', 'target'] as const) {
    const select = element<HTMLSelectElement>(id);
    for (const [value, label] of Object.entries(LANGUAGES)) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
    }
    select.value = settings[id]; select.addEventListener('change', () => { void onChange().catch(showError); });
  }
  element<HTMLInputElement>('consent').checked = settings.consent;
  element<HTMLInputElement>('auto-pause').checked = settings.autoPause;
  element('auto-pause').addEventListener('change', () => { void onChange().catch(showError); });
}
export async function savePreferences() {
  const result = await command({ type: 'settings', provider: element<HTMLSelectElement>('provider').value, source: element<HTMLSelectElement>('source').value, target: element<HTMLSelectElement>('target').value, consent: element<HTMLInputElement>('consent').checked, autoPause: element<HTMLInputElement>('auto-pause').checked });
  if (!result.ok) throw new Error(result.error);
}
export function showError(error: unknown) { element('status').textContent = error instanceof Error ? error.message : 'Не удалось выполнить действие.'; }

export function renderProvider(settings: Settings) {
  element<HTMLSelectElement>('provider').value = settings.provider;
  element<HTMLInputElement>('consent').checked = settings.consent;
  element('consent-label').textContent = `Разрешаю отправлять выбранное слово и языковую пару в ${PROVIDERS[settings.provider]}.`;
  element('provider-hint').textContent = settings.provider === 'google'
    ? 'Нужны личный API-ключ и биллинг Google Cloud. Сверх бесплатного объёма возможна оплата.'
    : 'Бесплатный MyMemory, без API-ключа. Действуют лимиты сервиса; при их достижении перевод остановится.';
  for (const id of ['google-settings', 'google-usage']) {
    const panel = document.getElementById(id); if (panel) panel.hidden = settings.provider !== 'google';
  }
}
