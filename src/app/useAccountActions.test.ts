// @vitest-environment jsdom
// Actions des écrans sur les données (useAccountActions) : chemins de refus, confirmations et
// annulations que les tests d'app.test.tsx ne couvrent pas. Les règles elles-mêmes sont dans
// src/lib/commands (testées à part) : ici, ce que l'interface en fait (toast, fenêtre, écriture).
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { emptyData } from '../lib/schema';
import { AccountType, type AppDoc, type SavingsAccount } from '../types';
import type { FiscalProposal } from '../lib/fiscalWatch';
import { useAccountActions } from './useAccountActions';
import type { AddToast, DialogApi } from './UiProviders';

const account = (id: string, extra: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id, name: id, institution: 'Banque', type: AccountType.LIVRET_A, totalAmount: 100, ownedAmount: 100, parentalCapital: 0, movements: [], ...extra,
});
const withAccounts = (...accounts: SavingsAccount[]): AppDoc => ({ ...emptyData(), accounts });

type ToastArg = Parameters<AddToast>[0] & { action?: { label: string; onClick: () => void } };

const setup = (doc: AppDoc) => {
  const setters = {
    setAccounts: vi.fn(), setPays: vi.fn(), setParentalRestitution: vi.fn(), setActivePayslipId: vi.fn(), setFiscalConfig: vi.fn(),
    patchConfig: vi.fn(), exportData: vi.fn(),
  };
  const addToast = vi.fn<AddToast>(() => 'id');
  const dialog = { open: vi.fn<DialogApi['open']>(), confirm: vi.fn<DialogApi['confirm']>() };
  const hook = renderHook(({ d }) => useAccountActions(d, setters, addToast, dialog), { initialProps: { d: doc } });
  const lastToast = () => addToast.mock.calls.at(-1)![0] as ToastArg;
  const accountsWritten = (i: number) => setters.setAccounts.mock.calls[i][0] as SavingsAccount[];
  return { ...hook, setters, addToast, dialog, lastToast, accountsWritten };
};

describe('refus des commandes', () => {
  it('ajout rapide refusé : message d’erreur, rien d’écrit, pas d’id', () => {
    const { result, setters, lastToast } = setup(withAccounts(account('a', { totalAmount: 150, ownedAmount: 50, parentalCapital: 100 })));
    let id: string | undefined = 'x';
    // Retrait plus grand que votre part : la part des parents ne se retire pas.
    act(() => { id = result.current.quickAdd('a', 80, 'OUT', 'Achat', '2026-10-01'); });
    expect(id).toBeUndefined();
    expect(setters.setAccounts).not.toHaveBeenCalled();
    expect(lastToast()).toMatchObject({ kind: 'error', message: expect.stringContaining('Retrait impossible') });
  });

  it('compte disparu entre-temps : rien à signaler (ni toast ni écriture)', () => {
    const { result, setters, addToast } = setup(withAccounts(account('a')));
    act(() => { result.current.quickAdd('disparu', 10, 'IN', 'x', '2026-10-01'); });
    act(() => result.current.uncheckPayLine({ key: 's:disparu', label: 'x', amount: 1, kind: 'saving', accountId: 'disparu' }));
    act(() => result.current.revertRate('disparu', '2026-08-01'));
    act(() => result.current.deleteMovement('a', 'disparu'));
    expect(addToast).not.toHaveBeenCalled();
    expect(setters.setAccounts).not.toHaveBeenCalled();
  });

  it('supprimer un mouvement qui rendrait un solde négatif : refus affiché, aucune fenêtre', () => {
    const doc = withAccounts(account('a', { totalAmount: 0, ownedAmount: 0, movements: [
      { id: 'in', date: '2026-10-01', amount: 50, label: 'Versement', type: 'IN' },
      { id: 'out', date: '2026-10-02', amount: 50, label: 'Retrait', type: 'OUT' },
    ] }));
    const { result, dialog, lastToast } = setup(doc);
    act(() => result.current.deleteMovement('a', 'in'));
    expect(dialog.open).not.toHaveBeenCalled();
    expect(lastToast()).toMatchObject({ kind: 'error' });
  });

  it('confirmation tardive sur un mouvement déjà supprimé ailleurs : rien ne se passe', () => {
    const doc = withAccounts(account('a', { totalAmount: 150, ownedAmount: 150, movements: [{ id: 'm', date: '2026-10-01', amount: 50, label: 'Versement', type: 'IN' }] }));
    const { result, rerender, setters, addToast, dialog } = setup(doc);
    act(() => result.current.deleteMovement('a', 'm'));
    // Entre l'ouverture de la fenêtre et la confirmation, l'état a changé (autre appareil...).
    rerender({ d: withAccounts(account('a')) });
    act(() => dialog.open.mock.calls[0][0].onConfirm!());
    expect(setters.setAccounts).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });
});

