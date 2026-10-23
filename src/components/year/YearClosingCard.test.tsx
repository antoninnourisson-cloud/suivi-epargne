// @vitest-environment jsdom
// Clôture de l'année (Historique) : étapes dans l'ordre, actions reliées à la navigation, aux
// téléchargements et au fichier (coches, clôture avec confirmation, réouverture).
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AccountType, type GlobalAppData, type SavingsAccount } from '../../types';
import { DEFAULT_FISCAL_CONFIG, LATEST_TAX_SCALE, TAX_SCALES } from '../../constants';

vi.mock('../../services/fileDownload', () => ({ downloadJSON: vi.fn(), downloadCsv: vi.fn() }));
vi.mock('../revealElement', () => ({ revealElementById: vi.fn() }));

import { downloadCsv, downloadJSON } from '../../services/fileDownload';
import { revealElementById } from '../revealElement';
import { YearClosingCard } from './YearClosingCard';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const JAN = new Date(2027, 0, 10, 12);
const base = (config: Partial<GlobalAppData['config']> = {}): GlobalAppData => ({
  accounts: [{
    id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'Banque', totalAmount: 10000, ownedAmount: 10000, parentalCapital: 0,
    interestRate: 3, openingDate: '2020-01-01', balanceCheckedAt: '2026-12-10',
    movements: [{ id: 'i', date: '2020-01-01', amount: 10000, label: 'Solde initial', type: 'IN', tag: 'initial' }],
  }],
  expenses: [], history: [],
  config: { grossAnnual: 0, leisureBudget: 0, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0, ...config },
});

/** Carte reliée à un état local, comme `patchConfig` l'est au document. */
const Harness: React.FC<{ initial: GlobalAppData; now?: Date; spies: ReturnType<typeof makeSpies> }> = ({ initial, now = JAN, spies }) => {
  const [data, setData] = useState(initial);
  return (
    <YearClosingCard
      data={data} now={now}
      onPatchConfig={patch => { spies.patch(patch); setData(d => ({ ...d, config: { ...d.config, ...patch } })); }}
      onUpdateAccounts={update => setData(d => { const accounts = update(d.accounts); spies.accounts(accounts); return { ...d, accounts }; })}
      onUpdateFiscalConfig={update => setData(d => { const fiscalConfig = update(d.fiscalConfig ?? DEFAULT_FISCAL_CONFIG); spies.fiscal(fiscalConfig); return { ...d, fiscalConfig }; })}
      onNavigate={spies.navigate} getArchiveData={() => data} confirm={spies.confirm}
    />
  );
};
const makeSpies = () => ({ patch: vi.fn(), navigate: vi.fn(), confirm: vi.fn(), accounts: vi.fn(), fiscal: vi.fn() });
const stepEl = (id: string) => document.querySelector(`[data-step="${id}"]`) as HTMLElement;

