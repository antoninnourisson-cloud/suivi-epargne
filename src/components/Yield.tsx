import React, { useMemo } from 'react';
import { SavingsAccount, AccountType, FiscalConfig } from '../types';
import { computeWeightedAnnualRate, computeCapitalGainsTax, computeParentalInterest, computeAccruedInterest, CapitalTaxRegime, computeWithdrawalTax, tracksDeposits, PEA_DEPOSIT_CEILING, computeExpectedYearInterest } from '../lib/finance';
import { Coins, TrendingUp, AlertCircle, PiggyBank, FileDown, Landmark, Info } from 'lucide-react';
import { formatEUR, formatRate } from '../lib/format';
import { netAnnualRate } from '../lib/projection';
import { SplitProjectionCard } from './SplitProjectionCard';

const REGIME_LABEL: Record<CapitalTaxRegime, string> = {
  PFU: 'PFU',
  EXONERE_IR: 'Exonéré IR',
  AV_REDUIT: 'IR réduit 7,5%',
  NON_MODELISE: 'Non calculé',
};

interface YieldProps {
  accounts: SavingsAccount[];
  fiscalConfig: FiscalConfig;
  monthPlan?: number;
  savingsSplit?: { accountId: string; pct: number }[];
  restitutionInMonths?: number;
}

const fmt = (n: number) => formatEUR(n);
const REGULATED = [AccountType.LIVRET_A, AccountType.LDDS, AccountType.LEP];

