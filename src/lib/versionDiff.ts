// Comparaison de deux versions des données (conflit entre deux appareils, fichier en double
// sur Drive). Fonctions pures : l'écran de choix n'affiche que ce qu'elles renvoient.
//
// Les deux contenus passent par migrate() (point d'entrée unique de toute donnée), puis sont
// comparés par identifiant : comptes (solde total et part propre), mouvements de chaque
// compte, et les autres parties du fichier (réglages, charges, objectifs…). Les points
// mensuels de l'historique sont ignorés : ils se recalculent à partir des soldes.
import { migrate, stableStringify, withoutDeviceOnlyFields } from './schema';
import { round2, EPS } from './money';
import { formatEUR } from './format';
import { parseISODate } from './dates';
import type { AccountMovement, GlobalAppData, SavingsAccount } from '../types';

export interface VersionSummary {
  /** Épargne totale : somme des soldes (part propre + part des parents). */
  totalSavings: number;
  /** Votre part : somme des parts propres. */
  ownShare: number;
  accountCount: number;
  movementCount: number;
}

export type Side = 'local' | 'remote';

export interface AccountDiff {
  id: string;
  name: string;
  /** Soldes de chaque côté ; absent = le compte n'existe pas de ce côté. */
  local?: { total: number; own: number };
  remote?: { total: number; own: number };
  /** 'balance' : soldes différents ; 'details' : mêmes soldes, autre chose a changé (nom, taux, mouvement modifié…). */
  kind: 'balance' | 'only-local' | 'only-remote' | 'details';
}

export interface MovementRef {
  accountId: string;
  accountName: string;
  id: string;
  date: string;
  label: string;
  amount: number;
  type: 'IN' | 'OUT';
}

export interface VersionDiff {
  local: VersionSummary;
  remote: VersionSummary;
  accounts: AccountDiff[];
  /** Mouvements présents d'un seul côté (dans un compte qui existe des deux côtés), du plus récent au plus ancien. */
  onlyLocal: MovementRef[];
  onlyRemote: MovementRef[];
  /** Mouvements présents des deux côtés mais modifiés (montant, libellé, date…). */
  changedMovements: number;
  /** Autres parties du fichier qui diffèrent, en clair (« Réglages », « Dons »…). */
  sections: string[];
  identical: boolean;
}

// Parties du fichier comparées en bloc, dans l'ordre d'affichage.
const SECTION_LABELS: [keyof GlobalAppData, string][] = [
  ['config', 'Réglages'],
  ['expenses', 'Charges fixes'],
  ['subscriptions', 'Abonnements'],
  ['recurringMovements', 'Mouvements réguliers'],
  ['payslips', 'Fiches de paie'],
  ['activePayslipId', 'Fiche de paie de référence'],
  ['payChecklist', 'Liste de la paie'],
  ['donations', 'Dons'],
  ['parentalRestitution', 'Restitution aux parents'],
  ['fiscalConfig', 'Paramètres fiscaux'],
  ['workBenefits', 'Avantages salariés'],
];
// Jamais comparés : recalculés (points mensuels), ou métadonnées d'écriture.
const IGNORED = new Set<string>(['accounts', 'history', 'expensesHistory', 'schemaVersion', 'lastView', 'lastWrite']);

const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0));

const summarize = (d: GlobalAppData): VersionSummary => ({
  totalSavings: sum(d.accounts.map(a => a.totalAmount)),
  ownShare: sum(d.accounts.map(a => a.ownedAmount)),
  accountCount: d.accounts.length,
  movementCount: d.accounts.reduce((n, a) => n + (a.movements?.length ?? 0), 0),
});

// Forme comparée : migrée, sans ce qui ne quitte jamais l'appareil (clé Gemini).
const prepare = (raw: unknown): GlobalAppData => withoutDeviceOnlyFields(migrate(raw));

/** Résumé d'une version (n'importe quel contenu : migré d'abord). */
export const summarizeVersion = (raw: unknown): VersionSummary => summarize(prepare(raw));

const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);
const differs = (a: number, b: number) => Math.abs(a - b) > EPS;
const balances = (a: SavingsAccount) => ({ total: round2(a.totalAmount), own: round2(a.ownedAmount) });
const ref = (a: SavingsAccount, m: AccountMovement): MovementRef => ({
  accountId: a.id, accountName: a.name, id: m.id, date: m.date, label: m.label, amount: m.amount, type: m.type,
});
const newestFirst = (x: MovementRef, y: MovementRef) => (y.date || '').localeCompare(x.date || '') || x.label.localeCompare(y.label);

/**
 * Compare la version de cet appareil (`localRaw`) à l'autre (`remoteRaw`). Les comptes sont
 * appariés par identifiant ; le nom affiché est celui de cet appareil s'il existe.
 */
