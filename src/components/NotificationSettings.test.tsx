// @vitest-environment jsdom
// Types de notifications : celui du capital des parents n'est plus proposé en mode solo.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

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
});
