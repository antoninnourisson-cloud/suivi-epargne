// @vitest-environment jsdom
// Pilotage : les réglages arrivent en un objet (config) et repartent par une seule fonction
// (onPatchConfig) ; l'autre salaire (second employeur) se règle enfin ici.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AssistantPilot, type PilotConfig } from './AssistantPilot';
import { DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS } from '../constants';

afterEach(() => cleanup());

const config: PilotConfig = { grossAnnual: 36000, leisureBudget: 250, projectSavings: 100, taxRateManual: 0, extraMonthlyIncome: 0 };

const renderPilot = (patch = vi.fn(), cfg: PilotConfig = config) => {
  render(<AssistantPilot
    accounts={[]} expenses={[]} onUpdateExpenses={() => {}}
    config={cfg} onPatchConfig={patch}
    fiscalConfig={DEFAULT_FISCAL_CONFIG} workBenefits={DEFAULT_WORK_BENEFITS}
    onClearActivePayslip={() => {}} subscriptions={[]} onOpenSubscriptions={() => {}}
    onPayLineCheck={() => true} onPayLineUncheck={() => {}} onPayPlanReset={() => {}} />);
  return patch;
};

const openIncome = () => {
  fireEvent.click(screen.getByRole('button', { name: /^Revenus et salaire/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Voir le détail du salaire' }));
};

describe('Pilotage : réglages', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /^Budgets/ }));
    // Les champs de saisie (textbox) : la liste de paie a aussi une case « Épargne projets ».
    fireEvent.change(screen.getByRole('textbox', { name: 'Argent plaisir' }), { target: { value: '300' } });
    expect(patch).toHaveBeenLastCalledWith({ leisureBudget: 300 });
    fireEvent.change(screen.getByRole('textbox', { name: 'Épargne projets' }), { target: { value: '50' } });
    expect(patch).toHaveBeenLastCalledWith({ projectSavings: 50 });
    openIncome();
    fireEvent.change(screen.getByRole('textbox', { name: 'Brut annuel' }), { target: { value: '40000' } });
    expect(patch).toHaveBeenLastCalledWith({ grossAnnual: 40000 });
  });
});

describe('Pilotage : en-tête « À placer ce mois »', () => {
  const amountsOf = () => {
    const hero = screen.getByRole('region', { name: 'À placer ce mois' });
    const pairs = Array.from(hero.querySelectorAll('dl > div'));
    return { hero, pairs };
  };

  it('chaque libellé est suivi de sa propre valeur (une paire dt/dd par montant)', () => {
    renderPilot();
    const { pairs } = amountsOf();
    expect(pairs).toHaveLength(2);
    expect(pairs.map((p) => p.querySelector('dt')?.textContent)).toEqual(['Paie nette après impôt', 'Dépenses prévues']);
    for (const p of pairs) expect(p.querySelectorAll('dd')).toHaveLength(1);
  });

  it('les trois montants ont la même précision : paie − dépenses = à placer, au centime près', () => {
    renderPilot();
    const { hero, pairs } = amountsOf();
    const parse = (s: string | null | undefined) => Number((s ?? '').replace(/[^\d,-]/g, '').replace(',', '.'));
    const texts = pairs.map((p) => p.querySelector('dd')?.textContent);
    const [net, spending] = texts.map(parse);
    // Même nombre de décimales partout (toutes avec centimes, ou aucune).
    const withCents = texts.map((t) => /,\d{2}/.test(t ?? ''));
    expect(new Set(withCents).size).toBe(1);
    const toInvest = hero.textContent!.match(/À placer ce mois\s*([\d\s ,]+)€/)?.[1];
    expect(Math.round((net - spending) * 100)).toBe(Math.round(parse(toInvest) * 100));
    expect(/,\d{2}/.test(toInvest ?? '')).toBe(withCents[0]);
  });
});
