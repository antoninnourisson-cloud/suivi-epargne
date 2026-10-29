// Carte « Routine d'octobre : 2/4 » de l'Accueil : les étapes de la paie, chacune déduite des
// données (lib/monthRoutine), avec un bouton qui mène à l'écran existant. Une fois tout fait,
// la carte se replie en une ligne, jusqu'à la paie suivante.
import React from 'react';
import { CheckCircle2, Circle, ListChecks } from 'lucide-react';
import type { MonthRoutine, RoutineStepKey } from '../../lib/monthRoutine';
import { elideDe } from '../../lib/format';
import { Button, Card, ListItem } from '../ui';

interface MonthRoutineCardProps {
  routine: MonthRoutine;
  onOpen: (step: RoutineStepKey) => void;
}

export const MonthRoutineCard: React.FC<MonthRoutineCardProps> = ({ routine, onOpen }) => {
  const title = `Routine ${elideDe(routine.monthName)}`;
  if (routine.complete) {
    return (
      <Card padding="sm" aria-label={`${title} faite`}>
        <p className="flex items-center gap-2 text-sm text-on-surface">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-primary" aria-hidden="true" />
          <span><span className="font-medium">{title} faite</span><span className="text-on-surface-variant"> · tout est à jour pour cette paie.</span></span>
        </p>
      </Card>
    );
  }
  return (
    <Card title={`${title} : ${routine.doneCount}/${routine.steps.length}`} icon={ListChecks}>
      <ol className="-my-3 divide-y divide-outline-variant">
        {routine.steps.map(step => (
          <ListItem
            key={step.key}
            leading={step.done
              ? <CheckCircle2 className="w-5 h-5 text-primary" aria-hidden="true" />
              : <Circle className="w-5 h-5 text-outline" aria-hidden="true" />}
            headline={<>{step.label}<span className="sr-only">{step.done ? ' : fait' : ' : à faire'}</span></>}
            supporting={step.detail}
            trailing={!step.done && (
              <Button variant="text" onClick={() => onOpen(step.key)} aria-label={`${step.action} : ${step.label}`}>{step.action}</Button>
            )}
          />
        ))}
      </ol>
    </Card>
  );
};
