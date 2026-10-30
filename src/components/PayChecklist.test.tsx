// @vitest-environment jsdom
// Carte « Ma paie » : paie attendue (estimation, « J'ai reçu ma paie ») ou reçue (montant,
// mois d'épargne, « Modifier la paie ») ; la liste : toute la ligne se coche (cible tactile),
// l'état est relié à la case, un montant illisible empêche de cocher et le dit, le plan figé
// se recalcule par un bouton.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PayChecklist } from './PayChecklist';
import { AccountType, type PayChecklist as PayChecklistData, type PayChecklistLine, type PayRecord } from '../types';
import { emptyData } from '../lib/schema';
import type { PayRitualProps } from './pilot/PayReceivedSheet';
import type { PlacementStep } from '../lib/finance';

afterEach(cleanup);

const steps: PlacementStep[] = [
  { accountId: 'la', accountName: 'Livret A', type: AccountType.LIVRET_A, rate: 1.7, fillAmount: 300, isFullAfter: false, isLiquid: true },
];
const transfers = [{ key: 't:loyer', label: 'Revolut commun', amount: 800 }];
const EST = { pay: 2000, spending: 1700, toSave: 300, sentence: 'Votre paie moins vos dépenses prévues.', decimals: 0 as const };

// Les commandes de la paie (lib/commands/pay) sont testées à part : ici, une liste en mémoire
// qui fait la même chose (fige les lignes, coche, décoche, défige).
const Harness: React.FC<{ onRecord: (id: string, amount: number) => string | undefined; onCancel?: () => void; initial?: PayChecklistData }> = ({ onRecord, onCancel = () => {}, initial }) => {
  const [list, setList] = useState<PayChecklistData | undefined>(initial);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const onCheck = (lines: PayChecklistLine[], l: PayChecklistLine, amount: number, alreadyRecorded: boolean) => {
    let movementId: string | undefined;
    if (!alreadyRecorded && l.kind === 'saving' && l.accountId && amount > 0) {
      movementId = onRecord(l.accountId, amount);
      if (!movementId) return false;
    }
    setList(prev => ({ month, lines, done: { ...prev?.done, [l.key]: { amount, movementId, alreadyRecorded: alreadyRecorded || undefined } } }));
    return true;
  };
  const onUncheck = (l: PayChecklistLine) => {
    onCancel();
    setList(prev => prev && ({ ...prev, done: Object.fromEntries(Object.entries(prev.done).filter(([k]) => k !== l.key)) }));
  };
  return (
    <PayChecklist estimate={EST} transfers={transfers} steps={steps} totalToInvest={300} shortfall={0}
      checklist={list} onCheck={onCheck} onUncheck={onUncheck} onReset={() => setList(undefined)} />
  );
};

