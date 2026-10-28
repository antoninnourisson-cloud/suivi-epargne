// @vitest-environment jsdom
// « Rendement » : taux après inflation (INSEE, daté), performance des placements, avantage
// fiscal du PER, hypothèses de la projection.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { Yield } from './Yield';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { AccountType, type SavingsAccount } from '../types';

afterEach(cleanup);

const year = new Date().getFullYear();
const acc = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: 'a', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'Banque', totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, movements: [], ...over,
});
const pea = acc({
  id: 'pea', name: 'PEA', type: AccountType.PEA, totalAmount: 1100, ownedAmount: 1100, totalDeposits: 1000,
  movements: [
    { id: 'i', date: '2024-01-01', amount: 1000, label: 'Solde initial', type: 'IN', tag: 'initial' },
    { id: 'v', date: '2025-01-01', amount: 100, label: 'Valorisation (+)', type: 'IN', kind: 'valuation' },
  ],
});

/** Ligne « après inflation … » du tableau, lue en entier (le taux est dans un span insécable). */
const inflationLine = (re: RegExp) => (_: string, el: Element | null) =>
  !!el && el.tagName === 'SPAN' && el.classList.contains('block') && re.test(el.textContent ?? '');

describe('Rendement', () => {
  it("taux après inflation, avec l'année et la source de l'INSEE", () => {
    render(<Yield accounts={[acc({ interestRate: 1.7 })]} fiscalConfig={DEFAULT_FISCAL_CONFIG} />);
    expect(screen.getByRole('heading', { name: 'Rendement', level: 2 })).toBeTruthy();
    const table = screen.getByRole('table', { name: /après inflation/ });
    // Le taux est d'un bloc (jamais coupé à 320 px) : la ligne se lit en entier.
    expect(within(table).getByText(inflationLine(/^après inflation \+0,79\s%$/))).toBeTruthy();
    expect(screen.getByText(/hausse des prix de 2025, 0,9\s% selon l'INSEE/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /source/ }).getAttribute('href')).toBe('https://www.insee.fr/fr/statistiques/8726461');
  });

  it("inflation plus forte que le taux net : rendement après inflation négatif", () => {
    render(<Yield accounts={[acc({ interestRate: 1.7 })]} fiscalConfig={{ ...DEFAULT_FISCAL_CONFIG, inflation: { rate: 3, year: 2026 } }} />);
    expect(screen.getByText(inflationLine(/^après inflation -1,26\s%$/))).toBeTruthy();
    expect(screen.getByText(/hausse des prix de 2026, 3\s% selon l'INSEE/)).toBeTruthy();
  });

  it('performance des placements : gain et rendement annuel ; placement sans taux signalé dans la projection', () => {
    render(<Yield accounts={[pea, acc({ id: 'c', name: 'Crypto', type: AccountType.CRYPTO, totalAmount: 500, ownedAmount: 500 })]} fiscalConfig={DEFAULT_FISCAL_CONFIG} />);
    const table = screen.getByRole('table', { name: /rendement annuel de chaque placement/ });
    const row = within(table).getByRole('row', { name: /PEA/ });
    expect(row.textContent).toMatch(/\+100\s€/);
    expect(row.textContent).toMatch(/\+[\d,]+\s% \/ an/);
    expect(screen.getByText(/PEA : \+[\d,]+\s% par an, la performance observée depuis janvier 2024/)).toBeTruthy();
    expect(screen.getByText(/Crypto : rendement à renseigner/)).toBeTruthy();
  });

  it('performance comparée au Livret A sur la même période (taux datés du Livret A)', () => {
    const livretA = acc({ interestRate: 1.7, rateHistory: [{ date: '2025-02-01', rate: 3 }, { date: '2025-08-01', rate: 2.4 }] });
    render(<Yield accounts={[pea, livretA]} fiscalConfig={DEFAULT_FISCAL_CONFIG} />);
    const row = within(screen.getByRole('table', { name: /rendement annuel de chaque placement/ })).getByRole('row', { name: /PEA/ });
    // Mesure depuis janvier 2024 : un mois à 3 %, puis 2,4 %, puis 1,7 % : moyenne entre 1,7 et 3 %.
    const shown = Number(row.textContent!.match(/Livret A : ([\d,]+)\s% \/ an/)![1].replace(',', '.'));
    expect(shown).toBeGreaterThan(1.7);
    expect(shown).toBeLessThan(3);
    expect(screen.getByText(/ce qu'aurait rapporté le Livret A sur la même période/)).toBeTruthy();
  });

  it('hypothèses prudentes : performance plafonnée, mesure trop courte, crypto jamais projetée', () => {
    const boom = acc({
      id: 'cto', name: 'Compte-titres', type: AccountType.CTO, totalAmount: 3000, ownedAmount: 3000,
      movements: [
        { id: 'i', date: '2022-01-01', amount: 1000, label: 'Solde initial', type: 'IN', tag: 'initial' },
        { id: 'v', date: '2025-01-01', amount: 2000, label: 'Valorisation (+)', type: 'IN', kind: 'valuation' },
      ],
    });
    const recent = acc({
      id: 'pea2', name: 'PEA récent', type: AccountType.PEA, totalAmount: 1100, ownedAmount: 1100,
      movements: [
        { id: 'i', date: `${year - 1}-01-01`, amount: 1000, label: 'Solde initial', type: 'IN', tag: 'initial' },
        { id: 'v', date: `${year}-01-01`, amount: 100, label: 'Valorisation (+)', type: 'IN', kind: 'valuation' },
      ],
    });
    const crypto = acc({
      id: 'c', name: 'Crypto', type: AccountType.CRYPTO, totalAmount: 3000, ownedAmount: 3000,
      movements: [
        { id: 'i', date: '2023-01-01', amount: 1000, label: 'Solde initial', type: 'IN', tag: 'initial' },
        { id: 'v', date: '2025-01-01', amount: 2000, label: 'Valorisation (+)', type: 'IN', kind: 'valuation' },
      ],
    });
    render(<Yield accounts={[boom, recent, crypto]} fiscalConfig={DEFAULT_FISCAL_CONFIG} />);
    const note = screen.getByText('Hypothèses de rendement de la projection').parentElement!;
    expect(note.textContent).toMatch(/Compte-titres : \+8\s% par an\. Sa performance observée depuis janvier 2022 \(\+[\d,]+\s% par an\) est ramenée, par prudence, entre -5\s% et \+8\s% par an/);
    expect(note.textContent).toMatch(/PEA récent, Crypto : rendement à renseigner/);
    expect(note.textContent).toMatch(/crypto varie trop/);
    expect(note.textContent).toMatch(/qu'après 2 ans de suivi/);
  });

  it("PER : impôt en moins au taux marginal, plafond de l'avis d'impôt enregistrable", () => {
    const onSave = vi.fn();
    const per = acc({ id: 'per', name: 'PER', type: AccountType.PER, movements: [{ id: 'p', date: `${year}-03-01`, amount: 1000, label: 'Versement', type: 'IN' }] });
    render(<Yield accounts={[per]} fiscalConfig={DEFAULT_FISCAL_CONFIG} taxableIncome={40_000} retirementCeiling={{ year, amount: 5000 }} onSaveRetirementCeiling={onSave} />);
    const card = screen.getByRole('region', { name: `PER : économie d'impôt ${year}` });
    expect(within(card).getByText('Votre tranche : 30 %')).toBeTruthy();
    expect(within(card).getByText(/lu sur votre avis d'impôt/)).toBeTruthy();
    const input = within(card).getByLabelText(`Plafond épargne retraite ${year} (avis d'impôt)`);
    fireEvent.change(input, { target: { value: '6200' } });
    fireEvent.blur(input);
    fireEvent.click(within(card).getByRole('button', { name: 'Enregistrer' }));
    expect(onSave).toHaveBeenCalledWith({ year, amount: 6200 });
  });

  it("manque à gagner seulement sur un solde de compte courant récent", () => {
    const livret = acc({ interestRate: 1.7, totalAmount: 1000, ownedAmount: 1000 });
    const cc = (checked?: string) => acc({ id: 'cc', name: 'Compte courant', type: AccountType.COMPTE_COURANT, totalAmount: 5000, ownedAmount: 5000, balanceCheckedAt: checked });
    const onConfirmBalance = vi.fn();
    render(<Yield accounts={[livret, cc()]} fiscalConfig={DEFAULT_FISCAL_CONFIG} monthlySpending={1000} onConfirmBalance={onConfirmBalance} />);
    expect(screen.queryByText('Manque à gagner')).toBeNull();
    expect(screen.getByText(/Solde de « Compte courant » jamais vérifié : s'il est toujours de 5\s000\s€, confirmez-le/)).toBeTruthy();
    // Solde inchangé : confirmé en un geste (« Actualiser » n'enregistre que des soldes qui changent).
    fireEvent.click(screen.getByRole('button', { name: /Solde vérifié/ }));
    expect(onConfirmBalance).toHaveBeenCalledWith(expect.objectContaining({ id: 'cc' }));
    cleanup();
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    render(<Yield accounts={[livret, cc(iso)]} fiscalConfig={DEFAULT_FISCAL_CONFIG} monthlySpending={1000} />);
    // Même calcul que l'alerte de l'Accueil (lib/idleCash) : 1 500 € gardés, 3 500 € placés à 1,7 %.
    const note = screen.getByText('Manque à gagner').parentElement!;
    expect(note.textContent).toMatch(/Pécule y garde 1\s500\s€/);
    expect(note.textContent).toMatch(/En plaçant 3\s500\s€ sur le Livret A \(jusqu'à 1,7\s%\)/);
    expect(note.textContent).toMatch(/environ 60\s€\/an/);
    cleanup();
    // Dépenses inconnues : pas de chiffre (le coussin ne peut pas être calculé).
    render(<Yield accounts={[livret, cc(iso)]} fiscalConfig={DEFAULT_FISCAL_CONFIG} />);
    expect(screen.queryByText('Manque à gagner')).toBeNull();
  });

  // Le 1er janvier, aucun intérêt n'est encore acquis sur l'année : rien à comparer.
  it.skipIf(new Date().getMonth() === 0 && new Date().getDate() === 1)("gains d'un livret imposable : option pour le barème signalée si la tranche est à 11 %", () => {
    const boost = acc({ id: 'lb', name: 'Livret Boost', type: AccountType.LIVRET_BANCAIRE, isTaxable: true, interestRate: 3, totalAmount: 10000, ownedAmount: 10000,
      movements: [{ id: 'i', date: `${year - 1}-01-01`, amount: 10000, label: 'Solde initial', type: 'IN', tag: 'initial' }] });
    render(<Yield accounts={[boost]} fiscalConfig={DEFAULT_FISCAL_CONFIG} taxableIncome={20_000} />);
    expect(screen.getByText(/Votre tranche d'impôt est estimée à 11\s%/)).toBeTruthy();
    expect(screen.getByText(/case 2OP de la déclaration/)).toBeTruthy();
    expect(screen.getByText(/Ce n'est qu'une approximation : Pécule applique une seule tranche/)).toBeTruthy();
    cleanup();
    render(<Yield accounts={[boost]} fiscalConfig={DEFAULT_FISCAL_CONFIG} taxableIncome={40_000} />);
    expect(screen.queryByText(/case 2OP/)).toBeNull();
  });

  it('crypto : seuil des 305 € de ventes déjà dépassé, ou dépassé avec ce retrait', () => {
    const wallet = (sold: number) => acc({ id: 'w', name: 'Portefeuille', type: AccountType.CRYPTO, totalAmount: 900, ownedAmount: 900, totalDeposits: 300,
      movements: [{ id: 'o', date: `${year}-01-01`, amount: sold, label: 'Vente', type: 'OUT' }] });
    render(<Yield accounts={[wallet(400)]} fiscalConfig={DEFAULT_FISCAL_CONFIG} />);
    expect(screen.getByText(/vos ventes de l'année dépassent déjà 305/)).toBeTruthy();
    expect(screen.queryByText(/ce retrait dépasserait/)).toBeNull();
    cleanup();
    render(<Yield accounts={[wallet(100)]} fiscalConfig={DEFAULT_FISCAL_CONFIG} />);
    expect(screen.getByText(/avec vos ventes de l'année, ce retrait dépasserait le seuil de 305/)).toBeTruthy();
    expect(screen.queryByText(/dépassent déjà/)).toBeNull();
  });
});
