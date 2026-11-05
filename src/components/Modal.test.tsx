// @vitest-environment jsdom
// Fenêtre restée ouverte sous le verrou (posé par-dessus l'app, qui devient `inert`) : Échap
// tapé sur l'écran de verrouillage ne la ferme pas ; une fois l'app rendue, Échap la ferme.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Modal } from './Modal';
import { Dialog } from './Dialog';

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

describe('Fenêtres empilées', () => {
  const Stack = ({ withDialog, onCloseSheet, onCloseDialog }: { withDialog: boolean; onCloseSheet: () => void; onCloseDialog: () => void }) => (
    <>
      <div data-testid="app"><Modal open onClose={onCloseSheet} label="Feuille" variant="sheet"><button>Dans la feuille</button></Modal></div>
      <Dialog state={{ open: withDialog, kind: 'confirm', title: 'Confirmer ?' }} onClose={onCloseDialog} />
      <div role="status" data-testid="toasts" />
    </>
  );

  it('Échap ne ferme que la confirmation posée sur la feuille', () => {
    const sheet = vi.fn(), dialog = vi.fn();
    const { rerender } = render(<Stack withDialog={false} onCloseSheet={sheet} onCloseDialog={dialog} />);
    rerender(<Stack withDialog onCloseSheet={sheet} onCloseDialog={dialog} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(sheet).not.toHaveBeenCalled();
    rerender(<Stack withDialog={false} onCloseSheet={sheet} onCloseDialog={dialog} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(sheet).toHaveBeenCalledTimes(1);
  });

  it('le reste de l’app est inerte tant qu’une fenêtre est ouverte, pas les toasts, et ne l’est plus après', () => {
    const noop = () => {};
    const { rerender, unmount } = render(<Stack withDialog={false} onCloseSheet={noop} onCloseDialog={noop} />);
    const app = document.querySelector('[data-testid="app"]')!;
    const toasts = document.querySelector('[data-testid="toasts"]')!;
    expect(toasts.hasAttribute('inert')).toBe(false);
    rerender(<Stack withDialog onCloseSheet={noop} onCloseDialog={noop} />);
    expect(app.hasAttribute('inert')).toBe(true);
    expect(toasts.hasAttribute('inert')).toBe(false);
    rerender(<Stack withDialog={false} onCloseSheet={noop} onCloseDialog={noop} />);
    expect(app.hasAttribute('inert')).toBe(false);
    unmount();
  });
});