describe('comptes', () => {
  it('enregistrer : true et écrit ; refusé : false, message, rien d’écrit', () => {
    const { result, setters, lastToast } = setup(withAccounts(account('a')));
    let ok = false;
    act(() => { ok = result.current.saveAccount(account('b', { totalAmount: 10, ownedAmount: 10 })); });
    expect(ok).toBe(true);
    expect(setters.setAccounts).toHaveBeenCalledTimes(1);
    act(() => { ok = result.current.saveAccount(account('c', { totalAmount: 10, ownedAmount: 10, parentalCapital: -5 })); });
    expect(ok).toBe(false);
    expect(setters.setAccounts).toHaveBeenCalledTimes(1);
    expect(lastToast()).toMatchObject({ kind: 'error' });
  });

  it('supprimer un compte vide ou non : message adapté, puis « Annuler » le remet à sa place', () => {
    const doc = withAccounts(account('a'), account('vide', { totalAmount: 0, ownedAmount: 0 }), account('c'));
    const { result, dialog, lastToast, accountsWritten } = setup(doc);
    act(() => result.current.deleteAccount(doc.accounts[1]));
    expect(dialog.open.mock.calls[0][0]).toMatchObject({ danger: true, title: 'Supprimer « vide »', message: 'Ce compte est vide, il sera supprimé.' });
    act(() => result.current.deleteAccount(doc.accounts[0]));
    expect(dialog.open.mock.calls[1][0].message).toMatch(/encore un solde/);

    act(() => dialog.open.mock.calls[0][0].onConfirm!());
    expect(accountsWritten(0).map(a => a.id)).toEqual(['a', 'c']);
    expect(lastToast().action?.label).toBe('Annuler');
    act(() => lastToast().action!.onClick());
    expect(accountsWritten(1).map(a => a.id)).toEqual(['a', 'vide', 'c']);
  });

  it('confirmation de suppression d’un compte déjà disparu : sans effet', () => {
    const doc = withAccounts(account('a'));
    const { result, rerender, setters, dialog } = setup(doc);
    act(() => result.current.deleteAccount(doc.accounts[0]));
    rerender({ d: withAccounts() });
    act(() => dialog.open.mock.calls[0][0].onConfirm!());
    expect(setters.setAccounts).not.toHaveBeenCalled();
  });
});

describe('mouvements', () => {
  it('virement interne : la fenêtre annonce les lignes liées, supprimées ensemble', () => {
    const doc = withAccounts(
      account('a', { totalAmount: 70, ownedAmount: 70, movements: [{ id: 'o', date: '2026-10-01', amount: 30, label: 'Virement', type: 'OUT', linkId: 'L' }] }),
      account('b', { totalAmount: 130, ownedAmount: 130, movements: [{ id: 'i', date: '2026-10-01', amount: 30, label: 'Virement', type: 'IN', linkId: 'L' }] }),
    );
    const { result, dialog, accountsWritten } = setup(doc);
    act(() => result.current.deleteMovement('a', 'o'));
    const asked = dialog.open.mock.calls[0][0];
    expect(asked).toMatchObject({ title: 'Supprimer le virement', message: expect.stringContaining('les 2 lignes liées') });
    act(() => asked.onConfirm!());
    expect(accountsWritten(0).map(a => [a.totalAmount, a.movements?.length])).toEqual([[100, 0], [100, 0]]);
  });

  it('renommer avec un libellé vide : rien d’écrit', () => {
    const doc = withAccounts(account('a', { movements: [{ id: 'm', date: '2026-10-01', amount: 5, label: 'Ancien', type: 'IN' }] }));
    const { result, setters, dialog } = setup(doc);
    act(() => result.current.renameMovement('a', 'm', 'Ancien'));
    act(() => dialog.open.mock.calls[0][0].onConfirm!(''));
    expect(setters.setAccounts).not.toHaveBeenCalled();
  });

  it('marquer comme correction : bascule appliquée à l’état du moment', () => {
    const doc = withAccounts(account('a', { movements: [{ id: 'm', date: '2026-10-01', amount: 5, label: 'Intérêts', type: 'IN' }] }));
    const { result, setters } = setup(doc);
    act(() => result.current.toggleAdjustment('a', 'm'));
    const update = setters.setAccounts.mock.calls[0][0] as (prev: SavingsAccount[]) => SavingsAccount[];
    expect(update(doc.accounts)[0].movements![0].kind).toBe('adjustment');
  });

  it('mouvements qui s’annulent : retirés avec « Annuler » ; refus si leur somme n’est pas nulle', () => {
    const movements = [
      { id: 'x', date: '2026-10-01', amount: 20, label: 'Aller', type: 'IN' as const },
      { id: 'y', date: '2026-10-01', amount: 20, label: 'Retour', type: 'OUT' as const },
    ];
    const doc = withAccounts(account('a', { movements }));
    const { result, lastToast, accountsWritten } = setup(doc);
    act(() => result.current.removeCancelling([{ accountId: 'a', accountName: 'a', date: '2026-10-01', movements }]));
    expect(accountsWritten(0)[0]).toMatchObject({ totalAmount: 100, movements: [] });
    expect(lastToast()).toMatchObject({ kind: 'success', action: { label: 'Annuler' } });
    act(() => lastToast().action!.onClick());
    expect(accountsWritten(1)[0].movements).toHaveLength(2);

    act(() => result.current.removeCancelling([{ accountId: 'a', accountName: 'a', date: '2026-10-01', movements: [movements[0]] }]));
    expect(lastToast()).toMatchObject({ kind: 'error', message: expect.stringContaining('ne s\'annulent pas') });
  });
});

