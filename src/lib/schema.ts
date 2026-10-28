// ================================================
// FILE: src/lib/schema.ts
// Forme du fichier de données Drive : version, valeurs par défaut, migration des anciens
// fichiers et comparaison canonique. UN SEUL point d'entrée (`migrate`) pour tout ce qui
// entre dans l'app : chargement Drive, import, restauration locale, synchronisation entre
// onglets, et lecture par le serveur de notifications.
// ================================================
import { AccountType, AppDoc, ExpenseSnapshot, FiscalConfig, GlobalAppData, PortfolioSnapshot, TaxBracket, YearClosingRecord } from '../types';
import { DEFAULT_DECOTE, DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS } from '../constants';
import { normalizeAccounts, dedupeMonthlySnapshots, migrateFiscalConfig } from './finance';
import { round2 } from './money';
import { sanitizePayAdjustment } from './payAdjustment';

/**
 * Version du format. À augmenter quand un changement rend le fichier illisible pour une
 * ancienne version de l'app : celle-ci refuse alors d'écrire (au lieu d'effacer ce
 * qu'elle ne connaît pas) et demande une mise à jour.
 */
export const APP_SCHEMA_VERSION = 2;

const DEFAULT_CONFIG: GlobalAppData['config'] = {
  grossAnnual: 45000,
  leisureBudget: 300,
  projectSavings: 200,
  taxRateManual: 0,
  extraMonthlyIncome: 0,
};

