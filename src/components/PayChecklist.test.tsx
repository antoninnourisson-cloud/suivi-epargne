// @vitest-environment jsdom
// Carte « Ma paie », trois états : avant la paie (barre du plan habituel, « J'ai reçu ma
// paie », rien à cocher), paie déclarée (« À faire » : seulement les lignes restantes, dans
// l'ordre des virements ; « Modifier la paie », « Autre argent reçu »), tout est fait (« Voir le
// détail »). La ligne Plaisir n'est jamais une case. « Comment c'est calculé » dit la règle des
// 2/3. Les lignes : toute la ligne se coche (cible tactile), l'état est relié à la case, un
// montant illisible empêche de cocher et le dit, le plan figé se recalcule par un bouton.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PayChecklist } from './PayChecklist';
import { AccountType, type PayChecklist as PayChecklistData, type PayChecklistLine, type PayRecord } from '../types';
import { emptyData } from '../lib/schema';
import { allocatePay, type PayDistribution } from '../lib/payDistribution';
import { setDiscreetAmounts } from '../lib/format';
import type { PayRitualProps } from './pilot/PayReceivedSheet';
import type { PlacementStep } from '../lib/finance';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 30, 12));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setDiscreetAmounts(false);
});

const MONTH = '2026-10';
const nb = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ');

// Plan habituel de la spécification : paie 2 000 €, virements fixes 1 050 €, projets 100 €,
// solde de départ 400 € (minimum 267 €) : épargne visée 450 €.
const plan = allocatePay({ received: 2000, expectedPay: 2000, fixed: 1050, projects: 100, startBalance: 400 });

// Paie déclarée : 2 000 € + 30 € déjà sur le compte ; virements fixes 800 €, solde de départ
// 900 € : épargne 300 € + 30 € de reste.
const declaredAllocation = allocatePay({ received: 2000, before: 30, expectedPay: 2000, fixed: 800, projects: 0, startBalance: 900 });
const steps: PlacementStep[] = [
  { accountId: 'la', accountName: 'Livret A', type: AccountType.LIVRET_A, rate: 1.7, fillAmount: 330, isFullAfter: false, isLiquid: true },
];
const transfers = [
  { key: 't:loyer', label: 'Revolut commun', amount: 800 },
  { key: 't:leisure', label: 'Argent plaisir (reste sur le compte courant)', amount: 900 },
];
const received = { allocation: declaredAllocation, transfers, steps, customSplit: false } as unknown as PayDistribution;
const pay: PayRecord = {
  id: 'p', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2000, balance: { seen: 2030, before: 30, source: 'typed' }, lines: [], done: {},
};

const ritual = (patch: Partial<PayRitualProps> = {}): PayRitualProps => ({
  doc: emptyData(), geminiApiKey: '', pickerApiKey: '',
  onRecordPay: vi.fn(() => null), onDeletePay: vi.fn(), onValidateReview: vi.fn(), onSavePayslip: vi.fn(), ...patch,
});

// Les commandes de la paie (lib/commands/pay) sont testées à part : ici, une liste en mémoire
// qui fait la même chose (fige les lignes, coche, décoche, défige).
const Harness: React.FC<{ onRecord: (id: string, amount: number) => string | undefined; initial?: PayChecklistData }> = ({ onRecord, initial }) => {
  const [list, setList] = useState<PayChecklistData | undefined>(initial);
  const onCheck = (lines: PayChecklistLine[], l: PayChecklistLine, amount: number, alreadyRecorded: boolean) => {
    let movementId: string | undefined;
    if (!alreadyRecorded && l.kind === 'saving' && l.accountId && amount > 0) {
      movementId = onRecord(l.accountId, amount);
      if (!movementId) return false;
    }
    setList(prev => ({ month: MONTH, lines, done: { ...prev?.done, [l.key]: { amount, movementId, alreadyRecorded: alreadyRecorded || undefined } } }));
    return true;
  };
  const onUncheck = (l: PayChecklistLine) => {
    setList(prev => prev && ({ ...prev, done: Object.fromEntries(Object.entries(prev.done).filter(([k]) => k !== l.key)) }));
  };
  return (
    <PayChecklist plan={plan} pay={pay} received={received}
      checklist={list} onCheck={onCheck} onUncheck={onUncheck} onReset={() => setList(undefined)} />
  );
};

