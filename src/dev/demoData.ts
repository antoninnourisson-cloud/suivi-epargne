// Données FICTIVES pour essayer l'app en développement (`npm run dev`, puis
// http://localhost:5173/?demo=1). Rien n'est lu ni écrit sur Google Drive en mode démo.
import { AccountType, GlobalAppData } from '../types';

const d = (offsetDays: number) => {
  const x = new Date(); x.setDate(x.getDate() - offsetDays);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export const DEMO_DATA: GlobalAppData = {
  accounts: [
    { id: 'demo-la', name: 'Livret A', institution: 'Banque Démo', type: AccountType.LIVRET_A, totalAmount: 15200, ownedAmount: 8200, parentalCapital: 7000, interestRate: 1.7, openingDate: '2019-03-01', ceiling: 22950,
      movements: [
        { id: 'm1', date: '2019-03-01', amount: 9000, label: 'Solde initial', type: 'IN', tag: 'initial' },
        { id: 'm2', date: d(40), amount: 600, label: 'Virement de paie', type: 'IN' },
        { id: 'm3', date: d(8), amount: 600, label: 'Virement de paie', type: 'IN' },
      ] },
    { id: 'demo-lep', name: 'LEP', institution: 'Banque Démo', type: AccountType.LEP, totalAmount: 10000, ownedAmount: 7500, parentalCapital: 2500, interestRate: 2.5, openingDate: '2022-01-10', ceiling: 10000, movements: [] },
    { id: 'demo-ldds', name: 'LDDS', institution: 'Banque Démo', type: AccountType.LDDS, totalAmount: 3000, ownedAmount: 3000, parentalCapital: 0, interestRate: 1.7, openingDate: '2023-05-02', ceiling: 12000, movements: [] },
    { id: 'demo-av', name: 'Assurance vie', institution: 'Assureur Démo', type: AccountType.ASSURANCE_VIE, totalAmount: 4300, ownedAmount: 4300, parentalCapital: 0, interestRate: 2.6, openingDate: '2024-06-15', totalDeposits: 4000,
      movements: [{ id: 'm4', date: d(20), amount: 200, label: 'Versement', type: 'IN' }] },
    { id: 'demo-cc', name: 'Compte courant', institution: 'Banque Démo', type: AccountType.COMPTE_COURANT, totalAmount: 1400, ownedAmount: 1400, parentalCapital: 0, interestRate: 0, movements: [] },
  ],
  expenses: [
    { id: 'e1', name: 'Loyer', amount: 750 },
    { id: 'e2', name: 'Électricité', amount: 45 },
    { id: 'e3', name: 'Téléphone', amount: 15 },
  ],
  history: [],
  expensesHistory: [],
  subscriptions: [
    { id: 's1', name: 'Musique', amount: 10.99, debitAccount: 'Carte', frequency: 'monthly', anchorDate: d(25), active: true },
  ],
  donations: [{ id: 'd1', date: d(100), amount: 120, organization: 'Association démo', rate: 66, receiptReceived: true }],
  config: { grossAnnual: 32000, leisureBudget: 250, projectSavings: 100, taxRateManual: 0, extraMonthlyIncome: 0, paydayDay: 27 },
  parentalRestitution: { plannedDate: '2027-01-01' },
};