describe('restitution du capital des parents', () => {
  const doc = withAccounts(account('a', { totalAmount: 1100, ownedAmount: 100, parentalCapital: 1000 }));

  it('date prévue enregistrée, sans toucher au reste', () => {
    const { result, setters } = setup(doc);
    act(() => result.current.planRestitution('2027-01-01'));
    const update = setters.setParentalRestitution.mock.calls[0][0] as (p: object | undefined) => object;
    expect(update({ note: 'x' })).toEqual({ note: 'x', plannedDate: '2027-01-01' });
  });

  it('restituer puis annuler, avec « Rétablir »', () => {
    const { result, setters, lastToast, accountsWritten } = setup(doc);
    act(() => result.current.restitute('2027-01-01'));
    expect(accountsWritten(0)[0]).toMatchObject({ parentalCapital: 0, ownedAmount: 100, totalAmount: 100 });
    expect(setters.setParentalRestitution).toHaveBeenCalledWith(expect.objectContaining({ done: expect.objectContaining({ date: '2027-01-01' }) }));
    expect(lastToast()).toMatchObject({ kind: 'success', action: { label: 'Annuler' } });

    // Annulation après coup (l'état de la commande suit les écritures, sans attendre un rendu).
    act(() => result.current.undoRestitution());
    expect(accountsWritten(1)[0]).toMatchObject({ parentalCapital: 1000, totalAmount: 1100 });
    expect(lastToast().action?.label).toBe('Rétablir');
    act(() => lastToast().action!.onClick());
    expect(accountsWritten(2)[0]).toMatchObject({ parentalCapital: 0 });
  });

  it('rien à rendre : refus affiché ; rien à annuler : silence', () => {
    const { result, setters, addToast, lastToast } = setup(withAccounts(account('a')));
    act(() => result.current.restitute('2027-01-01'));
    expect(lastToast()).toMatchObject({ kind: 'error' });
    addToast.mockClear();
    act(() => result.current.undoRestitution());
    expect(addToast).not.toHaveBeenCalled();
    expect(setters.setAccounts).not.toHaveBeenCalled();
  });
});

