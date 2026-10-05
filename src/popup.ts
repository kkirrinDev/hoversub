import { originOf, pattern } from './shared';
import { command, element, languages, savePreferences, showError, state } from './ui';

async function main() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const origin = originOf(tab?.url);
  const toggle = element<HTMLButtonElement>('toggle');
  const consent = element<HTMLInputElement>('consent');
  const initial = await state();
  let enabled = Boolean(origin && initial.settings.enabledOrigins.includes(origin));
  element('site').textContent = origin ? new URL(origin).hostname : 'Откройте обычную веб-страницу';
  const render = () => {
    toggle.disabled = !origin || !tab.id;
    toggle.textContent = enabled ? 'Выключить на этом сайте' : 'Включить перевод';
    toggle.setAttribute('aria-pressed', String(enabled));
    element<HTMLButtonElement>('region').disabled = !enabled;
    element<HTMLButtonElement>('reset').disabled = !enabled;
    element('status').textContent = element<HTMLSelectElement>('provider').value === 'google' && !initial.hasApiKey ? 'Добавьте Google Cloud API-ключ в настройках.' : enabled ? consent.checked ? 'Перевод включён. Наведите на слово.' : 'Запросы остановлены: нет согласия.' : 'Перевод выключен.';
  };
  languages(initial.settings, async () => { await savePreferences(); render(); });
  consent.addEventListener('change', () => { void savePreferences().then(render).catch(showError); });
  toggle.addEventListener('click', () => {
    if (!origin || !tab.id) return;
    if (!enabled && !consent.checked) { element('status').textContent = 'Сначала разрешите передачу выбранного слова ниже.'; return; }
    // The permission request starts directly in the click handler (user gesture).
    const permission = enabled ? Promise.resolve(true) : browser.permissions.request({ origins: [pattern(origin)] });
    toggle.disabled = true;
    void permission.then(async granted => {
      if (!granted) throw new Error('Firefox не предоставил доступ к сайту.');
      await savePreferences();
      const result = await command<{ ok: boolean; error?: string; warning?: string }>({ type: 'toggle', origin, enabled: !enabled, tabId: tab.id });
      if (!result.ok) throw new Error(result.error);
      enabled = !enabled; render();
      if (result.warning) element('status').textContent = result.warning;
    }).catch(showError).finally(() => { toggle.disabled = false; });
  });
  for (const [id, type] of [['region', 'select-region'], ['reset', 'reset-region']]) {
    element(id).addEventListener('click', () => {
      if (!tab.id) return;
      void browser.tabs.sendMessage(tab.id, { type }).then(() => window.close()).catch(() => showError(new Error('Перезагрузите страницу после включения расширения.')));
    });
  }
  element('options').addEventListener('click', () => { void browser.runtime.openOptionsPage(); });
  render();
  if (tab.id && origin) {
    const frames = await command<string[]>({ type: 'frames', tabId: tab.id });
    if (!Array.isArray(frames)) return;
    for (const frame of frames.filter(f => f !== origin)) {
      const button = document.createElement('button'); button.className = 'secondary';
      const granted = await browser.permissions.contains({ origins: [pattern(frame)] });
      button.textContent = `${granted ? '✓ Доступ есть: ' : 'Разрешить: '}${new URL(frame).hostname}`;
      button.disabled = granted;
      button.addEventListener('click', () => {
        void browser.permissions.request({ origins: [pattern(frame)] }).then(async allowed => {
          if (!allowed) return;
          await command({ type: 'inject', tabId: tab.id }); button.disabled = true; button.textContent = `✓ ${new URL(frame).hostname}`;
        }).catch(showError);
      });
      element('frames').append(button);
    }
    if (!element('frames').children.length) element('frames').textContent = 'Других адресов плееров сейчас не найдено. Запустите видео и откройте это окно снова.';
  }
}
void main().catch(showError);
