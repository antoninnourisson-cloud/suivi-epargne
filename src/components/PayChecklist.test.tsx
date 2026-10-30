// @vitest-environment jsdom
// Liste de la paie : toute la ligne se coche (cible tactile), l'état est relié à la case,
// un montant illisible empêche de cocher et le dit, le plan figé se recalcule par un bouton.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PayChecklist } from './PayChecklist';
import { AccountType, type PayChecklist as PayChecklistData, type PayChecklistLine } from '../types';
import type { PlacementStep } from '../lib/finance';

afterEach(cleanup);

const steps: PlacementStep[] = [
  { accountId: 'la', accountName: 'Livret A', type: AccountType.LIVRET_A, rate: 1.7, fillAmount: 300, isFullAfter: false, isLiquid: true },
];
const transfers = [{ key: 't:loyer', label: 'Revolut commun', amount: 800 }];

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
    <PayChecklist superNet={2000} transfers={transfers} steps={steps} totalToInvest={300} shortfall={0}
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
    render(<PayChecklist superNet={2000} transfers={transfers} steps={steps} totalToInvest={300} shortfall={0}
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
    const { rerender } = render(<PayChecklist superNet={2000} transfers={transfers} steps={steps} totalToInvest={300} shortfall={0}
      checklist={{ month, lines, done: { 's:la': { amount: 240, movementId: 'm' } } }} onCheck={vi.fn(() => true)} onUncheck={onUncheck} onReset={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Livret A' }));
    expect(onUncheck).toHaveBeenCalledWith(lines[0]);
    rerender(<PayChecklist superNet={2000} transfers={transfers} steps={steps} totalToInvest={300} shortfall={0}
      checklist={{ month, lines, done: {} }} onCheck={vi.fn(() => true)} onUncheck={onUncheck} onReset={vi.fn()} />);
    expect(screen.getByLabelText(/^Montant réel de Livret A/)).toHaveProperty('value', '240');
  });
});

describe('PayChecklist : élision du mois', () => {
  afterEach(() => vi.useRealTimers());
  it('« Paie d’octobre », « Paie de septembre »', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 12));
    render(<Harness onRecord={() => 'm'} />);
    expect(screen.getByText(/^Paie d'octobre :/)).toBeTruthy();
    cleanup();
    vi.setSystemTime(new Date(2026, 8, 15, 12));
    render(<Harness onRecord={() => 'm'} />);
    expect(screen.getByText(/^Paie de septembre :/)).toBeTruthy();
  });
});
