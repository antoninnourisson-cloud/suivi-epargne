// @vitest-environment jsdom
// Élément de liste et bouton-icône Material 3 : titre jamais coupé, actions nommées,
// cible tactile de 48 px.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Trash2 } from 'lucide-react';
import { IconButton, ListItem } from './index';

afterEach(cleanup);

describe('ListItem', () => {
  it('titre, texte d’appui, valeur et actions ; les actions passent sous le titre sur téléphone', () => {
    render(<ul><ListItem headline="Épargne du mois" supporting="28/09/2026" trailing="+320 €" actions={<button type="button">Agir</button>} /></ul>);
    const item = screen.getByRole('listitem');
    expect(screen.getByText('Épargne du mois').className).toContain('break-words');
    expect(screen.getByText('28/09/2026')).toBeTruthy();
    expect(screen.getByText('+320 €')).toBeTruthy();
    // Rangée de repli sur petit écran (flex-wrap), alignée à la suite du titre dès sm.
    expect(item.className).toContain('flex-wrap');
    expect(screen.getByRole('button', { name: 'Agir' }).parentElement!.className).toContain('w-full');
  });

  it('sans valeur ni actions, ni colonne vide ni rangée vide', () => {
    render(<ul><ListItem headline="Seul" /></ul>);
    const item = screen.getByRole('listitem');
    expect(item.children).toHaveLength(1);
  });

  it('une valeur à zéro reste affichée (0 n’est pas « rien »)', () => {
    render(<ul><ListItem headline="Solde" trailing={0} /></ul>);
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('un élément à gauche est gardé tel quel', () => {
    render(<ul><ListItem headline="Paie" leading={<span data-testid="lead">i</span>} /></ul>);
    expect(screen.getByTestId('lead')).toBeTruthy();
  });
});

describe('IconButton', () => {
  it('nom accessible et infobulle identiques, 48 px de côté, clic transmis', () => {
    const onClick = vi.fn();
    render(<IconButton icon={Trash2} label="Supprimer « Musique »" onClick={onClick} />);
    const b = screen.getByRole('button', { name: 'Supprimer « Musique »' });
    expect(b.getAttribute('title')).toBe('Supprimer « Musique »');
    expect(b.className).toContain('w-12');
    expect(b.className).toContain('h-12');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('l’infobulle peut être plus explicite que le nom, et « danger » se voit', () => {
    render(<IconButton icon={Trash2} tone="danger" label="Annuler" title="Revenir au taux précédent" />);
    const b = screen.getByRole('button', { name: 'Annuler' });
    expect(b.getAttribute('title')).toBe('Revenir au taux précédent');
    expect(b.className).toContain('hover:text-error');
  });
});
