// @vitest-environment jsdom
// « Lire un relevé » : clé manquante, lecture, relecture (compte proposé, doublon décoché,
// contrôle du relevé), refus montré avant de valider, import par la commande.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StatementImport, type StatementImportProps } from './StatementImport';
import { AccountType, type SavingsAccount } from '../types';
import type { StatementData } from '../lib/statementImport';
import { StatementReadError } from '../services/statementReader';
import { localTodayISO } from '../lib/dates';

afterEach(cleanup);

const today = localTodayISO();
const livretA: SavingsAccount = {
  id: 'la', name: 'Livret A', institution: 'Banque', type: AccountType.LIVRET_A, totalAmount: 15200, ownedAmount: 8200, parentalCapital: 7000,
  balanceCheckedAt: '2020-01-01', movements: [{ id: 'e', date: today, amount: 320, label: 'Épargne du mois', type: 'IN' }],
};
const courant: SavingsAccount = { id: 'cc', name: 'Compte courant', institution: 'Banque', type: AccountType.COMPTE_COURANT, totalAmount: 3900, ownedAmount: 3900, parentalCapital: 0, movements: [] };

const statement = (over: Partial<StatementData['accounts'][number]> = {}): StatementData => ({
  bank: 'Banque', periodStart: '2026-09-01', periodEnd: today,
  accounts: [{
    name: 'Livret A ···1234', openingBalance: 14880, closingBalance: 15350, closingDate: today, ignored: 1,
    movements: [
      { date: today, label: 'VIR EPARGNE DU MOIS', amount: 320, type: 'IN' },
      { date: today, label: 'VIR RECU PRIME', amount: 150, type: 'IN' },
    ],
    ...over,
  }],
});

const setup = (props: Partial<StatementImportProps> = {}) => {
  const onClose = vi.fn();
  const onImport = vi.fn<StatementImportProps['onImport']>(() => null);
  const onOpenKeys = vi.fn();
  render(<StatementImport accounts={[livretA, courant]} geminiApiKey="k" onClose={onClose} onImport={onImport} onOpenKeys={onOpenKeys} {...props} />);
  return { onClose, onImport, onOpenKeys };
};
const pickFile = () => fireEvent.change(screen.getByTestId('statement-file'), { target: { files: [new File(['%PDF'], 'releve.pdf', { type: 'application/pdf' })] } });

