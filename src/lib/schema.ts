// ================================================
// FILE: src/lib/schema.ts
// Forme du fichier de données Drive : version, valeurs par défaut, migration des anciens
// fichiers et comparaison canonique. UN SEUL point d'entrée (`migrate`) pour tout ce qui
// entre dans l'app : chargement Drive, import, restauration locale, synchronisation entre
// onglets, et lecture par le serveur de notifications.
// ================================================
import { GlobalAppData } from '../types';
import { DEFAULT_FISCAL_CONFIG, DEFAULT_WORK_BENEFITS } from '../constants';
import { normalizeAccounts, dedupeMonthlySnapshots, migrateFiscalConfig } from './finance';

/**
 * Version du format. À augmenter quand un changement rend le fichier illisible pour une
 * ancienne version de l'app : celle-ci refuse alors d'écrire (au lieu d'effacer ce
 * qu'elle ne connaît pas) et demande une mise à jour.
 */
export const APP_SCHEMA_VERSION = 2;

export const DEFAULT_CONFIG: GlobalAppData['config'] = {
  grossAnnual: 45000,
  leisureBudget: 300,
  projectSavings: 200,
  navigoBase: 90.80,
  navigoRate: 67.24,
  taxRateManual: 0,
  extraMonthlyIncome: 0,
  parentsEmail: '',
};

/** Données d'un tout premier lancement. */
export const emptyData = (): GlobalAppData => ({
  schemaVersion: APP_SCHEMA_VERSION,
  accounts: [],
  expenses: [],
  history: [],
  expensesHistory: [],
  goals: [],
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

/** Le fichier a été écrit par une version plus récente de l'app que celle-ci. */
export const isFromNewerApp = (raw: unknown): boolean =>
  isObj(raw) && typeof raw.schemaVersion === 'number' && raw.schemaVersion > APP_SCHEMA_VERSION;

/**
 * Remet n'importe quel contenu (ancien fichier, import, sauvegarde locale) à la forme
 * courante. Les champs INCONNUS sont conservés tels quels : une version de l'app ne doit
 * jamais effacer ce qu'une version plus récente a ajouté.
 */
export const migrate = (raw: unknown): GlobalAppData => {
  const r = isObj(raw) ? raw : {};
  const cfgRaw = isObj(r.config) ? r.config : {};
  const config = { ...DEFAULT_CONFIG, ...cfgRaw } as GlobalAppData['config'];
  // Ancien format : l'avantage Navigo vivait dans config (navigoBase / navigoRate).
  const workBenefits = isObj(r.workBenefits)
    ? (r.workBenefits as unknown as GlobalAppData['workBenefits'])
    : { ...DEFAULT_WORK_BENEFITS, navigo: { active: true, basePrice: Number(cfgRaw.navigoBase) || 90.80, refundRate: Number(cfgRaw.navigoRate) || 67.24 } };
  const { lastView: _lastView, ...rest } = r;
  return {
    ...rest,
    schemaVersion: APP_SCHEMA_VERSION,
    accounts: normalizeAccounts(arr<GlobalAppData['accounts'][number]>(r.accounts)),
    expenses: arr(r.expenses),
    history: dedupeMonthlySnapshots(arr(r.history)),
    expensesHistory: dedupeMonthlySnapshots(arr(r.expensesHistory)),
    goals: arr(r.goals),
    payslips: arr(r.payslips),
    recurringMovements: arr(r.recurringMovements),
    subscriptions: arr(r.subscriptions),
    donations: arr(r.donations),
    payChecklist: (r.payChecklist as GlobalAppData['payChecklist']) || undefined,
    parentalRestitution: (r.parentalRestitution as GlobalAppData['parentalRestitution']) || undefined,
    activePayslipId: (r.activePayslipId as string) || undefined,
    fiscalConfig: migrateFiscalConfig((isObj(r.fiscalConfig) ? r.fiscalConfig : DEFAULT_FISCAL_CONFIG) as unknown as NonNullable<GlobalAppData['fiscalConfig']>),
    workBenefits,
    config,
  } as GlobalAppData;
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
export const withoutDeviceOnlyFields = (data: GlobalAppData): GlobalAppData => {
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
