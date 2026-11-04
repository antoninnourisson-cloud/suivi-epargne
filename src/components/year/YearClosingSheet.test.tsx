// @vitest-environment jsdom
// Feuille « Clôture de l'année » : étapes dans l'ordre, saisies sur place (intérêts crédités et
// leur écart, soldes, taux servi, objectif) enregistrées en une fois, récapitulatif de la
// restitution, et les étapes à boutons (coches, archive, « Votre année », clôture).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AccountType, type GlobalAppData, type SavingsAccount } from '../../types';
import { DEFAULT_FISCAL_CONFIG, LATEST_TAX_SCALE, TAX_SCALES } from '../../constants';
import { recordYearClosing } from '../../lib/commands';

vi.mock('../../services/fileDownload', () => ({ downloadJSON: vi.fn(), downloadCsv: vi.fn() }));
vi.mock('../revealElement', () => ({ revealElementById: vi.fn() }));

import { downloadCsv, downloadJSON } from '../../services/fileDownload';
import { revealElementById } from '../revealElement';
import { YearClosingSheet, type YearGoalChange } from './YearClosingSheet';
import { YearClosingCard } from './YearClosingCard';

const JAN = new Date(2027, 0, 10, 12);
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(JAN); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

const livretA = (over: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id: 'la', name: 'Livret A', type: AccountType.LIVRET_A, institution: 'Banque', totalAmount: 10000, ownedAmount: 10000, parentalCapital: 0,
  interestRate: 3, openingDate: '2020-01-01', balanceCheckedAt: '2026-12-10',
  movements: [{ id: 'i', date: '2020-01-01', amount: 10000, label: 'Solde initial', type: 'IN', tag: 'initial' }],
  ...over,
});
const base = (config: Partial<GlobalAppData['config']> = {}, accounts: SavingsAccount[] = [livretA()]): GlobalAppData => ({
  accounts, expenses: [], history: [],
  config: { grossAnnual: 0, leisureBudget: 0, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0, ...config },
});

