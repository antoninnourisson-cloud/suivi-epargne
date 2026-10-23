// ================================================
// FILE: src/components/Yield.tsx
// Écran « Rendement » (Material 3) : intérêts de l'année, taux brut, net (frais, impôt et
// prélèvements sociaux) et après inflation (INSEE), performance des placements (gain et
// rendement annuel mesuré), avantage fiscal du PER, projection, plus-values latentes et net
// si l'on retirait ses gains. Les calculs viennent de lib (finance, projection, performance,
// inflation, retirement, freshness).
// ================================================
import React, { useMemo, useState } from 'react';
import { SavingsAccount, AccountType, FiscalConfig } from '../types';
import { computeWeightedAnnualRate, computeGainsWithdrawal, computeParentalInterest, computeAccruedInterest, CapitalTaxRegime, computeWithdrawalTax, tracksDeposits, PEA_DEPOSIT_CEILING, computeExpectedYearInterest, cryptoDisposalsOfYear, adviseProgressiveOption, CRYPTO_EXEMPT_DISPOSALS, type CryptoThreshold } from '../lib/finance';
import { computeIdleCash, describeIdleDestinations } from '../lib/idleCash';
import { Coins, TrendingUp, AlertCircle, PiggyBank, FileDown, Landmark, Info, ExternalLink, LineChart, CheckCircle2 } from 'lucide-react';
import { formatEUR, formatRate } from '../lib/format';
import { netAnnualRate } from '../lib/projection';
import { SplitProjectionCard } from './SplitProjectionCard';
import { round2 } from '../lib/money';
import { csvAmount } from '../lib/csv';
import { downloadCsv } from '../services/fileDownload';
import { inflationOf, isInflationOutdated, realRate } from '../lib/inflation';
import { accountPerformance, withAssumedRates, type ProjectionHypotheses } from '../lib/performance';
import { ProjectionAssumptionsNote } from './ProjectionAssumptionsNote';
import { computePerAdvantage, marginalTaxRate } from '../lib/retirement';
import { CURRENT_ACCOUNT_FRESH_DAYS, balanceFreshness, describeCheckAge, isRecentlyChecked } from '../lib/freshness';
import { ACCOUNT_TYPE_LABELS } from '../lib/accountTypes';
import { parseISODate } from '../lib/dates';
import { NumberInput } from './NumberInput';
import { Button, Card, DataTable, MoneyText, PageHeader, StatTile, TextField, type Column } from './ui';

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
  /** Revenu imposable estimé (salaires après l'abattement de 10 %), pour l'économie d'impôt du PER. */
  taxableIncome?: number;
  /** « Plafond épargne retraite » lu sur l'avis d'impôt. */
  retirementCeiling?: { year: number; amount: number };
  onSaveRetirementCeiling?: (ceiling: { year: number; amount: number } | undefined) => void;
  /** Dépenses du mois (charges fixes + argent plaisir) : coussin gardé sur le compte courant. */
  monthlySpending?: number;
  /** false : le LEP va fermer, il n'est plus proposé pour l'argent qui dort. */
  lepEligible?: boolean;
  /** « Solde vérifié » : le solde affiché du compte est confirmé aujourd'hui (annulable). */
  onConfirmBalance?: (account: SavingsAccount) => void;
  /** Hypothèses de rendement (useDerivedData) ; calculées ici si absentes. */
  hypotheses?: ProjectionHypotheses;
}

const fmt = (n: number) => formatEUR(n);
/** Seuil des 305 € de ventes de crypto de l'année (computeWithdrawalTax), en mots. */
const cryptoThresholdNote = (t?: CryptoThreshold) =>
  t === 'already-past' ? ` · vos ventes de l'année dépassent déjà ${fmt(CRYPTO_EXEMPT_DISPOSALS)}`
    : t === 'with-this-sale' ? ` · avec vos ventes de l'année, ce retrait dépasserait le seuil de ${fmt(CRYPTO_EXEMPT_DISPOSALS)}`
      : '';
