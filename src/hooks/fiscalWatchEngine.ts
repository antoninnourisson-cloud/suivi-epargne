// Moteur de la veille fiscale (lecture d'une réponse, comparaison aux paramètres de l'app,
// détail du relevé du serveur), chargé à part par useFiscalWatch (import()) : une trentaine de
// kB qui n'ont rien à faire dans le fichier chargé au démarrage (plafond de 500 kB, voir
// scripts/check-bundle-size.mjs). Il n'est demandé qu'une fois l'app prête.
import type { FiscalConfig, SavingsAccount, TaxBracket } from '../types';
import { diffFiscalWatch, type FiscalWatchResult } from '../lib/fiscalWatch';
import type { ServerFiscalWatch } from '../services/backendService';
import { formatRate, plainEUR } from '../lib/format';

export { diffFiscalWatch, isWatchDue, parseFiscalWatch } from '../lib/fiscalWatch';

// ---------- Détail du relevé du serveur (contrôle de qualité visible dans l'app) ----------

const pct = formatRate;
const eur = plainEUR;
const brackets = (v: unknown) => (Array.isArray(v) ? (v as TaxBracket[]).map(b => `${b.limit === null || b.limit === undefined ? '…' : eur(b.limit as number)} : ${pct(b.rate * 100)}`).join(' · ') : '?');

/** Champ du relevé → libellé, mise en forme et clé de la proposition correspondante (diffFiscalWatch). */
const FIELDS: Record<string, { label: string; fmt: (v: unknown) => string; proposal: string }> = {
  livretARate: { label: 'Taux du Livret A', fmt: v => pct(v as number), proposal: 'rate.livretA' },
  lepRate: { label: 'Taux du LEP', fmt: v => pct(v as number), proposal: 'rate.lep' },
  livretACeiling: { label: 'Plafond du Livret A', fmt: v => eur(v as number), proposal: 'ceiling.livretA' },
  lddsCeiling: { label: 'Plafond du LDDS', fmt: v => eur(v as number), proposal: 'ceiling.ldds' },
  lepCeiling: { label: 'Plafond du LEP', fmt: v => eur(v as number), proposal: 'ceiling.lep' },
  lepIncomeCeilingOnePart: { label: 'Plafond de revenus LEP (1 part)', fmt: v => eur(v as number), proposal: 'lepIncomeCeiling' },
  lepPerHalfPart: { label: 'Plafond LEP : ajout par demi-part', fmt: v => eur(v as number), proposal: 'lepCeilingPerHalfPart' },
  socialChargesGeneral: { label: 'Prélèvements sociaux (placements)', fmt: v => pct((v as number) * 100), proposal: 'socialChargesCapital' },
  socialChargesLifeInsurance: { label: 'Prélèvements sociaux (assurance vie, PEL, CEL)', fmt: v => pct((v as number) * 100), proposal: 'socialChargesLifeInsurance' },
  allowanceCap: { label: "Plafond de l'abattement de 10 %", fmt: v => eur(v as number), proposal: 'standardAllowanceCap' },
  allowanceMin: { label: "Minimum de l'abattement de 10 %", fmt: v => eur(v as number), proposal: 'standardAllowanceMin' },
  decoteSingle: { label: 'Décote (personne seule)', fmt: v => eur(v as number), proposal: 'decote.single' },
  decoteThreshold: { label: 'Seuil de la décote', fmt: v => eur(v as number), proposal: 'decote.threshold' },
  donation75Ceiling: { label: 'Plafond des dons à 75 %', fmt: v => eur(v as number), proposal: 'donation75Ceiling' },
  transportExemptUntil: { label: 'Remboursement transport exonéré jusqu\'à 75 %', fmt: v => `revenus ${String(v)}`, proposal: 'transportExemptUntil' },
  taxBrackets: { label: "Barème de l'impôt", fmt: brackets, proposal: 'taxBrackets' },
  inflationAnnual: { label: 'Inflation annuelle (INSEE)', fmt: v => pct(v as number), proposal: 'inflation' },
  inflationYear: { label: "Année de l'inflation (INSEE)", fmt: v => String(v), proposal: 'inflation' },
};

const STATUS_LABEL: Record<string, string> = {
  fetch_failed: 'page injoignable', invalid_json: 'réponse illisible', ai_error: "erreur de l'IA", skipped_budget: 'sautée (budget)', no_fields: 'rien à relever',
};

export interface ServerWatchRow { key: string; label: string; value: string; sameAsApp: boolean; quote?: string; source?: string }
export interface ServerWatchReport { rows: ServerWatchRow[]; issues: string[]; model: string; neurons?: number; checkedAt: string }

/** Chaque valeur relevée par le serveur, comparée aux paramètres de l'app, et les pages en défaut. */
export const describeServerWatch = (s: ServerFiscalWatch, fiscal: FiscalConfig, accounts: SavingsAccount[]): ServerWatchReport => {
  const differing = new Set(diffFiscalWatch(s.values as FiscalWatchResult, fiscal, accounts).map(p => p.key));
  const rows: ServerWatchRow[] = [];
  for (const [key, meta] of Object.entries(FIELDS)) {
    const w = (s.values as Record<string, { value?: unknown; quote?: string; source?: string } | undefined>)[key];
    if (!w || w.value === undefined) continue;
    rows.push({ key, label: meta.label, value: meta.fmt(w.value), sameAsApp: !differing.has(meta.proposal), quote: w.quote, source: w.source });
  }
  const issues: string[] = [];
  for (const src of s.sources || []) {
    if (src.status !== 'ok' && src.status !== 'no_fields') issues.push(`${src.topic} : ${STATUS_LABEL[src.status] || src.status}`);
    for (const r of src.rejected || []) issues.push(`${FIELDS[r.field]?.label || r.field} écarté : ${r.reason}`);
  }
  return { rows, issues, model: s.model, neurons: s.neuronsUsed ?? s.neuronsEstimate, checkedAt: s.checkedAt };
};
