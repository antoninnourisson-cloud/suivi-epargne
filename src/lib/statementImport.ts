// ================================================
// FILE: src/lib/statementImport.ts
// Import d'un relevé bancaire lu par Gemini (« Lire un relevé ») : filtrage de la réponse,
// rapprochement avec vos comptes, doublons, contrôle de cohérence, puis demande prête pour la
// commande importStatement (lib/commands/statement), qui seule modifie les soldes.
// Fonctions pures, testées. Rien n'est enregistré sans votre validation.
// ================================================
import { AccountType, type AccountMovement, type SavingsAccount } from '../types';
import { EPS, round2, signedAmount } from './money';
import { daysBetween, parseISODate } from './dates';
import { tracksDeposits } from './finance';
import type { StatementImportItem } from './commands/statement';
import { isISODay, olderThanBalance, type OlderBalance } from './statementDates';

export interface StatementMovement {
  /** Date de l'opération, AAAA-MM-JJ. */
  date: string;
  label: string;
  /** Montant positif ; le sens est dans `type`. */
  amount: number;
  type: 'IN' | 'OUT';
}

export interface StatementAccount {
  /** Intitulé du compte sur le relevé (numéros longs masqués). */
  name: string;
  /** 4 derniers chiffres du numéro, seulement. */
  numberEnd?: string;
  /** Soldes affichés par la banque (total du compte), en euros. */
  openingBalance?: number;
  closingBalance?: number;
  closingDate?: string;
  /** Opérations lisibles, par date. */
  movements: StatementMovement[];
  /** Lignes illisibles écartées (date, montant ou sens manquant). */
  ignored: number;
}

export interface StatementData {
  bank?: string;
  periodStart?: string;
  periodEnd?: string;
  accounts: StatementAccount[];
}

/** Bornes de vraisemblance d'une lecture (au-delà : lecture aberrante, ligne écartée). */
export const STATEMENT_LIMITS = { accounts: 12, movements: 400, amount: 100_000_000, balance: 1_000_000_000 } as const;

// ---------------------------------------------------------------------------
// Filtrage de la réponse de Gemini
// ---------------------------------------------------------------------------

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const cleanText = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : undefined;
const money = (v: unknown, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? round2(v) : undefined;

/**
 * Numéros masqués : IBAN retiré, et toute suite d'au moins `minDigits` chiffres réduite à ses
 * 4 derniers (« ···1234 »). Intitulé d'un compte : dès 5 chiffres (il ne sert qu'au
 * rapprochement) ; libellé d'une opération, enregistré dans vos mouvements : dès 9 chiffres
 * (numéro de compte ou de carte d'un tiers), les petites références restent lisibles.
 */
export const maskAccountNumbers = (s: string, minDigits = 5): string =>
  s.replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,}(?:[ ]?[A-Z0-9]{1,3})?\b/gi, '')
    .replace(new RegExp(`\\d(?:[ .-]?\\d){${minDigits - 1},}`, 'g'), run => `···${run.replace(/\D/g, '').slice(-4)}`)
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Réponse de Gemini → relevé exploitable : dates qui existent, montants finis et plausibles,
 * sens connu, numéros réduits aux 4 derniers chiffres. Une opération illisible est écartée
 * (et comptée), jamais devinée ; un compte sans solde ni opération lisible est ignoré.
 */
