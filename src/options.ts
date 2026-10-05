import { command, element, languages, savePreferences, showError, state } from './ui';
async function refresh() {
  const { settings, cacheSize, hasApiKey, usage, monthlyLimit } = await state();
  element('key-status').textContent = hasApiKey ? 'API-ключ сохранён. Значение ключа не отображается.' : 'API-ключ не задан. Перевод пока недоступен.';
  element('usage').textContent = `${usage.month} (UTC): ${usage.characters.toLocaleString('ru')} / ${monthlyLimit.toLocaleString('ru')} символов — локальный счётчик отправок.`;
  element('cache-info').textContent = `Сохранено переводов: ${cacheSize}`;
  const sites = element('sites'); sites.replaceChildren();
  if (!settings.enabledOrigins.length) sites.textContent = 'Пока нет. Откройте сайт и включите HoverSub через значок расширения.';
  for (const origin of settings.enabledOrigins) {
    const row = document.createElement('div'); row.className = 'row';
    const label = document.createElement('span'); label.textContent = origin;
    const button = document.createElement('button'); button.className = 'secondary'; button.textContent = 'Выключить';
    button.addEventListener('click', () => { void command({ type: 'toggle', origin, enabled: false }).then(refresh).catch(showError); });
    row.append(label, button); sites.append(row);
  }
}
async function main() {
  const { settings } = await state();
  const save = async () => { await savePreferences(); element('status').textContent = 'Настройки сохранены.'; };
  languages(settings, save);
  element('consent').addEventListener('change', () => { void save().catch(showError); });
  for (const [id, remove] of [['save-key', false], ['remove-key', true]] as const) {
    element(id).addEventListener('click', () => {
      const input = element<HTMLInputElement>('api-key');
      if (!remove && !input.value.trim()) { showError(new Error('Введите API-ключ.')); return; }
      const key = remove ? '' : input.value.trim(); input.value = '';
      void command({ type: 'google-key', key }).then(async result => {
        if (!result.ok) throw new Error(result.error);
        await refresh(); element('status').textContent = remove ? 'Ключ удалён.' : 'Ключ сохранён. Разрешите отправку слова и проверьте подключение.';
      }).catch(showError);
    });
  }
  element('clear').addEventListener('click', () => {
    void command({ type: 'clear' }).then(refresh).then(() => { element('status').textContent = 'Кэш очищен.'; }).catch(showError);
  });
  element('test').addEventListener('click', () => {
    const button = element<HTMLButtonElement>('test'); button.disabled = true;
    element('test-status').textContent = 'Проверяем…';
    void command<{ ok: boolean; text?: string; error?: string }>({ type: 'test' }).then(result => {
      element('test-status').textContent = result.ok ? `dragon → ${result.text}` : result.error ?? 'Ошибка перевода.';
    }).catch(showError).finally(() => { button.disabled = false; void refresh().catch(showError); });
  });
  await refresh();
}
void main().catch(showError);
