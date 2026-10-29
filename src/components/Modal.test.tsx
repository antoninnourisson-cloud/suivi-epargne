// @vitest-environment jsdom
// Fenêtre restée ouverte sous le verrou (posé par-dessus l'app, qui devient `inert`) : Échap
// tapé sur l'écran de verrouillage ne la ferme pas ; une fois l'app rendue, Échap la ferme.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Modal } from './Modal';

afterEach(cleanup);

const Harness = ({ locked, onClose }: { locked: boolean; onClose: () => void }) => (
  <div {...(locked ? { inert: true } : {})}>
    <Modal open onClose={onClose} label="Fenêtre"><input aria-label="Champ" /></Modal>
  </div>
);

describe('Modal sous le verrou', () => {
  it('Échap ignoré tant que la fenêtre est sous un ancêtre inert', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Harness locked onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    rerender(<Harness locked={false} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Feuille du bas : poignée', () => {
  it('posée avant le contenu, avec un espace fixe en dessous (pas de marge négative vers le titre)', () => {
    const { container } = render(<Modal open onClose={() => {}} label="Feuille" variant="sheet" className="p-4"><h2>Titre</h2></Modal>);
    const dialog = container.ownerDocument.querySelector('[role="dialog"]')!;
    const handle = dialog.querySelector('[data-sheet-handle]')!;
    expect(handle).toBe(dialog.firstElementChild);
    expect(handle.className).toMatch(/(^| )mb-2( |$)/);
    expect(handle.className).not.toMatch(/-mb-/);
  });

  it('une boîte de dialogue n’a pas de poignée', () => {
    render(<Modal open onClose={() => {}} label="Boîte"><p>Contenu</p></Modal>);
    expect(document.querySelector('[data-sheet-handle]')).toBeNull();
  });
});
