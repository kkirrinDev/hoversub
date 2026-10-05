import { describe, expect, it, vi } from 'vitest';
import { MonthlyBudget, MONTHLY_LIMIT } from '../src/usage';
describe('local monthly spend guard', () => {
  const now = () => new Date('2026-10-05T00:00:00Z');
  it('serializes simultaneous reservations at the boundary', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const budget = new MonthlyBudget({ month: '2026-10', characters: MONTHLY_LIMIT - 6 }, save, now);
    const results = await Promise.allSettled([budget.reserve('dragon'), budget.reserve('castle')]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(save).toHaveBeenCalledTimes(1); expect(budget.snapshot().characters).toBe(MONTHLY_LIMIT);
  });
  it('does not allow sending when the counter cannot be persisted', async () => {
    const budget = new MonthlyBudget(null, vi.fn().mockRejectedValue(new Error('disk')), now);
    await expect(budget.reserve('dragon')).rejects.toThrow('не отправлен'); expect(budget.snapshot().characters).toBe(0);
  });
  it('retains usage across restarts and rolls over only at a new UTC month', async () => {
    let time = new Date('2026-10-31T23:59:00Z'); const save = vi.fn().mockResolvedValue(undefined);
    const budget = new MonthlyBudget({ month: '2026-10', characters: 100 }, save, () => time);
    await budget.reserve('dragon'); expect(budget.snapshot().characters).toBe(106);
    time = new Date('2026-11-01T00:00:00Z'); await budget.reserve('queen');
    expect(budget.snapshot()).toEqual({ month: '2026-11', characters: 5 });
  });
  it('counts Unicode code points rather than UTF16 units', async () => {
    const budget = new MonthlyBudget(null, vi.fn().mockResolvedValue(undefined), now);
    await budget.reserve('𐐀'); expect(budget.snapshot().characters).toBe(1);
  });
});
