export const MONTHLY_LIMIT = 450_000;
export interface Usage { month: string; characters: number }
export class MonthlyBudget {
  private queue = Promise.resolve();
  private usage: Usage;
  constructor(saved: unknown, private save: (usage: Usage) => Promise<void>, private now = () => new Date()) {
    const value = saved as Partial<Usage> | null;
    this.usage = { month: typeof value?.month === 'string' ? value.month : '', characters: Number.isSafeInteger(value?.characters) && value!.characters! >= 0 ? value!.characters! : 0 };
  }
  snapshot(): Usage { return this.usage.month === this.month() ? { ...this.usage } : { month: this.month(), characters: 0 }; }
  reserve(word: string): Promise<void> {
    const task = this.queue.then(async () => {
      const next = this.snapshot(); next.characters += Array.from(word).length;
      if (next.characters > MONTHLY_LIMIT) throw new Error('Локальный лимит 450 000 символов за месяц достигнут. Переводы из кэша доступны.');
      // Persist BEFORE sending; failures/cancellations are counted conservatively.
      try { await this.save(next); } catch { throw new Error('Не удалось сохранить счётчик расхода. Запрос не отправлен.'); }
      this.usage = next;
    });
    this.queue = task.catch(() => {}); return task;
  }
  private month() { return this.now().toISOString().slice(0, 7); }
}
