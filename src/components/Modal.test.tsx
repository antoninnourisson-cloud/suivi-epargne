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
