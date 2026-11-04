// @vitest-environment jsdom
// Rituel « J'ai reçu ma paie » : montant prérempli (fiche du mois, sinon paie estimée), écart
// annoncé, paie plus basse ou plus haute que prévu, « Tout est fait comme conseillé » ou
// enregistrement partiel (une seule commande), fiche de paie importée sur place, bilan du
// mois précédent en tête, modification d'une paie déclarée, accessibilité.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PayReceivedSheet, type PayRitualProps } from './PayReceivedSheet';
import { emptyData } from '../../lib/schema';
import { computeMonthlyPay } from '../../lib/finance';
import { AccountType, type GlobalAppData, type PayRecord, type PayslipRecord, type SavingsAccount } from '../../types';
import type { RecordPayInput } from '../../lib/commands';

vi.mock('../../services/googleDriveService', () => ({ openDrivePicker: vi.fn(), downloadFileAsBase64: vi.fn() }));
vi.mock('../../services/geminiService', () => ({
  extractPayslipData: vi.fn(), fileToBase64: vi.fn(), GeminiError: class GeminiError extends Error { code = 'OTHER'; },
}));

// Le 30 octobre 2026, paie le 27 : la paie du 27 octobre finance l'épargne de novembre.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 30, 12));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const account = (id: string, name: string, type: AccountType, over: Partial<SavingsAccount> = {}): SavingsAccount => ({
  id, name, type, institution: 'B', totalAmount: 1000, ownedAmount: 1000, parentalCapital: 0, movements: [], ...over,
});

const makeDoc = (over: Partial<GlobalAppData> = {}): GlobalAppData => {
  const d = emptyData();
  return {
    ...d,
    accounts: [account('la', 'Livret A', AccountType.LIVRET_A, { interestRate: 1.7, ceiling: 22950 }), account('av', 'Assurance vie', AccountType.ASSURANCE_VIE)],
    expenses: [{ id: 'e', name: 'Loyer', amount: 800 }],
    // Motivation coupée par défaut : pas de bilan (étape 0) sauf dans son test.
    config: { ...d.config, grossAnnual: 36000, leisureBudget: 200, projectSavings: 0, paydayDay: 27, gamification: false },
    ...over,
  };
};

const slip = (period: string, netPaid: number): PayslipRecord => ({
  id: `ps-${period}`, fileId: '', fileName: `${period}.pdf`, addedAt: `${period}-27T09:00:00.000Z`, reviewed: true, extracted: { period, netPaid },
});

const setup = (doc: GlobalAppData, patch: Partial<PayRitualProps> & { editPayId?: string } = {}) => {
  const onRecordPay = vi.fn((_: RecordPayInput) => null as string | null);
  const onClose = vi.fn();
  const props = {
    doc, geminiApiKey: '', pickerApiKey: '', onRecordPay, onDeletePay: vi.fn(), onValidateReview: vi.fn(), onSavePayslip: vi.fn(), onClose, ...patch,
  };
  render(<PayReceivedSheet {...props} />);
  return props as typeof props & { onRecordPay: typeof onRecordPay };
};

const amountField = () => screen.getByLabelText('Montant reçu') as HTMLInputElement;
/** Espaces insécables (formateurs) remis en espaces simples. */
const nbsp = (s: string | null | undefined) => (s ?? '').replace(/[\u00a0\u202f]/g, ' ').trim();
const toPlan = () => fireEvent.click(screen.getByRole('button', { name: 'Voir la répartition' }));
const toSaveValue = () => Number((screen.getByRole('textbox', { name: 'Montant fait pour Livret A' }) as HTMLInputElement).value.replace(/\s/g, '').replace(',', '.'));

