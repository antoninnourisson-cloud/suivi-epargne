// @vitest-environment jsdom
// « Demander à Pécule » : sans clé, un lien vers les Paramètres et rien n'est préparé ; avec
// une clé, suggestions, conversation à plusieurs tours (en mémoire seulement), erreurs en
// français et question gardée pour réessayer.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { emptyData } from '../../lib/schema';
import { GeminiError } from '../../services/geminiService';

const ask = vi.fn<(key: string, snap: { json: string; asOf: string }, history: { role: string; text: string }[], q: string) => Promise<string>>();
vi.mock('../../services/askPecule', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/askPecule')>()),
  askPecule: (...a: Parameters<typeof ask>) => ask(...a),
}));
const build = vi.fn();
vi.mock('../../lib/askSnapshot', async importOriginal => {
  const real = await importOriginal<typeof import('../../lib/askSnapshot')>();
  return { ...real, buildAskSnapshot: (...a: Parameters<typeof real.buildAskSnapshot>) => { build(); return real.buildAskSnapshot(...a); } };
});

import { AskPecule, ASK_SUGGESTIONS } from './AskPecule';

const setup = (key = 'cle') => {
  const props = { data: emptyData(), geminiApiKey: key, onClose: vi.fn(), onOpenSettings: vi.fn() };
  return { props, ...render(<AskPecule {...props} />) };
};

beforeEach(() => { ask.mockReset(); build.mockClear(); localStorage.clear(); });
afterEach(cleanup);

describe('Demander à Pécule', () => {
  it('sans clé : explique et ouvre « Clés et services », sans rien préparer', () => {
    const { props } = setup('');
    const dialog = screen.getByRole('dialog', { name: 'Demander à Pécule' });
    expect(dialog.textContent).toMatch(/Clés et services/);
    expect(screen.queryByLabelText('Votre question')).toBeNull();
    expect(build).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Ajouter ma clé Gemini/ }));
    expect(props.onOpenSettings).toHaveBeenCalledWith('keys');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('suggestion, puis question de suivi avec la conversation ; rien d’enregistré', async () => {
    ask.mockResolvedValueOnce('Ce trimestre : 600 €.').mockResolvedValueOnce('En septembre : 200 €.');
    setup();
    expect(screen.getByText(/ne sont pas un conseil financier/).textContent).toMatch(/d'après vos données du \d+ \S+ \d{4}/);
    expect(screen.getAllByRole('button').filter(b => ASK_SUGGESTIONS.includes(b.textContent ?? ''))).toHaveLength(ASK_SUGGESTIONS.length);
    fireEvent.click(screen.getByRole('button', { name: ASK_SUGGESTIONS[0] }));
    expect(await screen.findByText('Ce trimestre : 600 €.')).toBeTruthy();
    expect(ask.mock.calls[0][2]).toEqual([]);
    expect(ask.mock.calls[0][3]).toBe(ASK_SUGGESTIONS[0]);
    expect(screen.queryByRole('button', { name: ASK_SUGGESTIONS[1] })).toBeNull();

    fireEvent.change(screen.getByLabelText('Votre question'), { target: { value: 'Et en septembre ?' } });
    fireEvent.keyDown(screen.getByLabelText('Votre question'), { key: 'Enter' });
    expect(await screen.findByText('En septembre : 200 €.')).toBeTruthy();
    expect(ask.mock.calls[1][2]).toEqual([{ role: 'user', text: ASK_SUGGESTIONS[0] }, { role: 'model', text: 'Ce trimestre : 600 €.' }]);
    expect(build).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });

  it('erreur : message en français, question remise dans le champ', async () => {
    ask.mockRejectedValueOnce(new GeminiError('x', 'OVERLOADED'));
    setup();
    fireEvent.change(screen.getByLabelText('Votre question'), { target: { value: 'Mon Livret A ?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer la question' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/très sollicité/);
    await waitFor(() => expect((screen.getByLabelText('Votre question') as HTMLTextAreaElement).value).toBe('Mon Livret A ?'));
    expect(screen.queryByText('Mon Livret A ?', { selector: 'p' })).toBeNull();
  });

  it('fermer : la réponse arrivée ensuite est ignorée', async () => {
    let resolve: (s: string) => void = () => {};
    ask.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const { props, unmount } = setup();
    fireEvent.click(screen.getByRole('button', { name: ASK_SUGGESTIONS[1] }));
    expect(screen.getByRole('status').textContent).toMatch(/réfléchit/);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(props.onClose).toHaveBeenCalled();
    unmount();
    resolve('trop tard');
    await Promise.resolve();
  });
});
