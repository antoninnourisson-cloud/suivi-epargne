// ================================================
// FILE: src/components/AccountForm.tsx
// Fiche d'un compte (création et modification), en Material 3. Les règles (fiscalité,
// plafonds, performance) viennent de lib/accountTypes, lib/finance et lib/performance.
// ================================================
import React, { useState, useEffect, useMemo } from 'react';
import { AccountType, SavingsAccount, FiscalConfig } from '../types';
import { NumberInput } from './NumberInput';
import { localTodayISO, parseISODate } from '../lib/dates';
import { parseFrenchNumber } from '../lib/numbers';
import { tracksDeposits, PEA_DEPOSIT_CEILING, applyRateChange } from '../lib/finance';
import { PlusCircle, Save, Users, Tag, X, History, Info } from 'lucide-react';
import { formatEUR, formatRate } from '../lib/format';
import { isLikelyForeignAccount } from '../lib/taxReturn';
import { ACCOUNT_TYPE_LABELS, defaultCeiling, describeAccountTax, hasCeiling } from '../lib/accountTypes';
import { OBSERVED_RATE_CAP, OBSERVED_RATE_FLOOR, OBSERVED_RATE_MIN_YEARS, accountPerformance } from '../lib/performance';
import { Button, Card, Chip, SegmentedButton, TextField } from './ui';

interface AccountFormProps {
  onSave: (account: SavingsAccount) => void;
  // Faux en mode solo (plus aucune part parentale) : le champ n'est plus proposé.
  showParental?: boolean;
  initialData?: SavingsAccount;
  onCancel?: () => void;
  fiscalConfig: FiscalConfig;
}

// Raccourcis de création : choisissent le type (et un nom par défaut modifiable).
const PRESETS: { type: AccountType; label: string }[] = [
  { type: AccountType.LIVRET_A, label: 'Livret A' },
  { type: AccountType.LDDS, label: 'LDDS' },
  { type: AccountType.LEP, label: 'LEP' },
  { type: AccountType.LIVRET_BANCAIRE, label: 'Livret bancaire' },
  { type: AccountType.ASSURANCE_VIE, label: 'Assurance vie' },
  { type: AccountType.PEA, label: 'PEA' },
  { type: AccountType.CTO, label: 'Compte-titres' },
  { type: AccountType.COMPTE_COURANT, label: 'Compte courant' },
];

// Comptes « avec impôt différé » (tableau « Si vous retiriez vos gains » de Rendement).
const DEFERRED_TAX_TYPES = [AccountType.ASSURANCE_VIE, AccountType.PEA, AccountType.PEE, AccountType.CRYPTO, AccountType.IMMOBILIER, AccountType.CTO];
const FEE_TYPES = [AccountType.ASSURANCE_VIE, AccountType.PEA, AccountType.PER, AccountType.CTO];

/** Taux servi par l'établissement (historisé), et non rendement supposé d'un placement. */
const hasServedRate = (t: AccountType) => !tracksDeposits(t) || t === AccountType.ASSURANCE_VIE;

const sectionClass = 'rounded-2xl border border-outline-variant p-4 space-y-4';
const checkboxRow = 'flex items-start gap-3 min-h-12 py-2 text-sm text-on-surface cursor-pointer';
const fmtDay = (iso: string) => parseISODate(iso).toLocaleDateString('fr-FR');