export const Yield: React.FC<YieldProps> = ({ accounts, fiscalConfig, monthPlan, savingsSplit, restitutionInMonths }) => {
  const currentYear = new Date().getFullYear();

  const rows = useMemo(() =>
    accounts
      .filter(a => (a.interestRate || 0) > 0 && a.totalAmount > 0)
      .map(a => {
        const weightedRate = computeWeightedAnnualRate(a.interestRate || 0, a.rateHistory, currentYear);
        return {
          id: a.id, name: a.name, type: a.type, rate: a.interestRate || 0,
          net: netAnnualRate(a, fiscalConfig),
          weightedRate,
          hasRateHistory: !!(a.rateHistory && a.rateHistory.length > 0),
          base: a.totalAmount,
          // `annual` = rythme annualisé sur le solde actuel (projection).
          annual: a.totalAmount * (weightedRate / 100),
          annualOwned: a.ownedAmount * (weightedRate / 100),
          // `accrued` = ce qui est VRAIMENT acquis depuis le 1er janvier, en tenant compte
          // de la date d'arrivée de chaque euro. Les deux cohabitent volontairement : le
          // premier répond à « combien ça rapporte », le second à « combien j'ai gagné ».
          accrued: computeAccruedInterest(a, currentYear),
          // Année complète si les soldes ne bougent plus d'ici le 31 décembre.
          expected: computeAccruedInterest(a, currentYear, new Date(currentYear + 1, 0, 1)),
        };
      })
      .sort((x, y) => y.annual - x.annual),
    [accounts, currentYear, fiscalConfig]);

  // Totaux via computeParentalInterest (partagé avec le rappel de fin d'année du Dashboard)
  // plutôt que recalculés ici : les deux écrans ne doivent jamais pouvoir diverger.
  // Intérêts produits par le capital de mes parents : ils me les offrent en fin d'année,
  // donc le TOTAL est bien ce qui me revient (je ne touche pas à leur capital, mais
  // j'encaisse 100 % des intérêts).
  // Intérêts de l'année complète (acquis + reste de l'année aux soldes actuels) : ce qui
  // sera réellement crédité au 31 décembre si rien ne bouge d'ici là.
  const expected = useMemo(() => computeExpectedYearInterest(accounts, currentYear), [accounts, currentYear]);
  const accruedTotal = useMemo(() => accounts.reduce((sum, a) => sum + computeAccruedInterest(a, currentYear), 0), [accounts, currentYear]);
  const { totalAnnual } = useMemo(
    () => computeParentalInterest(accounts, currentYear),
    [accounts, currentYear]
  );

  // Manque à gagner : cash dormant sur compte courant vs place possible sur livrets non pleins.
  const missed = useMemo(() => {
    const ceilings: Record<string, number> = {
      [AccountType.LIVRET_A]: fiscalConfig.ceilings.livretA,
      [AccountType.LDDS]: fiscalConfig.ceilings.ldds,
      [AccountType.LEP]: fiscalConfig.ceilings.lep,
    };
    const idleCash = accounts
      .filter(a => a.type === AccountType.COMPTE_COURANT)
      .reduce((s, a) => s + a.ownedAmount, 0);

    const livrets = accounts
      .filter(a => REGULATED.includes(a.type))
      .map(a => ({ rate: a.interestRate || 0, space: Math.max(0, (ceilings[a.type] || 0) - a.totalAmount) }))
      .filter(a => a.space > 0)
      .sort((x, y) => y.rate - x.rate);

    // Alloue le cash aux meilleurs livrets non pleins.
    let remaining = idleCash;
    let extra = 0;
    let placeable = 0;
    for (const l of livrets) {
      if (remaining <= 0) break;
      const amount = Math.min(remaining, l.space);
      extra += amount * (l.rate / 100);
      placeable += amount;
      remaining -= amount;
    }
    return { idleCash, placeable, extra, bestRate: livrets[0]?.rate || 0 };
  }, [accounts, fiscalConfig]);

  // --- GAINS NETS SI RETRAIT (comptes à fiscalité différée) ---
  // PEA et Assurance Vie ne sont PAS imposés chaque année : l'impôt n'intervient qu'au
  // retrait (seuls les prélèvements sociaux du fonds euros sont retenus annuellement, par
  // l'assureur lui-même). Il n'y a donc en général rien à déclarer sur ces lignes. Cette
  // section répond à une autre question : « combien toucherais-je net si je retirais
  // maintenant les gains de l'année ». Elle était présentée à tort comme une aide à la
  // déclaration.
  // Le net après prélèvements est une SIMPLIFICATION (voir les commentaires de
  // computeCapitalGainsTax) — utile pour se projeter, pas pour remplir une déclaration.
  const taxableRows = useMemo(() =>
    accounts
      .filter(a => a.isTaxable)
      .map(a => {
        const base = a.totalAmount;
        const rate = a.interestRate || 0;
        // Intérêts RÉELLEMENT acquis sur l'année (règle des quinzaines pour les livrets,
        // prorata journalier sinon) et non `taux × solde du jour` : cette colonne annonce
        // une année précise — un dépôt de novembre s'y voyait
        // créditer douze mois d'intérêts.
        const estimatedAnnualInterest = computeAccruedInterest(a, currentYear);
        const tax = computeCapitalGainsTax(a, estimatedAnnualInterest, fiscalConfig);
        return {
          id: a.id, name: a.name, type: a.type, institution: a.institution,
          base, rate, estimatedAnnualInterest,
          openingDate: a.openingDate || '',
          tax,
        };
      }),
    [accounts, fiscalConfig, currentYear]);

  const totalGrossTaxable = taxableRows.reduce((s, r) => s + r.estimatedAnnualInterest, 0);
  // Total net = somme des seules lignes réellement calculées : additionner le BRUT des
  // comptes "Non calculé" (dont la cellule affiche "—") rendait le total invérifiable
  // depuis le tableau.
  const totalNetTaxable = taxableRows.reduce((s, r) => s + (r.tax.regime === 'NON_MODELISE' ? 0 : r.tax.netInterest), 0);
  const hasUnmodeled = taxableRows.some(r => r.tax.regime === 'NON_MODELISE');

  // --- PLUS-VALUES LATENTES (placements dont on connaît les versements cumulés) ---
  // Impôt si l'on retirait TOUT le compte aujourd'hui : c'est la plus-value entière qui est
  // imposée (versements rendus sans impôt), selon l'ancienneté du compte.
  const trackedAccounts = accounts.filter(a => tracksDeposits(a.type) && a.totalAmount > 0);
  const latentRows = useMemo(() =>
    trackedAccounts
      .filter(a => a.totalDeposits !== undefined)
      .map(a => {
        const tax = computeWithdrawalTax(a, a.totalAmount, fiscalConfig);
        return { account: a, gain: a.totalAmount - (a.totalDeposits || 0), tax };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, fiscalConfig]);
  const missingDeposits = trackedAccounts.filter(a => a.totalDeposits === undefined);

  const exportFiscalCsv = () => {
    let csv = `Compte,Type,Établissement,Solde,Taux (%),Intérêts bruts acquis ${currentYear},Prélèvements sociaux,Impôt sur le revenu,Net si retiré,Régime,Date ouverture\n`;
    taxableRows.forEach(r => {
      csv += `"${r.name}","${r.type}","${r.institution}",${r.base},${r.rate},${r.estimatedAnnualInterest.toFixed(2)},${r.tax.socialCharges.toFixed(2)},${r.tax.incomeTax.toFixed(2)},${r.tax.netInterest.toFixed(2)},${REGIME_LABEL[r.tax.regime]},${r.openingDate}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gains-nets-si-retrait-${currentYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-1"><Coins className="w-6 h-6 text-indigo-600" /> Rendement réel</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">« Acquis » = réellement gagné depuis le 1er janvier (règle des quinzaines pour les livrets). « Attendu » = l'année complète si vos soldes ne bougent plus. « Rythme » = ce que rapporteraient vos soldes actuels sur douze mois.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-900 text-white p-6 rounded-2xl">
          <p className="text-slate-400 text-xs font-bold uppercase mb-1 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Intérêts attendus sur {currentYear}</p>
          <p className="text-4xl font-black text-emerald-400">{fmt(expected.total)}</p>
          <p className="text-xs text-slate-400 mt-1">
            Dont {fmt(accruedTotal)} déjà acquis. Si vos soldes ne bougent plus, c'est ce qui sera crédité au 31 décembre (versé début janvier pour les livrets), capital parental inclus.
            {' '}Rythme actuel : ≈ {fmt(totalAnnual)}/an.
          </p>
        </div>
        {(expected.parental >= 0.5 || accounts.some(a => a.parentalCapital > 0)) && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-6 rounded-2xl">
          <p className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase mb-1 flex items-center gap-2"><PiggyBank className="w-4 h-4" /> Dont offerts par vos parents</p>
          <p className="text-4xl font-black text-indigo-600">{fmt(expected.parental)}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Intérêts attendus sur {currentYear} grâce à leur capital, qu'ils vous offrent en fin d'année. Le reste ({fmt(expected.own)}) vient de votre part propre.
          </p>
        </div>
        )}
      </div>

      {missed.extra > 0.5 && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl p-5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-300">
            <p className="font-black mb-1">Manque à gagner détecté</p>
            <p>Vous avez <b>{fmt(missed.idleCash)}</b> sur compte courant. En plaçant <b>{fmt(missed.placeable)}</b> sur vos livrets non pleins (jusqu'à {formatRate(missed.bestRate)}), vous généreriez environ <b>{fmt(missed.extra)}/an</b> d'intérêts supplémentaires.</p>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm sm:min-w-[34rem]">
            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-3 sm:px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Compte</th>
                <th className="px-3 sm:px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase text-right">Taux</th>
                <th className="hidden sm:table-cell px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase text-right">Solde</th>
                <th className="px-3 sm:px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase text-right">Acquis {currentYear}</th>
                <th className="px-3 sm:px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase text-right">Attendu 31/12</th>
                <th className="hidden sm:table-cell px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase text-right">Rythme / an</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-3 sm:px-6 py-3"><div className="font-bold text-slate-800 dark:text-slate-100">{r.name}</div><div className="text-[11px] uppercase text-slate-500 dark:text-slate-400 font-bold">{r.type}</div></td>
                  <td className="px-3 sm:px-6 py-3 text-right font-mono whitespace-nowrap text-slate-600 dark:text-slate-300">
                    {formatRate(r.rate)}
                    {Math.abs(r.net - r.rate) > 0.005 && <span className="block text-[11px] font-bold text-emerald-700 dark:text-emerald-400" title="Après prélèvements sociaux (et frais éventuels)">net {formatRate(Math.round(r.net * 100) / 100)}</span>}
                    {r.hasRateHistory && Math.abs(r.weightedRate - r.rate) > 0.01 && (
                      <span className="block text-[11px] text-indigo-600 dark:text-indigo-400 font-bold normal-case" title="Moyenne pondérée dans le temps suite à un changement de taux">≈ {formatRate(Math.round(r.weightedRate * 100) / 100)} pondéré</span>
                    )}
                  </td>
                  <td className="hidden sm:table-cell px-6 py-3 text-right font-mono text-slate-600 dark:text-slate-300">{fmt(r.base)}</td>
                  <td className="px-3 sm:px-6 py-3 text-right font-black text-emerald-700 dark:text-emerald-400">{fmt(r.accrued)}</td>
                  <td className="px-3 sm:px-6 py-3 text-right font-bold text-slate-700 dark:text-slate-200">{fmt(r.expected)}</td>
                  <td className="hidden sm:table-cell px-6 py-3 text-right font-mono text-slate-500 dark:text-slate-400">{fmt(r.annual)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400 italic">Aucun compte rémunéré (renseignez un taux d'intérêt sur vos comptes).</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <SplitProjectionCard accounts={accounts} fiscalConfig={fiscalConfig} monthPlan={monthPlan} savingsSplit={savingsSplit} restitutionInMonths={restitutionInMonths} />

      {(latentRows.length > 0 || missingDeposits.length > 0) && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-slate-800">
            <h3 className="font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-indigo-600" /> Plus-values latentes</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Valeur − versements cumulés. En cas de retrait, seule cette part est imposée ; « Si tout retiré » donne ce qu'il resterait de la plus-value en vidant le compte aujourd'hui.</p>
          </div>
          {latentRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm sm:min-w-[34rem]">
                <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-3 sm:px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Compte</th>
                    <th className="hidden sm:table-cell px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase text-right">Versé</th>
                    <th className="px-3 sm:px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase text-right">Plus-value</th>
                    <th className="px-3 sm:px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase text-right">Si tout retiré</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {latentRows.map(({ account: a, gain, tax }) => (
                    <tr key={a.id}>
                      <td className="px-3 sm:px-6 py-3">
                        <div className="font-bold text-slate-800 dark:text-slate-100">{a.name}</div>
                        <div className="text-[11px] uppercase text-slate-500 dark:text-slate-400 font-bold">{a.type} · valeur {fmt(a.totalAmount)}</div>
                        {a.type === AccountType.PEA && (
                          <div className={`text-[11px] font-bold ${(a.totalDeposits || 0) >= PEA_DEPOSIT_CEILING * 0.9 ? 'text-amber-600' : 'text-slate-500 dark:text-slate-400'}`}>
                            Plafond de versements : {fmt(Math.max(0, PEA_DEPOSIT_CEILING - (a.totalDeposits || 0)))} restants
                          </div>
                        )}
                      </td>
                      <td className="hidden sm:table-cell px-6 py-3 text-right font-mono text-slate-600 dark:text-slate-300">{fmt(a.totalDeposits || 0)}</td>
                      <td className={`px-3 sm:px-6 py-3 text-right font-mono font-bold ${gain >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{gain >= 0 ? '+' : ''}{fmt(gain)}</td>
                      <td className="px-3 sm:px-6 py-3 text-right">
                        {tax.known ? (
                          <>
                            <div className="font-black text-emerald-700 dark:text-emerald-400">{fmt(gain - tax.socialCharges - tax.incomeTax)}</div>
                            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">impôt {fmt(tax.socialCharges + tax.incomeTax)}{tax.closesPea ? ' · clôture le PEA' : ''}</div>
                          </>
                        ) : <div className="text-slate-400">—</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {missingDeposits.length > 0 && (
            <p className="px-6 py-4 text-xs text-slate-500 dark:text-slate-400 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
              Versements cumulés à renseigner (fiche du compte ou Actualiser solde) : {missingDeposits.map(a => a.name).join(', ')}.
            </p>
          )}
        </div>
      )}

      {taxableRows.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="font-black text-slate-800 dark:text-slate-100 flex items-center gap-2"><Landmark className="w-5 h-5 text-indigo-600" /> Si vous retiriez vos gains de {currentYear}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1"><strong>Rien à déclarer tant que vous ne retirez rien</strong> : le PEA et l'Assurance Vie ne sont imposés qu'au moment d'un retrait (les prélèvements sociaux du fonds euros sont déjà retenus chaque année par l'assureur). Ce tableau estime le net que vous toucheriez si vous retiriez maintenant les gains acquis cette année.</p>
            </div>
            <button onClick={exportFiscalCsv} className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-xl font-bold text-sm flex-shrink-0"><FileDown className="w-4 h-4" /> Exporter (CSV)</button>
          </div>

          <div className="px-6 pt-4 flex flex-wrap gap-4">
            <div>
              <p className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Brut acquis {currentYear}</p>
              <p className="text-lg font-black text-slate-500 dark:text-slate-400 line-through decoration-slate-300 dark:decoration-slate-600">{fmt(totalGrossTaxable)}</p>
            </div>
            <div>
              <p className="text-[11px] font-black text-emerald-700 dark:text-emerald-400 uppercase">Net si retiré maintenant</p>
              <p className="text-lg font-black text-emerald-700 dark:text-emerald-400">{fmt(totalNetTaxable)}</p>
            </div>
          </div>
          <p className="px-6 pb-2 pt-1 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1">
            <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
            Estimation simplifiée : PFU (31,4 % en 2026, 30 % sur l'assurance vie) ou régime réduit selon l'ancienneté du compte. Lors d'un vrai rachat d'Assurance Vie, l'impôt ne porte que sur la part de gains contenue dans le montant retiré, avec un abattement annuel de 4 600 € après 8 ans : le vrai net est souvent meilleur.
            {hasUnmodeled && ' Certains comptes (Immobilier, PER...) ont un régime trop spécifique pour être calculé ici : ils sont exclus du total net.'}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm sm:min-w-[34rem]">
              <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-3 sm:px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase">Compte</th>
                  <th className="hidden sm:table-cell px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase text-right">Solde</th>
                  <th className="px-3 sm:px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase text-right">Brut acquis {currentYear}</th>
                  <th className="px-3 sm:px-6 py-3 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase text-right">Net si retiré</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {taxableRows.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                    <td className="px-3 sm:px-6 py-3"><div className="font-bold text-slate-800 dark:text-slate-100">{r.name}</div><div className="text-[11px] uppercase text-slate-500 dark:text-slate-400 font-bold">{r.institution} · {r.type}</div></td>
                    <td className="hidden sm:table-cell px-6 py-3 text-right font-mono text-slate-600 dark:text-slate-300">{fmt(r.base)}</td>
                    <td className="px-3 sm:px-6 py-3 text-right font-mono text-slate-500 dark:text-slate-400">{fmt(r.estimatedAnnualInterest)}</td>
                    <td className="px-3 sm:px-6 py-3 text-right">
                      <div className="font-black text-emerald-700 dark:text-emerald-400">{r.tax.regime === 'NON_MODELISE' ? '—' : fmt(r.tax.netInterest)}</div>
                      <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase">{REGIME_LABEL[r.tax.regime]}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
