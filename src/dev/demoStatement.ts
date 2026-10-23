// Relevé FICTIF du mode démo (« Lire un relevé » sans clé Gemini), cohérent avec DEMO_DATA :
// - Livret A : l'épargne du mois déjà saisie (doublon reconnu) et une prime pas encore
//   enregistrée ; le nouveau solde concorde exactement ;
// - compte de dépôt : trois opérations du quotidien, seul le solde est repris par défaut ;
// - livret jeune : aucun compte correspondant dans la démo (« Ne pas importer »).
import type { StatementData, StatementMovement } from '../lib/statementImport';
import { DEMO_DATA } from './demoData';

const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => { const x = new Date(); x.setDate(x.getDate() - n); return iso(x); };

export const demoStatement = (): StatementData => {
  const la = DEMO_DATA.accounts.find(a => a.id === 'demo-la')!;
  const cc = DEMO_DATA.accounts.find(a => a.id === 'demo-cc')!;
  const saved = la.movements!.find(m => m.id === 'la-0')!;
  const today = daysAgo(0);
  const laMoves: StatementMovement[] = [
    { date: saved.date, label: 'VIR EPARGNE DU MOIS', amount: saved.amount, type: 'IN' },
    { date: daysAgo(1), label: 'VIR RECU PRIME', amount: 150, type: 'IN' },
  ];
  laMoves.sort((a, b) => a.date.localeCompare(b.date));
  const ccMoves: StatementMovement[] = [
    { date: daysAgo(1), label: 'PRLV LOYER', amount: 750, type: 'OUT' },
    { date: daysAgo(1), label: 'CB SUPERMARCHE', amount: 62.4, type: 'OUT' },
    { date: today, label: 'PRLV MUSIQUE', amount: 10.99, type: 'OUT' },
  ];
  return {
    bank: 'Banque Démo',
    periodStart: daysAgo(30),
    periodEnd: today,
    accounts: [
      {
        name: 'Livret A ···1234', numberEnd: '1234',
        openingBalance: la.totalAmount - saved.amount, closingBalance: la.totalAmount + 150, closingDate: today,
        movements: laMoves, ignored: 0,
      },
      {
        name: 'Compte de dépôt ···5678', numberEnd: '5678',
        openingBalance: cc.totalAmount, closingBalance: Math.round((cc.totalAmount - 750 - 62.4 - 10.99) * 100) / 100, closingDate: today,
        movements: ccMoves, ignored: 0,
      },
      {
        name: 'Livret Jeune ···9012', numberEnd: '9012',
        openingBalance: 800, closingBalance: 800, closingDate: today, movements: [], ignored: 0,
      },
    ],
  };
};
