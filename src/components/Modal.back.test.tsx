// @vitest-environment jsdom
// Geste Retour (une entrée d'historique par fenêtre) et clavier à l'écran (la feuille du bas
// remonte au-dessus du clavier).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Modal } from './Modal';

const settle = () => new Promise<void>(r => setTimeout(r, 30));
const entryState = () => window.history.state as { pecModal?: boolean } | null;

describe('Geste Retour', () => {
  afterEach(async () => { cleanup(); await settle(); });

  it("ouvrir pose une entrée ; Retour ferme la fenêtre sans changer l'adresse", async () => {
    window.history.replaceState(null, '', '/?partage=1');
    const onClose = vi.fn();
    const before = window.history.length;
    render(<Modal open onClose={onClose} label="Feuille" variant="sheet"><button>Ok</button></Modal>);
    expect(window.history.length).toBe(before + 1);
    expect(entryState()?.pecModal).toBe(true);
    window.history.back();
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?partage=1');
  });

  it("fermée par Échap puis retirée : l'entrée est retirée, sans second appel", async () => {
    const onClose = vi.fn();
    const Host = ({ open }: { open: boolean }) => <Modal open={open} onClose={onClose} label="Feuille"><button>Ok</button></Modal>;
    const { rerender } = render(<Host open />);
    expect(entryState()?.pecModal).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<Host open={false} />);
    await settle();
    expect(entryState()?.pecModal).toBeFalsy();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fenêtres empilées : un Retour ferme la plus haute seulement', async () => {
    const low = vi.fn(), high = vi.fn();
    const Both = ({ withHigh }: { withHigh: boolean }) => (<>
      <Modal open onClose={low} label="Dessous"><button>A</button></Modal>
      <Modal open={withHigh} onClose={high} label="Dessus"><button>B</button></Modal>
    </>);
    const { rerender } = render(<Both withHigh={false} />);
    rerender(<Both withHigh />);
    window.history.back();
    await settle();
    expect(high).toHaveBeenCalledTimes(1);
    expect(low).not.toHaveBeenCalled();
  });

  it("voile qui ne ferme pas : Retour laisse la fenêtre ouverte et remet l'entrée", async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} label="Parcours" variant="page" closeOnScrim={false}><button>Ok</button></Modal>);
    window.history.back();
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Parcours' })).toBeTruthy();
    expect(entryState()?.pecModal).toBe(true);
    window.history.back();
    await settle();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("fenêtre qui reste ouverte après Retour (confirmation d'abandon) : l'entrée revient", async () => {
    render(<Modal open onClose={() => {}} label="Reste"><button>Ok</button></Modal>);
    window.history.back();
    await new Promise(r => setTimeout(r, 150));
    expect(entryState()?.pecModal).toBe(true);
  });

  it('sous le verrou (fenêtre inerte) : Retour ne ferme pas', async () => {
    const onClose = vi.fn();
    render(<div {...{ inert: true }}><Modal open onClose={onClose} label="Fenêtre"><input aria-label="Champ" /></Modal></div>);
    window.history.back();
    await settle();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Feuille du bas et clavier', () => {
  type FakeVV = EventTarget & { height: number; offsetTop: number; scale: number };
  const fakeViewport = (height: number): FakeVV => Object.assign(new EventTarget(), { height, offsetTop: 0, scale: 1 });
  const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  const install = (vv: FakeVV | undefined) => Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  afterEach(async () => {
    cleanup();
    await settle();
    if (original) Object.defineProperty(window, 'visualViewport', original); else delete (window as unknown as Record<string, unknown>).visualViewport;
  });
  const overlayOf = () => screen.getByRole('dialog').parentElement!;

  it('suit le viewport visuel : variable posée avec le clavier, à zéro sans', () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const vv = fakeViewport(800);
    install(vv);
    render(<Modal open onClose={() => {}} label="Feuille" variant="sheet"><input aria-label="Champ" /></Modal>);
    expect(overlayOf().style.getPropertyValue('--kb-inset')).toBe('0px');
    vv.height = 500;
    vv.dispatchEvent(new Event('resize'));
    expect(overlayOf().style.getPropertyValue('--kb-inset')).toBe('300px');
    vv.height = 790; // barre d'adresse : pas un clavier
    vv.dispatchEvent(new Event('resize'));
    expect(overlayOf().style.getPropertyValue('--kb-inset')).toBe('0px');
  });

  it('pincement (zoom) : pas pris pour un clavier', () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const vv = fakeViewport(400);
    vv.scale = 2;
    install(vv);
    render(<Modal open onClose={() => {}} label="Feuille" variant="sheet"><p>Texte</p></Modal>);
    expect(overlayOf().style.getPropertyValue('--kb-inset')).toBe('0px');
  });

  it('boîte centrée ou sans viewport visuel : rien ne change', () => {
    install(fakeViewport(400));
    const { unmount } = render(<Modal open onClose={() => {}} label="Boîte"><p>Texte</p></Modal>);
    expect(overlayOf().style.getPropertyValue('--kb-inset')).toBe('');
    unmount();
    install(undefined);
    render(<Modal open onClose={() => {}} label="Feuille" variant="sheet"><p>Texte</p></Modal>);
    expect(overlayOf().style.getPropertyValue('--kb-inset')).toBe('');
  });
});