export const sanitizeStatement = (raw: unknown): StatementData => {
  const r = record(raw) ?? {};
  const list = Array.isArray(r.accounts) ? r.accounts.slice(0, STATEMENT_LIMITS.accounts) : [];
  const accounts: StatementAccount[] = [];
  list.forEach((item, i) => {
    const a = record(item);
    if (!a) return;
    const rawMoves: unknown[] = Array.isArray(a.movements) ? a.movements : [];
    const movements: StatementMovement[] = [];
    let ignored = Math.max(0, rawMoves.length - STATEMENT_LIMITS.movements);
    for (const raw of rawMoves.slice(0, STATEMENT_LIMITS.movements)) {
      const m = record(raw);
      const amount = m ? money(m.amount, STATEMENT_LIMITS.amount) : undefined;
      const type = m?.direction === 'CREDIT' ? 'IN' : m?.direction === 'DEBIT' ? 'OUT' : undefined;
      if (!m || !isISODay(m.date) || amount === undefined || amount <= 0 || !type) { ignored++; continue; }
      const label = cleanText(m.label, 140);
      movements.push({ date: m.date, label: (label && maskAccountNumbers(label, 9)) || 'Opération', amount, type });
    }
    movements.sort((x, y) => x.date.localeCompare(y.date));
    const closingBalance = money(a.closingBalance, STATEMENT_LIMITS.balance);
    if (movements.length === 0 && closingBalance === undefined) return;
    const digits = typeof a.numberEnd === 'string' || typeof a.numberEnd === 'number' ? String(a.numberEnd).replace(/\D/g, '').slice(-4) : '';
    const name = cleanText(a.name, 120);
    accounts.push({
      name: (name && maskAccountNumbers(name).slice(0, 80)) || `Compte ${i + 1}`,
      numberEnd: digits.length >= 2 ? digits : undefined,
      openingBalance: money(a.openingBalance, STATEMENT_LIMITS.balance),
      closingBalance,
      closingDate: isISODay(a.closingDate) ? a.closingDate : undefined,
      movements,
      ignored,
    });
  });
  return {
    bank: cleanText(r.bank, 80),
    periodStart: isISODay(r.periodStart) ? r.periodStart : undefined,
    periodEnd: isISODay(r.periodEnd) ? r.periodEnd : undefined,
    accounts,
  };
};

// ---------------------------------------------------------------------------
// Rapprochement avec vos comptes
// ---------------------------------------------------------------------------

/** Texte comparable : sans accents, minuscules, mots séparés par une espace. */
export const normalizeLabel = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hasWords = (hay: string, needle: string) => !!needle && ` ${hay} `.includes(` ${needle} `);

// Mots qui désignent un type de compte sur un relevé (le premier trouvé l'emporte : les plus
// précis d'abord, « livret » seul en dernier).
const TYPE_HINTS: [AccountType, string[]][] = [
  [AccountType.LIVRET_A, ['livret a', 'livret bleu']],
  [AccountType.LDDS, ['ldds', 'ldd', 'developpement durable']],
  [AccountType.LEP, ['lep', 'epargne populaire']],
  [AccountType.CEL, ['cel', 'compte epargne logement']],
  [AccountType.PEL, ['pel', 'plan epargne logement']],
  [AccountType.COMPTE_A_TERME, ['compte a terme', 'depot a terme']],
  [AccountType.PEA, ['pea', 'plan epargne en actions']],
  [AccountType.CTO, ['compte titres', 'compte titre', 'cto']],
  [AccountType.ASSURANCE_VIE, ['assurance vie']],
  [AccountType.PER, ['per', 'plan epargne retraite']],
  [AccountType.PEE, ['pee', 'plan epargne entreprise', 'epargne salariale']],
  [AccountType.COMPTE_COURANT, ['compte courant', 'compte cheque', 'compte cheques', 'compte de depot', 'compte de depots', 'compte a vue', 'cpt courant', 'compte joint']],
  [AccountType.LIVRET_BANCAIRE, ['livret']],
];

/** Type de compte que l'intitulé du relevé désigne, s'il en nomme un. */
export const guessAccountType = (name: string): AccountType | undefined => {
  const n = normalizeLabel(name);
  return TYPE_HINTS.find(([, words]) => words.some(w => hasWords(n, w)))?.[0];
};

/**
 * Ressemblance entre un compte du relevé et un de vos comptes : 4 = même nom, 3 = même type
 * nommé (2 pour un simple « livret »), +1 si la banque est la même ; 0 = un autre type est
 * explicitement nommé, ou rien en commun.
 */