const base = { plan, onCheck: vi.fn(() => true), onUncheck: vi.fn(), onReset: vi.fn() };
const openDetail = () => fireEvent.click(screen.getByRole('button', { name: /^Voir le détail/ }));

describe('Carte « Ma paie » : avant la paie', () => {
  it('paie attendue, barre du plan habituel et sa légende, « J’ai reçu ma paie » ; rien à cocher, pas de pastille', () => {
    render(<PayChecklist {...base} paydayDay={27} ritual={ritual()} />);
    expect(nb(screen.getByText(/^Paie attendue vers le/).textContent)).toBe('Paie attendue vers le 27 octobre · environ 2 000 €');
    const bar = screen.getByRole('img');
    expect(nb(bar.getAttribute('aria-label'))).toBe('Répartition de 2 000 € : virements fixes 1 050 €, épargne 450 €, épargne projets 100 €, plaisir 400 €.');
    // Légende lisible : une paire dt/dd par part, dans l'ordre des priorités.
    const legend = Array.from(document.querySelectorAll('dl > div')).map(d => nb(d.textContent));
    expect(legend).toEqual(['Virements fixes1 050 €', 'Épargne450 €', 'Épargne projets100 €', 'Plaisir400 €']);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByText(/faits$/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Ma paie' })).toBeTruthy();
    expect(screen.getByRole('button', { name: "J'ai reçu ma paie" })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Modifier la paie' })).toBeNull();
  });

  it('sans jour de paie : « Paie pas encore déclarée » ; sans rituel : pas de bouton', () => {
    render(<PayChecklist {...base} />);
    expect(nb(screen.getByText(/^Paie pas encore déclarée/).textContent)).toBe('Paie pas encore déclarée · environ 2 000 €');
    expect(screen.queryByRole('button', { name: "J'ai reçu ma paie" })).toBeNull();
  });

  it('« Comment c’est calculé » : la cascade et la règle des 2/3, en euros', () => {
    render(<PayChecklist {...base} />);
    const toggle = screen.getByRole('button', { name: "Comment c'est calculé" });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const panel = screen.getByRole('region', { name: "Comment c'est calculé" });
    expect(nb(panel.textContent)).toMatch(/Paie habituelle2 000 €/);
    expect(nb(panel.textContent)).toMatch(/Épargne visée450 €/);
    expect(nb(panel.textContent)).toMatch(/jamais sous les 2\/3 du solde de départ du mois \(267 €\)/);
    expect(nb(panel.textContent)).toMatch(/puis l'épargne projets, puis l'épargne/);
    // Jamais de lettres à la place des montants.
    expect(panel.textContent).not.toMatch(/\b[xy]\b/);
  });

  it('conseils du plan (ouvrir un LDDS…) sous la barre', () => {
    const hint: PlacementStep = { accountName: 'LDDS', type: AccountType.LDDS, rate: 1.7, fillAmount: 0, isFullAfter: false, isLiquid: true, alert: true, hint: 'Ouvrez un LDDS : 12 000 € de plafond en plus.' };
    render(<PayChecklist {...base} planSteps={[hint]} />);
    expect(screen.getByText('Ouvrez un LDDS : 12 000 € de plafond en plus.')).toBeTruthy();
  });

  it('mode discret : aucun montant en chiffres', () => {
    setDiscreetAmounts(true);
    const { container } = render(<PayChecklist {...base} paydayDay={27} />);
    expect(container.textContent).not.toMatch(/\d\s?€/);
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toMatch(/\d\s?€/);
  });
});

describe('Carte « Ma paie » : paie déclarée', () => {
  it('paie reçue, reste du compte, mois d’épargne ; « À faire » dans l’ordre des virements, sans la ligne Plaisir', () => {
    render(<PayChecklist {...base} pay={pay} received={received} ritual={ritual()} />);
    expect(nb(screen.getByText(/^Paie reçue le/).textContent)).toBe('Paie reçue le 27 octobre : 2 000 € + 30 € déjà sur le compte · Épargne de novembre');
    const todo = screen.getByRole('region', { name: 'À faire' });
    expect(within(todo).getAllByRole('checkbox').map(b => b.getAttribute('aria-label'))).toEqual(['Revolut commun', 'Livret A']);
    expect(screen.queryByRole('checkbox', { name: /plaisir/i })).toBeNull();
    expect(screen.getByText('0/2 faits')).toBeTruthy();
    expect(nb(screen.getByRole('img').getAttribute('aria-label'))).toBe('Répartition de 2 030 € : virements fixes 800 €, épargne 330 €, plaisir 900 €.');
    expect(nb(screen.getByText(/^dont 30 € de reste/).textContent)).toBe('dont 30 € de reste du mois dernier');
    expect(screen.getByRole('button', { name: 'Modifier la paie' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Autre argent reçu' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: "J'ai reçu ma paie" })).toBeNull();
  });

  it('découvert avant la paie, et élision du mois d’épargne', () => {
    vi.setSystemTime(new Date(2026, 2, 30, 12));
    const overdraft = allocatePay({ received: 2000, before: -50, expectedPay: 2000, fixed: 800, projects: 0, startBalance: 900 });
    render(<PayChecklist {...base} pay={{ ...pay, receivedOn: '2026-03-27', savingsMonth: '2026-04', balance: { before: -50, source: 'typed' } }}
      received={{ ...received, allocation: overdraft } as PayDistribution} />);
    expect(nb(screen.getByText(/^Paie reçue le/).textContent)).toBe('Paie reçue le 27 mars : 2 000 € · découvert de 50 € avant la paie · Épargne d\'avril');
  });

  it('prime placée en entier : dite sous l’épargne de la barre', () => {
    const withBonus = allocatePay({ received: 2500, bonus: 500, expectedPay: 2000, fixed: 800, projects: 0, startBalance: 900 });
    render(<PayChecklist {...base} pay={{ ...pay, amount: 2500, bonus: 500, balance: undefined }} received={{ ...received, allocation: withBonus, steps: [{ ...steps[0], fillAmount: 800 }] } as PayDistribution} />);
    expect(nb(screen.getByText(/dont prime/).textContent)).toBe('dont prime 500 €');
  });

  it('« Voir le détail » montre l’argent reçu en plus du mois, avec sa nature (ancien versement : « Autre »)', () => {
    const extra = (id: string, over: Partial<PayRecord>): PayRecord => ({ id, receivedOn: '2026-10-29', savingsMonth: '2026-11', amount: 40, kind: 'extra', lines: [], done: {}, ...over });
    const pays = [pay,
      extra('r', { nature: 'refund' }),
      extra('g', { nature: 'gift', amount: 150, lines: [{ key: 's:la', label: 'Livret A', amount: 150, kind: 'saving', accountId: 'la' }], done: { 's:la': { amount: 150 } } }),
      extra('o', { amount: 300, lines: [{ key: 's:la', label: 'Livret A', amount: 300, kind: 'saving', accountId: 'la' }] }),
      extra('old', { savingsMonth: '2026-10', receivedOn: '2026-10-02' }),
    ];
    render(<PayChecklist {...base} pay={pay} received={received} ritual={ritual({ doc: { ...emptyData(), pays } })} />);
    const toggle = screen.getByRole('button', { name: /^Voir le détail/ });
    expect(nb(toggle.textContent)).toMatch(/3 versements en plus/);
    fireEvent.click(toggle);
    const list = screen.getByRole('list', { name: 'Argent reçu en plus' });
    expect(within(list).getAllByRole('listitem').map(li => nb(li.textContent).replace(/Modifier.*$/, ''))).toEqual([
      'Remboursement reçu le 29 octobre : 40 €Resté sur le compte courant',
      'Cadeau reçu le 29 octobre : 150 €150 € placés',
      "Autre argent reçu le 29 octobre : 300 €Rien de placé pour l'instant",
    ]);
  });

  it('« Autre argent reçu » ouvre le rituel (versement en plus) ; « J’ai reçu ma paie » aussi, chargé à la demande ; Échap le ferme', async () => {
    vi.useRealTimers();
    render(<PayChecklist {...base} paydayDay={27} ritual={ritual()} />);
    fireEvent.click(screen.getByRole('button', { name: "J'ai reçu ma paie" }));
    // Module chargé à la demande : le premier import peut être lent sous charge.
    const dialog = await screen.findByRole('dialog', { name: "J'ai reçu ma paie" }, { timeout: 8000 });
    // Le focus entre dans la fenêtre (ses écouteurs, Échap compris, sont posés).
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    render(<PayChecklist {...base} pay={pay} received={received} ritual={ritual()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Autre argent reçu' }));
    expect(await screen.findByRole('dialog', {}, { timeout: 8000 })).toBeTruthy();
  });
});

describe('Carte « Ma paie » : cocher', () => {
  it('cliquer sur le nom du compte coche la ligne et enregistre le versement ; elle passe dans « Voir le détail »', () => {
    const onRecord = vi.fn(() => 'mvt-1');
    render(<Harness onRecord={onRecord} />);
    const box = screen.getByRole('checkbox', { name: 'Livret A' }) as HTMLInputElement;
    // La case est dans un <label> qui englobe le nom : cible de toute la ligne.
    expect(box.closest('label')?.textContent).toContain('Livret A');
    expect(document.getElementById(box.getAttribute('aria-describedby')!)?.textContent).toMatch(/Cocher enregistre le versement/);
    fireEvent.click(screen.getByText('Livret A'));
    expect(onRecord).toHaveBeenCalledWith('la', 330);
    expect(screen.getByText('1/2 faits')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'À faire' })).queryByRole('checkbox', { name: 'Livret A' })).toBeNull();
    openDetail();
    const detail = screen.getByRole('region', { name: /^Voir le détail/ });
    expect((within(detail).getByRole('checkbox', { name: 'Livret A' }) as HTMLInputElement).checked).toBe(true);
    expect(within(detail).getByText('Versement enregistré')).toBeTruthy();
  });

  it('montant illisible : la case est désactivée et la ligne dit pourquoi', () => {
    render(<Harness onRecord={vi.fn(() => 'm')} />);
    fireEvent.change(screen.getByLabelText(/^Montant réel de Livret A/), { target: { value: 'abc' } });
    const box = screen.getByRole('checkbox', { name: 'Livret A' }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(document.getElementById(box.getAttribute('aria-describedby')!)?.textContent).toMatch(/Montant non reconnu/);
  });

  it('« Déjà enregistré ? » coche sans enregistrer une seconde fois ; tout fait : pastille, ce qui est placé et ce qui reste', () => {
    const onRecord = vi.fn(() => 'm');
    render(<Harness onRecord={onRecord} />);
    fireEvent.click(screen.getByRole('button', { name: /^Déjà enregistré \? \(Livret A/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Revolut commun' }));
    expect(onRecord).not.toHaveBeenCalled();
    expect(screen.getAllByText('Tout est fait')[0].closest('span')?.className).not.toMatch(/emerald/);
    expect(nb(screen.getByText(/^Tout est fait ·/).textContent)).toBe('Tout est fait · 330 € placés · le compte courant démarre à 900 €');
    expect(screen.queryByRole('region', { name: 'À faire' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Voir le détail/ })).toBeTruthy();
  });

  it('montant réel différent : la barre suit ce qui est fait, le plaisir est ce qui reste', () => {
    render(<Harness onRecord={vi.fn(() => 'm')} />);
    fireEvent.change(screen.getByLabelText(/^Montant réel de Livret A/), { target: { value: '400' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Livret A' }));
    expect(nb(screen.getByRole('img').getAttribute('aria-label'))).toBe('Répartition de 2 030 € : virements fixes 800 €, épargne 400 €, plaisir 830 € (prévu 900 €).');
    openDetail();
    expect(nb(screen.getByText(/^Versement enregistré :/).textContent)).toBe('Versement enregistré : 400 € (prévu 330 €)');
  });

  it('plan figé sans virement coché : « Recalculer le plan » le libère', () => {
    const frozen: PayChecklistData = { month: MONTH, lines: [{ key: 's:la', label: 'Livret A', amount: 250, kind: 'saving', accountId: 'la' }], done: {} };
    render(<Harness onRecord={vi.fn()} initial={frozen} />);
    expect(screen.getByLabelText(/^Montant réel de Livret A/)).toHaveProperty('value', '250');
    fireEvent.click(screen.getByRole('button', { name: 'Recalculer le plan sur les soldes actuels' }));
    expect(screen.getByLabelText(/^Montant réel de Livret A/)).toHaveProperty('value', '330');
  });

  it('ancienne paie dont la ligne plaisir était cochée : elle ne compte pas dans « faits »', () => {
    const lines: PayChecklistLine[] = [
      { key: 's:la', label: 'Livret A', amount: 330, kind: 'saving', accountId: 'la' },
      { key: 't:leisure', label: 'Argent plaisir', amount: 900, kind: 'transfer' },
    ];
    render(<Harness onRecord={vi.fn()} initial={{ month: MONTH, lines, done: { 't:leisure': { amount: 900 } } }} />);
    expect(screen.getByText('0/1 faits')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Argent plaisir' })).toBeNull();
  });
});

describe('Carte « Ma paie » : branchement des commandes', () => {
  it('cocher transmet le plan affiché (figé) et le montant saisi ; refusé, la ligne reste à faire', () => {
    const frozenLines = [{ key: 's:la', label: 'Livret A', amount: 250, kind: 'saving' as const, accountId: 'la' }];
    const onCheck = vi.fn(() => false);
    render(<PayChecklist {...base} pay={pay} received={received} checklist={{ month: MONTH, lines: frozenLines, done: {} }} onCheck={onCheck} />);
    fireEvent.change(screen.getByLabelText(/^Montant réel de Livret A/), { target: { value: '240,5' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Livret A' }));
    expect(onCheck).toHaveBeenCalledWith(frozenLines, frozenLines[0], 240.5, false);
    expect((screen.getByRole('checkbox', { name: 'Livret A' }) as HTMLInputElement).checked).toBe(false);
  });

  it('décocher (dans « Voir le détail ») appelle la commande et remet le montant fait dans le champ', () => {
    const lines = [{ key: 's:la', label: 'Livret A', amount: 250, kind: 'saving' as const, accountId: 'la' }, { key: 't:loyer', label: 'Revolut commun', amount: 800, kind: 'transfer' as const }];
    const onUncheck = vi.fn();
    const props = { ...base, pay, received, onUncheck };
    const { rerender } = render(<PayChecklist {...props} checklist={{ month: MONTH, lines, done: { 's:la': { amount: 240, movementId: 'm' } } }} />);
    openDetail();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Livret A' }));
    expect(onUncheck).toHaveBeenCalledWith(lines[0]);
    rerender(<PayChecklist {...props} checklist={{ month: MONTH, lines, done: {} }} />);
    expect(screen.getByLabelText(/^Montant réel de Livret A/)).toHaveProperty('value', '240');
  });

  it('« Voir le détail » : compte réellement crédité et date du versement', () => {
    const lines = [{ key: 's:la', label: 'Livret A', amount: 330, kind: 'saving' as const, accountId: 'la' }];
    const accounts = [
      { id: 'la', name: 'Livret A', movements: [] },
      { id: 'ldds', name: 'LDDS', movements: [{ id: 'm', date: '2026-10-28', amount: 330, label: 'Paie', type: 'IN' as const }] },
    ];
    render(<PayChecklist {...base} pay={pay} received={received} accounts={accounts}
      checklist={{ month: MONTH, lines, done: { 's:la': { amount: 330, movementId: 'm', accountId: 'ldds' } } }} />);
    openDetail();
    expect(screen.getByText('sur LDDS · le 28 octobre')).toBeTruthy();
  });
});
