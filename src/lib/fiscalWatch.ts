// ================================================
// FILE: src/lib/fiscalWatch.ts
// Veille fiscale : compare les valeurs officielles trouvées par Gemini (recherche web) avec
// les paramètres de l'app, et produit des PROPOSITIONS. Rien n'est appliqué sans un clic de
// l'utilisateur. Les valeurs hors des bornes plausibles sont écartées (une IA peut se
// tromper ou inventer) et chaque proposition garde sa source pour vérification.
// ================================================
import { FiscalConfig, SavingsAccount, TaxBracket } from '../types';
import { REGULATED_RATE_GROUPS, applyRateChange } from './finance';
import { localTodayISO } from './dates';

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
  taxBrackets?: WatchedValue<TaxBracket[]> & { year?: number };
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

const pct = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inRange = (w: WatchedValue | undefined, min: number, max: number): w is WatchedValue => !!w && isNum(w.value) && w.value >= min && w.value <= max;
const differs = (a: number | undefined, b: number, tol: number) => a === undefined || Math.abs(a - b) > tol;
const safeSource = (u?: string) => (u && /^https:\/\//.test(u) ? u : undefined);
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
  const field = (
    key: keyof FiscalConfig, label: string, w: WatchedValue | undefined, min: number, max: number,
    current: number | undefined, fmt: (n: number) => string, tol: number,
  ) => {
    if (!inRange(w, min, max) || !differs(current, w.value, tol)) return;
    out.push({
      key, label, current: current === undefined ? '—' : fmt(current), proposed: fmt(w.value), source: safeSource(w.source),
      apply: s => ({ ...s, fiscal: { ...s.fiscal, [key]: w.value } }),
    });
  };
  const ceil = (k: 'livretA' | 'ldds' | 'lep', label: string, w?: WatchedValue) => {
    if (!inRange(w, 1000, 100000) || !differs(fiscal.ceilings[k], w.value, 0.5)) return;
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
  field('lepIncomeCeiling', 'Plafond de revenus LEP (1 part)', r.lepIncomeCeilingOnePart, 15000, 40000, fiscal.lepIncomeCeiling, eur, 0.5);
  field('lepCeilingPerHalfPart', 'Plafond LEP : ajout par demi-part', r.lepPerHalfPart, 2000, 15000, fiscal.lepCeilingPerHalfPart, eur, 0.5);
  field('socialChargesCapital', 'Prélèvements sociaux (placements)', r.socialChargesGeneral, 0.1, 0.3, fiscal.socialChargesCapital, n => pct(n * 100), 0.0005);
  field('socialChargesLifeInsurance', 'Prélèvements sociaux (assurance vie)', r.socialChargesLifeInsurance, 0.1, 0.3, fiscal.socialChargesLifeInsurance, n => pct(n * 100), 0.0005);
  field('standardAllowanceCap', 'Plafond de l\'abattement de 10 %', r.allowanceCap, 10000, 25000, fiscal.standardAllowanceCap, eur, 0.5);
  field('standardAllowanceMin', 'Minimum de l\'abattement de 10 %', r.allowanceMin, 300, 1000, fiscal.standardAllowanceMin, eur, 0.5);
  field('donation75Ceiling', 'Plafond des dons à 75 %', r.donation75Ceiling, 500, 3000, fiscal.donation75Ceiling, eur, 0.5);

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

export const WATCH_INTERVAL_DAYS = 7;
export const isWatchDue = (lastCheckISO: string | undefined, now: Date = new Date()): boolean =>
  !lastCheckISO || now.getTime() - new Date(lastCheckISO).getTime() >= WATCH_INTERVAL_DAYS * 86_400_000;

// Utilisé par le service pour construire la question posée à Gemini.
export const FISCAL_WATCH_PROMPT = `Tu es un assistant de veille fiscale française. Utilise la recherche Google pour trouver les valeurs OFFICIELLES EN VIGUEUR AUJOURD'HUI (privilégie service-public.fr, impots.gouv.fr, economie.gouv.fr, legifrance.gouv.fr, banque-france.fr). Réponds UNIQUEMENT par un objet JSON, sans texte autour, de cette forme (omets un champ si tu n'es pas sûr ; chaque valeur a la source https exacte où tu l'as lue) :
{
  "livretARate": {"value": 1.7, "effectiveDate": "AAAA-MM-JJ", "source": "https://..."},
  "lepRate": {"value": 2.5, "effectiveDate": "AAAA-MM-JJ", "source": "..."},
  "livretACeiling": {"value": 22950, "source": "..."},
  "lddsCeiling": {"value": 12000, "source": "..."},
  "lepCeiling": {"value": 10000, "source": "..."},
  "lepIncomeCeilingOnePart": {"value": 23028, "source": "..."},
  "lepPerHalfPart": {"value": 6149, "source": "..."},
  "socialChargesGeneral": {"value": 0.186, "source": "..."},
  "socialChargesLifeInsurance": {"value": 0.172, "source": "..."},
  "allowanceCap": {"value": 14555, "source": "..."},
  "allowanceMin": {"value": 509, "source": "..."},
  "decoteSingle": {"value": 897, "source": "..."},
  "decoteThreshold": {"value": 1982, "source": "..."},
  "donation75Ceiling": {"value": 1000, "source": "..."},
  "taxBrackets": {"year": 2026, "value": [{"limit": 11600, "rate": 0}, {"limit": 29579, "rate": 0.11}, {"limit": 84577, "rate": 0.30}, {"limit": 181917, "rate": 0.41}, {"limit": null, "rate": 0.45}], "source": "..."}
}
Les exemples ci-dessus ne sont que des formats : vérifie chaque valeur. Taux des livrets en % annuel ; prélèvements sociaux en fraction (0,186 = 18,6 %) ; "taxBrackets" = le barème le plus récent publié pour l'impôt sur le revenu (une part), "year" = année de publication du barème, "limit" = borne haute de la tranche (null pour la dernière). Les montants de plafond de revenus LEP sont ceux applicables pour une ouverture aujourd'hui.`;

