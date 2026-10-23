// Données FICTIVES pour essayer l'app en développement (`npm run dev`, puis
// http://localhost:5173/?demo=1). Rien n'est lu ni écrit sur Google Drive en mode démo.
import { AccountMovement, AccountType, GlobalAppData, PayslipRecord, PortfolioSnapshot, SavingsAccount } from '../types';
import { computeAccountBalanceAtDate } from '../lib/finance';
import { round2 } from '../lib/money';

const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const d = (offsetDays: number) => {
  const x = new Date(); x.setDate(x.getDate() - offsetDays);
  return iso(x);
};

// Jour de paie de la démo : le 27. `payday(k)` = la paie d'il y a k paies (0 = celle en cours).
const PAYDAY = 27;
const now = new Date();
const lastPayMonth = now.getDate() >= PAYDAY ? now.getMonth() : now.getMonth() - 1;
const payday = (k: number) => new Date(now.getFullYear(), lastPayMonth - k, PAYDAY);
const afterPay = (k: number, days: number) => {
  const x = payday(k); x.setDate(x.getDate() + days);
  // La paie en cours peut être toute récente : jamais de mouvement daté dans le futur.
  return x > now ? iso(now) : iso(x);
};
const mv = (id: string, date: string, amount: number, label: string, type: 'IN' | 'OUT' = 'IN'): AccountMovement => ({ id, date, amount, label, type });

// « Épargne du mois » le lendemain de chaque paie, sur huit paies : un mois plus juste (520 €),
// et la dernière paie terminée sous le seuil à cause d'un retrait (couverte par le joker).
const MONTHLY: { k: number; la: number; ldds?: number; av?: number }[] = [
  { k: 8, la: 400, av: 200 },
  { k: 7, la: 450, ldds: 200 },
  { k: 6, la: 320, av: 200 },
  { k: 5, la: 500, ldds: 200 },
  { k: 4, la: 400, av: 200 },
  { k: 3, la: 480, ldds: 200 },
  { k: 2, la: 420, av: 200 },
  { k: 1, la: 450, av: 200 },
];
const laMoves = MONTHLY.map(m => mv(`la-${m.k}`, afterPay(m.k, 1), m.la, 'Épargne du mois'));
const lddsMoves = MONTHLY.filter(m => m.ldds).map(m => mv(`ldds-${m.k}`, afterPay(m.k, 2), m.ldds as number, 'Épargne du mois'));
const avMoves = MONTHLY.filter(m => m.av).map(m => mv(`av-${m.k}`, afterPay(m.k, 3), m.av as number, 'Versement'));

// Fiches de paie relues, enregistrées le jour de la paie ; la dernière est nettement plus
// basse (absence non payée) : le contrôle des fiches la signale.
const NETS = [2050, 2070, 2040, 2060, 2055, 1720];
const PAYSLIPS: PayslipRecord[] = NETS.map((net, i) => {
  const k = NETS.length - i;
  const p = payday(k);
  const period = `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}`;
  return {
    id: `ps-${period}`, fileId: `demo-${period}`, fileName: `Bulletin ${period}.pdf`, addedAt: `${iso(p)}T09:00:00.000Z`, reviewed: true,
    extracted: { period, employer: 'Entreprise Démo', grossAmount: i === NETS.length - 1 ? 2230 : 2667, netAmount: Math.round(net * 1.06), netPaid: net },
  };
});

