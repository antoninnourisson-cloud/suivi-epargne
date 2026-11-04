// @vitest-environment jsdom
// Pilotage › Ce mois : deux cartes, « Ma paie » et « Réglages de la paie » (cinq groupes dans
// l'ordre de la barre). Les réglages arrivent en un objet (config) et repartent par une seule
// fonction (onPatchConfig). Le plaisir ne descend jamais sous les 2/3 du solde de départ :
// une règle dite, pas un réglage.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AssistantPilot, type PilotConfig } from './AssistantPilot';
import { DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS } from '../constants';
import { AccountType, type SavingsAccount, type Subscription } from '../types';
import { requestPaySettings } from './pilot/paySettingsRequest';

vi.mock('../services/backendService', async (orig) => ({ ...(await orig<object>()), isBackendEnabled: () => true }));

afterEach(() => cleanup());

const config: PilotConfig = { grossAnnual: 36000, leisureBudget: 250, projectSavings: 100, taxRateManual: 0, extraMonthlyIncome: 0 };
const nb = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ');

const current = (id: string, name: string): SavingsAccount => ({
  id, name, institution: 'B', type: AccountType.COMPTE_COURANT, totalAmount: 500, ownedAmount: 500, parentalCapital: 0, interestRate: 0, movements: [],
} as SavingsAccount);

const renderPilot = (patch = vi.fn(), cfg: PilotConfig = config, extra: Partial<React.ComponentProps<typeof AssistantPilot>> = {}) => {
  render(<AssistantPilot
    accounts={[]} expenses={[]} onUpdateExpenses={() => {}}
    config={cfg} onPatchConfig={patch}
    fiscalConfig={DEFAULT_FISCAL_CONFIG} workBenefits={DEFAULT_WORK_BENEFITS}
    onClearActivePayslip={() => {}} subscriptions={[]} onOpenSubscriptions={() => {}}
    onPayLineCheck={() => true} onPayLineUncheck={() => {}} onPayPlanReset={() => {}} {...extra} />);
  return patch;
};

const open = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const openIncome = () => {
  open(/^Paie habituelle/);
  fireEvent.click(screen.getByRole('button', { name: 'Voir le détail du salaire' }));
};

describe('Pilotage › Ce mois : deux cartes', () => {
  it('« Ma paie » puis « Réglages de la paie » en cinq groupes, dans l’ordre de la barre ; plus de héros ni de durée de survie', () => {
    renderPilot();
    expect(screen.getByRole('heading', { name: 'Ma paie' })).toBeTruthy();
    const settings = screen.getByRole('region', { name: 'Réglages de la paie' });
    const groups = within(settings).getAllByRole('heading', { level: 4 }).map(h => h.querySelector('span.flex-1')?.textContent);
    expect(groups).toEqual(['Paie habituelle', 'Virements fixes', 'Épargne', 'Épargne projets', 'Plaisir']);
    expect(screen.queryByText('Durée de survie')).toBeNull();
    expect(screen.queryByRole('region', { name: 'À placer ce mois' })).toBeNull();
    expect(screen.queryByText('Mes paramètres')).toBeNull();
    expect(screen.getByText('Ce que devient votre paie, et où va votre épargne.')).toBeTruthy();
  });

  it('Plaisir : « Solde de départ du mois » seul, le minimum (2/3) dit en euros, sans réglage de minimum', () => {
    const patch = renderPilot(vi.fn(), { ...config, leisureBudget: 400 });
    const toggle = screen.getByRole('button', { name: /^Plaisir/ });
    expect(nb(toggle.textContent)).toMatch(/400 € au départ · minimum 267 €/);
    fireEvent.click(toggle);
    const group = screen.getByRole('region', { name: /^Plaisir/ });
    expect(within(group).getAllByRole('textbox')).toHaveLength(1);
    const field = within(group).getByRole('textbox', { name: 'Solde de départ du mois' });
    expect(nb(document.getElementById(field.getAttribute('aria-describedby')!.split(' ')[0])?.textContent)).toMatch(/jamais sous les 2\/3 \(267 €\)/);
    fireEvent.change(field, { target: { value: '300' } });
    expect(patch).toHaveBeenLastCalledWith({ leisureBudget: 300 });
  });
});

