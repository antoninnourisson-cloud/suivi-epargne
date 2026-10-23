// @vitest-environment jsdom
// Liste de la paie : toute la ligne se coche (cible tactile), l'état est relié à la case,
// un montant illisible empêche de cocher et le dit, le plan figé se recalcule par un bouton.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PayChecklist } from './PayChecklist';
import { AccountType, type PayChecklist as PayChecklistData } from '../types';
import type { PlacementStep } from '../lib/finance';

afterEach(cleanup);

const steps: PlacementStep[] = [
  { accountId: 'la', accountName: 'Livret A', type: AccountType.LIVRET_A, rate: 1.7, fillAmount: 300, isFullAfter: false, isLiquid: true },
];
const transfers = [{ key: 't:loyer', label: 'Revolut commun', amount: 800 }];

const Harness: React.FC<{ onRecord: (id: string, amount: number) => string | undefined; onCancel?: () => void; initial?: PayChecklistData }> = ({ onRecord, onCancel = () => {}, initial }) => {
  const [list, setList] = useState<PayChecklistData | undefined>(initial);
  return (
    <PayChecklist superNet={2000} transfers={transfers} steps={steps} totalToInvest={300} shortfall={0}
      checklist={list} onChange={setList} onRecordDeposit={onRecord} onCancelDeposit={onCancel} />
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
