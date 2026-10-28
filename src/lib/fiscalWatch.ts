// ================================================
// FILE: src/lib/fiscalWatch.ts
// Veille fiscale : compare les valeurs officielles relevées (par le serveur avec Cloudflare
// Workers AI, ou par Gemini en secours) avec les paramètres de l'app, et produit des
// PROPOSITIONS. Rien n'est appliqué sans un clic de
// l'utilisateur. Les valeurs hors des bornes plausibles sont écartées (une IA peut se
// tromper ou inventer) et chaque proposition garde sa source pour vérification.
// ================================================
import { FiscalConfig, SavingsAccount, TaxBracket } from '../types';
import { REGULATED_RATE_GROUPS, applyRateChange, transportExemptUntil, TRANSPORT_TEMPORARY_LAST_YEAR, DONATION_75_CEILING, DONATION_75_RAISE_DATE } from './finance';
import { localTodayISO } from './dates';
import { formatRate, plainEUR } from './format';
import { inflationOf } from './inflation';

export interface WatchedValue<T = number> { value: T; source?: string; effectiveDate?: string }

/** Forme attendue de la réponse de Gemini (tous les champs facultatifs). */
export interface FiscalWatchResult {
  livretARate?: WatchedValue;          // % annuel, ex. 1.7
  lepRate?: WatchedValue;
  livretACeiling?: WatchedValue;
  lddsCeiling?: WatchedValue;
  lepCeiling?: WatchedValue;
  lepIncomeCeilingOnePart?: WatchedValue;
  lepPerHalfPart?: WatchedValue;
  socialChargesGeneral?: WatchedValue; // fraction, ex. 0.186
  socialChargesLifeInsurance?: WatchedValue;
  allowanceCap?: WatchedValue;
  allowanceMin?: WatchedValue;
  decoteSingle?: WatchedValue;
  decoteThreshold?: WatchedValue;
  donation75Ceiling?: WatchedValue;
  // Dernière année de revenus où le remboursement transport est exonéré jusqu'à 75 % du prix.
  transportExemptUntil?: WatchedValue;
  taxBrackets?: WatchedValue<TaxBracket[]> & { year?: number };
  // Inflation annuelle moyenne (INSEE, indice des prix à la consommation), en %, et son année.
  inflationAnnual?: WatchedValue & { year?: number };
  inflationYear?: WatchedValue;
}

export interface FiscalProposal {
  key: string;
  label: string;
  current: string;
  proposed: string;
  source?: string;
  /** Applique la proposition (paramètres fiscaux et/ou comptes). */
  apply: (s: { fiscal: FiscalConfig; accounts: SavingsAccount[] }) => { fiscal: FiscalConfig; accounts: SavingsAccount[] };
}

const pct = formatRate;
const eur = plainEUR;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inRange = (w: WatchedValue | undefined, min: number, max: number): w is WatchedValue => !!w && isNum(w.value) && w.value >= min && w.value <= max;
const differs = (a: number | undefined, b: number, tol: number) => a === undefined || Math.abs(a - b) > tol;
const safeSource = (u?: string) => (u && /^https:\/\//.test(u) ? u : undefined);
/**
 * Source officielle : un site de l'État (service-public.gouv.fr, impots.gouv.fr,
 * legifrance.gouv.fr, bofip.impots.gouv.fr, economie.gouv.fr…). Une baisse de plafond légal
 * n'est proposée que sur une telle source : un modèle qui recopie un exemple ou une page
 * périmée ne doit pas faire reculer un plafond relevé par la loi.
 */
export const isOfficialSource = (u?: string): boolean => {
  if (!safeSource(u)) return false;
  try { return /(^|\.)gouv\.fr$/.test(new URL(u as string).hostname); } catch { return false; }
};
/** Source de l'inflation annuelle : l'INSEE (insee.fr) ou un site de l'État. */
const isInflationSource = (u?: string): boolean => {
  if (!safeSource(u)) return false;
  try { return isOfficialSource(u) || /(^|\.)insee\.fr$/.test(new URL(u as string).hostname); } catch { return false; }
};
const effectiveOr = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : localTodayISO());