describe('Pilotage, veille fiscale, relevés', () => {
  it('point de départ retiré : message dédié, « Annuler » remet l’ancien', () => {
    const doc = { ...emptyData(), config: { ...emptyData().config, trackingStartDate: '2026-01-01' } };
    const { result, setters, lastToast } = setup(doc);
    act(() => result.current.setTrackingStart(undefined));
    expect(setters.patchConfig).toHaveBeenCalledWith({ trackingStartDate: undefined });
    expect(lastToast().message).toBe('Point de départ retiré');
    act(() => lastToast().action!.onClick());
    expect(setters.patchConfig).toHaveBeenLastCalledWith({ trackingStartDate: '2026-01-01' });
  });

  it('fiche sans brut lisible : rien proposé ; fiche sans période : libellé générique', () => {
    const { result, dialog } = setup(emptyData());
    act(() => result.current.applyPayslip({ id: 'p', fileName: 'f.pdf', extracted: {} } as never));
    expect(dialog.open).not.toHaveBeenCalled();
    act(() => result.current.applyPayslip({ id: 'p', fileName: 'f.pdf', extracted: { grossAmount: 2000 } } as never));
    expect(dialog.open.mock.calls[0][0].message).toContain('de cette fiche');
  });

  it('retour à l’estimation théorique', () => {
    const { result, setters, lastToast } = setup(emptyData());
    act(() => result.current.clearActivePayslip());
    expect(setters.setActivePayslipId).toHaveBeenCalledWith(undefined);
    expect(lastToast()).toMatchObject({ kind: 'success', message: 'Retour à l\'estimation théorique' });
  });

  it('proposition de la veille fiscale : paramètres écrits, comptes seulement s’ils changent', () => {
    const doc = withAccounts(account('a', { interestRate: 1.7 }));
    const { result, setters, lastToast } = setup(doc);
    const fiscalOnly: FiscalProposal = {
      key: 'k', label: 'Plafond', current: '1', proposed: '2',
      apply: ({ fiscal, accounts }) => ({ fiscal: { ...fiscal }, accounts }),
    };
    act(() => result.current.applyFiscalProposal(fiscalOnly));
    expect(setters.setFiscalConfig).toHaveBeenCalledTimes(1);
    expect(setters.setAccounts).not.toHaveBeenCalled();
    expect(lastToast().message).toBe('Plafond mis à jour');

    const withRate: FiscalProposal = {
      ...fiscalOnly, label: 'Taux du Livret A',
      apply: ({ fiscal, accounts }) => ({ fiscal, accounts: accounts.map(a => ({ ...a, interestRate: 1.5 })) }),
    };
    act(() => result.current.applyFiscalProposal(withRate));
    expect((setters.setAccounts.mock.calls[0][0] as SavingsAccount[])[0].interestRate).toBe(1.5);
  });

  it('relevé importé : « Annuler » ; refus renvoyé à la fenêtre (compte disparu : rien à importer)', () => {
    const doc = withAccounts(account('a'));
    const { result, lastToast, accountsWritten } = setup(doc);
    let refusal: string | null = 'x';
    act(() => { refusal = result.current.importStatement([{ accountId: 'a', date: '2026-10-15', movements: [{ date: '2026-10-10', label: 'Versement', amount: 25, type: 'IN' }] }]); });
    expect(refusal).toBeNull();
    expect(accountsWritten(0)[0].totalAmount).toBe(125);
    expect(lastToast()).toMatchObject({ kind: 'success', action: { label: 'Annuler' } });
    act(() => lastToast().action!.onClick());
    expect(accountsWritten(1)[0].totalAmount).toBe(100);

    act(() => { refusal = result.current.importStatement([{ accountId: 'a', date: 'pas une date', movements: [] }]); });
    expect(refusal).toMatch(/date du relevé invalide/);
    act(() => { refusal = result.current.importStatement([{ accountId: 'disparu', date: '2026-10-15', movements: [{ date: '2026-10-10', label: 'V', amount: 5, type: 'IN' }] }]); });
    expect(refusal).toBe('Rien à importer.');
  });
});

