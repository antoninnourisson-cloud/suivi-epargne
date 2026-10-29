// @vitest-environment jsdom
// Mode discret depuis l'en-tête : bouton à bascule (aria-pressed), montants masqués partout
// où ils passent par le formatage commun, et reconstruits à chaque bascule.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppShell } from './AppShell';
import { MoneyText } from '../components/ui';
import { resetDiscreetModeForTests, useDiscreetMode } from '../hooks/useDiscreetMode';
import { DISCREET_AMOUNT } from '../lib/format';

const Harness: React.FC = () => {
  const { discreet, toggleDiscreet } = useDiscreetMode();
  return (
    <AppShell view="dashboard" setView={() => {}} showParentalScreen={false} syncPhase={{ kind: 'idle' }} lastSavedAt={null}
      hasPendingEdits={false} onRetrySync={() => {}} onReconnect={() => {}} isDark={false} onToggleTheme={() => {}}
      discreet={discreet} onToggleDiscreet={toggleDiscreet} onRequestLogout={() => {}} mainRef={{ current: null }} overlays={null}>
      {/* Comme App : l'écran est reconstruit à la bascule. */}
      <div key={String(discreet)} data-testid="ecran">Épargne nette <MoneyText value={24400} /> · reste <MoneyText value={-12.5} signed /></div>
    </AppShell>
  );
};

beforeEach(() => { localStorage.clear(); resetDiscreetModeForTests(); });
afterEach(() => { cleanup(); resetDiscreetModeForTests(); });

describe('Mode discret (en-tête)', () => {
  it('masque puis réaffiche les montants, avec un bouton à bascule annoncé', () => {
    render(<Harness />);
    const buttons = screen.getAllByRole('button', { name: 'Masquer les montants' });
    // Un bouton dans le menu latéral (ordinateur), un dans l'en-tête (téléphone).
    expect(buttons).toHaveLength(2);
    buttons.forEach(b => expect(b.getAttribute('aria-pressed')).toBe('false'));
    expect(screen.getByTestId('ecran').textContent).not.toContain('•');

    fireEvent.click(buttons[1]);
    screen.getAllByRole('button', { name: 'Masquer les montants' }).forEach(b => expect(b.getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByTestId('ecran').textContent).toBe(`Épargne nette ${DISCREET_AMOUNT} · reste −${DISCREET_AMOUNT}`);
    expect(localStorage.getItem('discreet_amounts')).toBe('1');

    fireEvent.click(screen.getAllByRole('button', { name: 'Masquer les montants' })[0]);
    expect(screen.getByTestId('ecran').textContent).not.toContain('•');
    expect(screen.getByTestId('ecran').textContent).toMatch(/24.400/);
  });
});