describe('StatementImport', () => {
  it('sans clé Gemini : la lecture le dit et mène aux Paramètres', () => {
    const { onClose, onOpenKeys } = setup({ geminiApiKey: '' });
    expect(screen.getByText(/demande une clé Gemini/)).toBeTruthy();
    expect(screen.queryByTestId('statement-file')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ajouter la clé Gemini/ }));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenKeys).toHaveBeenCalled();
  });

  it('propose le compte, décoche le doublon, vérifie le relevé, puis importe', async () => {
    const read = vi.fn(async () => statement());
    const { onImport, onClose } = setup({ read });
    expect(screen.getByText(/jamais au serveur de Pécule/)).toBeTruthy();
    pickFile();
    await screen.findByRole('heading', { name: 'Relecture du relevé' });
    expect((screen.getByLabelText('Compte dans Pécule') as HTMLSelectElement).value).toBe('la');
    const dup = screen.getByRole('checkbox', { name: /VIR EPARGNE DU MOIS.*Déjà enregistrée/ }) as HTMLInputElement;
    const fresh = screen.getByRole('checkbox', { name: /VIR RECU PRIME/ }) as HTMLInputElement;
    expect(dup.checked).toBe(false);
    expect(fresh.checked).toBe(true);
    expect(screen.getByText(/Relevé complet/)).toBeTruthy();
    expect(screen.getByText(/1 ligne illisible écartée/)).toBeTruthy();
    expect(screen.getByText(/identique au relevé/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Importer' }));
    expect(onImport).toHaveBeenCalledWith([{ accountId: 'la', date: today, closingBalance: 15350, movements: [{ date: today, label: 'VIR RECU PRIME', amount: 150, type: 'IN' }] }]);
    expect(onClose).toHaveBeenCalled();
  });

  it("écart restant, « Tout décocher », relevé qui ne tombe pas juste", async () => {
    setup({ read: async () => statement({ openingBalance: 14000 }) });
    pickFile();
    await screen.findByRole('heading', { name: 'Relecture du relevé' });
    expect(screen.getByText(/ne tombe pas juste/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tout décocher' }));
    expect((screen.getByRole('checkbox', { name: /VIR RECU PRIME/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/L'écart restant/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Cocher les nouvelles \(1\)/ }));
    expect((screen.getByRole('checkbox', { name: /VIR RECU PRIME/ }) as HTMLInputElement).checked).toBe(true);
    // Solde non repris : seules les opérations cochées.
    fireEvent.click(screen.getByRole('checkbox', { name: /Mettre le solde à jour/ }));
    expect(screen.getByText("Solde non repris : seule l'opération cochée est ajoutée.")).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /VIR RECU PRIME/ }));
    expect(screen.getByText('Rien à importer pour ce compte.')).toBeTruthy();
  });

  it('montre le refus avant de valider : solde sous la part des parents', async () => {
    setup({ read: async () => statement({ closingBalance: 5000, openingBalance: undefined, movements: [] }) });
    pickFile();
    expect((await screen.findByRole('alert')).textContent).toContain('part de vos parents');
    expect((screen.getByRole('button', { name: 'Importer' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('« Ne pas importer » : rien à valider ; un compte choisi deux fois est signalé', async () => {
    const two: StatementData = { accounts: [...statement().accounts, { name: 'Livret A bis', closingBalance: 1, movements: [], ignored: 0 }] };
    setup({ read: async () => two });
    pickFile();
    await screen.findByRole('heading', { name: 'Relecture du relevé' });
    const selects = screen.getAllByLabelText('Compte dans Pécule') as HTMLSelectElement[];
    fireEvent.change(selects[1], { target: { value: 'la' } });
    expect(screen.getByText(/déjà choisi plus haut/)).toBeTruthy();
    fireEvent.change(selects[0], { target: { value: '' } });
    fireEvent.change(selects[1], { target: { value: '' } });
    expect((screen.getByRole('button', { name: 'Importer' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Choisissez au moins un compte/)).toBeTruthy();
    // Compte courant : rien de coché par défaut, solde repris.
    fireEvent.change(selects[0], { target: { value: 'cc' } });
    expect(screen.getByText(/Compte courant : par défaut/)).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: /VIR RECU PRIME/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('relevé plus ancien que le dernier solde vérifié : solde non repris par défaut, choix explicite possible', async () => {
    const checked: SavingsAccount = { ...livretA, balanceCheckedAt: '2021-07-15', movements: [] };
    const { onImport } = setup({
      accounts: [checked, courant],
      read: async () => ({ periodEnd: '2021-06-30', accounts: [{ name: 'Livret A', closingBalance: 15000, closingDate: '2021-06-30', movements: [], ignored: 0 }] }),
    });
    expect(screen.getByText(/améliorer ses modèles/)).toBeTruthy();
    pickFile();
    await screen.findByRole('heading', { name: 'Relecture du relevé' });
    const box = screen.getByRole('checkbox', { name: /Mettre le solde à jour/ }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText(/avant votre dernier solde vérifié \(15\/07\/2021\)/)).toBeTruthy();
    expect(box.getAttribute('aria-describedby')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Importer' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Importer' }));
    expect(onImport).toHaveBeenCalledWith([{ accountId: 'la', date: '2021-06-30', closingBalance: 15000, allowOlder: true, movements: [] }]);
  });

  it("autre compte choisi : l'avertissement du compte d'avant disparaît", async () => {
    const checked: SavingsAccount = { ...livretA, balanceCheckedAt: '2021-07-15', movements: [] };
    setup({
      accounts: [checked, courant],
      read: async () => ({ periodEnd: '2021-06-30', accounts: [{ name: 'Livret A', closingBalance: 15000, closingDate: '2021-06-30', movements: [], ignored: 0 }] }),
    });
    pickFile();
    await screen.findByRole('heading', { name: 'Relecture du relevé' });
    expect(screen.getByText(/avant votre dernier solde vérifié/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Compte dans Pécule'), { target: { value: 'cc' } });
    expect(screen.queryByText(/avant votre dernier solde vérifié/)).toBeNull();
    expect((screen.getByRole('checkbox', { name: /Mettre le solde à jour/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('placement : opérations décochées par défaut, avec une explication', async () => {
    const pea: SavingsAccount = { id: 'pea', name: 'PEA', institution: 'Banque', type: AccountType.PEA, totalAmount: 10000, ownedAmount: 10000, parentalCapital: 0, totalDeposits: 9000, movements: [] };
    setup({
      accounts: [pea],
      read: async () => ({ accounts: [{ name: 'PEA', closingBalance: 10050, closingDate: today, ignored: 0, movements: [{ date: today, label: 'ACHAT 10 MSCI WORLD', amount: 1000, type: 'OUT' }] }] }),
    });
    pickFile();
    await screen.findByRole('heading', { name: 'Relecture du relevé' });
    expect(screen.getByText(/Placement : par défaut, seul le solde est mis à jour/)).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: /ACHAT 10 MSCI WORLD/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/variation de valeur\)/)).toBeTruthy();
  });

  it("document illisible, erreur de clé, refus à l'enregistrement, « Autre relevé »", async () => {
    const read = vi.fn<(f: File) => Promise<StatementData>>()
      .mockResolvedValueOnce({ accounts: [] })
      .mockRejectedValueOnce(new StatementReadError('Gemini refuse la clé', 'key'))
      .mockResolvedValue(statement());
    const { onImport, onOpenKeys } = setup({ read });
    pickFile();
    expect((await screen.findByRole('alert')).textContent).toContain('Aucun compte lisible');
    pickFile();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Gemini refuse la clé'));
    fireEvent.click(screen.getByRole('button', { name: /Ajouter la clé Gemini/ }));
    expect(onOpenKeys).toHaveBeenCalled();
    pickFile();
    await screen.findByRole('heading', { name: 'Relecture du relevé' });
    onImport.mockReturnValueOnce('Refusé par la commande');
    fireEvent.click(screen.getByRole('button', { name: 'Importer' }));
    expect(screen.getByRole('alert').textContent).toBe('Refusé par la commande');
    fireEvent.click(screen.getByRole('button', { name: 'Autre relevé' }));
    expect(screen.getByRole('button', { name: /Choisir le relevé/ })).toBeTruthy();
  });

  it('fichier partagé vers Pécule : lu dès l’ouverture, une seule fois', async () => {
    const shared = new File(['%PDF'], 'releve-partage.pdf', { type: 'application/pdf' });
    const read = vi.fn(async () => statement());
    setup({ read, initialFile: shared });
    expect(await screen.findByRole('heading', { name: 'Relecture du relevé' })).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(shared);
  });
});