const pct1 = (fraction: number) => formatRate(Math.round(fraction * 1000) / 10);
const signedPct = (pctValue: number) => `${pctValue > 0 ? '+' : ''}${formatRate(round2(pctValue))}`;
const monthYear = (iso: string) => parseISODate(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const linkClass = 'inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2 hover:no-underline';

/** Saisie du plafond épargne retraite lu sur l'avis d'impôt. */
const CeilingInput: React.FC<{ year: number; current?: number; onSave: (amount: number | undefined) => void }> = ({ year, current, onSave }) => {
  const [value, setValue] = useState<number>(current ?? 0);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <TextField className="w-64 max-w-full" label={`Plafond épargne retraite ${year} (avis d'impôt)`}
        render={p => <NumberInput id={p.id} describedBy={p.describedBy} value={value} onChange={setValue} min={0} suffix="€" className={`${p.className} tabular-nums`} />} />
      <Button type="button" variant="tonal" className="h-14" onClick={() => onSave(value > 0 ? value : undefined)}>Enregistrer</Button>
    </div>
  );
};

export const Yield: React.FC<YieldProps> = ({ accounts, fiscalConfig, monthPlan, savingsSplit, restitutionInMonths, taxableIncome, retirementCeiling, onSaveRetirementCeiling, monthlySpending, lepEligible, onConfirmBalance, hypotheses }) => {
  const currentYear = new Date().getFullYear();
  const inflation = inflationOf(fiscalConfig);

  const rows = useMemo(() =>
    accounts
      .filter(a => (a.interestRate || 0) > 0 && a.totalAmount > 0)
      .map(a => {
        const weightedRate = computeWeightedAnnualRate(a.interestRate || 0, a.rateHistory, currentYear);
        const net = netAnnualRate(a, fiscalConfig);
        return {
          id: a.id, name: a.name, type: a.type, rate: a.interestRate || 0,
          net,
          real: realRate(net, inflation.rate),
          weightedRate,
          hasRateHistory: !!(a.rateHistory && a.rateHistory.length > 0),
          base: a.totalAmount,
          // `annual` = rythme annualisé sur le solde actuel (projection).
          annual: a.totalAmount * (weightedRate / 100),
          // `accrued` = ce qui est VRAIMENT acquis depuis le 1er janvier, en tenant compte
          // de la date d'arrivée de chaque euro. Les deux cohabitent volontairement : le
          // premier répond à « combien ça rapporte », le second à « combien j'ai gagné ».
          accrued: computeAccruedInterest(a, currentYear),
          // Année complète si les soldes ne bougent plus d'ici le 31 décembre.
          expected: computeAccruedInterest(a, currentYear, new Date(currentYear + 1, 0, 1)),
        };
      })
      .sort((x, y) => y.annual - x.annual),
    [accounts, currentYear, fiscalConfig, inflation.rate]);
  type Row = (typeof rows)[number];

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

  // Manque à gagner : argent qui dort sur le compte courant. Même calcul que l'alerte de
  // l'Accueil (lib/idleCash) : coussin d'un mois et demi de dépenses gardé, livrets dans
  // l'ordre du plan de placement, plafond de chaque compte respecté. Seulement sur un solde
  // de compte courant constaté depuis moins de 15 jours (sinon il a pu fondre depuis : on
  // demande de le vérifier).
  const currentAccounts = accounts.filter(a => a.type === AccountType.COMPTE_COURANT);
  const staleCurrent = currentAccounts.filter(a => !isRecentlyChecked(a, CURRENT_ACCOUNT_FRESH_DAYS)).map(a => ({ a, f: balanceFreshness(a) }))[0];
  const hasCash = currentAccounts.some(a => a.ownedAmount > 0);
  const idle = useMemo(
    () => computeIdleCash({ accounts, fiscalConfig, today: new Date(), monthlySpending, lepEligible }),
    [accounts, fiscalConfig, monthlySpending, lepEligible]);

  // --- PERFORMANCE DES PLACEMENTS (valeur, versements, gain, rendement annuel mesuré) ---
  const livretARate = accounts.find(a => a.type === AccountType.LIVRET_A)?.interestRate;
  const performance = useMemo(() =>
    accounts
      .filter(a => tracksDeposits(a.type) && a.totalAmount > 0)
      .map(a => ({ account: a, perf: accountPerformance(a) })),
    [accounts]);
  type PerfRow = (typeof performance)[number];

  // --- PROJECTION : un placement sans taux saisi prend sa performance observée (deux ans de
  // suivi au moins, hors crypto, plafonnée), sinon il est signalé. Elle ne change que ses
  // intérêts : la répartition des versements reste celle du vrai plan. ---
  const projection = useMemo(() => hypotheses ?? withAssumedRates(accounts), [hypotheses, accounts]);

  // --- PER : économie d'impôt des versements de l'année ---
  const per = useMemo(() => computePerAdvantage({ accounts, year: currentYear, fiscalConfig, taxableIncome, notice: retirementCeiling }),
    [accounts, currentYear, fiscalConfig, taxableIncome, retirementCeiling]);

  // --- GAINS NETS SI RETRAIT (comptes à fiscalité différée) ---
  // PEA et Assurance Vie ne sont PAS imposés chaque année : l'impôt n'intervient qu'au
  // retrait (seuls les prélèvements sociaux du fonds euros sont retenus annuellement, par
  // l'assureur lui-même). Il n'y a donc en général rien à déclarer sur ces lignes. Cette
  // section répond à une autre question : « combien toucherais-je net si je retirais
  // maintenant les gains de l'année ».
  // Versements cumulés connus : vrai retrait de ce montant, seule sa part de gains est
  // imposée (computeGainsWithdrawal) ; sinon tout le montant compte comme gain. Utile pour
  // se projeter, pas pour remplir une déclaration.
  // Crypto : l'exonération des 305 € porte sur le total des ventes de l'année (retraits notés).
  const cryptoSold = useMemo(() => cryptoDisposalsOfYear(accounts, currentYear), [accounts, currentYear]);
  const taxableRows = useMemo(() =>
    accounts
      .filter(a => a.isTaxable)
      .map(a => {
        const base = a.totalAmount;
        const rate = a.interestRate || 0;
        // Intérêts RÉELLEMENT acquis sur l'année (règle des quinzaines pour les livrets,
        // prorata journalier sinon) et non `taux × solde du jour`.
        const estimatedAnnualInterest = computeAccruedInterest(a, currentYear);
        const tax = computeGainsWithdrawal(a, estimatedAnnualInterest, fiscalConfig, new Date(), { cryptoDisposalsThisYear: cryptoSold });
        return {
          id: a.id, name: a.name, type: a.type, institution: a.institution,
          base, rate, estimatedAnnualInterest,
          openingDate: a.openingDate || '',
          tax,
        };
      }),
    [accounts, fiscalConfig, currentYear, cryptoSold]);
  type TaxRow = (typeof taxableRows)[number];

  const totalGrossTaxable = taxableRows.reduce((s, r) => s + r.estimatedAnnualInterest, 0);
  // Total net = somme des seules lignes réellement calculées (« Non calculé » affiche « — »).
  const totalNetTaxable = taxableRows.reduce((s, r) => s + (r.tax.regime === 'NON_MODELISE' ? 0 : r.tax.netInterest), 0);
  const hasUnmodeled = taxableRows.some(r => r.tax.regime === 'NON_MODELISE');
  const hasProRata = taxableRows.some(r => r.tax.proRata);
  // Option pour le barème : peut coûter moins que 12,8 % si votre tranche est à 0 ou 11 %.
  const progressiveOption = useMemo(() => adviseProgressiveOption(
    taxableRows.filter(r => r.tax.regime !== 'NON_MODELISE').map(r => ({ type: r.type, incomeTax: r.tax.incomeTax, taxableGain: r.tax.taxableGain })),
    taxableIncome !== undefined && taxableIncome > 0 ? marginalTaxRate(taxableIncome, fiscalConfig.taxBrackets) : undefined,
  ), [taxableRows, taxableIncome, fiscalConfig.taxBrackets]);

  // --- PLUS-VALUES LATENTES (placements dont on connaît les versements cumulés) ---
  // Impôt si l'on retirait TOUT le compte aujourd'hui : c'est la plus-value entière qui est
  // imposée (versements rendus sans impôt), selon l'ancienneté du compte.
  const trackedAccounts = accounts.filter(a => tracksDeposits(a.type) && a.totalAmount > 0);
  const latentRows = useMemo(() =>
    trackedAccounts
      .filter(a => a.totalDeposits !== undefined)
      .map(a => {
        const tax = computeWithdrawalTax(a, a.totalAmount, fiscalConfig, new Date(), { cryptoDisposalsThisYear: cryptoSold });
        return { account: a, gain: a.totalAmount - (a.totalDeposits || 0), tax };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, fiscalConfig, cryptoSold]);
  type LatentRow = (typeof latentRows)[number];
  const missingDeposits = trackedAccounts.filter(a => a.totalDeposits === undefined);

  // Format d'Excel en français (voir lib/csv).
  const exportFiscalCsv = () => downloadCsv(`gains-nets-si-retrait-${currentYear}.csv`, [
    ['Compte', 'Type', 'Établissement', 'Solde (€)', 'Taux (%)', `Intérêts bruts acquis ${currentYear} (€)`, 'Prélèvements sociaux (€)', 'Impôt sur le revenu (€)', 'Net si retiré (€)', 'Régime', 'Date d\'ouverture'],
    ...taxableRows.map(r => [
      r.name, r.type, r.institution, csvAmount(r.base), r.rate, csvAmount(r.estimatedAnnualInterest),
      csvAmount(r.tax.socialCharges), csvAmount(r.tax.incomeTax), csvAmount(r.tax.netInterest), REGIME_LABEL[r.tax.regime], r.openingDate,
    ]),
  ]);

  const rateColumns: Column<Row>[] = [
    { key: 'name', header: 'Compte', cell: r => <><span className="block">{r.name}</span><span className="block text-xs font-normal text-on-surface-variant">{ACCOUNT_TYPE_LABELS[r.type]}</span></> },
    {
      // Téléphone (320 px) : les lignes de détail passent à la ligne entre les mots, jamais
      // au milieu d'un taux, pour que le tableau tienne sans glisser de côté.
      key: 'rate', header: 'Taux', numeric: true, className: 'max-sm:whitespace-normal', cell: r => (
        <>
          <span className="block whitespace-nowrap">{formatRate(r.rate)}</span>
          {Math.abs(r.net - r.rate) > 0.005 && <span className="block text-xs text-on-surface-variant">net <span className="whitespace-nowrap">{formatRate(round2(r.net))}</span></span>}
          <span className={`block text-xs font-medium ${r.real < 0 ? 'text-loss' : 'text-gain'}`}>après inflation <span className="whitespace-nowrap">{signedPct(r.real)}</span></span>
          {r.hasRateHistory && Math.abs(r.weightedRate - r.rate) > 0.01 && (
            <span className="block text-xs text-on-surface-variant"><span className="whitespace-nowrap">≈ {formatRate(round2(r.weightedRate))}</span> sur l'année</span>
          )}
        </>
      ),
    },
    { key: 'base', header: 'Solde', numeric: true, className: 'max-sm:hidden', cell: r => <MoneyText value={r.base} /> },
    {
      // Téléphone : l'attendu au 31/12 passe sous l'acquis (sa propre colonne est masquée).
      key: 'accrued', header: `Acquis ${currentYear}`, numeric: true, className: 'max-sm:whitespace-normal', cell: r => <>
        <MoneyText value={r.accrued} className="block font-medium text-gain" />
        <span className="sm:hidden block text-xs text-on-surface-variant">attendu <MoneyText value={r.expected} /></span>
      </>,
    },
    { key: 'expected', header: 'Attendu 31/12', numeric: true, className: 'max-sm:hidden', cell: r => <MoneyText value={r.expected} /> },
    { key: 'annual', header: 'Rythme / an', numeric: true, className: 'max-sm:hidden', cell: r => <MoneyText value={r.annual} className="text-on-surface-variant" /> },
  ];

  const perfColumns: Column<PerfRow>[] = [
    { key: 'name', header: 'Placement', cell: ({ account: a }) => <><span className="block">{a.name}</span><span className="block text-xs font-normal text-on-surface-variant">{ACCOUNT_TYPE_LABELS[a.type]}</span></> },
    { key: 'value', header: 'Valeur', numeric: true, className: 'max-sm:hidden', cell: ({ account: a }) => <MoneyText value={a.totalAmount} /> },
    {
      key: 'deposits', header: 'Versé', numeric: true, className: 'max-sm:hidden', cell: ({ account: a, perf }) =>
        a.totalDeposits !== undefined ? <MoneyText value={a.totalDeposits} />
          : perf ? <><MoneyText value={perf.contributions} /><span className="block text-xs text-on-surface-variant">depuis {monthYear(perf.since)}</span></> : '—',
    },
    {
      key: 'gain', header: 'Gain', numeric: true, cell: ({ account: a, perf }) =>
        perf && (perf.measured || a.totalDeposits !== undefined) ? <MoneyText value={perf.gain} signed tone="auto" className="font-medium" /> : <span className="text-on-surface-variant">—</span>,
    },
    {
      // Téléphone : « depuis … » passe à la ligne entre les mots, le taux reste d'un bloc.
      key: 'perf', header: 'Rendement', numeric: true, className: 'max-sm:whitespace-normal', cell: ({ perf }) =>
        !perf || !perf.measured || perf.periodReturn === null
          ? <span className="text-xs text-on-surface-variant whitespace-nowrap">à mesurer</span>
          : perf.annualized !== null
            ? <><span className="block font-medium"><span className="whitespace-nowrap">{signedPct(perf.annualized * 100)}</span> <span className="whitespace-nowrap">/ an</span></span><span className="block text-xs text-on-surface-variant">depuis {monthYear(perf.since)}</span></>
            : <><span className="block font-medium whitespace-nowrap">{signedPct(perf.periodReturn * 100)}</span><span className="block text-xs text-on-surface-variant">depuis {monthYear(perf.since)}, moins d'un an</span></>,
    },
  ];

  const latentColumns: Column<LatentRow>[] = [
    {
      key: 'name', header: 'Compte', cell: ({ account: a }) => (
        <>
          <span className="block">{a.name}</span>
          <span className="block text-xs font-normal text-on-surface-variant">{ACCOUNT_TYPE_LABELS[a.type]} · valeur {fmt(a.totalAmount)}</span>
          {a.type === AccountType.PEA && (
            <span className={`block text-xs ${(a.totalDeposits || 0) >= PEA_DEPOSIT_CEILING * 0.9 ? 'font-medium text-tertiary' : 'font-normal text-on-surface-variant'}`}>
              Plafond de versements : {fmt(Math.max(0, PEA_DEPOSIT_CEILING - (a.totalDeposits || 0)))} restants
            </span>
          )}
        </>
      ),
    },
    { key: 'deposits', header: 'Versé', numeric: true, className: 'max-sm:hidden', cell: ({ account: a }) => <MoneyText value={a.totalDeposits || 0} /> },
    { key: 'gain', header: 'Plus-value', numeric: true, cell: ({ gain }) => <MoneyText value={gain} signed tone="auto" className="font-medium" /> },
    {
      key: 'net', header: 'Si tout retiré', numeric: true, cell: ({ gain, tax }) => tax.known ? (
        <>
          <MoneyText value={gain - tax.socialCharges - tax.incomeTax} className="block font-medium" />
          <span className="block text-xs text-on-surface-variant">impôt {fmt(tax.socialCharges + tax.incomeTax)}{tax.closesPea ? ' · clôture le PEA' : ''}{cryptoThresholdNote(tax.cryptoThreshold)}</span>
        </>
      ) : <span className="text-on-surface-variant">—</span>,
    },
  ];

  const taxColumns: Column<TaxRow>[] = [
    { key: 'name', header: 'Compte', cell: r => <><span className="block">{r.name}</span><span className="block text-xs font-normal text-on-surface-variant">{[r.institution, ACCOUNT_TYPE_LABELS[r.type]].filter(Boolean).join(' · ')}</span></> },
    { key: 'base', header: 'Solde', numeric: true, className: 'max-sm:hidden', cell: r => <MoneyText value={r.base} /> },
    { key: 'gross', header: `Brut acquis ${currentYear}`, numeric: true, cell: r => <MoneyText value={r.estimatedAnnualInterest} className="text-on-surface-variant" /> },
    {
      key: 'net', header: 'Net si retiré', numeric: true, cell: r => (
        <>
          <span className="block font-medium">{r.tax.regime === 'NON_MODELISE' ? '—' : fmt(r.tax.netInterest)}</span>
          <span className="block text-xs text-on-surface-variant">{REGIME_LABEL[r.tax.regime]}{cryptoThresholdNote(r.tax.cryptoThreshold)}</span>
        </>
      ),
    },
  ];


  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <PageHeader
        title="Rendement"
        subtitle={<>« Net » : après frais, impôt et prélèvements sociaux. « Après inflation » : ce que gagne vraiment votre pouvoir d'achat. « Acquis » : gagné depuis le 1er janvier (règle des quinzaines pour les livrets) ; « Attendu » : l'année complète si vos soldes ne bougent plus.</>}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card variant="filled">
          <StatTile
            size="hero"
            label={<span className="inline-flex items-center gap-2"><TrendingUp className="w-4 h-4" aria-hidden="true" /> Intérêts attendus sur {currentYear}</span>}
            value={<MoneyText value={expected.total} className="text-gain" />}
            hint={<>Dont {fmt(accruedTotal)} déjà acquis. Si vos soldes ne bougent plus, c'est ce qui sera crédité au 31 décembre (versé début janvier pour les livrets){expected.parental >= 0.5 || accounts.some(a => a.parentalCapital > 0) ? ', capital parental inclus' : ''}. Rythme actuel : ≈ {fmt(totalAnnual)}/an.</>}
          />
        </Card>
        {(expected.parental >= 0.5 || accounts.some(a => a.parentalCapital > 0)) && (
          <Card>
            <StatTile
              label={<span className="inline-flex items-center gap-2"><PiggyBank className="w-4 h-4" aria-hidden="true" /> Dont offerts par vos parents</span>}
              value={<MoneyText value={expected.parental} className="text-parents" />}
              hint={<>Intérêts attendus sur {currentYear} grâce à leur capital, qu'ils vous offrent en fin d'année. Le reste ({fmt(expected.own)}) vient de votre part propre.</>}
            />
          </Card>
        )}
      </div>

      {staleCurrent ? (
        hasCash && (
          <div className="text-sm text-on-surface-variant flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="flex items-start gap-2 flex-1 min-w-[16rem]">
              <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>Solde de « {staleCurrent.a.name} » {describeCheckAge(staleCurrent.f.days)} : s'il est toujours de {fmt(staleCurrent.a.totalAmount)}, confirmez-le pour chiffrer l'argent qui dort sur le compte courant ; sinon, corrigez-le avec « Actualiser ».</span>
            </p>
            {onConfirmBalance && (
              <Button type="button" variant="tonal" className="max-sm:h-12" onClick={() => onConfirmBalance(staleCurrent.a)}>
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Solde vérifié<span className="sr-only"> : {staleCurrent.a.name} est à jour aujourd'hui</span>
              </Button>
            )}
          </div>
        )
      ) : idle && (
        <div role="note" className="bg-tertiary-container text-on-tertiary-container rounded-2xl p-5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-medium mb-1">Manque à gagner</p>
            <p>Vous avez <b className="font-medium">{formatEUR(idle.cash, 0)}</b> sur compte courant. Pécule y garde {formatEUR(idle.buffer, 0)} pour les dépenses du quotidien (un mois et demi de dépenses). En plaçant <b className="font-medium">{formatEUR(idle.placed, 0)}</b> sur {describeIdleDestinations(idle)} (jusqu'à {formatRate(idle.bestRate)}), vous gagneriez environ <b className="font-medium">{formatEUR(idle.gain, 0)}/an</b> d'intérêts en plus.</p>
          </div>
        </div>
      )}

      <Card title="Taux de vos comptes" icon={Coins} padding="none">
        {rows.length > 0 ? (
          <DataTable caption="Taux brut, net et après inflation de chaque compte rémunéré" columns={rateColumns} rows={rows} rowKey={r => r.id} className="px-5 sm:px-6" />
        ) : (
          <p className="px-5 sm:px-6 pb-4 text-sm text-on-surface-variant">Aucun compte rémunéré : renseignez un taux d'intérêt sur vos comptes.</p>
        )}
        <p className="px-5 sm:px-6 py-4 text-xs text-on-surface-variant flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          <span>
            Après inflation : taux net corrigé de la hausse des prix de {inflation.year}, {formatRate(inflation.rate)} selon l'INSEE
            {inflation.source && <> (<a href={inflation.source} target="_blank" rel="noopener noreferrer" className={linkClass}>source<ExternalLink className="w-3 h-3" aria-hidden="true" /><span className="sr-only"> (nouvel onglet)</span></a>)</>}.
            {' '}Négatif : l'épargne perd du pouvoir d'achat.
            {isInflationOutdated(inflation) && ` Le chiffre de ${currentYear - 1} est attendu : la veille fiscale vous le proposera.`}
          </span>
        </p>
      </Card>

      {performance.length > 0 && (
        <Card title="Performance de vos placements" icon={LineChart} padding="none">
          <DataTable caption="Valeur, versements, gain et rendement annuel de chaque placement" columns={perfColumns} rows={performance} rowKey={r => r.account.id} className="px-5 sm:px-6" />
          <p className="px-5 sm:px-6 py-4 text-xs text-on-surface-variant flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
            <span>
              Rendement : gain annuel moyen tenant compte de la date de chaque versement et retrait (taux de rendement interne), mesuré depuis le premier mouvement noté dans Pécule, avant impôt. Il se mesure dès qu'une valeur est actualisée ; il n'est annualisé qu'après un an.
              {livretARate !== undefined && livretARate > 0 && ` À comparer au Livret A : ${formatRate(livretARate)} aujourd'hui, sans impôt.`}
            </span>
          </p>
        </Card>
      )}

      {per && (
        <Card title={`PER : économie d'impôt ${currentYear}`} icon={Landmark}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-5">
            <StatTile label={`Versé en ${currentYear}`} value={<MoneyText value={per.contributions} />} hint="Versements volontaires notés dans Pécule (case 6NS)" />
            <StatTile label="Impôt en moins (estimé)" value={per.saving !== undefined ? <MoneyText value={per.saving} className="text-gain" /> : '—'}
              hint={per.marginalRate !== undefined ? `Votre tranche : ${pct1(per.marginalRate)}` : 'Renseignez votre salaire dans le Pilotage pour le chiffrer'} />
            <StatTile label="Encore déductible" value={per.room !== undefined ? <MoneyText value={per.room} /> : '—'}
              hint={per.savingPer100 !== undefined && per.room !== 0 ? `100 € de plus ≈ ${fmt(per.savingPer100)} d'impôt en moins` : undefined} />
          </div>
          <p className="mt-5 text-sm text-on-surface">
            {per.ceilingSource === 'notice' && <>Plafond de déduction : <b className="font-medium">{fmt(per.ceiling ?? 0)}</b>, lu sur votre avis d'impôt.</>}
            {per.ceilingSource === 'estimate' && <>Plafond estimé : <b className="font-medium">{fmt(per.ceiling ?? 0)}</b> (10 % de vos revenus d'activité, au moins le minimum légal, sans les plafonds non utilisés des années passées). Celui de votre avis d'impôt (rubrique « Plafond épargne retraite ») fait foi.</>}
            {per.ceilingSource === 'unknown' && <>Plafond de déduction inconnu pour {currentYear} : reportez celui de votre avis d'impôt (rubrique « Plafond épargne retraite »).</>}
            {per.overCeiling > 0 && <> {fmt(per.overCeiling)} versés au-delà ne sont pas déduits.</>}
          </p>
          <p className="mt-2 text-xs text-on-surface-variant">À la sortie, les sommes déduites sont imposées : c'est surtout un report d'impôt, intéressant si votre tranche est plus basse à la retraite. L'argent reste bloqué jusque-là, sauf cas prévus par la loi.</p>
          {onSaveRetirementCeiling && (
            <div className="mt-4">
              <CeilingInput key={`${retirementCeiling?.year}-${retirementCeiling?.amount}`} year={currentYear}
                current={retirementCeiling?.year === currentYear ? retirementCeiling.amount : undefined}
                onSave={amount => onSaveRetirementCeiling(amount === undefined ? undefined : { year: currentYear, amount })} />
            </div>
          )}
        </Card>
      )}

      <ProjectionAssumptionsNote assumptions={projection.assumptions} />
      <SplitProjectionCard accounts={accounts} assumedRates={projection.rates} fiscalConfig={fiscalConfig} monthPlan={monthPlan} savingsSplit={savingsSplit} restitutionInMonths={restitutionInMonths} />

      {(latentRows.length > 0 || missingDeposits.length > 0) && (
        <Card title="Plus-values latentes" icon={TrendingUp} padding="none">
          <p className="px-5 sm:px-6 -mt-2 mb-3 text-xs text-on-surface-variant">Valeur − versements cumulés. En cas de retrait, seule cette part est imposée ; « Si tout retiré » donne ce qu'il resterait de la plus-value en vidant le compte aujourd'hui.</p>
          {latentRows.length > 0 && (
            <DataTable caption="Plus-values latentes et net si tout était retiré" columns={latentColumns} rows={latentRows} rowKey={r => r.account.id} className="px-5 sm:px-6" />
          )}
          {missingDeposits.length > 0 && (
            <p className="px-5 sm:px-6 py-4 text-xs text-on-surface-variant flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
              Versements cumulés à renseigner (fiche du compte ou Actualiser) : {missingDeposits.map(a => a.name).join(', ')}.
            </p>
          )}
        </Card>
      )}

      {taxableRows.length > 0 && (
        <Card
          title={`Si vous retiriez vos gains de ${currentYear}`}
          icon={Landmark}
          padding="none"
          action={<Button variant="tonal" onClick={exportFiscalCsv}><FileDown className="w-4 h-4" aria-hidden="true" /> Exporter (CSV)</Button>}
        >
          <div className="px-5 sm:px-6 space-y-3">
            <p className="text-xs text-on-surface-variant"><b className="font-medium text-on-surface">Rien à déclarer tant que vous ne retirez rien</b> : le PEA, l'assurance vie et le compte-titres ne sont imposés qu'au moment d'un retrait ou d'une vente (les prélèvements sociaux du fonds euros sont déjà retenus chaque année par l'assureur). Ce tableau estime le net que vous toucheriez si vous retiriez maintenant les gains acquis cette année.</p>
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              <StatTile label={`Brut acquis ${currentYear}`} value={<MoneyText value={totalGrossTaxable} className="text-on-surface-variant" />} />
              <StatTile label="Net si retiré maintenant" value={<MoneyText value={totalNetTaxable} className="text-gain" />} />
            </div>
            <p className="text-xs text-on-surface-variant flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
              <span>
                Taux forfaitaire (31,4 % en 2026 prélèvements sociaux compris, 30 % sur l'assurance vie) ou régime réduit selon l'ancienneté du compte.
                {hasProRata
                  ? " Quand vos versements cumulés sont connus, c'est un vrai retrait de ce montant : seule sa part de gains est imposée, avec l'abattement annuel de 4 600 € après 8 ans pour l'assurance vie, et sans les prélèvements sociaux du fonds euros, déjà payés chaque année. Sinon, tout le montant compte comme un gain : le vrai net peut être meilleur."
                  : " Tout le montant compte ici comme un gain : lors d'un vrai retrait, seule la part de gains qu'il contient est imposée. Renseignez vos versements cumulés (fiche du compte) pour un calcul plus juste."}
                {hasUnmodeled && ' Certains comptes (immobilier, PER…) ont un régime trop particulier pour être calculé ici : ils sont exclus du total net.'}
              </span>
            </p>
            {progressiveOption && (
              <p role="note" className="text-xs text-on-surface flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
                <span>
                  Votre tranche d'impôt est estimée à {pct1(progressiveOption.marginalRate)}, sous le taux forfaitaire de 12,8 %.
                  {progressiveOption.securities && <> Imposés au barème (case 2OP de la déclaration), ces gains coûteraient environ <b className="font-medium">{fmt(progressiveOption.securities.progressive)}</b> d'impôt sur le revenu au lieu de {fmt(progressiveOption.securities.flat)}. Ce choix vaut pour tous vos revenus de placement de l'année (intérêts, dividendes, plus-values) : comparez les deux calculs au moment de déclarer.</>}
                  {progressiveOption.crypto && <> Plus-values de crypto : leur option pour le barème est distincte (case 3CN), environ {fmt(progressiveOption.crypto.progressive)} au lieu de {fmt(progressiveOption.crypto.flat)}.</>}
                </span>
              </p>
            )}
          </div>
          <DataTable caption={`Gains ${currentYear} bruts et nets si retirés`} columns={taxColumns} rows={taxableRows} rowKey={r => r.id} className="px-5 sm:px-6 pb-2" />
        </Card>
      )}
    </div>
  );
};
