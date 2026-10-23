// @vitest-environment jsdom
// Boîte de dialogue Material 3 et boutons du kit : champ de saisie relié à un libellé visible,
// pas de croix, bouton destructeur au rôle « error », focus sur « Annuler » pour une action
// dangereuse ; bouton désactivé visiblement différent d'un bouton actif.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Dialog, type DialogState } from './Dialog';
import { Button, buttonClass } from './Button';

afterEach(cleanup);

const renderDialog = (state: Partial<DialogState>) => {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(<Dialog state={{ open: true, kind: 'confirm', title: 'Titre', onConfirm, ...state }} onClose={onClose} />);
  return { onClose, onConfirm };
};

describe('Dialog', () => {
  it('saisie : le champ a un libellé visible et relié, Entrée valide la nouvelle valeur', () => {
    const { onClose, onConfirm } = renderDialog({ kind: 'prompt', title: 'Renommer le mouvement', defaultValue: 'Courses', confirmLabel: 'Renommer' });
    const field = screen.getByLabelText('Nouveau libellé') as HTMLInputElement;
    expect(field.value).toBe('Courses');
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: 'Courses du samedi' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith('Courses du samedi');
    expect(onClose).toHaveBeenCalled();
  });

  it('saisie : le libellé du champ peut être précisé', () => {
    renderDialog({ kind: 'prompt', inputLabel: 'Nom du compte' });
    expect(screen.getByLabelText('Nom du compte')).toBeTruthy();
  });

  it("pas de croix : on ferme par « Annuler », sans rien confirmer", () => {
    const { onClose, onConfirm } = renderDialog({ message: 'Explication' });
    expect(screen.queryByRole('button', { name: 'Fermer' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Titre' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirmation simple : « Confirmer » appelle onConfirm sans valeur', () => {
    const { onConfirm } = renderDialog({});
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it('action dangereuse : bouton au rôle « error », focus sur le bouton qui ne détruit rien', () => {
    renderDialog({ danger: true, title: 'Supprimer ?', confirmLabel: 'Supprimer', cancelLabel: 'Garder' });
    const destroy = screen.getByRole('button', { name: 'Supprimer' });
    expect(destroy.className).toContain('bg-error');
    expect(destroy.className).not.toMatch(/rose|indigo/);
    expect(document.activeElement?.textContent).toBe('Garder');
  });
});

describe('Button', () => {
  it('désactivé : état Material 3 (fond et contenu atténués), pas un simple voile', () => {
    render(<><Button disabled>Tout enregistrer</Button><Button variant="tonal">Valider</Button></>);
    const off = screen.getByRole('button', { name: 'Tout enregistrer' }) as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    expect(off.className).toContain('disabled:bg-on-surface/12');
    expect(off.className).toContain('disabled:text-on-surface/38');
    expect(off.className).not.toContain('opacity-40');
    // Le survol ne s'applique qu'à un bouton actif.
    expect(off.className).not.toMatch(/(^|\s)hover:/);
  });

  it('chaque variante repose sur les rôles de couleur (aucune ancienne palette)', () => {
    for (const v of ['filled', 'tonal', 'outlined', 'text', 'danger'] as const) {
      expect(buttonClass(v)).not.toMatch(/indigo|slate|rose|emerald/);
    }
    expect(buttonClass('filled')).toContain('bg-primary');
    expect(buttonClass('danger', 'w-full')).toContain('w-full');
  });

  it('tailles Material : 40 px (24 px de marge, 12 px pour un bouton texte) ou 32 px en « sm »', () => {
    const tokens = (c: string) => c.split(/\s+/);
    expect(tokens(buttonClass('filled'))).toEqual(expect.arrayContaining(['h-10', 'px-6']));
    expect(tokens(buttonClass('text'))).toEqual(expect.arrayContaining(['h-10', 'px-3']));
    expect(tokens(buttonClass('text'))).not.toContain('px-6');
    expect(tokens(buttonClass('outlined', '', 'sm'))).toEqual(expect.arrayContaining(['h-8', 'px-3']));
    expect(tokens(buttonClass('outlined', '', 'sm'))).not.toContain('h-10');
    render(<Button size="sm" variant="tonal">Exporter</Button>);
    expect(screen.getByRole('button', { name: 'Exporter' }).className.split(/\s+/)).toContain('h-8');
  });

  it('en cours : désactivé, avec le texte « Enregistrement… »', () => {
    render(<Button isLoading>Enregistrer</Button>);
    const b = screen.getByRole('button') as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.textContent).toContain('Enregistrement…');
  });
});