export const AccountForm: React.FC<AccountFormProps> = ({ onSave, initialData, onCancel, fiscalConfig, showParental = true }) => {
  const [type, setType] = useState<AccountType>(initialData?.type || AccountType.LIVRET_A);
  const [name, setName] = useState(initialData?.name || '');
  const [institution, setInstitution] = useState(initialData?.institution || '');
  const [totalAmount, setTotalAmount] = useState<number>(initialData?.totalAmount || 0);
  const [parentalCapital, setParentalCapital] = useState<number>(initialData?.parentalCapital || 0);
  const [ownedAmount, setOwnedAmount] = useState<number>(initialData?.ownedAmount || 0);
  // Placement : un 0 % enregistré par l'ancienne fiche voulait dire « pas de taux » (vide).
  const [interestRate, setInterestRate] = useState<string>(
    initialData?.interestRate !== undefined && !(tracksDeposits(initialData.type) && initialData.interestRate === 0)
      ? String(initialData.interestRate).replace('.', ',') : '');
  const [openingDate, setOpeningDate] = useState(initialData?.openingDate || '');
  const [contractEndDate, setContractEndDate] = useState(initialData?.contractEndDate || '');
  const [ceiling, setCeiling] = useState<number>(initialData?.ceiling || 0);
  const [tags, setTags] = useState<string[]>(initialData?.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [rateEffectiveDate, setRateEffectiveDate] = useState(localTodayISO());
  const [euroFundPct, setEuroFundPct] = useState(initialData?.euroFundPct !== undefined ? String(initialData.euroFundPct) : '');
  const [managementFee, setManagementFee] = useState(initialData?.managementFee !== undefined ? String(initialData.managementFee).replace('.', ',') : '');
  const [blocked, setBlocked] = useState<boolean>(!!initialData?.blocked);
  const showFee = FEE_TYPES.includes(type);
  // Placement dont la valeur bouge : « rendement supposé » (hypothèse) au lieu d'un taux.
  const market = tracksDeposits(type);
  // Taux servi, historisé à sa date d'effet : livrets, comptes, et fonds euros d'une assurance
  // vie (annoncé chaque janvier : le rappel « Taux servi » s'éteint avec ce changement daté,
  // et les intérêts de l'année gardent l'ancien taux jusqu'à cette date). Le rendement supposé
  // d'un PEA, d'un compte-titres, d'un PER, d'un PEE ou d'une crypto n'a pas d'historique.
  const servedRate = hasServedRate(type);
  const assumedRateField = market && !servedRate;
  // Texte et non nombre : vide = versements inconnus (différent de 0 €).
  const [totalDeposits, setTotalDeposits] = useState(initialData?.totalDeposits !== undefined ? String(initialData.totalDeposits) : '');
  const showDeposits = market;
  const parsedDeposits = totalDeposits.trim() === '' ? undefined : parseFrenchNumber(totalDeposits);
  // Compte tenu à l'étranger (déclaration 3916 / 3916-bis) : Oui, Non, ou pas encore précisé
  // (undefined). Seule une réponse donnée est enregistrée : un compte non précisé chez une
  // néobanque ou un courtier reste « à vérifier » dans l'aide à la déclaration. Seul un
  // NOUVEAU compte crypto part sur « Oui » (affiché, donc visible) : les grandes plateformes
  // sont établies hors de France.
  const [heldAbroad, setHeldAbroad] = useState<boolean | undefined>(initialData?.heldAbroad);
  const heldAbroadValue = heldAbroad ?? (!initialData && type === AccountType.CRYPTO ? true : undefined);
  const abroadToCheck = heldAbroadValue === undefined && isLikelyForeignAccount({ type, institution, name, heldAbroad: undefined });

  const isTaxableType = DEFERRED_TAX_TYPES.includes(type);
  const taxText = describeAccountTax({ type, openingDate: openingDate || undefined }, fiscalConfig);
  // Performance observée (placements déjà suivis) : aide à choisir l'hypothèse de rendement.
  const observed = useMemo(() => (initialData && market ? accountPerformance(initialData) : null), [initialData, market]);

  useEffect(() => {
    if (!initialData) setCeiling(defaultCeiling(type, fiscalConfig));
  }, [type, initialData, fiscalConfig]);

  const handleTotalChange = (total: number) => {
    setTotalAmount(total);
    setOwnedAmount(Math.round((total - parentalCapital) * 100) / 100);
  };

  const handleParentalChange = (parents: number) => {
    setParentalCapital(parents);
    setOwnedAmount(Math.round((totalAmount - parents) * 100) / 100);
  };

  const handleOwnedChange = (owned: number) => {
    setOwnedAmount(owned);
    const rest = Math.round((totalAmount - owned) * 100) / 100;
    if (rest >= 0) {
      setParentalCapital(rest);
    } else {
      // Ma part saisie dépasse le total : plutôt que de laisser le formulaire afficher des
      // nombres incohérents (silencieusement renormalisés à la sauvegarde, en GONFLANT le
      // total), on maintient l'invariant total = ma part + parents immédiatement.
      setParentalCapital(0);
      setTotalAmount(owned);
    }
  };

  const applyPreset = (t: AccountType, label: string) => {
    setType(t);
    if (!name.trim() || PRESETS.some(p => p.label === name)) setName(label);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };
  const removeTag = (t: string) => setTags(tags.filter(x => x !== t));

  // Total inférieur à la part des parents : votre part serait négative (refusé, comme dans saveAccount).
  const ownedNegative = ownedAmount < -0.004;
  const parsedRate = interestRate.trim() === '' ? undefined : parseFrenchNumber(interestRate);
  const rateUnreadable = parsedRate === null;
  // Taux servi déjà connu : un 0 % d'une assurance vie enregistré par l'ancienne fiche voulait
  // dire « pas de taux », et un rendement supposé n'est pas un taux servi : rien à historiser.
  const previousServedRate = initialData && initialData.interestRate !== undefined && hasServedRate(initialData.type)
    && !(tracksDeposits(initialData.type) && initialData.interestRate === 0) ? initialData.interestRate : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ownedNegative || rateUnreadable) return;
    // parseFrenchNumber et non parseFloat : « 2,4 » donnait 2 %. Un placement sans hypothèse
    // reste sans taux (la performance observée prend le relais) ; un livret vide vaut 0 %.
    const newRate = parsedRate ?? (market ? undefined : 0);

    // Historise l'ancien taux s'il a changé, à la date d'effet choisie (par défaut
    // aujourd'hui) : un taux passé à 1,7 % le 1er août se saisit encore en octobre.
    let rateHistory = initialData?.rateHistory || [];
    // Un rendement supposé de placement n'a pas d'historique (ce n'est pas un taux servi).
    if (servedRate && previousServedRate !== undefined && newRate !== undefined && previousServedRate !== newRate && initialData) {
      rateHistory = applyRateChange(initialData, newRate, rateEffectiveDate || localTodayISO()).rateHistory || [];
    }

    onSave({
      // Champs que ce formulaire n'édite pas (date de vérification du taux, champs inconnus
      // d'une version plus récente…) : conservés tels quels.
      ...initialData,
      id: initialData?.id || crypto.randomUUID(),
      // Espaces superflus retirés : « BPVF » et « BPVF  » apparaissaient comme deux établissements.
      name: name.trim().replace(/\s+/g, ' ') || `${type} - ${institution.trim()}`,
      type,
      institution: institution.trim().replace(/\s+/g, ' '),
      totalAmount,
      ownedAmount,
      parentalCapital,
      interestRate: newRate,
      openingDate,
      contractEndDate: type === AccountType.PEE || type === AccountType.COMPTE_A_TERME ? contractEndDate || undefined : undefined,
      ceiling: hasCeiling(type) ? ceiling || undefined : undefined,
      isTaxable: isTaxableType,
      rateHistory: rateHistory.length > 0 ? rateHistory : undefined,
      tags: tags.length > 0 ? tags : undefined,
      euroFundPct: type === AccountType.ASSURANCE_VIE && euroFundPct.trim() !== '' && (parseFrenchNumber(euroFundPct) ?? -1) >= 0 ? Math.min(100, parseFrenchNumber(euroFundPct)!) : undefined,
      managementFee: showFee && managementFee.trim() !== '' && (parseFrenchNumber(managementFee) ?? -1) >= 0 ? parseFrenchNumber(managementFee)! : undefined,
      // Saisie illisible : la valeur connue est gardée (jamais effacée en silence).
      totalDeposits: !showDeposits ? undefined
        : parsedDeposits === null ? initialData?.totalDeposits
        : parsedDeposits !== undefined && parsedDeposits >= 0 ? parsedDeposits : undefined,
      heldAbroad: heldAbroadValue,
      blocked: type === AccountType.AUTRE && blocked ? true : undefined,
    });
  };

  const rateChanged = servedRate && previousServedRate !== undefined && parsedRate !== null && parsedRate !== undefined && parsedRate !== previousServedRate;
  const observedText = observed?.annualized !== null && observed?.annualized !== undefined
    ? `Performance observée : ${formatRate(Math.round(observed.annualized * 1000) / 10)} par an depuis le ${fmtDay(observed.since)}.`
    : observed?.periodReturn !== null && observed?.periodReturn !== undefined
      ? `Performance observée : ${formatRate(Math.round(observed.periodReturn * 1000) / 10)} depuis le ${fmtDay(observed.since)} (moins d'un an : pas encore annualisée).`
      : null;
  const historyCount = initialData?.rateHistory?.length ?? 0;
  const historyNote = historyCount > 0
    ? <span className="inline-flex items-center gap-1"><History className="w-3.5 h-3.5" aria-hidden="true" /> {historyCount} changement(s) de taux gardé(s)</span>
    : null;
  const rateSupporting = assumedRateField
    ? <>Hypothèse pour les projections, pas une promesse.{observedText ? ` ${observedText}` : ''} {type === AccountType.CRYPTO
      ? "Laissé vide, la projection compte 0 % et le signale : la performance passée d'une crypto varie trop pour servir d'hypothèse."
      : `Laissé vide, Pécule prend la performance observée après ${OBSERVED_RATE_MIN_YEARS} ans de suivi (ramenée entre ${formatRate(OBSERVED_RATE_FLOOR)} et +${formatRate(OBSERVED_RATE_CAP)} par an) ; en attendant, la projection le signale.`}</>
    : type === AccountType.ASSURANCE_VIE
      ? <>Taux annoncé chaque année par l'assureur (déjà net de frais) ; vide pour des unités de compte seules.{observedText ? ` ${observedText}` : ''} {historyNote}</>
      : historyNote ?? undefined;

  return (
    <Card
      title={initialData ? `Modifier « ${initialData.name} »` : 'Nouveau compte'}
      icon={initialData ? Save : PlusCircle}
      headingLevel={3}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {!initialData && (
          <div>
            <p className="text-sm font-medium text-on-surface-variant mb-2">Type de compte</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Raccourcis de type de compte">
              {PRESETS.map(p => (
                <Chip key={p.type} selected={type === p.type} onClick={() => applyPreset(p.type, p.label)} className="max-sm:h-12">{p.label}</Chip>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextField id="acc-name" className="md:col-span-2" label="Nom du compte" value={name} onChange={e => setName(e.target.value)} placeholder={`${ACCOUNT_TYPE_LABELS[type]}${institution ? ` - ${institution}` : ''}`} />
          <TextField id="acc-type" label="Type" render={p => (
            <select id={p.id} aria-describedby="acc-type-tax" value={type} onChange={e => setType(e.target.value as AccountType)} className={p.className}>
              {Object.values(AccountType).map(t => <option key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</option>)}
            </select>
          )} />
          <TextField id="acc-bank" label="Banque *" value={institution} onChange={e => setInstitution(e.target.value)} required autoComplete="off" />
          <p id="acc-type-tax" className="md:col-span-2 text-xs text-on-surface-variant flex items-start gap-1.5 -mt-1">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
            <span>{taxText}</span>
          </p>
        </div>

        <fieldset className={sectionClass}>
          <legend className="px-1 text-sm font-medium text-on-surface flex items-center gap-2"><Users className="w-4 h-4 text-primary" aria-hidden="true" /> Répartition du capital</legend>
          <div className={`grid grid-cols-1 ${showParental ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-4`}>
            <TextField label="Solde total" render={p => <NumberInput id={p.id} describedBy={p.describedBy} value={totalAmount} onChange={handleTotalChange} min={0} suffix="€" className={`${p.className} tabular-nums`} />} />
            {showParental && (
              <TextField label="Part des parents" render={p => <NumberInput id={p.id} describedBy={p.describedBy} value={parentalCapital} onChange={handleParentalChange} min={0} suffix="€" className={`${p.className} tabular-nums text-parents`} />} />
            )}
            <TextField label="Votre part" render={p => <NumberInput id={p.id} describedBy={p.describedBy} invalid={ownedNegative} value={ownedAmount} onChange={handleOwnedChange} min={0} suffix="€" className={`${p.className} tabular-nums`} />} />
          </div>
          {ownedNegative && <p role="alert" className="text-sm font-medium text-error">Le solde total est inférieur à la part des parents : votre part serait négative. Corrigez le total ou la part des parents.</p>}
          {initialData && <p className="text-xs text-on-surface-variant">Un écart de solde saisi ici est enregistré comme une correction, qui ne compte pas comme épargne. Pour un versement ou des intérêts, passez plutôt par « Actualiser ».</p>}
        </fieldset>

        <fieldset className={sectionClass}>
          <legend className="px-1 text-sm font-medium text-on-surface">{market ? 'Rendement et versements' : 'Taux et plafond'}</legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <TextField
                label={assumedRateField ? 'Rendement annuel supposé' : type === AccountType.ASSURANCE_VIE ? 'Taux servi (fonds euros)' : 'Taux actuel'}
                suffix="%"
                inputMode="decimal"
                value={interestRate}
                onChange={e => setInterestRate(e.target.value)}
                placeholder={market ? 'Vide : performance observée' : '0'}
                error={rateUnreadable ? 'Taux non reconnu : écrivez par exemple 2,5.' : undefined}
                supporting={rateSupporting}
              />
              {rateChanged && (
                <TextField className="mt-3" label="Nouveau taux à partir du" type="date" value={rateEffectiveDate} onChange={e => setRateEffectiveDate(e.target.value)} />
              )}
            </div>
            {hasCeiling(type) && (
              <TextField label="Plafond" supporting={type === AccountType.PEL || type === AccountType.CEL ? 'Plafond des versements ; les intérêts peuvent le dépasser.' : undefined}
                render={p => <NumberInput id={p.id} describedBy={p.describedBy} value={ceiling} onChange={setCeiling} min={0} suffix="€" className={`${p.className} tabular-nums`} />} />
            )}
            {showFee && (
              <TextField label="Frais de gestion annuels" suffix="%" inputMode="decimal" value={managementFee} onChange={e => setManagementFee(e.target.value)} placeholder="0"
                supporting="Facultatif. Le taux servi d'un fonds euros est déjà net de frais : laissez vide. Pour des unités de compte, indiquez les frais du contrat (souvent 0,5 à 0,85 %)." />
            )}
            {type === AccountType.ASSURANCE_VIE && (
              <TextField id="acc-eurofund" label="Part en fonds euros" suffix="%" inputMode="decimal" value={euroFundPct} onChange={e => setEuroFundPct(e.target.value)} placeholder="100"
                supporting="Facultatif. Sur le fonds euros, les prélèvements sociaux sont déjà retenus chaque année : un retrait ne les redoit pas. 100 si tout est en fonds euros." />
            )}
            {showDeposits && (
              <TextField
                className="md:col-span-2"
                label="Versements cumulés"
                suffix="€"
                inputMode="decimal"
                value={totalDeposits}
                onChange={e => setTotalDeposits(e.target.value)}
                placeholder="Inconnu"
                error={parsedDeposits === null ? 'Montant non reconnu : il ne sera pas enregistré (la valeur précédente est gardée).' : undefined}
                supporting={parsedDeposits !== null && parsedDeposits !== undefined && totalAmount > 0
                  ? <>Plus-value latente : <b className="font-medium">{formatEUR(totalAmount - parsedDeposits, 0)}</b>{type === AccountType.PEA && <> · reste {formatEUR(Math.max(0, PEA_DEPOSIT_CEILING - parsedDeposits))} de versements possibles</>}</>
                  : "Ce que vous avez versé, hors gains (voir votre relevé). Sert au calcul exact de l'impôt en cas de retrait et du gain."}
              />
            )}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextField label="Date d'ouverture" type="date" value={openingDate} onChange={e => setOpeningDate(e.target.value)} />
          {type === AccountType.PEE && <TextField label="Fin du contrat" type="date" value={contractEndDate} onChange={e => setContractEndDate(e.target.value)} />}
          {type === AccountType.COMPTE_A_TERME && <TextField label="Échéance" type="date" value={contractEndDate} onChange={e => setContractEndDate(e.target.value)} supporting="Jusqu'à cette date, l'argent est compté comme bloqué." />}
        </div>

        {type === AccountType.AUTRE && (
          <label className={checkboxRow}>
            <input type="checkbox" className="mt-0.5 w-5 h-5 shrink-0 accent-primary" checked={blocked} onChange={e => setBlocked(e.target.checked)} />
            <span><span className="font-medium">Argent bloqué</span> : il ne peut pas être retiré pour l'instant (compté à part dans « Bloqué » sur l'Accueil).</span>
          </label>
        )}

        <div className={sectionClass}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-on-surface">Compte détenu à l'étranger ?</p>
            <SegmentedButton<'yes' | 'no' | 'unset'>
              label="Compte détenu à l'étranger"
              options={[{ value: 'yes', label: 'Oui' }, { value: 'no', label: 'Non' }]}
              value={heldAbroadValue === undefined ? 'unset' : heldAbroadValue ? 'yes' : 'no'}
              onChange={v => setHeldAbroad(v === 'yes')}
            />
          </div>
          <p className="text-xs text-on-surface-variant">
            {type === AccountType.CRYPTO
              ? 'Plateforme établie hors de France (Binance, Coinbase, Kraken… : vérifiez le pays dans leurs conditions). Le compte se déclare chaque année avec vos revenus (formulaire 3916-bis), même sans vente. Un portefeuille que vous gardez vous-même n\'est pas concerné.'
              : 'Banque en ligne, néobanque ou courtier établi hors de France : si l\'IBAN ne commence pas par FR, le compte est sûrement à l\'étranger. Il se déclare chaque année avec vos revenus (formulaire 3916), même sans opération.'}
          </p>
          {abroadToCheck && <p className="text-xs font-medium text-on-surface">Pas encore précisé : l'aide à la déclaration vous demandera de vérifier ce compte.</p>}
        </div>

        <div>
          <p className="text-sm font-medium text-on-surface-variant mb-2 flex items-center gap-1.5"><Tag className="w-4 h-4" aria-hidden="true" /> Étiquettes (libres)</p>
          {tags.length > 0 && (
            <ul className="flex flex-wrap gap-2 mb-2" aria-label="Étiquettes du compte">
              {tags.map(t => (
                <li key={t} className="inline-flex items-center gap-1 h-8 max-sm:h-12 pl-3 pr-1 rounded-sm border border-outline text-sm font-medium text-on-surface-variant">
                  {t}
                  <button type="button" onClick={() => removeTag(t)} aria-label={`Retirer l'étiquette ${t}`} className="w-8 h-8 max-sm:w-11 max-sm:h-11 inline-flex items-center justify-center rounded-full hover:bg-on-surface/8"><X className="w-4 h-4" aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2">
            <TextField
              className="flex-1"
              label="Nouvelle étiquette"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              placeholder="Ex : Précaution, Voyage, Apport…"
              aria-describedby="acc-tags-help"
            />
            <Button type="button" variant="tonal" onClick={addTag} className="h-14">Ajouter</Button>
          </div>
          <p id="acc-tags-help" className="mt-1 px-4 text-xs text-on-surface-variant">Une étiquette par projet (voyage, apport…) : « Mes comptes » affiche le total mis de côté pour chacune.</p>
        </div>

        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:static flex justify-end items-center gap-3 bg-surface-container-lowest/95 dark:bg-surface-container-low/95 py-3 -mx-2 px-2 rounded-xl">
          {onCancel && <Button type="button" variant="text" onClick={onCancel}>Annuler</Button>}
          <Button type="submit" className="px-10" disabled={ownedNegative || rateUnreadable}>Enregistrer</Button>
        </div>
      </form>
    </Card>
  );
};
