// @vitest-environment jsdom
// Paramètres › Verrou de l'appareil : délai avant verrouillage, proposé seulement quand un
// verrou est actif, 5 minutes par défaut, enregistré sur cet appareil.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LockSection } from './LockSection';
import { getLockDelayMs } from '../../services/appLockService';

beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

describe('LockSection : délai avant verrouillage', () => {
  it('sans verrou : pas de délai à choisir', () => {
    render(<LockSection />);
    expect(screen.queryByLabelText('Verrouiller')).toBeNull();
  });

  it('code PIN actif : « Après 5 minutes » par défaut, le choix est gardé sur l’appareil', () => {
    localStorage.setItem('app_lock_pin_hash', 'x');
    localStorage.setItem('app_lock_pin_salt', 'y');
    render(<LockSection />);
    const select = screen.getByLabelText<HTMLSelectElement>('Verrouiller');
    expect(select.selectedOptions[0].textContent).toBe('Après 5 minutes');
    expect(Array.from(select.options).map(o => o.textContent)).toEqual(['Immédiatement', 'Après 1 minute', 'Après 5 minutes', 'Après 15 minutes']);
    fireEvent.change(select, { target: { value: '0' } });
    expect(getLockDelayMs()).toBe(0);
    expect(select.selectedOptions[0].textContent).toBe('Immédiatement');
  });
});