/** Feuille reliée à un état local, comme dans l'app (commande groupée, réglages). */
const Harness: React.FC<{ initial: GlobalAppData; spies: ReturnType<typeof makeSpies> }> = ({ initial, spies }) => {
  const [data, setData] = useState(initial);
  return (
    <YearClosingSheet
      year={2026} data={data} now={JAN}
      onRecord={(input, goal) => {
        spies.record(input, goal);
        const r = recordYearClosing({ accounts: data.accounts }, input);
        if (!r.ok && !goal) return r.error;
        setData(d => ({
          ...d, accounts: r.ok ? r.next.accounts ?? d.accounts : d.accounts,
          config: goal ? { ...d.config, yearGoals: { ...(d.config.yearGoals ?? {}), [String(goal.year)]: goal.amount as number } } : d.config,
        }));
        return null;
      }}
      onPatchConfig={patch => { spies.patch(patch); setData(d => ({ ...d, config: { ...d.config, ...patch } })); }}
      onUpdateFiscalConfig={update => setData(d => { const fiscalConfig = update(d.fiscalConfig ?? DEFAULT_FISCAL_CONFIG); spies.fiscal(fiscalConfig); return { ...d, fiscalConfig }; })}
      onNavigate={spies.navigate} getArchiveData={() => data} confirm={spies.confirm} onClose={spies.close}
    />
  );
};
const makeSpies = () => ({ patch: vi.fn(), navigate: vi.fn(), confirm: vi.fn(), fiscal: vi.fn(), close: vi.fn(), record: vi.fn() });
const stepEl = (id: string) => document.querySelector(`[data-step="${id}"]`) as HTMLElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('YearClosingSheet', () => {
  it('étapes dans l\'ordre, saisies sur place, boutons gardés', () => {
    const spies = makeSpies();
    render(<Harness initial={base()} spies={spies} />);
    const dialog = screen.getByRole('dialog', { name: 'Clôture de l\'année 2026' });
    expect(within(dialog).getByText('0 étape sur 6 faite')).toBeTruthy();
    const steps = within(dialog).getByRole('list', { name: 'Étapes de la clôture 2026' });
    expect(within(steps).getAllByRole('heading', { level: 4 }).map(h => h.textContent)).toEqual([
      '1. Vérifier les soldes au 31 décembre', '2. Enregistrer les intérêts 2026', '3. Votre année 2026',
      '4. Préparer la déclaration des revenus 2026', '5. Paramètres fiscaux 2027', '6. Garder une archive sur cet appareil', '7. Clôturer l\'année 2026',
    ]);
    // Plus de renvoi vers Actualiser : les soldes et les intérêts se saisissent ici.
    expect(within(stepEl('balances')).queryByRole('button', { name: 'Actualiser' })).toBeNull();
    expect(within(stepEl('balances')).getByLabelText('Solde au 31 décembre, Livret A')).toBeTruthy();
    fireEvent.click(within(stepEl('tax-return')).getByRole('button', { name: 'Voir les cases' }));
    expect(spies.navigate).toHaveBeenCalledWith('donations');
    expect(spies.close).toHaveBeenCalled();
    expect(revealElementById).toHaveBeenCalledWith('tax-return');
    fireEvent.click(within(stepEl('fiscal-params')).getByRole('button', { name: 'Ouvrir les paramètres' }));
    expect(spies.navigate).toHaveBeenLastCalledWith('settings');
  });

  it('intérêt crédité différent du calcul : l\'écart, puis sa cause au-delà de 5 €, et un seul enregistrement', () => {
    const spies = makeSpies();
    render(<Harness initial={base()} spies={spies} />);
    const step = stepEl('interest');
    expect(step.textContent).toContain('Calculé par Pécule : 300,00');
    const field = within(step).getByLabelText('Crédité par la banque, Livret A') as HTMLInputElement;
    expect(field.value).toBe('300,00');
    expect(step.querySelector('[data-gap]')).toBeNull();
    type('Crédité par la banque, Livret A', '297,70');
    expect(step.textContent).toMatch(/2,30\s€ de moins que prévu\./);
    expect(step.textContent).not.toContain('Causes possibles');
    type('Crédité par la banque, Livret A', '310');
    expect(step.textContent).toMatch(/10,00\s€ de plus que prévu\. Causes possibles : un retrait en milieu de quinzaine, ou un taux changé en cours d'année\./);
    // Le solde au 31 décembre proposé comprend les intérêts saisis.
    expect((screen.getByLabelText('Solde au 31 décembre, Livret A') as HTMLInputElement).value).toBe('10310');

    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
    expect(spies.record).toHaveBeenCalledTimes(1);
    const [input] = spies.record.mock.calls[0];
    expect(input.updates).toEqual([expect.objectContaining({ accountId: 'la', date: '2026-12-31', owned: 10310, interest: 310, interestLabel: 'Intérêts 2026' })]);
    expect(spies.close).toHaveBeenCalled();
    expect(stepEl('interest').textContent).toMatch(/^Fait : /);
  });

  it('objectif prérempli avec le mis de côté de l\'année, modifiable', () => {
    const spies = makeSpies();
    render(<Harness initial={base()} spies={spies} />);
    const goal = within(stepEl('review')).getByLabelText('Objectif 2027') as HTMLInputElement;
    expect(goal.value).toBe('0');
    type('Objectif 2027', '9 000');
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
    expect(spies.record.mock.calls[0][1]).toEqual<YearGoalChange>({ year: 2027, amount: 9000 });
  });

  it('restitution à faire : capital des parents compte par compte, total et intérêts qui vous restent', () => {
    const spies = makeSpies();
    const accounts: SavingsAccount[] = [
      livretA({ totalAmount: 9460, ownedAmount: 5000, parentalCapital: 4460, movements: [{ id: 'i', date: '2020-01-01', amount: 5000, label: 'Solde initial', type: 'IN', tag: 'initial' }, { id: 'p', date: '2020-01-01', amount: 4460, label: 'Part des parents', type: 'IN', kind: 'parental' }] }),
      { ...livretA(), id: 'lep', name: 'LEP', type: AccountType.LEP, totalAmount: 5000, ownedAmount: 0, parentalCapital: 5000, movements: [{ id: 'p2', date: '2020-01-01', amount: 5000, label: 'Part des parents', type: 'IN', kind: 'parental' }] },
    ];
    render(<Harness initial={base({}, accounts)} spies={spies} />);
    const step = stepEl('restitution');
    expect(step.textContent).toMatch(/Livret A : 4\s460\s€ · LEP : 5\s000\s€/);
    expect(step.textContent).toMatch(/Total à rendre : 9\s460\s€/);
    expect(step.textContent).toMatch(/Les intérêts 2026 vous restent, y compris les \d+\s€ produits par le capital de vos parents\./);
    fireEvent.click(within(step).getByRole('button', { name: 'Préparer la restitution' }));
    expect(spies.navigate).toHaveBeenCalledWith('parental');
  });

  it('coches à la main, « Votre année » et archive : enregistrées dans le fichier', () => {
    const spies = makeSpies();
    const opened = vi.fn();
    window.addEventListener('pecule:open-year', opened);
    render(<Harness initial={base()} spies={spies} />);
    fireEvent.click(within(stepEl('interest')).getByRole('checkbox', { name: 'Déjà enregistrés' }));
    expect(spies.patch).toHaveBeenLastCalledWith({ yearClosings: { 2026: { checked: ['interest'] } } });
    const [json, csv] = within(stepEl('archive')).getAllByRole('button', { name: 'Télécharger' });
    fireEvent.click(json);
    expect(downloadJSON).toHaveBeenCalledWith('pecule-archive-2026.json', expect.objectContaining({ accounts: expect.any(Array) }));
    expect(spies.patch).toHaveBeenLastCalledWith(expect.objectContaining({ lastExportAt: '2027-01-10' }));
    fireEvent.click(csv);
    expect(downloadCsv).toHaveBeenCalledWith('pecule-2026-mouvements-et-soldes.csv', expect.any(Array));
    expect(stepEl('archive').textContent).toMatch(/^Fait : /);
    fireEvent.click(within(stepEl('review')).getByRole('button', { name: 'Voir votre année 2026' }));
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toBe(2026);
    expect(spies.navigate).toHaveBeenLastCalledWith('history');
    window.removeEventListener('pecule:open-year', opened);
  });

  it('clôturer avec des étapes en suspens demande confirmation, puis rouvrir', () => {
    const spies = makeSpies();
    render(<Harness initial={base()} spies={spies} />);
    fireEvent.click(within(stepEl('close')).getByRole('button', { name: 'Clôturer 2026' }));
    expect(spies.confirm).toHaveBeenCalledWith('Clôturer l\'année 2026 ?', expect.stringMatching(/^Il reste 6 étapes : Vérifier les soldes/), expect.any(Function), false, 'Clôturer 2026');
    act(() => { spies.confirm.mock.calls[0][2](); });
    expect(spies.patch).toHaveBeenLastCalledWith({ yearClosings: { 2026: { closedOn: '2027-01-10' } } });
    expect(screen.getByText('Année clôturée : plus de rappel de clôture.')).toBeTruthy();
    fireEvent.click(within(stepEl('close')).getByRole('button', { name: 'Rouvrir' }));
    expect(spies.patch).toHaveBeenLastCalledWith({ yearClosings: { 2026: {} } });
  });

  it('taux servi : « Taux inchangé » remplit le champ, noté au compte à l\'enregistrement ; barème et paramètres fiscaux', () => {
    const spies = makeSpies();
    const av: SavingsAccount = {
      id: 'av', name: 'Assurance vie', type: AccountType.ASSURANCE_VIE, institution: 'Assureur', totalAmount: 5000, ownedAmount: 5000, parentalCapital: 0,
      totalDeposits: 4000, interestRate: 2.5, openingDate: '2022-01-01', balanceCheckedAt: '2027-01-05', movements: [],
    };
    const initial = { ...base({}, [av]), fiscalConfig: { ...DEFAULT_FISCAL_CONFIG, taxBrackets: TAX_SCALES[0].brackets, taxScaleYear: TAX_SCALES[0].year } };
    render(<Harness initial={initial} spies={spies} />);
    fireEvent.click(within(stepEl('statements')).getByRole('button', { name: 'Taux inchangé' }));
    expect((screen.getByLabelText('Taux servi 2026, Assurance vie') as HTMLInputElement).value).toBe('2,5');
    fireEvent.click(within(stepEl('fiscal-params')).getByRole('button', { name: 'Appliquer' }));
    expect(spies.fiscal).toHaveBeenLastCalledWith(expect.objectContaining({ taxScaleYear: LATEST_TAX_SCALE.year }));
    fireEvent.click(within(stepEl('fiscal-params')).getByRole('button', { name: 'C\'est à jour' }));
    expect(stepEl('fiscal-params').textContent).toMatch(/^Fait : /);
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
    expect(spies.record.mock.calls[0][0].rates).toEqual([{ accountId: 'av', rate: 2.5 }]);
    expect(stepEl('statements').textContent).toMatch(/^Fait : /);
  });
});

describe('YearClosingCard', () => {
  it('résumé et bouton qui ouvre la feuille ; rien sans année à clôturer', () => {
    const onOpen = vi.fn();
    render(<YearClosingCard data={base()} onOpen={onOpen} now={JAN} />);
    const card = screen.getByRole('region', { name: 'Clôture de l\'année 2026' });
    expect(card.id).toBe('year-closing');
    expect(within(card).getByText('0 étape sur 6 faite')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Ouvrir la clôture' }));
    expect(onOpen).toHaveBeenCalled();
    cleanup();
    render(<YearClosingCard data={base({ yearClosings: { 2026: { closedOn: '2027-01-12' } } })} onOpen={onOpen} now={JAN} />);
    expect(screen.getByText('Année clôturée : plus de rappel de clôture.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Voir la clôture' })).toBeTruthy();
    cleanup();
    render(<YearClosingCard data={base({}, [])} onOpen={onOpen} now={JAN} />);
    expect(screen.queryByRole('region')).toBeNull();
  });
});