/** Lit une réponse de Gemini (texte brut, éventuellement entouré de ```json). */
export const parseFiscalWatch = (text: string): FiscalWatchResult | null => {
  const tryParse = (t: string): FiscalWatchResult | null => {
    // Virgules finales et citations « [1] » ajoutées par la recherche : tolérées.
    const cleaned = t.replace(/\[\d+(?:,\s*\d+)*\]/g, '').replace(/,\s*([}\]])/g, '$1');
    try { const v = JSON.parse(cleaned); return v && typeof v === 'object' && !Array.isArray(v) ? v as FiscalWatchResult : null; } catch { return null; }
  };
  // 1. bloc ```json … ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) { const r = tryParse(fenced[1]); if (r) return r; }
  // 2. premier objet { … } équilibré (le texte peut contenir d'autres accolades après)
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return tryParse(text.slice(start, i + 1));
  }
  return null;
};

export const diffFiscalWatch = (r: FiscalWatchResult, fiscal: FiscalConfig, accounts: SavingsAccount[]): FiscalProposal[] => {
  const out: FiscalProposal[] = [];
  // Plafond légal (`ceiling`) : une baisse exige une source officielle (isOfficialSource).
  const lowersWithoutOfficialSource = (w: WatchedValue, current: number | undefined) =>
    current !== undefined && w.value < current && !isOfficialSource(w.source);
  const field = (
    key: keyof FiscalConfig, label: string, w: WatchedValue | undefined, min: number, max: number,
    current: number | undefined, fmt: (n: number) => string, tol: number, ceiling = false,
  ) => {
    if (!inRange(w, min, max) || !differs(current, w.value, tol)) return;
    if (ceiling && lowersWithoutOfficialSource(w, current)) return;
    out.push({
      key, label, current: current === undefined ? '—' : fmt(current), proposed: fmt(w.value), source: safeSource(w.source),
      apply: s => ({ ...s, fiscal: { ...s.fiscal, [key]: w.value } }),
    });
  };
  const ceil = (k: 'livretA' | 'ldds' | 'lep', label: string, w?: WatchedValue) => {
    if (!inRange(w, 1000, 100000) || !differs(fiscal.ceilings[k], w.value, 0.5)) return;
    if (lowersWithoutOfficialSource(w, fiscal.ceilings[k])) return;
    out.push({
      key: `ceiling.${k}`, label, current: eur(fiscal.ceilings[k]), proposed: eur(w.value), source: safeSource(w.source),
      apply: s => ({ ...s, fiscal: { ...s.fiscal, ceilings: { ...s.fiscal.ceilings, [k]: w.value } } }),
    });
  };

  // Taux des livrets réglementés : appliqués à tous les comptes concernés, à la date d'effet.
  const rate = (groupKey: string, w?: WatchedValue) => {
    const group = REGULATED_RATE_GROUPS.find(g => g.key === groupKey);
    if (!group || !inRange(w, 0.1, 10)) return;
    const concerned = accounts.filter(a => group.types.includes(a.type));
    if (concerned.length === 0 || concerned.every(a => Math.abs((a.interestRate || 0) - w.value) < 0.005)) return;
    const effective = effectiveOr(w.effectiveDate);
    out.push({
      key: `rate.${groupKey}`, label: `Taux ${group.label}`,
      current: pct(concerned[0].interestRate || 0), proposed: `${pct(w.value)} au ${effective.split('-').reverse().join('/')}`,
      source: safeSource(w.source),
      apply: s => ({ ...s, accounts: s.accounts.map(a => (group.types.includes(a.type) ? applyRateChange(a, w.value, effective) : a)) }),
    });
  };

  rate('livretA', r.livretARate);
  rate('lep', r.lepRate);
  ceil('livretA', 'Plafond du Livret A', r.livretACeiling);
  ceil('ldds', 'Plafond du LDDS', r.lddsCeiling);
  ceil('lep', 'Plafond du LEP', r.lepCeiling);
  field('lepIncomeCeiling', 'Plafond de revenus LEP (1 part)', r.lepIncomeCeilingOnePart, 15000, 40000, fiscal.lepIncomeCeiling, eur, 0.5, true);
  field('lepCeilingPerHalfPart', 'Plafond LEP : ajout par demi-part', r.lepPerHalfPart, 2000, 15000, fiscal.lepCeilingPerHalfPart, eur, 0.5, true);
  field('socialChargesCapital', 'Prélèvements sociaux (placements)', r.socialChargesGeneral, 0.1, 0.3, fiscal.socialChargesCapital, n => pct(n * 100), 0.0005);
  field('socialChargesLifeInsurance', 'Prélèvements sociaux (assurance vie, PEL, CEL)', r.socialChargesLifeInsurance, 0.1, 0.3, fiscal.socialChargesLifeInsurance, n => pct(n * 100), 0.0005);
  field('standardAllowanceCap', 'Plafond de l\'abattement de 10 %', r.allowanceCap, 10000, 25000, fiscal.standardAllowanceCap, eur, 0.5, true);
  field('standardAllowanceMin', 'Minimum de l\'abattement de 10 %', r.allowanceMin, 300, 1000, fiscal.standardAllowanceMin, eur, 0.5, true);
  // Dons à 75 % : les pages officielles citent encore l'ancien plafond (1 000 € pour les dons
  // d'avant le 14 octobre 2025). Sous le plafond en vigueur, rien n'est proposé sans une date
  // d'effet postérieure à ce relèvement : sinon c'est l'ancienne règle qui a été relevée.
  const donation = r.donation75Ceiling;
  const staleDonationCeiling = !!donation && isNum(donation.value) && donation.value < DONATION_75_CEILING
    && !(donation.effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(donation.effectiveDate) && donation.effectiveDate > DONATION_75_RAISE_DATE);
  if (!staleDonationCeiling) field('donation75Ceiling', 'Plafond des dons à 75 %', donation, 500, 3000, fiscal.donation75Ceiling, eur, 0.5, true);

  // Remboursement transport : seule une prorogation (année plus tardive) est proposée ; la
  // fin d'une mesure temporaire n'a pas besoin de la veille, elle est déjà dans l'app.
  const tr = r.transportExemptUntil;
  const maxYear = new Date().getFullYear() + 5;
  if (inRange(tr, TRANSPORT_TEMPORARY_LAST_YEAR + 1, maxYear) && Number.isInteger(tr.value) && tr.value > transportExemptUntil(fiscal) && isOfficialSource(tr.source)) {
    const v = tr.value;
    out.push({
      key: 'transportExemptUntil', label: 'Remboursement transport exonéré jusqu\'à 75 %',
      current: `revenus ${transportExemptUntil(fiscal)}`, proposed: `revenus ${v}`, source: safeSource(tr.source),
      apply: s => ({ ...s, fiscal: { ...s.fiscal, transportExemptUntil: v } }),
    });
  }

  // Inflation INSEE : une nouvelle année (ou un chiffre révisé) remplace la valeur datée.
  // Année absente de la réponse : la dernière année close (le chiffre paraît mi-janvier).
  // Seule une année CLOSE est acceptée : un chiffre de l'année en cours est un glissement sur
  // un mois, pas la moyenne annuelle ; et seulement lu sur insee.fr ou un site de l'État.
  const inf = r.inflationAnnual;
  if (inRange(inf, -5, 20) && isInflationSource(inf.source)) {
    const thisYear = new Date().getFullYear();
    const rawYear = inf.year ?? r.inflationYear?.value;
    const year = rawYear === undefined ? thisYear - 1
      : typeof rawYear === 'number' && Number.isInteger(rawYear) && rawYear >= 2000 && rawYear <= thisYear - 1 ? rawYear : undefined;
    const cur = inflationOf(fiscal);
    if (year !== undefined && (year > cur.year || (year === cur.year && differs(cur.rate, inf.value, 0.005)))) {
      const figure = { rate: inf.value, year, ...(safeSource(inf.source) ? { source: safeSource(inf.source) } : {}) };
      out.push({
        key: 'inflation', label: 'Inflation annuelle (INSEE)', current: `${pct(cur.rate)} (${cur.year})`, proposed: `${pct(inf.value)} (${year})`,
        source: safeSource(inf.source),
        apply: s => ({ ...s, fiscal: { ...s.fiscal, inflation: figure } }),
      });
    }
  }

  const d = fiscal.decote ?? { single: 0, rate: 0.4525, threshold: 0 };
  if (inRange(r.decoteSingle, 500, 1500) && differs(d.single, r.decoteSingle.value, 0.5)) {
    const v = r.decoteSingle.value;
    out.push({ key: 'decote.single', label: 'Décote (personne seule)', current: eur(d.single), proposed: eur(v), source: safeSource(r.decoteSingle.source),
      apply: s => ({ ...s, fiscal: { ...s.fiscal, decote: { ...d, ...s.fiscal.decote, single: v } } }) });
  }
  if (inRange(r.decoteThreshold, 1000, 3500) && differs(d.threshold, r.decoteThreshold.value, 0.5)) {
    const v = r.decoteThreshold.value;
    out.push({ key: 'decote.threshold', label: 'Seuil de la décote', current: eur(d.threshold), proposed: eur(v), source: safeSource(r.decoteThreshold.source),
      apply: s => ({ ...s, fiscal: { ...s.fiscal, decote: { ...d, ...s.fiscal.decote, threshold: v } } }) });
  }

  // Barème : 5 tranches croissantes, taux entre 0 et 50 %, sinon ignoré.
  const tb = r.taxBrackets;
  if (tb && Array.isArray(tb.value) && tb.value.length >= 4 && tb.value.length <= 7) {
    const brackets = tb.value.map(b => ({ limit: b.limit === null || b.limit === undefined || !isNum(b.limit) ? Infinity : b.limit, rate: b.rate > 1 ? b.rate / 100 : b.rate }));
    const ok = brackets.every((b, i) => isNum(b.rate) && b.rate >= 0 && b.rate <= 0.5 && (i === 0 || b.limit > brackets[i - 1].limit));
    const same = brackets.length === fiscal.taxBrackets.length && brackets.every((b, i) => {
      const cur = fiscal.taxBrackets[i]; const curLimit = cur.limit ?? Infinity;
      return Math.abs(b.rate - cur.rate) < 1e-6 && (b.limit === curLimit || Math.abs(b.limit - curLimit) < 0.5);
    });
    if (ok && !same) {
      const fmtB = (bs: TaxBracket[]) => bs.filter(b => (b.limit ?? Infinity) !== Infinity).map(b => eur(b.limit as number)).join(' / ');
      out.push({
        key: 'taxBrackets', label: `Barème de l'impôt${tb.year ? ` ${tb.year}` : ''}`, current: fmtB(fiscal.taxBrackets), proposed: fmtB(brackets), source: safeSource(tb.source),
        apply: s => ({ ...s, fiscal: { ...s.fiscal, taxBrackets: brackets, taxScaleYear: tb.year ?? s.fiscal.taxScaleYear,
          taxBracketsHistory: [...(s.fiscal.taxBracketsHistory || []), { year: s.fiscal.taxScaleYear, replacedOn: localTodayISO(), brackets: s.fiscal.taxBrackets }] } }),
      });
    }
  }
  return out;
};

const WATCH_INTERVAL_DAYS = 7;
export const isWatchDue = (lastCheckISO: string | undefined, now: Date = new Date()): boolean =>
  !lastCheckISO || now.getTime() - new Date(lastCheckISO).getTime() >= WATCH_INTERVAL_DAYS * 86_400_000;
