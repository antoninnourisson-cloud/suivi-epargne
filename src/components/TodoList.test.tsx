// @vitest-environment jsdom
// « Plus tard » : 7 jours par défaut, ou jusqu'à la date de retour propre à la tâche.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Clock } from 'lucide-react';
import { TodoList, type TodoSpec } from './TodoList';
import { storageKey } from '../lib/storageKeys';

const spec = (key: string, over: Partial<TodoSpec> = {}): TodoSpec => ({ key, icon: Clock, tone: 'info', text: `Tâche ${key}`, snoozable: true, ...over });
const snoozed = (): Record<string, number> => JSON.parse(localStorage.getItem(storageKey('todoSnoozed')) ?? '{}');

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 20, 10)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('TodoList : « Plus tard »', () => {
  it('garde 7 jours pour une tâche sans date de retour', () => {
    render(<TodoList items={[spec('a')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
    expect(snoozed().a).toBe(new Date(2026, 10, 20, 10).getTime() + 7 * 86_400_000);
    expect(screen.queryByText('Tâche a')).toBeNull();
  });
  it('masque la tâche jusqu\'à sa propre date de retour', () => {
    render(<TodoList items={[spec('b', { snoozeUntil: '2026-12-15' })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
    expect(snoozed().b).toBe(new Date(2026, 11, 15).getTime());
  });
  it('une date déjà passée retombe sur 7 jours', () => {
    render(<TodoList items={[spec('c', { snoozeUntil: '2026-11-01' })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
    expect(snoozed().c).toBe(new Date(2026, 10, 20, 10).getTime() + 7 * 86_400_000);
  });
});

describe('TodoList : tâches épinglées', () => {
  it('une tâche épinglée passe devant les autres, même dernière de la liste', () => {
    const items = [
      spec('a', { tone: 'action' }),
      spec('b', { tone: 'action' }), spec('c', { tone: 'action' }), spec('d', { tone: 'action' }),
      spec('e', { pinned: true }),
    ];
    render(<TodoList items={items} />);
    expect(screen.getByText('Tâche e')).toBeTruthy(); // visible sans « Voir tout »
    const texts = screen.getAllByText(/^Tâche /).map(el => el.textContent);
    expect(texts[0]).toBe('Tâche e');
  });
});