describe('paie reçue (commandes de la paie)', () => {
  const line = (id: string, amount = 30) => ({ key: `s:${id}`, label: id, amount, kind: 'saving' as const, accountId: id });
  const paysWritten = (setters: { setPays: ReturnType<typeof vi.fn> }, i: number) => setters.setPays.mock.calls[i][0] as AppDoc['pays'];

  it('cocher une ligne d’un compte supprimé : rien d’écrit, rien à signaler, false', () => {
    const { result, setters, addToast } = setup(withAccounts(account('a')));
    let ok = true;
    act(() => { ok = result.current.checkPayLine([line('disparu')], line('disparu'), 30); });
    expect(ok).toBe(false);
    expect(setters.setPays).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it('cocher un virement de la paie : la paie est enregistrée, sans toast ; « Recalculer » défige', () => {
    const doc = withAccounts(account('a'));
    const { result, rerender, setters, addToast } = setup(doc);
    const loyer = { key: 't:loyer', label: 'Loyer', amount: 800, kind: 'transfer' as const };
    act(() => { result.current.checkPayLine([loyer, line('a')], loyer, 800); });
    expect(setters.setAccounts).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
    const pays = paysWritten(setters, 0);
    expect(pays[0]).toMatchObject({ lines: [loyer, line('a')], done: { 't:loyer': { amount: 800 } } });
    // Rien n'est fait tant que la coche reste : « Recalculer » ne fait rien ; décochée, il défige.
    rerender({ d: { ...doc, pays } });
    act(() => result.current.resetPayPlan());
    expect(setters.setPays).toHaveBeenCalledTimes(1);
    act(() => result.current.uncheckPayLine(loyer));
    rerender({ d: { ...doc, pays: paysWritten(setters, 1) } });
    act(() => result.current.resetPayPlan());
    expect(paysWritten(setters, 2)[0]).toMatchObject({ lines: [], done: {} });
  });

  it('enregistrer la paie : toast avec « Annuler » qui remet paies et soldes ; refus renvoyé à la feuille', () => {
    const doc = withAccounts(account('a'));
    const { result, setters, lastToast, accountsWritten } = setup(doc);
    let refusal: string | null = 'x';
    act(() => { refusal = result.current.recordPay({ pay: { receivedOn: '2026-10-27', amount: 2500 }, lines: [line('a', 300)], done: [{ key: 's:a', amount: 300 }], transferDate: '2026-10-28' }); });
    expect(refusal).toBeNull();
    expect(accountsWritten(0)[0].totalAmount).toBe(400);
    expect(paysWritten(setters, 0)).toHaveLength(1);
    expect(lastToast()).toMatchObject({ kind: 'success', action: { label: 'Annuler' } });
    act(() => lastToast().action!.onClick());
    expect(accountsWritten(1)[0].totalAmount).toBe(100);
    expect(paysWritten(setters, 1)).toEqual([]);
    act(() => { refusal = result.current.recordPay({ pay: { receivedOn: '2026-10-27', amount: 2500 }, lines: [line('b')], done: [{ key: 's:b', amount: 30 }], transferDate: '2026-10-28' }); });
    expect(refusal).toMatch(/n'existe plus/);
  });

  it('modifier la paie : « Annuler » ; paie disparue : refus renvoyé', () => {
    const pay = { id: 'p', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2500, lines: [], done: {} };
    const { result, setters, lastToast } = setup({ ...withAccounts(account('a')), pays: [pay] });
    let refusal: string | null = 'x';
    act(() => { refusal = result.current.updatePay({ payId: 'p', amount: 2600 }); });
    expect(refusal).toBeNull();
    expect(paysWritten(setters, 0)[0].amount).toBe(2600);
    act(() => lastToast().action!.onClick());
    expect(paysWritten(setters, 1)).toEqual([pay]);
    act(() => { refusal = result.current.updatePay({ payId: 'autre' }); });
    expect(refusal).toBe('Paie introuvable.');
  });

  it('supprimer une paie sans versement : simple confirmation', () => {
    const pay = { id: 'p', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2500, lines: [], done: {} };
    const { result, setters, dialog, lastToast } = setup({ ...withAccounts(account('a')), pays: [pay] });
    act(() => result.current.deletePay('inconnue'));
    expect(dialog.open).not.toHaveBeenCalled();
    act(() => result.current.deletePay('p'));
    const asked = dialog.open.mock.calls[0][0];
    expect(asked).toMatchObject({ title: 'Supprimer cette paie', danger: true, confirmLabel: 'Supprimer' });
    expect(asked.alternative).toBeUndefined();
    act(() => asked.onConfirm!());
    expect(paysWritten(setters, 0)).toEqual([]);
    expect(lastToast()).toMatchObject({ message: 'Paie supprimée', action: { label: 'Annuler' } });
  });

  it('supprimer une paie qui a créé des versements : supprimer aussi, ou les garder', () => {
    const a = account('a', { totalAmount: 130, ownedAmount: 130, movements: [{ id: 'm', date: '2026-10-28', amount: 30, label: 'Virement de paie', type: 'IN', payId: 'p' }] });
    const pay = { id: 'p', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2500, lines: [line('a')], done: { 's:a': { amount: 30, movementId: 'm' } } };
    const { result, setters, dialog, lastToast, accountsWritten } = setup({ ...withAccounts(a), pays: [pay] });
    act(() => result.current.deletePay('p'));
    const asked = dialog.open.mock.calls[0][0];
    expect(asked).toMatchObject({ confirmLabel: 'Supprimer aussi le versement', alternative: { label: 'Garder le versement' } });
    expect(asked.message).toMatch(/Elle a créé un versement sur vos comptes\. Supprimer aussi le versement enregistré/);
    act(() => asked.onConfirm!());
    expect(accountsWritten(0)[0]).toMatchObject({ totalAmount: 100, movements: [] });
    expect(lastToast().message).toBe('Paie supprimée, avec son versement');
    act(() => lastToast().action!.onClick());
    expect(accountsWritten(1)[0].totalAmount).toBe(130);
    expect(paysWritten(setters, 1)).toEqual([pay]);
    act(() => asked.alternative!.onClick());
    expect(accountsWritten(2)[0]).toMatchObject({ totalAmount: 130 });
    expect(accountsWritten(2)[0].movements[0].payId).toBeUndefined();
  });
});
