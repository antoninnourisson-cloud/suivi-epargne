// @vitest-environment jsdom
// Fiche d'un compte : « Compte détenu à l'étranger ? » (déclaration 3916 / 3916-bis), et
// conservation des champs que le formulaire n'édite pas.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { AccountForm } from './AccountForm';
import { DEFAULT_FISCAL_CONFIG } from '../constants';
import { AccountType, type SavingsAccount } from '../types';
import { buildTaxReturnChecklist } from '../lib/taxReturn';

afterEach(cleanup);

const existing = (over: Partial<SavingsAccount>): SavingsAccount => ({
  id: 'a1', name: 'Compte', type: AccountType.COMPTE_COURANT, institution: 'Banque', totalAmount: 100, ownedAmount: 100, parentalCapital: 0, movements: [], ...over,
});

const submit = (initialData?: SavingsAccount) => {
  const onSave = vi.fn();
  render(<AccountForm onSave={onSave} initialData={initialData} fiscalConfig={DEFAULT_FISCAL_CONFIG} />);
  const group = screen.getByRole('group', { name: "Compte détenu à l'étranger" });
  return {
    onSave,
    yes: within(group).getByRole('button', { name: 'Oui' }),
    no: within(group).getByRole('button', { name: 'Non' }),
    save: () => fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })),
    saved: (): SavingsAccount => onSave.mock.calls[0][0],
  };
};

describe('AccountForm : compte détenu à l’étranger', () => {
  it('un nouveau compte crypto part sur « Oui », affiché et enregistré', () => {
    const f = submit();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: AccountType.CRYPTO } });
    fireEvent.change(screen.getByLabelText(/^Banque/), { target: { value: 'Binance' } });
    expect(f.yes.getAttribute('aria-pressed')).toBe('true');
    f.save();
    expect(f.saved().heldAbroad).toBe(true);
  });

  it('sans réponse, rien n’est enregistré : un compte Revolut reste « à vérifier » dans l’aide', () => {
    // Nouveau compte : ni Oui ni Non.
    const f = submit();
    fireEvent.click(screen.getByRole('button', { name: 'Compte courant' }));
    fireEvent.change(screen.getByLabelText(/^Banque/), { target: { value: 'Revolut' } });
    expect(f.yes.getAttribute('aria-pressed')).toBe('false');
    expect(f.no.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText(/Pas encore précisé/)).not.toBeNull();
    f.save();
    const created = f.saved();
    expect(created.heldAbroad).toBeUndefined();
    const lines = buildTaxReturnChecklist({ accounts: [created], payslips: [], donations: [] }, new Date().getFullYear());
    expect(lines.some(l => l.id === `abroad-check-${created.id}`)).toBe(true);
    cleanup();

    // Compte existant modifié sans toucher à la question : toujours non précisé.
    const g = submit(existing({ institution: 'Revolut', name: 'Revolut' }));
    g.save();
    expect(g.saved().heldAbroad).toBeUndefined();
    cleanup();

    // Un compte crypto existant non précisé n'est pas pré-rempli.
    const h = submit(existing({ type: AccountType.CRYPTO, institution: 'Kraken' }));
    expect(h.yes.getAttribute('aria-pressed')).toBe('false');
    h.save();
    expect(h.saved().heldAbroad).toBeUndefined();
  });

  it('une réponse donnée est enregistrée, et une réponse déjà donnée est gardée', () => {
    const f = submit(existing({ institution: 'N26' }));
    fireEvent.click(f.no);
    f.save();
    expect(f.saved().heldAbroad).toBe(false);
    cleanup();
    const g = submit(existing({ institution: 'N26' }));
    fireEvent.click(g.yes);
    g.save();
    expect(g.saved().heldAbroad).toBe(true);
    cleanup();
    const h = submit(existing({ institution: 'N26', heldAbroad: false }));
    expect(h.no.getAttribute('aria-pressed')).toBe('true');
    h.save();
    expect(h.saved().heldAbroad).toBe(false);
  });

  it('garde les champs que le formulaire ne montre pas', () => {
    const { onSave, save } = submit(existing({ rateReviewedAt: '2026-08-02', ...({ futureField: 'x' } as object) }));
    save();
    expect(onSave.mock.calls[0][0]).toMatchObject({ rateReviewedAt: '2026-08-02', futureField: 'x', id: 'a1' });
  });
});