export const diffVersions = (localRaw: unknown, remoteRaw: unknown): VersionDiff => {
  const local = prepare(localRaw);
  const remote = prepare(remoteRaw);
  const remoteById = new Map(remote.accounts.map(a => [a.id, a]));
  const localIds = new Set(local.accounts.map(a => a.id));

  const accounts: AccountDiff[] = [];
  const onlyLocal: MovementRef[] = [];
  const onlyRemote: MovementRef[] = [];
  let changedMovements = 0;

  for (const l of local.accounts) {
    const r = remoteById.get(l.id);
    if (!r) { accounts.push({ id: l.id, name: l.name, local: balances(l), kind: 'only-local' }); continue; }
    const lb = balances(l), rb = balances(r);
    const balanceDiffers = differs(lb.total, rb.total) || differs(lb.own, rb.own);

    const lm = new Map((l.movements ?? []).map(m => [m.id, m]));
    const rm = new Map((r.movements ?? []).map(m => [m.id, m]));
    let movementDiff = false;
    for (const [id, m] of lm) {
      const other = rm.get(id);
      if (!other) { onlyLocal.push(ref(l, m)); movementDiff = true; } else if (!same(m, other)) { changedMovements++; movementDiff = true; }
    }
    for (const [id, m] of rm) if (!lm.has(id)) { onlyRemote.push(ref(l, m)); movementDiff = true; }

    if (balanceDiffers) accounts.push({ id: l.id, name: l.name, local: lb, remote: rb, kind: 'balance' });
    else {
      const { movements: _lm, ...lRest } = l;
      const { movements: _rm, ...rRest } = r;
      if (movementDiff || !same(lRest, rRest)) accounts.push({ id: l.id, name: l.name, local: lb, remote: rb, kind: 'details' });
    }
  }
  for (const r of remote.accounts) {
    if (!localIds.has(r.id)) accounts.push({ id: r.id, name: r.name, remote: balances(r), kind: 'only-remote' });
  }
  // Même comptes, ordre différent : la liste des comptes a changé (rangement).
  const orderChanged = accounts.length === 0 && !same(local.accounts.map(a => a.id), remote.accounts.map(a => a.id));

  const sections: string[] = SECTION_LABELS.filter(([k]) => !same(local[k], remote[k])).map(([, label]) => label);
  if (orderChanged) sections.unshift('Ordre des comptes');
  // Champs inconnus de cette version (ajoutés par une version plus récente) : signalés en bloc.
  const known = new Set<string>([...IGNORED, ...SECTION_LABELS.map(([k]) => k as string)]);
  const lr = local as unknown as Record<string, unknown>;
  const rr = remote as unknown as Record<string, unknown>;
  const extra = [...new Set([...Object.keys(lr), ...Object.keys(rr)])].filter(k => !known.has(k));
  if (extra.some(k => !same(lr[k], rr[k]))) sections.push('Autres données');

  onlyLocal.sort(newestFirst);
  onlyRemote.sort(newestFirst);
  return {
    local: summarize(local),
    remote: summarize(remote),
    accounts,
    onlyLocal,
    onlyRemote,
    changedMovements,
    sections,
    identical: accounts.length === 0 && onlyLocal.length === 0 && onlyRemote.length === 0 && changedMovements === 0 && sections.length === 0,
  };
};

/** Comment nommer chaque côté dans les phrases (« sur cet appareil », « sur Drive »). */
export interface SideLabels { local: string; remote: string }

const shortDate = (iso: string) => {
  const d = parseISODate(iso || '');
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};
const movementText = (m: MovementRef) =>
  `« ${m.label || 'Mouvement'} », ${m.type === 'IN' ? '+' : '−'}${formatEUR(Math.abs(m.amount))} le ${shortDate(m.date)} (${m.accountName})`;
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/**
 * Les différences principales, en phrases courtes et par ordre d'importance : soldes
 * différents, comptes d'un seul côté, mouvements d'un seul côté, mouvements modifiés, puis
 * le reste du fichier. Au plus `limit` phrases ; `more` compte celles laissées de côté.
 */
export const diffHighlights = (diff: VersionDiff, labels: SideLabels, limit = 6): { lines: string[]; more: number } => {
  const lines: string[] = [];
  for (const a of diff.accounts) {
    if (a.kind !== 'balance' || !a.local || !a.remote) continue;
    const sameTotal = !differs(a.local.total, a.remote.total);
    lines.push(sameTotal
      ? `${a.name} : même solde, mais votre part vaut ${formatEUR(a.local.own)} ${labels.local} et ${formatEUR(a.remote.own)} ${labels.remote}`
      : `${a.name} : ${formatEUR(a.local.total)} ${labels.local}, ${formatEUR(a.remote.total)} ${labels.remote}`);
  }
  for (const a of diff.accounts) {
    if (a.kind === 'only-local') lines.push(`Compte « ${a.name} » seulement ${labels.local}`);
    if (a.kind === 'only-remote') lines.push(`Compte « ${a.name} » seulement ${labels.remote}`);
  }
  const movementLines = (list: MovementRef[], where: string) => {
    if (list.length === 1) lines.push(`Seulement ${where} : ${movementText(list[0])}`);
    else if (list.length > 1) lines.push(`${plural(list.length, 'mouvement', 'mouvements')} seulement ${where}, dont ${movementText(list[0])}`);
  };
  movementLines(diff.onlyLocal, labels.local);
  movementLines(diff.onlyRemote, labels.remote);
  if (diff.changedMovements > 0) lines.push(`${plural(diff.changedMovements, 'mouvement modifié', 'mouvements modifiés')} (montant, libellé ou date)`);
  for (const a of diff.accounts) {
    if (a.kind === 'details') lines.push(`${a.name} : même solde, détails du compte modifiés`);
  }
  if (diff.sections.length > 0) lines.push(`Modifié aussi : ${diff.sections.join(', ')}`);
  return { lines: lines.slice(0, limit), more: Math.max(0, lines.length - limit) };
};