describe('Rituel « J’ai reçu ma paie » : votre paie', () => {
  it('fenêtre nommée, montant prérempli avec la paie estimée, reçue aujourd’hui, épargne de novembre', () => {
    const doc = makeDoc();
    setup(doc);
    expect(screen.getByRole('dialog', { name: "J'ai reçu ma paie" })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Votre paie' })).toBeTruthy();
    expect(Number(amountField().value.replace(',', '.'))).toBeCloseTo(Math.round(computeMonthlyPay(doc) * 100) / 100, 2);
    expect((screen.getByLabelText('Reçue le') as HTMLInputElement).value).toBe('2026-10-30');
    expect(screen.getByText('Épargne de novembre')).toBeTruthy();
    // Paie reçue le 3 novembre : épargne de novembre aussi ; « Changer » propose un autre mois.
    fireEvent.change(screen.getByLabelText('Reçue le'), { target: { value: '2026-10-10' } });
    expect(screen.getByText("Épargne d'octobre")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Changer' }));
    fireEvent.change(screen.getByLabelText("Mois d'épargne"), { target: { value: '2026-11' } });
    expect(screen.getByText('Épargne de novembre')).toBeTruthy();
    expect(screen.getByText('Choisi par vous pour cette paie.')).toBeTruthy();
  });

  it('fiche du mois déjà importée : son net payé préremplit le montant, avec l’écart à la paie prévue', () => {
    const doc = makeDoc({ payslips: [slip('2026-10', 3000)] });
    setup(doc);
    expect(amountField().value).toBe('3000');
    const gap = Math.round(3000 - computeMonthlyPay(doc));
    const section = screen.getByRole('region', { name: "Fiche de paie d'octobre" });
    expect(section.textContent).toMatch(/Net payé : 3\s000\s€/);
    expect(section.textContent).toMatch(new RegExp(`${String(Math.abs(gap)).replace(/\B(?=(\d{3})+(?!\d))/g, '\\s')}\\s€ de ${gap > 0 ? 'plus' : 'moins'} que prévu`));
  });

  it('montant illisible ou prime plus grande que la paie : on ne passe pas à la répartition', () => {
    setup(makeDoc());
    fireEvent.change(amountField(), { target: { value: '12a' } });
    expect(screen.getByText(/Montant non reconnu/)).toBeTruthy();
    expect(amountField().getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByRole('button', { name: 'Voir la répartition' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(amountField(), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dont prime ou exceptionnel' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Dont prime ou exceptionnel' }), { target: { value: '2500' } });
    expect(screen.getByText('La prime ne peut pas dépasser le montant reçu.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Voir la répartition' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sans clé : la fiche se saisit à la main sur place, rejoint les fiches, et son net payé devient le montant', () => {
    const doc = makeDoc();
    const props = setup(doc);
    const section = screen.getByRole('region', { name: "Fiche de paie d'octobre" });
    expect(within(section).getByText(/Sans clé Gemini, saisissez ses montants à la main/)).toBeTruthy();
    expect((within(section).getByRole('button', { name: 'Importer depuis Drive' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(section).getByRole('button', { name: 'Saisir à la main' }));
    // Le mois de la fiche est proposé : celui qui précède le mois d'épargne.
    expect((screen.getByLabelText('Mois de la paie (AAAA-MM)') as HTMLInputElement).value).toBe('2026-10');
    expect((screen.getByRole('button', { name: 'Voir la répartition' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.blur(screen.getByLabelText('Net payé'), { target: { value: '2 600,40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la fiche' }));
    expect(props.onSavePayslip).toHaveBeenCalledTimes(1);
    const [record, replaced] = vi.mocked(props.onSavePayslip).mock.calls[0];
    expect(record).toMatchObject({ reviewed: true, extracted: { period: '2026-10', netPaid: 2600.4 } });
    expect(replaced.size).toBe(0);
    expect(amountField().value).toBe('2600,40');
    toPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Tout est fait comme conseillé' }));
    expect(props.onRecordPay.mock.calls[0][0].pay).toMatchObject({ amount: 2600.4, payslipId: record.id });
  });
});

describe('Rituel : répartition et enregistrement', () => {
  it('« Tout est fait comme conseillé » : une seule commande, toutes les lignes faites, date des virements', () => {
    const doc = makeDoc();
    const props = setup(doc);
    fireEvent.change(amountField(), { target: { value: '2500' } });
    toPlan();
    // Le titre de l'étape reçoit le focus.
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Que faire de votre paie' }));
    fireEvent.change(screen.getByLabelText('Virements faits le'), { target: { value: '2026-10-29' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tout est fait comme conseillé' }));
    expect(props.onRecordPay).toHaveBeenCalledTimes(1);
    const input = props.onRecordPay.mock.calls[0][0];
    expect(input.pay).toMatchObject({ receivedOn: '2026-10-30', savingsMonth: '2026-11', amount: 2500 });
    expect(input.pay.id).toBeUndefined();
    expect(input.transferDate).toBe('2026-10-29');
    expect(input.done.map(d => d.key).sort()).toEqual(input.lines.map(l => l.key).sort());
    for (const d of input.done) expect(d.amount).toBe(input.lines.find(l => l.key === d.key)!.amount);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('« Enregistrer » : seulement la case cochée, avec son montant et son compte corrigés', () => {
    const props = setup(makeDoc());
    fireEvent.change(amountField(), { target: { value: '2500' } });
    toPlan();
    const box = screen.getByRole('checkbox', { name: /^Livret A/ });
    fireEvent.click(box);
    fireEvent.change(screen.getByRole('textbox', { name: 'Montant fait pour Livret A' }), { target: { value: '321,5' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Compte crédité pour Livret A' }), { target: { value: 'av' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const input = props.onRecordPay.mock.calls[0][0];
    expect(input.done).toEqual([{ key: 's:la', amount: 321.5, accountId: 'av' }]);
  });

  it('« + Autre compte » : une ligne ajoutée, faite, hors plan conseillé', () => {
    const props = setup(makeDoc());
    toPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Autre compte' }));
    fireEvent.change(screen.getByRole('textbox', { name: "Montant versé sur l'autre compte" }), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const input = props.onRecordPay.mock.calls[0][0];
    const added = input.lines.find(l => l.added);
    expect(added).toMatchObject({ kind: 'saving', amount: 50, added: true });
    expect(input.done).toEqual([{ key: added!.key, amount: 50 }]);
  });

  it('paie plus basse que prévu : le plaisir baisse d’abord, jusqu’à son minimum, puis l’épargne, et Pécule le dit ; plus haute : l’épargne monte', () => {
    const doc = makeDoc();
    const expected = Math.round(computeMonthlyPay(doc) * 100) / 100;
    setup(doc);
    toPlan();
    const base = toSaveValue();
    // Solde de départ 200 € (minimum 133 €) : 50 € de moins, le plaisir absorbe tout.
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    fireEvent.change(amountField(), { target: { value: String(expected - 50).replace('.', ',') } });
    toPlan();
    expect(toSaveValue()).toBeCloseTo(base, 2);
    expect(screen.getByText(/^Paie inférieure de 50\s€ à l'habitude : le plaisir passe à 150\s€ au lieu de 200\s€ \(minimum 133\s€\)\. Épargne tenue\.$/)).toBeTruthy();
    // 100 € de moins : le plaisir à son minimum, l'épargne baisse des 33 € qui manquent.
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    fireEvent.change(amountField(), { target: { value: String(expected - 100).replace('.', ',') } });
    toPlan();
    expect(toSaveValue()).toBeCloseTo(base - 33, 2);
    expect(screen.getByText(/^Paie inférieure de 100\s€ à l'habitude : le plaisir descend à son minimum \(133\s€\) et l'épargne baisse de 33\s€\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    fireEvent.change(amountField(), { target: { value: String(expected + 150).replace('.', ',') } });
    toPlan();
    expect(toSaveValue()).toBeCloseTo(base + 150, 2);
    expect(screen.getByText(/^Le compte courant démarre à 200\s€ : 150\s€ de plus vont à l'épargne \(paie supérieure de 150\s€ à l'habitude\)\.$/)).toBeTruthy();
  });

  it('montants modifiables : le plaisir est la ligne d’équilibre (sans case), la barre suit, « Rétablir les montants conseillés »', () => {
    const props = setup(makeDoc());
    fireEvent.change(amountField(), { target: { value: '2500' } });
    toPlan();
    const base = toSaveValue();
    const leisure = () => screen.getByRole('region', { name: /^Plaisir : reste sur le compte courant/ });
    expect(nbsp(leisure().textContent)).toMatch(/Plaisir : reste sur le compte courant200 €/);
    expect(screen.queryByRole('checkbox', { name: /plaisir/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rétablir les montants conseillés' })).toBeNull();
    expect(screen.getByText(/^Le compte courant démarre à 200/)).toBeTruthy();
    const bar = screen.getByRole('img');
    expect(nbsp(bar.getAttribute('aria-label'))).toMatch(/^Répartition de 2 500 € : virements fixes 800 €, épargne [\d ,]+ €, plaisir 200 €\.$/);
    // 100 € de plus sur le Livret A : le plaisir passe à 100 €, sous son minimum (2/3 de 200 €).
    const field = screen.getByRole('textbox', { name: 'Montant fait pour Livret A' });
    fireEvent.change(field, { target: { value: String(base + 100).replace('.', ',') } });
    expect(nbsp(leisure().textContent)).toMatch(/courant100 €/);
    // La phrase du conseil se tait une fois les montants changés.
    expect(screen.queryByText(/^Le compte courant démarre/)).toBeNull();
    expect(nbsp(within(leisure()).getByRole('status').textContent)).toBe('En dessous de votre minimum de 133 €.');
    expect(nbsp(screen.getByRole('img').getAttribute('aria-label'))).toMatch(/plaisir 100 € \(prévu 200 €\)\.$/);
    // Rétablir : le conseil revient, le bouton disparaît.
    fireEvent.click(screen.getByRole('button', { name: 'Rétablir les montants conseillés' }));
    expect(toSaveValue()).toBeCloseTo(base, 2);
    expect(screen.queryByRole('button', { name: 'Rétablir les montants conseillés' })).toBeNull();
    // 300 € de plus : il manque 100 € pour les virements fixes ; la barre garde un plaisir à 0.
    fireEvent.change(screen.getByRole('textbox', { name: 'Montant fait pour Livret A' }), { target: { value: String(base + 300).replace('.', ',') } });
    expect(nbsp(within(leisure()).getByRole('status').textContent)).toMatch(/Il manque 100 € pour les virements fixes/);
    expect(nbsp(screen.getByRole('img').getAttribute('aria-label'))).toMatch(/plaisir 0 € \(prévu 200 €\)\. Il manque 100 € pour les virements fixes\.$/);
    // Montant raisonnable, puis « Enregistrer » : seulement la case cochée, le plaisir n'est pas fait.
    fireEvent.change(screen.getByRole('textbox', { name: 'Montant fait pour Livret A' }), { target: { value: String(base + 50).replace('.', ',') } });
    fireEvent.click(screen.getByRole('checkbox', { name: /^Livret A/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const partial = props.onRecordPay.mock.calls[0][0];
    expect(partial.done).toEqual([{ key: 's:la', amount: Math.round((base + 50) * 100) / 100 }]);
    expect(partial.lines.find(l => l.key === 't:leisure')?.amount).toBe(150);
    // « Tout est fait » : le plaisir est fait avec ce qui reste vraiment ; la somme vaut l'argent à répartir.
    fireEvent.click(screen.getByRole('button', { name: 'Tout est fait comme conseillé' }));
    const all = props.onRecordPay.mock.calls[1][0];
    expect(all.done.find(d => d.key === 't:leisure')).toEqual({ key: 't:leisure', amount: 150 });
    expect(Math.round(all.done.reduce((s, d) => s + d.amount, 0) * 100)).toBe(250000);
  });

  it('refus de la commande : affiché dans la feuille, qui reste ouverte', () => {
    const props = setup(makeDoc(), { onRecordPay: vi.fn(() => 'Le compte « Livret A » n\'existe plus : choisissez-en un autre.') });
    toPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Tout est fait comme conseillé' }));
    expect(screen.getByRole('alert').textContent).toMatch(/n'existe plus/);
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

describe('Rituel : bilan, deuxième paie, modification', () => {
  it('bilan du mois précédent non validé : étape 0, « Continuer » le valide', () => {
    const accounts = [account('la', 'Livret A', AccountType.LIVRET_A, {
      movements: [
        { id: 'm1', date: '2026-08-28', amount: 600, label: 'Épargne', type: 'IN' },
        { id: 'm2', date: '2026-09-28', amount: 650, label: 'Épargne', type: 'IN' },
      ],
    })];
    const doc = makeDoc({ accounts });
    doc.config = { ...doc.config, gamification: undefined };
    const props = setup(doc);
    expect(screen.getByRole('heading', { name: "Bilan d'octobre" })).toBeTruthy();
    expect(screen.getByText('Étape 1 sur 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(props.onValidateReview).toHaveBeenCalledWith('2026-10');
    expect(screen.getByRole('heading', { name: 'Votre paie' })).toBe(document.activeElement);
  });

  it('une paie déjà déclarée ce mois-ci : proposée comme versement en plus, placé en entier', () => {
    const pays: PayRecord[] = [{ id: 'pay-2026-11', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2500, lines: [], done: {} }];
    const props = setup(makeDoc({ pays }));
    expect(screen.getByRole('radio', { name: /Versement en plus/ })).toHaveProperty('checked', true);
    fireEvent.change(amountField(), { target: { value: '300' } });
    toPlan();
    expect(screen.queryByText("Virements de la paie, déduits avant l'épargne")).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tout est fait comme conseillé' }));
    const input = props.onRecordPay.mock.calls[0][0];
    expect(input.pay).toMatchObject({ kind: 'extra', amount: 300 });
    expect(input.done.reduce((s, d) => s + d.amount, 0)).toBeCloseTo(300, 2);
  });

  it('modifier une paie : lignes déjà faites gardées, montant à placer remis au calcul, suppression', () => {
    const pays: PayRecord[] = [{
      id: 'pay-2026-11', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2500, toSave: 500,
      lines: [{ key: 's:la', label: 'Livret A', amount: 500, kind: 'saving', accountId: 'la' }, { key: 't:Loyer', label: 'Loyer', amount: 800, kind: 'transfer' }],
      done: { 't:Loyer': { amount: 800 } },
    }];
    const doc = makeDoc({ pays });
    const props = setup(doc, { editPayId: 'pay-2026-11' });
    expect(screen.getByRole('dialog', { name: 'Modifier la paie' })).toBeTruthy();
    expect(amountField().value).toBe('2500');
    expect((screen.getByLabelText('Reçue le') as HTMLInputElement).value).toBe('2026-10-27');
    toPlan();
    expect(screen.getByText(/Plan figé/)).toBeTruthy();
    const loyer = screen.getByRole('checkbox', { name: /^Loyer/ }) as HTMLInputElement;
    expect(loyer.checked && loyer.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Tout est fait comme conseillé' }));
    const input = props.onRecordPay.mock.calls[0][0];
    expect(input.pay).toMatchObject({ id: 'pay-2026-11' });
    // L'ancien « à placer » reste sur la paie (la commande le garde) ; pas de solde ajouté à une ancienne paie.
    expect('toSave' in input.pay || 'balance' in input.pay).toBe(false);
    expect(input.done).toEqual([{ key: 's:la', amount: 500 }]);
    cleanup();
    const again = setup(doc, { editPayId: 'pay-2026-11' });
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer cette paie' }));
    expect(again.onClose).toHaveBeenCalled();
    expect(again.onDeletePay).toHaveBeenCalledWith('pay-2026-11');
  });
});

describe('Rituel : le compte courant', () => {
  // Compte courant « Boursorama » à 430 €, constaté le 25 octobre (il y a 5 jours).
  const withCurrent = (over: Partial<SavingsAccount> = {}) => {
    const doc = makeDoc();
    return { ...doc, accounts: [...doc.accounts, account('cc', 'Boursorama', AccountType.COMPTE_COURANT, { totalAmount: 430, ownedAmount: 430, balanceCheckedAt: '2026-10-25', ...over })] };
  };
  const balanceField = () => screen.getByLabelText('Solde maintenant, paie comprise') as HTMLInputElement;
  const region = () => screen.getByRole('region', { name: 'Compte courant · Boursorama' });

  it('solde récent : estimation prérempli (solde connu + paie), avec sa source et son âge', () => {
    setup(withCurrent());
    fireEvent.change(amountField(), { target: { value: '2000' } });
    expect(balanceField().value).toBe('2430');
    expect(nbsp(region().textContent)).toMatch(/Estimation : 430 € le 25 octobre \(il y a 5 jours\), plus votre paie\. Vérifiez dans votre banque\./);
    expect(nbsp(within(region()).getByRole('status').textContent)).toBe('Il restait 430 € du mois dernier.');
  });

  it('solde constaté après la paie : repris tel quel ; plus de 15 jours : rien de proposé', () => {
    setup(withCurrent({ balanceCheckedAt: '2026-10-29' }));
    fireEvent.change(screen.getByLabelText('Reçue le'), { target: { value: '2026-10-27' } });
    expect(balanceField().value).toBe('430');
    expect(nbsp(region().textContent)).toMatch(/Solde enregistré le 29 octobre\./);
    cleanup();
    setup(withCurrent({ balanceCheckedAt: '2026-09-20' }));
    expect(balanceField().value).toBe('');
    expect(region().textContent).toMatch(/Dernier solde connu il y a 40 jours : trop ancien\. Regardez votre banque\./);
    expect(within(region()).getByRole('status').textContent).toBe('');
  });

  it('solde saisi : « 2 000 € de paie + 30 € déjà sur le compte = 2 030 € à répartir », et « Tout est fait » note le compte courant', () => {
    const props = setup(withCurrent());
    fireEvent.change(amountField(), { target: { value: '2000' } });
    fireEvent.change(balanceField(), { target: { value: '2 030' } });
    expect(nbsp(within(region()).getByRole('status').textContent)).toBe('Il restait 30 € du mois dernier.');
    toPlan();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && /^2 000 € de paie \+ 30 € déjà sur le compte = 2 030 € à répartir$/.test(nbsp(el.textContent)))).toBeTruthy();
    expect(nbsp(screen.getByRole('img').getAttribute('aria-label'))).toMatch(/^Répartition de 2 030 €/);
    fireEvent.click(screen.getByRole('button', { name: 'Tout est fait comme conseillé' }));
    const input = props.onRecordPay.mock.calls[0][0];
    expect(input.pay.balance).toEqual({ seen: 2030, before: 30, source: 'typed' });
    expect(input.currentAccountId).toBe('cc');
    // Argent conservé au centime : les lignes valent la paie + le reste.
    expect(Math.round(input.done.reduce((s, d) => s + d.amount, 0) * 100)).toBe(203000);
  });

  it('paie pas encore dans le solde, découvert : « Découvert de 50 € avant la paie »', () => {
    const props = setup(withCurrent());
    fireEvent.change(amountField(), { target: { value: '2000' } });
    fireEvent.change(balanceField(), { target: { value: '−50' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ma paie apparaît déjà dans ce solde' }));
    expect(nbsp(within(region()).getByRole('status').textContent)).toBe('Découvert de 50 € avant la paie.');
    toPlan();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && /^2 000 € de paie − 50 € de découvert = 1 950 € à répartir$/.test(nbsp(el.textContent)))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const input = props.onRecordPay.mock.calls[0][0];
    expect(input.pay.balance).toEqual({ seen: -50, before: -50, source: 'typed' });
    // « Enregistrer » (partiel) : pas de constat du compte courant.
    expect(input.currentAccountId).toBeUndefined();
  });

  it('« Je ne sais pas » : champ vidé, compté 0, dit à l’étape 2, rien de noté sur le compte courant', () => {
    const props = setup(withCurrent());
    fireEvent.click(screen.getByRole('button', { name: 'Je ne sais pas' }));
    expect(balanceField().value).toBe('');
    expect(region().textContent).toMatch(/Sans votre solde, Pécule suppose que le compte courant était vide avant la paie\./);
    expect(screen.queryByRole('button', { name: 'Je ne sais pas' })).toBeNull();
    toPlan();
    expect(screen.getByText('Sans votre solde, Pécule suppose que le compte courant était vide avant la paie.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tout est fait comme conseillé' }));
    const input = props.onRecordPay.mock.calls[0][0];
    expect(input.pay.balance).toEqual({ before: 0, source: 'unknown' });
    expect(input.currentAccountId).toBeUndefined();
  });

  it('solde illisible : on ne passe pas à la répartition ; versement en plus : pas de bloc compte courant', () => {
    setup(withCurrent());
    fireEvent.change(balanceField(), { target: { value: 'beaucoup' } });
    expect(screen.getByText('Montant non reconnu (exemple : 430,50 ou −50).')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Voir la répartition' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const pays: PayRecord[] = [{ id: 'pay-2026-11', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2500, lines: [], done: {} }];
    setup({ ...withCurrent(), pays });
    expect(screen.queryByLabelText('Solde maintenant, paie comprise')).toBeNull();
  });

  it('modifier une paie : son solde est repris (et non le solde connu)', () => {
    const pays: PayRecord[] = [{ id: 'pay-2026-11', receivedOn: '2026-10-27', savingsMonth: '2026-11', amount: 2000, balance: { seen: 30, before: 30, source: 'typed' }, lines: [], done: {} }];
    const props = setup({ ...withCurrent(), pays }, { editPayId: 'pay-2026-11' });
    expect(balanceField().value).toBe('30');
    expect((screen.getByRole('checkbox', { name: 'Ma paie apparaît déjà dans ce solde' }) as HTMLInputElement).checked).toBe(false);
    toPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(props.onRecordPay.mock.calls[0][0].pay.balance).toEqual({ seen: 30, before: 30, source: 'typed' });
  });
});