describe('YearClosingCard', () => {
  it('en janvier, ouverte : étapes dans l\'ordre et liens vers les écrans', () => {
    const spies = makeSpies();
    render(<Harness initial={base()} spies={spies} />);
    const card = screen.getByRole('region', { name: 'Clôture de l\'année 2026' });
    expect(card.id).toBe('year-closing');
    expect(within(card).getByText('0 étape sur 6 faite')).toBeTruthy();
    const steps = within(card).getByRole('list', { name: 'Étapes de la clôture 2026' });
    expect(within(steps).getAllByRole('heading', { level: 4 }).map(h => h.textContent)).toEqual([
      '1. Vérifier les soldes au 31 décembre', '2. Enregistrer les intérêts 2026', '3. Votre année 2026',
      '4. Préparer la déclaration des revenus 2026', '5. Paramètres fiscaux 2027', '6. Garder une archive sur cet appareil', '7. Clôturer l\'année 2026',
    ]);
    expect(stepEl('balances').textContent).toContain('À faire : ');
    fireEvent.click(within(stepEl('balances')).getByRole('button', { name: 'Actualiser' }));
    expect(spies.navigate).toHaveBeenCalledWith('update');
    fireEvent.click(within(stepEl('tax-return')).getByRole('button', { name: 'Voir les cases' }));
    expect(spies.navigate).toHaveBeenCalledWith('donations');
    expect(revealElementById).toHaveBeenCalledWith('tax-return');
    fireEvent.click(within(stepEl('fiscal-params')).getByRole('button', { name: 'Ouvrir les paramètres' }));
    expect(spies.navigate).toHaveBeenLastCalledWith('settings');
  });

  it('coches à la main, « Votre année » et archive : enregistrées dans le fichier', () => {
    const spies = makeSpies();
    const opened = vi.fn();
    window.addEventListener('pecule:open-year', opened);
    render(<Harness initial={base()} spies={spies} />);
    fireEvent.click(within(stepEl('interest')).getByRole('checkbox', { name: 'Déjà enregistrés' }));
    expect(spies.patch).toHaveBeenLastCalledWith({ yearClosings: { 2026: { checked: ['interest'] } } });
    expect(stepEl('interest').textContent).toContain('Fait : ');
    fireEvent.click(within(stepEl('review')).getByRole('button', { name: 'Voir votre année 2026' }));
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toBe(2026);
    expect(spies.patch).toHaveBeenLastCalledWith({ yearClosings: { 2026: { checked: ['interest', 'review'] } } });
    window.removeEventListener('pecule:open-year', opened);
    const [json, csv] = within(stepEl('archive')).getAllByRole('button', { name: 'Télécharger' });
    fireEvent.click(json);
    expect(downloadJSON).toHaveBeenCalledWith('pecule-archive-2026.json', expect.objectContaining({ accounts: expect.any(Array) }));
    expect(spies.patch).toHaveBeenLastCalledWith(expect.objectContaining({ lastExportAt: '2027-01-10' }));
    fireEvent.click(csv);
    expect(downloadCsv).toHaveBeenCalledWith('pecule-2026-mouvements-et-soldes.csv', expect.any(Array));
    expect(stepEl('archive').textContent).toMatch(/^Fait : /);
    expect(screen.getByText('3 étapes sur 6 faites')).toBeTruthy();
    // Décocher rend l'étape à faire.
    fireEvent.click(within(stepEl('interest')).getByRole('checkbox', { name: 'Déjà enregistrés' }));
    expect(stepEl('interest').textContent).toContain('À faire : ');
  });

  it('clôturer avec des étapes en suspens demande confirmation, puis rouvrir', () => {
    const spies = makeSpies();
    render(<Harness initial={base()} spies={spies} />);
    fireEvent.click(within(stepEl('close')).getByRole('button', { name: 'Clôturer 2026' }));
    expect(spies.confirm).toHaveBeenCalledWith('Clôturer l\'année 2026 ?', expect.stringMatching(/^Il reste 6 étapes : Vérifier les soldes/), expect.any(Function), false, 'Clôturer 2026');
    expect(spies.patch).not.toHaveBeenCalled();
    act(() => { spies.confirm.mock.calls[0][2](); });
    expect(spies.patch).toHaveBeenLastCalledWith({ yearClosings: { 2026: { closedOn: '2027-01-10' } } });
    expect(screen.getByText('Année clôturée : plus de rappel de clôture.')).toBeTruthy();
    fireEvent.click(within(stepEl('close')).getByRole('button', { name: 'Rouvrir' }));
    expect(spies.patch).toHaveBeenLastCalledWith({ yearClosings: { 2026: {} } });
    expect(screen.getByText('0 étape sur 6 faite')).toBeTruthy();
  });

  it('tout fait : clôture sans confirmation', () => {
    const spies = makeSpies();
    const done = base({ yearClosings: { 2026: { checked: ['interest', 'review', 'tax-return', 'archive-json', 'archive-csv'] } } });
    done.accounts[0].balanceCheckedAt = '2027-01-02';
    done.fiscalConfig = { ...DEFAULT_FISCAL_CONFIG, paramsReviewedYear: 2027 };
    render(<Harness initial={done} spies={spies} />);
    expect(screen.getByText('6 étapes sur 6 faites')).toBeTruthy();
    fireEvent.click(within(stepEl('close')).getByRole('button', { name: 'Clôturer 2026' }));
    expect(spies.confirm).not.toHaveBeenCalled();
    expect(spies.patch).toHaveBeenCalledWith({ yearClosings: { 2026: { checked: expect.any(Array), closedOn: '2027-01-10' } } });
  });

  it('« Taux inchangé » est noté sur le compte ; barème et paramètres fiscaux dans les réglages', () => {
    const spies = makeSpies();
    const av: SavingsAccount = {
      id: 'av', name: 'Assurance vie', type: AccountType.ASSURANCE_VIE, institution: 'Assureur', totalAmount: 5000, ownedAmount: 5000, parentalCapital: 0,
      totalDeposits: 4000, openingDate: '2022-01-01', balanceCheckedAt: '2027-01-05', movements: [],
    };
    const initial = { ...base(), accounts: [av], fiscalConfig: { ...DEFAULT_FISCAL_CONFIG, taxBrackets: TAX_SCALES[0].brackets, taxScaleYear: TAX_SCALES[0].year } };
    render(<Harness initial={initial} spies={spies} />);
    fireEvent.click(within(stepEl('statements')).getByRole('button', { name: 'Taux inchangé' }));
    expect(spies.accounts).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'av', rateReviewedAt: '2027-01-10' })]);
    expect(spies.patch).not.toHaveBeenCalled();
    expect(stepEl('statements').textContent).toMatch(/^Fait : /);
    fireEvent.click(within(stepEl('fiscal-params')).getByRole('button', { name: 'Appliquer' }));
    expect(spies.fiscal).toHaveBeenLastCalledWith(expect.objectContaining({ taxScaleYear: LATEST_TAX_SCALE.year }));
    fireEvent.click(within(stepEl('fiscal-params')).getByRole('button', { name: 'C\'est à jour' }));
    expect(spies.fiscal).toHaveBeenLastCalledWith(expect.objectContaining({ paramsReviewedYear: 2027 }));
    expect(stepEl('fiscal-params').textContent).toMatch(/^Fait : /);
  });

  it('hors saison ou déjà clôturée : repliée, dépliable', () => {
    const spies = makeSpies();
    render(<Harness initial={base({ yearClosings: { 2026: { closedOn: '2027-01-12' } } })} now={new Date(2027, 1, 10)} spies={spies} />);
    const toggle = screen.getByRole('button', { name: 'Voir les étapes' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: 'Étapes de la clôture 2026' })).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Masquer les étapes' }).getAttribute('aria-expanded')).toBe('true');
    expect(stepEl('close').textContent).toContain('Année clôturée le 12 janvier');
    cleanup();
    render(<Harness initial={base()} now={new Date(2027, 5, 10)} spies={spies} />);
    expect(screen.getByRole('button', { name: 'Voir les étapes' })).toBeTruthy();
  });
});