const ACCOUNTS: SavingsAccount[] = [
    { id: 'demo-la', name: 'Livret A', institution: 'Banque Démo', type: AccountType.LIVRET_A, totalAmount: 15200, ownedAmount: 8200, parentalCapital: 7000, interestRate: 1.7, openingDate: '2019-03-01', ceiling: 22950, balanceCheckedAt: d(10),
      movements: [
        { id: 'm1', date: '2019-03-01', amount: 9000, label: 'Solde initial', type: 'IN', tag: 'initial' },
        ...laMoves,
        // Paie en cours : 320 € déjà mis de côté.
        mv('la-0', afterPay(0, 1), 320, 'Épargne du mois'),
      ] },
    { id: 'demo-lep', name: 'LEP', institution: 'Banque Démo', type: AccountType.LEP, totalAmount: 10000, ownedAmount: 7500, parentalCapital: 2500, interestRate: 2.5, openingDate: '2022-01-10', ceiling: 10000, movements: [],
      // Solde lu il y a quatre mois : « À faire » propose de le vérifier (lib/freshness).
      balanceCheckedAt: d(120) },
    { id: 'demo-ldds', name: 'LDDS', institution: 'Banque Démo', type: AccountType.LDDS, totalAmount: 3000, ownedAmount: 3000, parentalCapital: 0, interestRate: 1.7, openingDate: '2023-05-02', ceiling: 12000, balanceCheckedAt: d(10),
      movements: [...lddsMoves, mv('ldds-out-1', afterPay(1, 12), 200, 'Réparation voiture', 'OUT')] },
    { id: 'demo-av', name: 'Assurance vie', institution: 'Assureur Démo', type: AccountType.ASSURANCE_VIE, totalAmount: 4300, ownedAmount: 4300, parentalCapital: 0, interestRate: 2.6, openingDate: '2024-06-15', totalDeposits: 4000, balanceCheckedAt: d(10),
      // Versé : 3 000 € à l'ouverture puis 200 € par mois ; relevé du 31/12 : +300 € de valeur.
      // Performance mesurée (Rendement, Mes comptes) sur plus d'un an.
      movements: [
        { id: 'av-init', date: '2024-06-15', amount: 3000, label: 'Solde initial', type: 'IN', tag: 'initial' },
        { id: 'av-val', date: `${now.getFullYear() - 1}-12-31`, amount: 300, label: 'Valorisation (+)', type: 'IN', kind: 'valuation' },
        ...avMoves,
      ] },
    // Compte courant bien au-dessus d'un mois et demi de dépenses : l'alerte « argent qui dort ».
    { id: 'demo-cc', name: 'Compte courant', institution: 'Banque Démo', type: AccountType.COMPTE_COURANT, totalAmount: 3900, ownedAmount: 3900, parentalCapital: 0, interestRate: 0, movements: [], balanceCheckedAt: d(2) },
];

/**
 * Historique des douze derniers mois (un point par mois, comme useMonthlySnapshots), tiré
 * des comptes eux-mêmes : votre part en fin de mois (mouvements postérieurs retirés), plus
 * le capital des parents, inchangé. Le dernier point est le solde d'aujourd'hui ; la courbe
 * de l'Historique, l'Accueil et « Votre année » racontent donc la même chose.
 */
export const demoHistory = (accounts: SavingsAccount[], today: Date = new Date()): PortfolioSnapshot[] => {
  const parental = accounts.reduce((s, a) => s + a.parentalCapital, 0);
  return Array.from({ length: 12 }, (_, i) => {
    const back = 11 - i;
    const first = new Date(today.getFullYear(), today.getMonth() - back, 1);
    const end = back === 0 ? today : new Date(today.getFullYear(), today.getMonth() - back + 1, 0);
    const owned = round2(computeAccountBalanceAtDate(accounts, iso(end)));
    return { date: iso(first), ownedAmount: owned, totalAmount: round2(owned + parental) };
  });
};

export const DEMO_DATA: GlobalAppData = {
  accounts: ACCOUNTS,
  expenses: [
    { id: 'e1', name: 'Loyer', amount: 750 },
    { id: 'e2', name: 'Électricité', amount: 45 },
    { id: 'e3', name: 'Téléphone', amount: 15 },
  ],
  history: demoHistory(ACCOUNTS, now),
  expensesHistory: [],
  subscriptions: [
    { id: 's1', name: 'Musique', amount: 10.99, debitAccount: 'Carte', frequency: 'monthly', anchorDate: d(25), active: true },
  ],
  donations: [{ id: 'd1', date: d(100), amount: 120, organization: 'Association démo', rate: 66, receiptReceived: true }],
  payslips: PAYSLIPS,
  config: {
    grossAnnual: 32000, leisureBudget: 250, projectSavings: 100, taxRateManual: 0, extraMonthlyIncome: 0, paydayDay: PAYDAY,
    // Jalons déjà vus : « Un livret au plafond » (le LEP) reste à célébrer dans la démo.
    milestonesSeen: ['good-month-1', 'streak-3', 'streak-6', 'emergency-3', 'emergency-6', 'savings-10000', 'savings-25000'],
  },
  parentalRestitution: { plannedDate: '2027-01-01' },
};
