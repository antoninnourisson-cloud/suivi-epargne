// @vitest-environment jsdom
// Types de notifications : celui du capital des parents n'est plus proposé en mode solo ;
// rappel du jour de paie, réglé dans Pilotage › Paie habituelle.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../services/backendService', () => ({ isBackendEnabled: () => true }));
vi.mock('../services/pushService', () => ({
  getPushState: () => Promise.resolve('enabled'),
  enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn(), isIosOutsideHomeScreen: () => false,
}));

import { NotificationSettings } from './NotificationSettings';

afterEach(cleanup);

const PARENTS = 'Capital des parents : intérêts et restitution';

describe('NotificationSettings', () => {
  it('propose le type « Capital des parents » tant qu\'il en reste, plus en mode solo', () => {
    const { rerender } = render(<NotificationSettings prefs={{}} onChangePrefs={() => {}} />);
    expect(screen.getByRole('checkbox', { name: PARENTS })).toBeTruthy();
    rerender(<NotificationSettings prefs={{}} onChangePrefs={() => {}} hasParental={false} />);
    expect(screen.queryByRole('checkbox', { name: PARENTS })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Clôture et bilan de l\'année (janvier)' })).toBeTruthy();
  });

  it('rappel du jour de paie : dit le jour (ou « pas de jour fixe ») et mène à Paie habituelle', () => {
    const open = vi.fn();
    const { rerender } = render(<NotificationSettings paydayDay={27} onOpenPayday={open} />);
    expect(screen.getByText(/^Rappel du jour de paie/).textContent).toBe('Rappel du jour de paie : le 27 du mois');
    fireEvent.click(screen.getByRole('button', { name: 'Modifier : Pilotage › Paie habituelle' }));
    expect(open).toHaveBeenCalledTimes(1);
    rerender(<NotificationSettings onOpenPayday={open} />);
    expect(screen.getByText(/^Rappel du jour de paie/).textContent).toBe('Rappel du jour de paie : aucun (pas de jour fixe)');
  });
});
