// @vitest-environment jsdom
// « Lire le relevé » dans la Clôture de l'année : Gemini simulé (succès, réponse incohérente,
// échec réseau, sans clé). Rien n'est enregistré avant « Enregistrer » : la lecture préremplit.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AccountType, type GlobalAppData, type SavingsAccount } from '../../types';
import { DEFAULT_FISCAL_CONFIG } from '../../constants';

vi.mock('../../services/fileDownload', () => ({ downloadJSON: vi.fn(), downloadCsv: vi.fn() }));
vi.mock('../revealElement', () => ({ revealElementById: vi.fn() }));
vi.mock('../../services/geminiService', () => ({ extractAnnualStatement: vi.fn(), fileToBase64: vi.fn(async () => 'b64') }));

import { extractAnnualStatement } from '../../services/geminiService';
import { YearClosingSheet } from './YearClosingSheet';

const JAN = new Date(2027, 0, 10, 12);
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(JAN); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

const av: SavingsAccount = {
  id: 'av', name: 'Assurance vie', type: AccountType.ASSURANCE_VIE, institution: 'Assureur', totalAmount: 5000, ownedAmount: 5000, parentalCapital: 0,
  totalDeposits: 4000, interestRate: 2.5, openingDate: '2022-01-01', balanceCheckedAt: '2027-01-05', movements: [],
};
const data = (geminiApiKey?: string): GlobalAppData => ({
  accounts: [av], expenses: [], history: [], fiscalConfig: DEFAULT_FISCAL_CONFIG,
  config: { grossAnnual: 0, leisureBudget: 0, projectSavings: 0, taxRateManual: 0, extraMonthlyIncome: 0, ...(geminiApiKey ? { geminiApiKey } : {}) },
});
const onRecord = vi.fn(() => null);
const sheet = (d: GlobalAppData) => render(
  <YearClosingSheet year={2026} data={d} now={JAN} onRecord={onRecord} onPatchConfig={vi.fn()} onUpdateFiscalConfig={vi.fn()}
    onNavigate={vi.fn()} getArchiveData={() => d} confirm={vi.fn()} onClose={vi.fn()} />,
);
const pick = () => {
  const input = document.querySelector('[data-statement-input]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'releve.pdf', { type: 'application/pdf' })] } });
};
const note = () => document.querySelector('[data-read-note="av"]') as HTMLElement;
const field = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

describe('Lire le relevé', () => {
  it('sans clé Gemini : pas de bouton', () => {
    sheet(data());
    expect(screen.queryByRole('button', { name: /Lire le relevé/ })).toBeNull();
  });

  it('relevé cohérent : champs préremplis, rien enregistré avant « Enregistrer »', async () => {
    vi.mocked(extractAnnualStatement).mockResolvedValue({ year: 2026, valueAtYearEnd: 5230.5, deposits: 1200, rate: 2.6, interest: 130.5 });
    sheet(data('cle'));
    fireEvent.click(screen.getByRole('button', { name: 'Lire le relevé, Assurance vie' }));
    pick();
    await waitFor(() => expect(note()).toBeTruthy());
    expect(field('Valeur au 31 décembre, Assurance vie')).toBe('5230,50');
    expect(field('Versements 2026, Assurance vie')).toBe('1200');
    expect(field('Taux servi 2026, Assurance vie')).toBe('2,6');
    expect(within(note()).queryByRole('alert')).toBeNull();
    expect(onRecord).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
    expect(onRecord).toHaveBeenCalledTimes(1);
  });

  it('réponse incohérente : avertissements, taux invraisemblable non repris', async () => {
    vi.mocked(extractAnnualStatement).mockResolvedValue({ year: 2025, valueAtYearEnd: 1000, deposits: 3000, rate: 26 });
    sheet(data('cle'));
    fireEvent.click(screen.getByRole('button', { name: 'Lire le relevé, Assurance vie' }));
    pick();
    await waitFor(() => expect(within(note()).getAllByRole('alert').length).toBe(3));
    expect(note().textContent).toMatch(/2025/);
    expect(note().textContent).toMatch(/dépassent/);
    expect(note().textContent).toMatch(/plausible/);
    expect(field('Taux servi 2026, Assurance vie')).toBe('');
    expect(field('Valeur au 31 décembre, Assurance vie')).toBe('1000');
  });

  it('échec réseau : message, champs intacts, bouton de nouveau disponible', async () => {
    vi.mocked(extractAnnualStatement).mockRejectedValue(new TypeError('Failed to fetch'));
    sheet(data('cle'));
    fireEvent.click(screen.getByRole('button', { name: 'Lire le relevé, Assurance vie' }));
    pick();
    await waitFor(() => expect(note().textContent).toMatch(/Lecture impossible : Failed to fetch/));
    expect(field('Valeur au 31 décembre, Assurance vie')).toBe('5000');
    expect((screen.getByRole('button', { name: 'Lire le relevé, Assurance vie' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