/** Données d'un tout premier lancement. */
export const emptyData = (): AppDoc => ({
  schemaVersion: APP_SCHEMA_VERSION,
  accounts: [],
  expenses: [],
  history: [],
  expensesHistory: [],
  payslips: [],
  recurringMovements: [],
  subscriptions: [],
  donations: [],
  fiscalConfig: DEFAULT_FISCAL_CONFIG,
  workBenefits: DEFAULT_WORK_BENEFITS,
  config: { ...DEFAULT_CONFIG },
});

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Nombre fini, y compris écrit en texte (« 12.5 ») ; sinon `undefined`. */
const finite = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
};
const OPTIONAL_ACCOUNT_NUMBERS = ['totalDeposits', 'interestRate', 'ceiling'] as const;
/** Types de compte des premiers fichiers (janvier 2026), écrits sous un autre nom depuis. */
const LEGACY_ACCOUNT_TYPES: Readonly<Record<string, AccountType>> = {
  'PEE (Plan Epargne Entreprise)': AccountType.PEE,
  'Immobilier (SCPI/Physique)': AccountType.IMMOBILIER,
  'Cryptomonnaies': AccountType.CRYPTO,
  'Compte Titres': AccountType.CTO,
  'Compte à Terme': AccountType.COMPTE_A_TERME,
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** `{ year, ... }` lisible : année entière plausible et nombre fini positif sous `key`. */
const datedFigure = (v: unknown, key: 'rate' | 'amount'): boolean =>
  isObj(v) && Number.isInteger(v.year) && (v.year as number) >= 2000 && (v.year as number) <= 2200
    && typeof v[key] === 'number' && Number.isFinite(v[key]) && (v[key] as number) >= (key === 'rate' ? -50 : 0);

/**
 * Remet un compte d'aplomb sans rien inventer : montants illisibles (texte, NaN, Infinity)
 * reconstitués quand c'est possible, total = part propre + part des parents au centime,
 * mouvements illisibles écartés (les soldes, eux, sont stockés à part et ne bougent pas).
 * Un fichier abîmé ne propage donc jamais de NaN dans les calculs.
 */
const sanitizeAccount = (a: Record<string, unknown>): Record<string, unknown> => {
  const parental = Math.max(0, finite(a.parentalCapital) ?? 0);
  const total = finite(a.totalAmount);
  const owned = finite(a.ownedAmount) ?? (total !== undefined ? total - parental : 0);
  const out: Record<string, unknown> = {
    ...a,
    name: typeof a.name === 'string' ? a.name : String(a.name ?? 'Compte'),
    institution: typeof a.institution === 'string' ? a.institution : '',
    ...(typeof a.type === 'string' && Object.hasOwn(LEGACY_ACCOUNT_TYPES, a.type) ? { type: LEGACY_ACCOUNT_TYPES[a.type] } : {}),
    ownedAmount: round2(owned),
    parentalCapital: round2(parental),
    totalAmount: round2(owned + parental),
  };
  for (const k of OPTIONAL_ACCOUNT_NUMBERS) {
    if (a[k] === undefined) continue;
    const n = finite(a[k]);
    if (n === undefined) delete out[k]; else out[k] = n;
  }
  // « Compte détenu à l'étranger » : un oui/non, sinon non précisé (l'aide à la déclaration
  // demande alors de vérifier plutôt que de supposer).
  if (a.heldAbroad !== undefined && typeof a.heldAbroad !== 'boolean') delete out.heldAbroad;
  // Date du dernier solde constaté et « argent bloqué » : illisibles = absents.
  if (a.balanceCheckedAt !== undefined && !(typeof a.balanceCheckedAt === 'string' && ISO_DAY.test(a.balanceCheckedAt))) delete out.balanceCheckedAt;
  if (a.blocked !== undefined && typeof a.blocked !== 'boolean') delete out.blocked;
  out.movements = arr<unknown>(a.movements).flatMap(m => {
    if (!isObj(m) || (m.type !== 'IN' && m.type !== 'OUT') || typeof m.date !== 'string') return [];
    const amount = finite(m.amount);
    return amount === undefined || amount < 0 ? [] : [{ ...m, amount }];
  });
  return out;
};

/**
 * Objet complété par ses valeurs par défaut, en profondeur : chaque champ du modèle garde
 * son type (nombre fini, booléen, texte, sous-objet), un champ illisible reprend sa valeur
 * par défaut, et les champs inconnus sont conservés.
 */
const withDefaults = <T extends object>(raw: unknown, defaults: T): T => {
  const src = isObj(raw) ? raw : {};
  const out: Record<string, unknown> = { ...src };
  for (const [k, d] of Object.entries(defaults)) {
    const v = src[k];
    if (typeof d === 'number') out[k] = finite(v) ?? d;
    else if (typeof d === 'boolean') out[k] = typeof v === 'boolean' ? v : d;
    else if (typeof d === 'string') out[k] = typeof v === 'string' ? v : d;
    else if (isObj(d)) out[k] = withDefaults(v, d);
  }
  return out as T;
};

// Points mensuels : une date au moins « AAAA-MM » et des montants lisibles, sinon écartés
// (le tri et le dédoublonnage lisent la date, les graphiques les montants).
const MONTH_DATE = /^\d{4}-\d{2}/;
const sanitizeSnapshots = <T,>(v: unknown, amounts: readonly string[]): T[] => arr<unknown>(v).flatMap(s => {
  if (!isObj(s) || typeof s.date !== 'string' || !MONTH_DATE.test(s.date)) return [];
  const out: Record<string, unknown> = { ...s };
  for (const k of amounts) {
    const n = finite(s[k]);
    if (n === undefined) return [];
    out[k] = n;
  }
  return [out as T];
});

/** Barème lisible (taux fini, limite finie ou infinie) ; `undefined` s'il n'en reste rien. */
const sanitizeBrackets = (v: unknown): TaxBracket[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const ok = v.flatMap(b => {
    if (!isObj(b)) return [];
    const rate = finite(b.rate);
    if (rate === undefined) return [];
    // Infinity devient `null` dans le JSON du fichier : les deux veulent dire « sans limite ».
    if (b.limit === null || b.limit === undefined || b.limit === Infinity) return [{ ...b, rate } as unknown as TaxBracket];
    const limit = finite(b.limit);
    return limit === undefined ? [] : [{ ...b, rate, limit } as unknown as TaxBracket];
  });
  return ok.length > 0 ? ok : undefined;
};

const FISCAL_NUMBERS = [
  'salaryChargesRate', 'socialChargesCapital', 'standardAllowance', 'socialChargesLifeInsurance', 'standardAllowanceMin',
  'standardAllowanceCap', 'lepCeilingPerHalfPart', 'donation75Ceiling', 'lepIncomeCeiling', 'lepHouseholdParts',
  'taxScaleYear', 'paramsReviewedYear', 'transportExemptUntil',
] as const;

/**
 * Paramètres fiscaux d'un fichier remis d'aplomb : champs illisibles retirés AVANT la mise à
 * niveau (qui se fonde sur l'absence d'un champ), puis champs obligatoires complétés par les
 * valeurs par défaut. Les champs facultatifs absents le restent (leur absence a un sens :
 * barème saisi à la main, alerte LEP désactivée…).
 */
const sanitizeFiscalConfig = (raw: unknown): FiscalConfig => {
  if (!isObj(raw)) return migrateFiscalConfig(DEFAULT_FISCAL_CONFIG);
  const f: Record<string, unknown> = { ...raw };
  for (const k of FISCAL_NUMBERS) {
    if (f[k] === undefined) continue;
    const n = finite(f[k]);
    if (n === undefined) delete f[k]; else f[k] = n;
  }
  if (f.decote !== undefined) {
    if (isObj(f.decote)) f.decote = withDefaults(f.decote, DEFAULT_DECOTE); else delete f.decote;
  }
  // Inflation INSEE datée : écartée si illisible (la valeur livrée avec l'app prend le relais).
  if (f.inflation !== undefined && !datedFigure(f.inflation, 'rate')) delete f.inflation;
  if (f.taxBracketsHistory !== undefined) {
    const h = arr<unknown>(f.taxBracketsHistory).filter(e => isObj(e) && Array.isArray(e.brackets));
    if (h.length > 0) f.taxBracketsHistory = h; else delete f.taxBracketsHistory;
  }
  const m = migrateFiscalConfig(f as unknown as FiscalConfig);
  return {
    ...m,
    salaryChargesRate: m.salaryChargesRate ?? DEFAULT_FISCAL_CONFIG.salaryChargesRate,
    socialChargesCapital: m.socialChargesCapital ?? DEFAULT_FISCAL_CONFIG.socialChargesCapital,
    standardAllowance: m.standardAllowance ?? DEFAULT_FISCAL_CONFIG.standardAllowance,
    ceilings: withDefaults(m.ceilings, DEFAULT_FISCAL_CONFIG.ceilings),
    legalMaturity: withDefaults(m.legalMaturity, DEFAULT_FISCAL_CONFIG.legalMaturity),
    taxBrackets: sanitizeBrackets(m.taxBrackets) ?? DEFAULT_FISCAL_CONFIG.taxBrackets,
  };
};

/**
 * Clôtures d'année (lib/yearClosing) remises d'aplomb : seules les années « AAAA » à objet
 * restent ; une date de clôture illisible est retirée (année rouverte), les coches gardent
 * leurs textes, sans doublon. `undefined` s'il n'en reste rien.
 */
const sanitizeYearClosings = (raw: unknown): Record<string, YearClosingRecord> | undefined => {
  if (!isObj(raw)) return undefined;
  const out: Record<string, YearClosingRecord> = {};
  for (const [year, rec] of Object.entries(raw)) {
    if (!/^\d{4}$/.test(year) || !isObj(rec)) continue;
    const r: Record<string, unknown> = { ...rec };
    if (r.closedOn !== undefined && !(typeof r.closedOn === 'string' && ISO_DAY.test(r.closedOn))) delete r.closedOn;
    if (r.checked !== undefined) {
      const checked = [...new Set(arr<unknown>(r.checked).filter((c): c is string => typeof c === 'string' && c !== ''))];
      if (checked.length > 0) r.checked = checked; else delete r.checked;
    }
    out[year] = r as YearClosingRecord;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

/** Le fichier a été écrit par une version plus récente de l'app que celle-ci. */
export const isFromNewerApp = (raw: unknown): boolean =>
  isObj(raw) && typeof raw.schemaVersion === 'number' && raw.schemaVersion > APP_SCHEMA_VERSION;

/**
 * Remet n'importe quel contenu (ancien fichier, import, sauvegarde locale) à la forme
 * courante. Les champs INCONNUS sont conservés tels quels : une version de l'app ne doit
 * jamais effacer ce qu'une version plus récente a ajouté.
 */
export const migrate = (raw: unknown): AppDoc => {
  const r = isObj(raw) ? raw : {};
  const cfgRaw = isObj(r.config) ? r.config : {};
  const config = withDefaults(cfgRaw, DEFAULT_CONFIG);
  // Réglage de la paie en cours (Pilotage) : écarté s'il est illisible (voir lib/payAdjustment).
  if (config.payAdjustment !== undefined) {
    const adj = sanitizePayAdjustment(config.payAdjustment);
    if (adj) config.payAdjustment = adj; else delete config.payAdjustment;
  }
  // Plafond épargne retraite de l'avis d'impôt : écarté s'il est illisible (redemandé).
  if (config.retirementCeiling !== undefined && !datedFigure(config.retirementCeiling, 'amount')) delete config.retirementCeiling;
  // Clôtures d'année : entrées illisibles écartées, champs inconnus conservés.
  if (config.yearClosings !== undefined) {
    const closings = sanitizeYearClosings(config.yearClosings);
    if (closings) config.yearClosings = closings; else delete config.yearClosings;
  }
  // Ancien format : l'avantage Navigo vivait dans config (navigoBase / navigoRate, gardés tels quels).
  // Fichier abîmé ou incomplet : chaque avantage est complété champ par champ.
  const workBenefits = isObj(r.workBenefits)
    ? withDefaults(r.workBenefits, DEFAULT_WORK_BENEFITS)
    : { ...DEFAULT_WORK_BENEFITS, navigo: { active: true, basePrice: Number(cfgRaw.navigoBase) || 90.80, refundRate: Number(cfgRaw.navigoRate) || 67.24 } };
  // `lastWrite` : signature de la dernière écriture (date, appareil, voir lib/writeStamp),
  // reposée à chaque enregistrement ; comme `lastView`, ce n'est pas une donnée.
  const { lastView: _lastView, lastWrite: _lastWrite, ...rest } = r;
  // Listes d'objets : une entrée qui n'est pas un objet (null, texte…) ferait planter les écrans.
  const objects = <T,>(v: unknown) => arr<unknown>(v).filter(isObj) as unknown as T[];
  return {
    ...rest,
    schemaVersion: APP_SCHEMA_VERSION,
    accounts: normalizeAccounts(arr<unknown>(r.accounts).filter(isObj).map(sanitizeAccount) as unknown as GlobalAppData['accounts']),
    expenses: objects(r.expenses),
    history: dedupeMonthlySnapshots(sanitizeSnapshots<PortfolioSnapshot>(r.history, ['totalAmount', 'ownedAmount'])),
    expensesHistory: dedupeMonthlySnapshots(sanitizeSnapshots<ExpenseSnapshot>(r.expensesHistory, ['total'])),
    payslips: objects(r.payslips),
    recurringMovements: objects(r.recurringMovements),
    subscriptions: objects(r.subscriptions),
    donations: objects(r.donations),
    payChecklist: isObj(r.payChecklist) ? (r.payChecklist as unknown as GlobalAppData['payChecklist']) : undefined,
    parentalRestitution: isObj(r.parentalRestitution) ? (r.parentalRestitution as unknown as GlobalAppData['parentalRestitution']) : undefined,
    activePayslipId: typeof r.activePayslipId === 'string' && r.activePayslipId ? r.activePayslipId : undefined,
    fiscalConfig: sanitizeFiscalConfig(r.fiscalConfig),
    workBenefits,
    config,
  } as AppDoc;
};

/** JSON à clés triées : deux contenus identiques donnent la même chaîne, quel que soit l'ordre. */
export const stableStringify = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (isObj(v)) {
    return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
};

/**
 * Forme comparable : migrée, sans préférence d'affichage ni secret propre à l'appareil.
 * Sert à savoir s'il y a vraiment quelque chose à écrire, et si une sauvegarde locale
 * diffère de Drive.
 */
export const canonicalize = (data: unknown): string => {
  if (!data) return '';
  const m = migrate(data) as GlobalAppData & Record<string, unknown>;
  const { geminiApiKey: _g, ...config } = m.config as GlobalAppData['config'] & { geminiApiKey?: string };
  return stableStringify({ ...m, config });
};

/** Retire ce qui ne doit jamais quitter l'appareil (fichier Drive, export, sauvegarde). */
export const withoutDeviceOnlyFields = <T extends GlobalAppData>(data: T): T => {
  const { geminiApiKey: _g, ...config } = data.config as GlobalAppData['config'] & { geminiApiKey?: string };
  return { ...data, config: config as GlobalAppData['config'] };
};

/**
 * Contrôle d'un fichier importé avant de remplacer quoi que ce soit. Renvoie la liste des
 * problèmes (vide = importable).
 */
export const validateImport = (raw: unknown): string[] => {
  const errors: string[] = [];
  if (!isObj(raw)) return ['Le fichier ne contient pas de données Pécule.'];
  if (!Array.isArray(raw.accounts)) errors.push('Liste des comptes absente.');
  else raw.accounts.forEach((a, i) => {
    if (!isObj(a) || typeof a.id !== 'string' || typeof a.name !== 'string') errors.push(`Compte n° ${i + 1} : identifiant ou nom manquant.`);
    else for (const k of ['totalAmount', 'ownedAmount', 'parentalCapital'] as const) {
      if (a[k] !== undefined && !(typeof a[k] === 'number' && Number.isFinite(a[k]))) errors.push(`${a.name} : montant « ${k} » invalide.`);
    }
  });
  if (isFromNewerApp(raw)) errors.push('Fichier créé par une version plus récente de Pécule : mettez l\'app à jour avant de l\'importer.');
  return errors;
};