export const matchScore = (stmt: Pick<StatementAccount, 'name'>, acc: Pick<SavingsAccount, 'name' | 'type' | 'institution'>, bank?: string): number => {
  const name = normalizeLabel(stmt.name);
  const accName = normalizeLabel(acc.name);
  const guessed = guessAccountType(stmt.name);
  const conflict = guessed !== undefined && guessed !== AccountType.LIVRET_BANCAIRE && guessed !== acc.type;
  let score = 0;
  if (accName && name === accName) score = 4;
  else if (conflict) return 0;
  else if (accName && (hasWords(name, accName) || hasWords(accName, name))) score = 4;
  else if (guessed === acc.type) score = guessed === AccountType.LIVRET_BANCAIRE ? 2 : 3;
  if (score === 0) return 0;
  const inst = normalizeLabel(acc.institution || '');
  const b = normalizeLabel(bank || '');
  if (inst && b && (hasWords(b, inst) || hasWords(inst, b))) score += 1;
  return score;
};

/** Score minimal pour proposer un compte (en dessous : « Ne pas importer », à choisir). */
const MATCH_THRESHOLD = 3;

/**
 * Compte proposé pour chaque compte du relevé (`undefined` = aucun). Un de vos comptes n'est
 * proposé qu'une fois ; à égalité, celui dont le solde est le plus proche. Ouvert depuis la
 * fiche d'un compte (`preferredAccountId`) avec un relevé d'un seul compte : ce compte-là.
 */
