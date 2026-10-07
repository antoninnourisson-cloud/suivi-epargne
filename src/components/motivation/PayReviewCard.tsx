// Carte « Point de paie » : le bilan de la dernière paie terminée, proposé une fois jusqu'à
// ce que l'utilisateur le valide.
import React from 'react';
import { Check, ClipboardCheck, Minus, ShieldCheck } from 'lucide-react';
import type { PayReview } from '../../lib/motivation';
import { formatEUR, formatPeriod } from '../../lib/format';
import { Button, Card, MoneyText } from '../ui';

interface PayReviewCardProps {
  review: PayReview;
  onValidate: () => void;
  onAction?: (view: NonNullable<PayReview['action']>['view']) => void;
}

export const PayReviewCard: React.FC<PayReviewCardProps> = ({ review, onValidate, onAction }) => {
  const status = review.good
    ? { label: 'Bon mois', icon: Check, cls: 'bg-secondary-container text-on-secondary-container' }
    : review.joker
      ? { label: 'Couvert par le joker : la série continue', icon: ShieldCheck, cls: 'bg-tertiary-container text-on-tertiary-container' }
      : { label: 'Sous le seuil ce mois-ci', icon: Minus, cls: 'border border-outline text-on-surface-variant' };
  const StatusIcon = status.icon;
  const stats: { label: string; value: number; signed?: boolean }[] = [
    { label: 'Versements', value: review.deposits },
    { label: 'Retraits', value: -review.withdrawals, signed: true },
    { label: 'Valorisation', value: review.valuation, signed: true },
  ];

  return (
    <Card variant="elevated" title={`Point de paie : ${formatPeriod(review.key)}`} icon={ClipboardCheck}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm text-on-surface-variant">
          <span className="text-[28px] leading-9 font-normal text-on-surface tabular-nums">{formatEUR(review.saved, 0)}</span>
          {' '}mis de côté · seuil <span className="tabular-nums">{formatEUR(review.threshold, 0)}</span>
          {review.plan !== undefined && <> · objectif <span className="tabular-nums">{formatEUR(review.plan, 0)}</span></>}
        </p>
        <span className={`h-8 px-3 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium ${status.cls}`}>
          <StatusIcon className="w-4 h-4" aria-hidden="true" /> {status.label}
        </span>
      </div>

      <p className="mt-3 text-sm text-on-surface">{review.insight}</p>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        {stats.map(s => (
          <div key={s.label} className="p-3 rounded-xl bg-surface-container min-w-0">
            <dt className="text-xs text-on-surface-variant">{s.label}</dt>
            <dd className="mt-0.5 text-sm font-medium text-on-surface">
              <MoneyText value={s.value} signed={s.signed} decimals={0} tone={s.signed ? 'auto' : 'neutral'} />
            </dd>
          </div>
        ))}
      </dl>

      {review.byAccount.length > 0 && (
        <ul aria-label="Par compte" className="mt-4 divide-y divide-outline-variant">
          {review.byAccount.map(a => (
            <li key={a.accountId} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate text-on-surface">{a.name}</span>
              <MoneyText value={a.net} signed decimals={0} tone="auto" className="font-medium" />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {review.action && onAction && <Button variant="text" onClick={() => onAction(review.action!.view)}>{review.action.label}</Button>}
        <Button variant="tonal" onClick={onValidate}>Valider</Button>
      </div>
    </Card>
  );
};
