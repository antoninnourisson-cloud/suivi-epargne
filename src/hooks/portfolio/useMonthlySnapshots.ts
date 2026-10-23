// Points mensuels du patrimoine et des charges (heure locale), tenus à jour dans le document
// une fois des données de Drive chargées. Le calcul est dans lib/monthlyPoints.
import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { totalFixedCharges } from '../../lib/finance';
import { localTodayISO } from '../../lib/dates';
import { portfolioTotals, withExpensePoint, withPortfolioPoint } from '../../lib/monthlyPoints';
import { round2 } from '../../lib/money';
import type { AppDoc } from '../../types';
import { localMonthKey } from './syncShared';

/**
 * `isLoaded` : un chargement Drive a réussi (avant, rien n'est ajouté). `loadCount` change à
 * chaque chargement réussi : les points sont recalculés après chacun, y compris quand les
 * saisies faites hors ligne restent affichées. `isLoaded` et `setDoc` doivent être stables.
 */
export const useMonthlySnapshots = (doc: AppDoc, setDoc: Dispatch<SetStateAction<AppDoc>>, isLoaded: () => boolean, loadCount: number) => {
  // Réveil périodique : les points mensuels s'ouvrent sur le nouveau mois même sans saisie.
  const [monthTick, setMonthTick] = useState(() => localMonthKey(new Date()));
  useEffect(() => {
    const sync = () => setMonthTick(localMonthKey(new Date()));
    const timer = setInterval(sync, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', sync);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', sync); };
  }, []);

  useEffect(() => {
    if (!isLoaded()) return;
    const totals = portfolioTotals(doc.accounts);
    const today = localTodayISO();
    setDoc(d => {
      const history = withPortfolioPoint(d.history, totals, monthTick, today);
      return history ? { ...d, history } : d;
    });
  }, [doc.accounts, monthTick, loadCount, isLoaded, setDoc]);

  useEffect(() => {
    if (!isLoaded()) return;
    const total = round2(totalFixedCharges(doc.expenses, doc.subscriptions));
    const today = localTodayISO();
    setDoc(d => {
      const expensesHistory = withExpensePoint(d.expensesHistory, total, monthTick, today);
      return expensesHistory ? { ...d, expensesHistory } : d;
    });
  }, [doc.expenses, doc.subscriptions, monthTick, loadCount, isLoaded, setDoc]);
};
