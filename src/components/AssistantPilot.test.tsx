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
    onPayChecklistChange={() => {}} onRecordPayDeposit={() => undefined} onCancelPayDeposit={() => {}} />);
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
    fireEvent.click(screen.getByRole('button', { name: /^Budgets et montant du mois/ }));
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