describe('Réglages de la paie', () => {
  it('l’autre salaire est modifiable et enregistré dans la config', () => {
    const patch = renderPilot();
    openIncome();
    fireEvent.change(screen.getByLabelText('Autre salaire (net par mois)'), { target: { value: '200' } });
    expect(patch).toHaveBeenCalledWith({ extraMonthlyIncome: 200 });
  });

  it('une valeur reprise d’un ancien fichier s’affiche dans le détail du salaire', () => {
    renderPilot(vi.fn(), { ...config, extraMonthlyIncome: 150 });
    openIncome();
    const detail = document.getElementById('pilot-salary-detail')!;
    expect(within(detail).getByText('Autre salaire')).toBeTruthy();
    expect((screen.getByLabelText('Autre salaire (net par mois)') as HTMLInputElement).value).toBe('150');
  });

  it('chaque réglage part par la même fonction, seul', () => {
    const patch = renderPilot();
    open(/^Épargne projets/);
    fireEvent.change(screen.getByRole('textbox', { name: 'Épargne projets' }), { target: { value: '50' } });
    expect(patch).toHaveBeenLastCalledWith({ projectSavings: 50 });
    openIncome();
    fireEvent.change(screen.getByRole('textbox', { name: 'Brut annuel' }), { target: { value: '40000' } });
    expect(patch).toHaveBeenLastCalledWith({ grossAnnual: 40000 });
  });

  it('Paie habituelle : jour de paie toujours là (« Pas de jour fixe »), lien vers les notifications', () => {
    const onOpenNotifications = vi.fn();
    const patch = renderPilot(vi.fn(), { ...config, paydayDay: 27 }, { onOpenNotifications });
    expect(nb(screen.getByRole('button', { name: /^Paie habituelle/ }).textContent)).toMatch(/nets · le 27 du mois/);
    open(/^Paie habituelle/);
    const day = screen.getByRole('combobox', { name: 'Jour de paie' }) as HTMLSelectElement;
    expect(day.value).toBe('27');
    expect(day.options[0].textContent).toBe('Pas de jour fixe');
    fireEvent.change(day, { target: { value: '' } });
    expect(patch).toHaveBeenLastCalledWith({ paydayDay: undefined });
    // Un seul compte courant (ou aucun) : pas de choix du compte de la paie.
    expect(screen.queryByRole('combobox', { name: 'Compte où arrive la paie' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Rappel par notification/ }));
    expect(onOpenNotifications).toHaveBeenCalled();
  });

  it('plusieurs comptes courants : le compte où arrive la paie se choisit', () => {
    const patch = renderPilot(vi.fn(), config, { accounts: [current('cc1', 'Compte joint'), current('cc2', 'Compte perso')] });
    open(/^Paie habituelle/);
    const select = screen.getByRole('combobox', { name: 'Compte où arrive la paie' }) as HTMLSelectElement;
    expect(select.value).toBe('cc1');
    fireEvent.change(select, { target: { value: 'cc2' } });
    expect(patch).toHaveBeenLastCalledWith({ payAccountId: 'cc2' });
  });

  it('« Modifier : Pilotage › Paie habituelle » (Notifications) : Paie habituelle s’ouvre, à son ancre stable', () => {
    requestPaySettings();
    renderPilot();
    const toggle = screen.getByRole('button', { name: /^Paie habituelle/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.closest('section')?.id).toBe('pay-settings-income');
    // Déjà affiché : la demande l'ouvre aussi.
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    act(() => requestPaySettings());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('Virements fixes : abonnements en total seulement, « Gérer » ouvre l’onglet Abonnements', () => {
    const onOpenSubscriptions = vi.fn();
    const subscriptions = [{ id: 's', name: 'Netflix', amount: 40, frequency: 'monthly', active: true }] as unknown as Subscription[];
    renderPilot(vi.fn(), config, { subscriptions, onOpenSubscriptions, expenses: [{ id: 'e', name: 'Loyer', amount: 750 }] });
    expect(nb(screen.getByRole('button', { name: /^Virements fixes/ }).textContent)).toMatch(/790 € par mois/);
    open(/^Virements fixes/);
    const group = screen.getByRole('region', { name: /^Virements fixes/ });
    expect(nb(group.textContent)).toMatch(/40 € d'abonnements mensuels/);
    expect(within(group).queryByText('Netflix')).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: 'Gérer les abonnements' }));
    expect(onOpenSubscriptions).toHaveBeenCalled();
  });

  it('Épargne : calculée ou montant fixe ; le montant fixe dit ce qu’il change au plaisir', () => {
    const patch = vi.fn();
    const { rerender } = render(<AssistantPilot
      accounts={[]} expenses={[]} onUpdateExpenses={() => {}} config={config} onPatchConfig={patch}
      fiscalConfig={DEFAULT_FISCAL_CONFIG} workBenefits={DEFAULT_WORK_BENEFITS}
      onClearActivePayslip={() => {}} subscriptions={[]} onOpenSubscriptions={() => {}}
      onPayLineCheck={() => true} onPayLineUncheck={() => {}} onPayPlanReset={() => {}} />);
    open(/^Épargne(?! projets)/);
    const group = screen.getByRole('region', { name: /^Épargne(?! projets)/ });
    const computed = within(group).getByRole('button', { name: /^Calculée \(/ });
    expect(computed.getAttribute('aria-pressed')).toBe('true');
    expect(within(group).queryByRole('textbox', { name: 'Montant fixe par paie' })).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: 'Montant fixe' }));
    // Le montant fixe part du calcul, arrondi à l'euro.
    const start = patch.mock.lastCall![0].paydayAmount;
    expect(Number.isInteger(start)).toBe(true);
    const field = within(group).getByRole('textbox', { name: 'Montant fixe par paie' }) as HTMLInputElement;
    expect(field.value).toBe(String(start));
    rerender(<AssistantPilot
      accounts={[]} expenses={[]} onUpdateExpenses={() => {}} config={{ ...config, paydayAmount: start + 50 }} onPatchConfig={patch}
      fiscalConfig={DEFAULT_FISCAL_CONFIG} workBenefits={DEFAULT_WORK_BENEFITS}
      onClearActivePayslip={() => {}} subscriptions={[]} onOpenSubscriptions={() => {}}
      onPayLineCheck={() => true} onPayLineUncheck={() => {}} onPayPlanReset={() => {}} />);
    // 50 € de plus que le calcul : le plaisir passe d'environ 250 € à environ 200 € (au-dessus du minimum de 167 €).
    expect(nb(group.textContent)).toMatch(/Plus haut que le calcul \([\d ]+ €\) : il resterait (199|200|201)(,\d\d)? € de plaisir au lieu de 250 €\./);
    fireEvent.click(within(group).getByRole('button', { name: /^Calculée \(/ }));
    expect(patch).toHaveBeenLastCalledWith({ paydayAmount: undefined });
    // Répartition entre les comptes et remplissage des livrets, dans le même groupe.
    expect(within(group).getByText('Répartition entre les comptes')).toBeTruthy();
    expect(within(group).getByRole('heading', { name: 'Remplissage des livrets' })).toBeTruthy();
  });
});