export const proposeMapping = (data: StatementData, accounts: SavingsAccount[], preferredAccountId?: string): (string | undefined)[] => {
  if (preferredAccountId && data.accounts.length === 1 && accounts.some(a => a.id === preferredAccountId)) return [preferredAccountId];
  const pairs: { i: number; id: string; score: number; gap: number }[] = [];
  data.accounts.forEach((s, i) => accounts.forEach(a => {
    const score = matchScore(s, a, data.bank);
    if (score >= MATCH_THRESHOLD) pairs.push({ i, id: a.id, score, gap: s.closingBalance !== undefined ? Math.abs(s.closingBalance - a.totalAmount) : Number.MAX_VALUE });
  }));
  pairs.sort((x, y) => y.score - x.score || x.gap - y.gap);
  const out: (string | undefined)[] = data.accounts.map(() => undefined);
  const used = new Set<string>();
  for (const p of pairs) {
    if (out[p.i] !== undefined || used.has(p.id)) continue;
    out[p.i] = p.id;
    used.add(p.id);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Relecture des opérations : doublons, déjà comptées, intérêts
// ---------------------------------------------------------------------------

/**
 * - `new` : à ajouter ;
 * - `duplicate` : un mouvement du même montant, du même sens et de date proche existe déjà ;
 * - `already-counted` : datée au plus tard du dernier solde vérifié du compte, elle y est
 *   probablement déjà comprise (l'ajouter la compterait deux fois avant l'actualisation) ;
 * - `future` : datée après aujourd'hui (année mal lue, ou opération « à venir » d'une capture
 *   de l'application de la banque).
 */
export type MovementStatus = 'new' | 'duplicate' | 'already-counted' | 'future';

export interface ReviewedMovement extends StatementMovement {
  status: MovementStatus;
  /** Intérêts crédités : enregistrés hors épargne (comme dans Actualiser). */
  interest: boolean;
  /** Mouvement existant reconnu (doublon). */
  matched?: Pick<AccountMovement, 'date' | 'label'>;
  /** Cochée par défaut. */
  selected: boolean;
}

/** Intitulé d'intérêts crédités (« INTERETS CREDITEURS 2026 », « Intérêts acquis »). */
export const isInterestLabel = (label: string): boolean => /\binterets?\b/.test(normalizeLabel(label));

const words = (s: string) => new Set(normalizeLabel(s).split(' ').filter(w => w.length >= 3));
/** Mots en commun (0 à 1) : sert à départager deux doublons possibles, et à élargir la fenêtre de dates. */
export const labelSimilarity = (a: string, b: string): number => {
  const x = words(a), y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / (x.size + y.size - common);
};

/**
 * Comptes dont seul le solde est repris par défaut (opérations décochées) :
 * - compte courant : dépenses du quotidien ;
 * - placement qui suit ses versements (PEA, CTO, assurance-vie, PER, PEE) : son relevé liste
 *   surtout des achats, ventes, dividendes et frais, qui ne sont ni des versements ni des
 *   retraits ; les compter ainsi fausserait les versements cumulés (base des plus-values).
 *   L'écart du solde est alors une variation de valeur, comme dans Actualiser.
 */
export const balanceOnlyByDefault = (type: AccountType): boolean => type === AccountType.COMPTE_COURANT || tracksDeposits(type);

/** Jours d'écart tolérés entre une opération et un mouvement déjà saisi (date de valeur, saisie le lendemain). */
const DUPLICATE_WINDOW_DAYS = 3;
/** Même tolérance, élargie quand les libellés se ressemblent. */
const DUPLICATE_WINDOW_SIMILAR_DAYS = 7;

/**
 * Statut de chaque opération du relevé pour le compte choisi. Chaque mouvement existant ne
 * reconnaît qu'une opération (deux virements identiques le même jour, un seul saisi : l'autre
 * reste nouveau). La part des parents et le solde initial ne sont jamais des doublons.
 * Cochées par défaut : les nouvelles, sauf sur les comptes dont seul le solde est repris
 * (`balanceOnlyByDefault`). Avec `today`, une opération datée après aujourd'hui est `future`.
 */
export const reviewMovements = (stmt: Pick<StatementAccount, 'movements'>, account: SavingsAccount, today?: string): ReviewedMovement[] => {
  const pool = account.movements.filter(m => m.kind !== 'parental' && m.tag !== 'initial');
  const used = new Set<string>();
  return stmt.movements.map(m => {
    const day = parseISODate(m.date);
    let best: { mv: AccountMovement; rank: number } | undefined;
    for (const e of pool) {
      if (used.has(e.id) || e.type !== m.type || Math.abs(e.amount - m.amount) > EPS || !isISODay(e.date)) continue;
      const days = Math.abs(daysBetween(day, parseISODate(e.date)));
      const sim = labelSimilarity(m.label, e.label);
      if (days > (sim >= 0.5 ? DUPLICATE_WINDOW_SIMILAR_DAYS : DUPLICATE_WINDOW_DAYS)) continue;
      const rank = days - sim;
      if (!best || rank < best.rank) best = { mv: e, rank };
    }
    if (best) used.add(best.mv.id);
    const status: MovementStatus = best ? 'duplicate'
      : today && m.date > today ? 'future'
        : account.balanceCheckedAt && m.date <= account.balanceCheckedAt ? 'already-counted' : 'new';
    return {
      ...m, status,
      interest: m.type === 'IN' && isInterestLabel(m.label),
      ...(best ? { matched: { date: best.mv.date, label: best.mv.label } } : {}),
      selected: status === 'new' && !balanceOnlyByDefault(account.type),
    };
  });
};

// ---------------------------------------------------------------------------
// Contrôles et aperçu
// ---------------------------------------------------------------------------

const sum = (ms: Pick<StatementMovement, 'type' | 'amount'>[]) => round2(ms.reduce((s, m) => s + signedAmount(m), 0));

/**
 * Cohérence du relevé lui-même : nouveau solde − ancien solde − opérations lues. 0 = tout
 * concorde ; sinon des lignes manquent ou ont été mal lues. `null` si un solde manque.
 */
export const statementConsistencyGap = (s: Pick<StatementAccount, 'openingBalance' | 'closingBalance' | 'movements'>): number | null =>
  s.openingBalance === undefined || s.closingBalance === undefined ? null : round2(s.closingBalance - s.openingBalance - sum(s.movements));

/** Date du nouveau solde : celle du relevé, sinon la fin de période, sinon la dernière opération ; jamais après aujourd'hui. */
export const statementClosingDate = (s: Pick<StatementAccount, 'closingDate' | 'movements'>, data: Pick<StatementData, 'periodEnd'>, today: string): string => {
  const d = [s.closingDate, data.periodEnd, s.movements[s.movements.length - 1]?.date].find(isISODay) ?? today;
  return d > today ? today : d;
};

export interface AccountImportPreview {
  /** Opérations cochées (somme signée). */
  movementsTotal: number;
  /** Écart restant enregistré comme actualisation (`null` : solde non mis à jour). */
  remainingGap: number | null;
  /** Nouveau solde inférieur à la part des parents (ou négatif) : solde non modifiable. */
  belowParental: boolean;
}

/** Ce que l'import fera sur un compte, pour l'écran de relecture. */
export const previewAccountImport = (
  account: Pick<SavingsAccount, 'totalAmount' | 'parentalCapital'>,
  closingBalance: number | undefined,
  selected: Pick<StatementMovement, 'type' | 'amount'>[],
): AccountImportPreview => {
  const movementsTotal = sum(selected);
  if (closingBalance === undefined) return { movementsTotal, remainingGap: null, belowParental: false };
  return {
    movementsTotal,
    remainingGap: round2(closingBalance - account.totalAmount - movementsTotal),
    belowParental: closingBalance < account.parentalCapital - EPS,
  };
};

/** Choix de l'utilisateur pour un compte du relevé. */
export interface StatementAccountChoice {
  /** Votre compte ; absent = ne pas importer. */
  accountId?: string;
  /** Mettre le solde à jour d'après le nouveau solde du relevé. */
  updateBalance: boolean;
  /** Opérations cochées (même ordre que `reviewMovements`). */
  selected: boolean[];
  /** Opérations relues, avec leur statut. */
  movements: ReviewedMovement[];
  /** Solde du relevé plus ancien que celui du compte (voir `olderThanBalance`). */
  older?: OlderBalance;
}

/**
 * Choix proposés pour un compte du relevé et le compte choisi (`undefined` = ne pas importer) :
 * opérations relues et cochées par défaut, solde repris s'il a été lu, SAUF s'il est plus
 * ancien que celui du compte (à cocher soi-même, après l'avertissement).
 */
export const initialChoice = (
  s: StatementAccount, data: Pick<StatementData, 'periodEnd'>, account: SavingsAccount | undefined, today: string,
): StatementAccountChoice => {
  if (!account) return { updateBalance: s.closingBalance !== undefined, selected: [], movements: [] };
  const movements = reviewMovements(s, account, today);
  const older = s.closingBalance !== undefined ? olderThanBalance(account, statementClosingDate(s, data, today)) : null;
  return {
    accountId: account.id,
    updateBalance: s.closingBalance !== undefined && !older,
    selected: movements.map(m => m.selected),
    movements,
    ...(older ? { older } : {}),
  };
};

/**
 * Demande pour la commande importStatement, d'après les choix faits à la relecture. Un compte
 * choisi deux fois n'est importé qu'une fois (le premier). Rien à faire sur un compte (aucune
 * opération cochée, solde non mis à jour) : il n'apparaît pas. Un solde plus ancien que celui
 * du compte n'est repris que si vous l'avez coché vous-même, après l'avertissement (`allowOlder`).
 */
export const buildImportItems = (data: StatementData, choices: StatementAccountChoice[], today: string): StatementImportItem[] => {
  const items: StatementImportItem[] = [];
  const seen = new Set<string>();
  data.accounts.forEach((s, i) => {
    const c = choices[i];
    if (!c?.accountId || seen.has(c.accountId)) return;
    const movements = c.movements
      .filter((_, k) => c.selected[k])
      .map(m => ({ date: m.date, label: m.label, amount: m.amount, type: m.type, ...(m.interest ? { interest: true } : {}) }));
    const closingBalance = c.updateBalance ? s.closingBalance : undefined;
    if (movements.length === 0 && closingBalance === undefined) return;
    seen.add(c.accountId);
    items.push({
      accountId: c.accountId, date: statementClosingDate(s, data, today),
      ...(closingBalance !== undefined ? { closingBalance } : {}),
      ...(closingBalance !== undefined && c.older ? { allowOlder: true } : {}),
      movements,
    });
  });
  return items;
};