describe('PayChecklist', () => {
  it('cliquer sur le nom du compte coche la ligne et enregistre le versement', () => {
    const onRecord = vi.fn(() => 'mvt-1');
    render(<Harness onRecord={onRecord} />);
    const box = screen.getByRole('checkbox', { name: 'Livret A' }) as HTMLInputElement;
    // La case est dans un <label> qui englobe le nom : cible de toute la ligne.
    expect(box.closest('label')?.textContent).toContain('Livret A');
    expect(document.getElementById(box.getAttribute('aria-describedby')!)?.textContent).toMatch(/Cocher enregistre le versement/);
    fireEvent.click(screen.getByText('Livret A'));
    expect(onRecord).toHaveBeenCalledWith('la', 300);
    expect(box.checked).toBe(true);
    expect(screen.getByText('Versement enregistré')).toBeTruthy();
    expect(screen.getByText('1/2 faits')).toBeTruthy();
  });

  it('montant illisible : la case est désactivée et la ligne dit pourquoi', () => {
    render(<Harness onRecord={vi.fn(() => 'm')} />);
    fireEvent.change(screen.getByLabelText(/^Montant réel de Livret A/), { target: { value: 'abc' } });
    const box = screen.getByRole('checkbox', { name: 'Livret A' }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(document.getElementById(box.getAttribute('aria-describedby')!)?.textContent).toMatch(/Montant non reconnu/);
  });

  it('« Déjà enregistré ? » coche sans enregistrer une seconde fois ; tout fait : pastille', () => {
    const onRecord = vi.fn(() => 'm');
    render(<Harness onRecord={onRecord} />);
    fireEvent.click(screen.getByRole('button', { name: /^Déjà enregistré \? \(Livret A/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Revolut commun' }));
    expect(onRecord).not.toHaveBeenCalled();
    expect(screen.getByText('Tout est fait').className).not.toMatch(/emerald/);
  });

  it('plan figé sans virement coché : « Recalculer le plan » le libère', () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const frozen: PayChecklistData = { month, lines: [{ key: 's:la', label: 'Livret A', amount: 250, kind: 'saving', accountId: 'la' }], done: {} };
    render(<Harness onRecord={vi.fn()} initial={frozen} />);
    expect(screen.getByLabelText(/^Montant réel de Livret A/)).toHaveProperty('value', '250');
    fireEvent.click(screen.getByRole('button', { name: 'Recalculer le plan sur les soldes actuels' }));
    expect(screen.getByLabelText(/^Montant réel de Livret A/)).toHaveProperty('value', '300');
  });
});

describe('PayChecklist : branchement des commandes', () => {
  it('cocher transmet le plan affiché (figé ou vivant) et le montant saisi ; refusé, la ligne reste à faire', () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const frozenLines = [{ key: 's:la', label: 'Livret A', amount: 250, kind: 'saving' as const, accountId: 'la' }];
    const onCheck = vi.fn(() => false);
    render(<PayChecklist estimate={EST} transfers={transfers} steps={steps} totalToInvest={300} shortfall={0}
      checklist={{ month, lines: frozenLines, done: {} }} onCheck={onCheck} onUncheck={vi.fn()} onReset={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Montant réel de Livret A/), { target: { value: '240,5' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Livret A' }));
    expect(onCheck).toHaveBeenCalledWith(frozenLines, frozenLines[0], 240.5, false);
    expect((screen.getByRole('checkbox', { name: 'Livret A' }) as HTMLInputElement).checked).toBe(false);
  });

  it('décocher appelle la commande et remet le montant fait dans le champ', () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lines = [{ key: 's:la', label: 'Livret A', amount: 250, kind: 'saving' as const, accountId: 'la' }];
    const onUncheck = vi.fn();
    const { rerender } = render(<PayChecklist estimate={EST} transfers={transfers} steps={steps} totalToInvest={300} shortfall={0}
      checklist={{ month, lines, done: { 's:la': { amount: 240, movementId: 'm' } } }} onCheck={vi.fn(() => true)} onUncheck={onUncheck} onReset={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Livret A' }));
    expect(onUncheck).toHaveBeenCalledWith(lines[0]);
    rerender(<PayChecklist estimate={EST} transfers={transfers} steps={steps} totalToInvest={300} shortfall={0}
      checklist={{ month, lines, done: {} }} onCheck={vi.fn(() => true)} onUncheck={onUncheck} onReset={vi.fn()} />);
    expect(screen.getByLabelText(/^Montant réel de Livret A/)).toHaveProperty('value', '240');
  });
});

describe('Carte « Ma paie »', () => {
  afterEach(() => vi.useRealTimers());
  const ritual = (patch: Partial<PayRitualProps> = {}): PayRitualProps => ({
    doc: emptyData(), geminiApiKey: '', pickerApiKey: '',
    onRecordPay: vi.fn(() => null), onDeletePay: vi.fn(), onValidateReview: vi.fn(), onSavePayslip: vi.fn(), ...patch,
  });
  const base = { transfers, steps, totalToInvest: 300, shortfall: 0, onCheck: vi.fn(() => true), onUncheck: vi.fn(), onReset: vi.fn() };

  it('avant la paie : paie attendue, estimation et « J’ai reçu ma paie » (seulement avec le rituel)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 30, 12));
    render(<PayChecklist {...base} estimate={EST} paydayDay={27} ritual={ritual()} />);
    const hero = screen.getByRole('region', { name: 'À placer ce mois' });
    expect(hero.textContent).toMatch(/Paie attendue vers le 27 octobre · environ 2\s000\s€ · environ 300\s€ à placer/);
    expect(screen.getByRole('heading', { name: 'Ma paie' })).toBeTruthy();
    expect(screen.getByRole('button', { name: "J'ai reçu ma paie" })).toBeTruthy();
    cleanup();
    render(<PayChecklist {...base} estimate={EST} />);
    expect(screen.queryByRole('button', { name: "J'ai reçu ma paie" })).toBeNull();
    expect(screen.getByText(/Paie pas encore déclarée/)).toBeTruthy();
  });

  it('paie déclarée : reçue le…, épargne du mois (élision), à placer, « Modifier la paie »', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 30, 12));
    const pay: PayRecord = { id: 'p', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2512, bonus: 200, lines: [], done: {} };
    render(<PayChecklist {...base} estimate={EST} paydayDay={27} pay={pay} ritual={ritual()} totalToInvest={962} />);
    const hero = screen.getByRole('region', { name: 'Paie reçue' });
    expect(hero.textContent).toMatch(/Paie reçue le 27 octobre : 2\s512\s€ · Épargne de novembre/);
    expect(hero.textContent).toMatch(/À placer sur cette paie\s*962\s€/);
    expect(hero.textContent).toMatch(/Dont prime placée en entier : 200\s€/);
    expect(screen.getByRole('button', { name: 'Modifier la paie' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'À placer ce mois' })).toBeNull();
    cleanup();
    vi.setSystemTime(new Date(2026, 2, 30, 12));
    render(<PayChecklist {...base} estimate={EST} paydayDay={27} pay={{ ...pay, receivedOn: '2026-03-27', savingsMonth: '2026-04' }} />);
    expect(screen.getByText(/Épargne d'avril/)).toBeTruthy();
  });

  it('« J’ai reçu ma paie » ouvre le rituel (chargé à la demande) ; Échap le ferme', async () => {
    render(<PayChecklist {...base} estimate={EST} paydayDay={27} ritual={ritual()} />);
    fireEvent.click(screen.getByRole('button', { name: "J'ai reçu ma paie" }));
    // Module chargé à la demande : le premier import peut être lent sous charge.
    const dialog = await screen.findByRole('dialog', { name: "J'ai reçu ma paie" }, { timeout: 8000 });
    // Le focus entre dans la fenêtre (ses écouteurs, Échap compris, sont posés).
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
