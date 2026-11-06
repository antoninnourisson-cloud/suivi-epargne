// @vitest-environment jsdom
// Envies : liste groupée par catégorie avec totaux, phrase de comparaison avec l'argent
// disponible, ajout, modification (date du prix), suppression avec « Annuler », catégories,
// « Je l'achète » (parcours prérempli), section « Achetées ».
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import type { Wish } from '../types';
import type { EmergencyFund } from '../lib/planning';
import { Wishes } from './Wishes';
import { ToastContext, type ToastItem } from './Toast';
import type { NeedPrefill } from './need/NeedMoneySheet';

// Le 5 novembre 2026.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const wish = (id: string, name: string, price: number, over: Partial<Wish> = {}): Wish =>
  ({ id, name, price, priceDate: '2026-10-20', category: 'Maison', ...over });

const emergency = (current: number, target = 5000) => ({ target, current, cashBuffer: 0, months: 3, monthlySpending: 1500, missing: Math.max(0, target - current), pct: 100, reached: current >= target }) as EmergencyFund;

// Espaces insécables et fines de formatEUR : on compare sans espaces.
const flat = (el: Element | null) => (el?.textContent ?? '').replace(/\s/g, '');

interface HarnessProps {
  initial?: Wish[];
  categories?: string[];
  emergencyFund?: EmergencyFund | null;
  onBuy?: (p: NeedPrefill) => void;
  toasts?: Omit<ToastItem, 'id'>[];
  onCategories?: (c: string[]) => void;
}
const Harness: React.FC<HarnessProps> = ({ initial = [], categories, emergencyFund = emergency(7300), onBuy = () => {}, toasts = [], onCategories }) => {
  const [list, setList] = useState(initial);
  const [cats, setCats] = useState(categories);
  return (
    <ToastContext.Provider value={t => { toasts.push(t); return 'toast'; }}>
      <Wishes wishes={list} categories={cats} onUpdateWishes={setList} onUpdateCategories={c => { setCats(c); onCategories?.(c); }} emergency={emergencyFund} onBuy={onBuy} />
    </ToastContext.Provider>
  );
};

const SAMPLE = [
  wish('a', 'Aspirateur robot', 349),
  wish('b', 'Lampe', 89, { note: 'Blanche' }),
  wish('c', 'Atlas du monde', 45, { category: 'Livres', priceDate: '2026-08-04' }),
  wish('d', 'Vélo électrique', 1490, { category: 'Gros projets', url: 'https://www.exemple.fr/velo' }),
];

