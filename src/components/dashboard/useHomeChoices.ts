// Choix faits sur l'Accueil et gardés sur cet appareil (registre lib/storageKeys) : échéance
// passée ce mois-ci, révision des taux écartée, déclaration faite, section « Plus de détails »
// ouverte. Le « Taux inchangé » de l'assurance vie, lui, est noté sur le compte (fichier).
import { useCallback, useMemo, useState } from 'react';
import { lsGet, lsSet } from '../../lib/storage';
import { MARK, readMarks, setMark, skippedRecurringIds, storageKey } from '../../lib/storageKeys';

const RATE_KEY = storageKey('dismissedRateRevision');
const TAX_RETURN_KEY = storageKey('taxReturnFiled');
const MORE_KEY = storageKey('homeMoreOpen');

/** `today` : AAAA-MM-JJ local. */
export const useHomeChoices = (today: string) => {
  const month = today.slice(0, 7);
  const [marks, setMarks] = useState(readMarks);
  const mark = useCallback((id: string) => { setMark(id, today); setMarks(readMarks()); }, [today]);

  const skippedRecurring = useMemo(() => skippedRecurringIds(marks, month), [marks, month]);

  const [dismissedRateRevision, setDismissedRateRevision] = useState(() => lsGet(RATE_KEY));
  const [taxReturnFiled, setTaxReturnFiled] = useState(() => lsGet(TAX_RETURN_KEY));
  const [moreOpen, setMoreOpen] = useState(() => lsGet(MORE_KEY) === '1');

  return {
    skippedRecurring,
    skipRecurring: (recurringId: string) => mark(MARK.skippedRecurring(month, recurringId)),
    dismissedRateRevision,
    dismissRateRevision: (key: string) => { lsSet(RATE_KEY, key); setDismissedRateRevision(key); },
    taxReturnFiled,
    markTaxReturnFiled: (incomeYear: number) => { lsSet(TAX_RETURN_KEY, String(incomeYear)); setTaxReturnFiled(String(incomeYear)); },
    moreOpen,
    toggleMore: () => setMoreOpen(open => { lsSet(MORE_KEY, open ? '0' : '1'); return !open; }),
  };
};
