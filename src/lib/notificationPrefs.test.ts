import { describe, it, expect } from 'vitest';
import { isReminderEnabled, categoryOfKey } from './notificationPrefs';

describe('préférences de notifications', () => {
  it('tout est actif par défaut', () => {
    expect(isReminderEnabled('stale:2026-09', undefined)).toBe(true);
  });
  it('coupe seulement le type désactivé', () => {
    const prefs = { stale: false };
    expect(isReminderEnabled('stale:2026-09', prefs)).toBe(false);
    expect(isReminderEnabled('payday:2026-09', prefs)).toBe(true);
  });
  it('distingue la paie de sa relance', () => {
    expect(categoryOfKey('payday-followup:2026-09')?.id).toBe('payday-followup');
    expect(categoryOfKey('payday:2026-09')?.id).toBe('payday');
    expect(categoryOfKey('restitution-day:2027-01-01')?.id).toBe('parents');
  });
  it('le point de paie garde l’id et le préfixe « recap » (préférences existantes conservées)', () => {
    const cat = categoryOfKey('recap:2026-09');
    expect(cat?.id).toBe('recap');
    expect(cat?.label).toBe('Point de paie (bilan de la paie précédente)');
    expect(isReminderEnabled('recap:2026-09', { recap: false })).toBe(false);
  });
});