describe('Envies', () => {
  it('liste vide : accueil et bouton d’ajout, pas de total', () => {
    render(<Harness />);
    expect(screen.getByText("Aucune envie pour l'instant")).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Ajouter une envie' })).toHaveLength(1);
    expect(screen.queryByText(/Vos envies :/)).toBeNull();
  });

  it('groupée par catégorie, total de chaque catégorie, total général et comparaison avec l’argent disponible', () => {
    render(<Harness initial={SAMPLE} />);
    const maison = screen.getByRole('region', { name: 'Maison' });
    expect(within(maison).getAllByRole('listitem')).toHaveLength(2);
    expect(flat(maison.querySelector('h3')!.parentElement)).toContain('438€');
    expect(flat(screen.getByRole('region', { name: 'Livres' }))).toContain('45€');
    expect(flat(screen.getByRole('region', { name: 'Gros projets' }))).toContain('1490€');
    const summary = screen.getByRole('region', { name: "Vos envies et l'argent disponible" });
    expect(flat(summary)).toContain('Vosenvies:1973€.');
    // 7 300 − 5 000 = 2 300 € au-dessus de l'objectif de précaution.
    expect(flat(summary)).toContain('Disponiblesanstoucheràvotreépargnedeprécaution:2300€.');
    expect(summary.textContent).toContain('Tout est possible');
  });

  it('dit ce qui manque quand les envies dépassent l’argent disponible, et reste sobre sans jauge', () => {
    const { unmount } = render(<Harness initial={SAMPLE} emergencyFund={emergency(5500)} />);
    const summary = screen.getByRole('region', { name: "Vos envies et l'argent disponible" });
    expect(flat(summary)).toContain('Disponiblesanstoucheràvotreépargnedeprécaution:500€.');
    expect(flat(summary)).toContain('Ilmanque1473€');
    unmount();
    render(<Harness initial={SAMPLE} emergencyFund={null} />);
    const s2 = screen.getByRole('region', { name: "Vos envies et l'argent disponible" });
    expect(flat(s2)).toBe('Vosenvies:1973€.');
  });

  it('prix de plus de 3 mois : mention discrète « à revérifier », pas pour un prix récent', () => {
    render(<Harness initial={SAMPLE} />);
    expect(screen.getByText('prix du 4 août : à revérifier')).toBeTruthy();
    expect(screen.getAllByText(/à revérifier/)).toHaveLength(1);
  });

  it('lien : nouvel onglet, rel sécurisé, nom du site', () => {
    render(<Harness initial={SAMPLE} />);
    const link = screen.getByRole('link', { name: /Voir sur exemple\.fr/ });
    expect(link.getAttribute('href')).toBe('https://www.exemple.fr/velo');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('ajout : nom et prix obligatoires, lien http(s) seulement, catégorie choisie, date du prix = aujourd’hui', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une envie' }));
    const sheet = screen.getByRole('dialog', { name: 'Nouvelle envie' });
    fireEvent.click(within(sheet).getByRole('button', { name: "Ajouter l'envie" }));
    expect(within(sheet).getByText("Donnez un nom à l'envie.")).toBeTruthy();
    expect(within(sheet).getByText('Saisissez un prix supérieur à 0.')).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText('Nom'), { target: { value: 'Roman' } });
    fireEvent.change(within(sheet).getByLabelText('Prix'), { target: { value: '12,5' } });
    fireEvent.change(within(sheet).getByLabelText('Lien (facultatif)'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(within(sheet).getByRole('button', { name: "Ajouter l'envie" }));
    expect(within(sheet).getByText('Le lien doit commencer par http:// ou https://.')).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText('Lien (facultatif)'), { target: { value: 'exemple.fr/roman' } });
    expect((within(sheet).getByLabelText('Prix relevé le') as HTMLInputElement).value).toBe('2026-11-05');
    fireEvent.change(within(sheet).getByLabelText('Catégorie'), { target: { value: 'Livres' } });
    fireEvent.change(within(sheet).getByLabelText('Note (facultative)'), { target: { value: 'Poche' } });
    fireEvent.click(within(sheet).getByRole('button', { name: "Ajouter l'envie" }));
    expect(screen.queryByRole('dialog', { name: 'Nouvelle envie' })).toBeNull();
    const livres = screen.getByRole('region', { name: 'Livres' });
    expect(livres.textContent).toContain('Roman');
    expect(livres.textContent).toContain('Poche');
    expect(flat(livres)).toContain('12,50€');
    expect(within(livres).getByRole('link', { name: /exemple\.fr/ }).getAttribute('href')).toBe('https://exemple.fr/roman');
  });

  it('modification : le prix change, sa date repasse à aujourd’hui ; sans changement de prix, la date reste', () => {
    render(<Harness initial={[wish('c', 'Atlas du monde', 45, { category: 'Livres', priceDate: '2026-08-04' })]} />);
    expect(screen.getByText('prix du 4 août : à revérifier')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Atlas du monde' }));
    let sheet = screen.getByRole('dialog', { name: "Modifier l'envie" });
    const price = within(sheet).getByLabelText('Prix');
    // Entrer dans le champ puis le quitter sans rien changer : la date ne bouge pas.
    fireEvent.focus(price);
    fireEvent.blur(price);
    expect((within(sheet).getByLabelText('Prix relevé le') as HTMLInputElement).value).toBe('2026-08-04');
    fireEvent.focus(price);
    fireEvent.change(price, { target: { value: '49' } });
    fireEvent.blur(price);
    expect((within(sheet).getByLabelText('Prix relevé le') as HTMLInputElement).value).toBe('2026-11-05');
    fireEvent.change(within(sheet).getByLabelText('Nom'), { target: { value: 'Grand atlas' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByText('Grand atlas')).toBeTruthy();
    expect(flat(screen.getByRole('region', { name: 'Livres' }))).toContain('49€');
    expect(screen.queryByText(/à revérifier/)).toBeNull();
    // Réouverture : la date enregistrée est celle d'aujourd'hui.
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Grand atlas' }));
    sheet = screen.getByRole('dialog', { name: "Modifier l'envie" });
    expect((within(sheet).getByLabelText('Prix relevé le') as HTMLInputElement).value).toBe('2026-11-05');
  });

  it('suppression : retirée tout de suite, « Annuler » la remet à sa place', () => {
    const toasts: Omit<ToastItem, 'id'>[] = [];
    render(<Harness initial={SAMPLE} toasts={toasts} />);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer Aspirateur robot' }));
    expect(screen.queryByText('Aspirateur robot')).toBeNull();
    expect(flat(screen.getByRole('region', { name: 'Maison' }))).toContain('89€');
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Envie « Aspirateur robot » supprimée');
    expect(toasts[0].action?.label).toBe('Annuler');
    React.act(() => toasts[0].action!.onClick());
    const items = within(screen.getByRole('region', { name: 'Maison' })).getAllByRole('listitem');
    expect(items[0].textContent).toContain('Aspirateur robot');
    expect(items).toHaveLength(2);
  });

  it('« Je l’achète » ouvre le parcours avec le prix et le nom ; l’envie ne bouge qu’une fois le retrait enregistré', () => {
    const onBuy = vi.fn();
    render(<Harness initial={SAMPLE} onBuy={onBuy} />);
    fireEvent.click(screen.getByRole('button', { name: "Je l'achète : Lampe" }));
    expect(onBuy).toHaveBeenCalledTimes(1);
    const prefill = onBuy.mock.calls[0][0] as NeedPrefill;
    expect(prefill).toMatchObject({ amount: 89, label: 'Lampe' });
    // Parcours abandonné : rien n'a changé.
    expect(screen.getByText('Lampe')).toBeTruthy();
    expect(screen.queryByText(/Achetées/)).toBeNull();
    // Retrait enregistré ou prévu : l'envie passe dans « Achetées ».
    React.act(() => prefill.onDone?.(85)); // montant finalement demandé dans le parcours
    expect(screen.queryByRole('button', { name: "Je l'achète : Lampe" })).toBeNull();
    expect(flat(screen.getByRole('region', { name: 'Maison' }))).toContain('349€');
    const toggle = screen.getByRole('button', { name: 'Achetées (1)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: 'Envies achetées' })).toBeNull();
    fireEvent.click(toggle);
    const bought = screen.getByRole('list', { name: 'Envies achetées' });
    expect(bought.textContent).toContain('Lampe');
    expect(bought.textContent).toContain('5 novembre');
    expect(flat(bought)).toContain('85€'); // le prix payé, pas celui de l'envie
  });

  it('achetées : « Remettre en envie » et « Supprimer »', () => {
    const toasts: Omit<ToastItem, 'id'>[] = [];
    render(<Harness initial={[wish('a', 'Casque', 199, { category: 'Tech', boughtAt: '2026-10-10', boughtPrice: 189 }), wish('b', 'Lampe', 89)]} toasts={toasts} />);
    fireEvent.click(screen.getByRole('button', { name: 'Achetées (1)' }));
    expect(flat(screen.getByRole('list', { name: 'Envies achetées' }))).toContain('189€');
    // Total des envies : sans l'achetée.
    expect(flat(screen.getByRole('region', { name: "Vos envies et l'argent disponible" }))).toContain('Vosenvies:89€.');
    fireEvent.click(screen.getByRole('button', { name: 'Remettre en envie : Casque' }));
    expect(screen.queryByRole('button', { name: /Achetées/ })).toBeNull();
    expect(flat(screen.getByRole('region', { name: 'Tech' }))).toContain('199€');
    expect(flat(screen.getByRole('region', { name: "Vos envies et l'argent disponible" }))).toContain('Vosenvies:288€.');
  });

  it('catégories : ajout, renommage (les envies suivent), retrait avec déplacement', async () => {
    const saved: string[][] = [];
    render(<Harness initial={SAMPLE} onCategories={c => saved.push(c)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Catégories' }));
    const sheet = screen.getByRole('dialog', { name: 'Catégories des envies' });
    expect(within(sheet).getAllByRole('listitem').map(li => li.querySelector('p')?.textContent)).toEqual(['Maison', 'Livres', 'Gros projets', 'Loisirs', 'Tech']);
    // Ajout, refus d'un doublon.
    fireEvent.change(within(sheet).getByLabelText('Nouvelle catégorie'), { target: { value: 'maison' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ajouter' }));
    expect(within(sheet).getByRole('alert').textContent).toBe('Cette catégorie existe déjà.');
    fireEvent.change(within(sheet).getByLabelText('Nouvelle catégorie'), { target: { value: 'Voyages' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ajouter' }));
    expect(saved.at(-1)).toEqual(['Maison', 'Livres', 'Gros projets', 'Loisirs', 'Tech', 'Voyages']);
    // Renommage : l'envie « Atlas du monde » suit sa catégorie.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Renommer Livres' }));
    fireEvent.change(within(sheet).getByLabelText('Nouveau nom de Livres'), { target: { value: 'Lecture' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enregistrer' }));
    expect(saved.at(-1)).toContain('Lecture');
    // Retrait d'une catégorie sans envie : direct.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Retirer Loisirs' }));
    expect(saved.at(-1)).not.toContain('Loisirs');
    // Retrait d'une catégorie qui a des envies : choix du déplacement, Annuler ne change rien.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Retirer Maison' }));
    expect(within(sheet).getByText(/« Maison » a encore 2 envies/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Annuler' }));
    expect(saved.at(-1)).toContain('Maison');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Retirer Maison' }));
    fireEvent.change(within(sheet).getByLabelText('Déplacer ses envies vers'), { target: { value: 'Tech' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Déplacer et retirer' }));
    expect(saved.at(-1)).not.toContain('Maison');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Terminé' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('region', { name: 'Maison' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Tech' })).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Lecture' }).textContent).toContain('Atlas du monde');
  });
});
