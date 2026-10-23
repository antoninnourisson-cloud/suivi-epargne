// Hausse de salaire repérée sur les fiches de paie : proposée une seule fois par fiche sur
// l'Accueil (« Épargner la différence »).
import { useCallback, useMemo, useState } from 'react';
import { detectPayRaise } from '../lib/projection';
import { formatEUR } from '../lib/format';
import type { AppDoc } from '../types';
import type { PortfolioData } from '../hooks/usePortfolioData';
import type { AddToast } from './UiProviders';
import { hasMark, MARK, setMark } from '../lib/storageKeys';
import { localTodayISO } from '../lib/dates';

export const usePayRaise = (doc: AppDoc, setters: Pick<PortfolioData, 'patchConfig' | 'setActivePayslipId'>, addToast: AddToast) => {
  const payRaise = useMemo(() => {
    const r = detectPayRaise(doc.payslips);
    if (!r) return null;
    if (hasMark(MARK.payRaiseSeen(r.latest.id))) return null;
    return r;
  }, [doc.payslips]);
  const [handled, setHandled] = useState(false);
  const { patchConfig, setActivePayslipId } = setters;
  const { paydayAmount } = doc.config;
  const { activePayslipId } = doc;

  const dismiss = useCallback(() => {
    if (payRaise) setMark(MARK.payRaiseSeen(payRaise.latest.id), localTodayISO());
    setHandled(true);
  }, [payRaise]);
  const accept = useCallback(() => {
    if (!payRaise) return;
    const delta = Math.round(payRaise.delta);
    if (paydayAmount !== undefined) patchConfig({ paydayAmount: Math.round(paydayAmount + delta) });
    if (activePayslipId !== payRaise.latest.id) setActivePayslipId(payRaise.latest.id);
    addToast({ message: paydayAmount !== undefined ? `Épargne mensuelle portée à ${formatEUR(Math.round(paydayAmount + delta))}` : 'Pilotage basé sur votre nouvelle fiche de paie', kind: 'success' });
    dismiss();
  }, [payRaise, paydayAmount, activePayslipId, patchConfig, setActivePayslipId, addToast, dismiss]);

  // Ce que la carte de l'Accueil affiche (null : rien à proposer).
  const shown = useMemo(
    () => (payRaise && !handled ? { delta: payRaise.delta, period: payRaise.latest.extracted.period || '', hasFixedAmount: paydayAmount !== undefined } : null),
    [payRaise, handled, paydayAmount],
  );
  return { payRaise: shown, accept, dismiss };
};
