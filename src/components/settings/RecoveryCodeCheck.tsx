// Avant d'activer la sauvegarde de secours chiffrée : l'utilisateur recopie deux groupes du
// code (sans l'avoir sous les yeux), pour prouver qu'il l'a vraiment noté. Sinon, toutes les
// copies seraient illisibles pour toujours, et il ne le découvrirait que le jour du besoin.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, TextField } from '../ui';
import { Notice } from './SettingsCard';
import { checkGroups, pickCheckGroups, recoveryCodeFileText } from '../../lib/recoveryCodeCheck';
import { downloadBlob } from '../../services/fileDownload';

/** Propose le code en fichier texte (à ranger hors de l'appareil). */
const downloadRecoveryCode = (code: string, now = new Date()): void =>
  downloadBlob('pecule-code-de-secours.txt', new Blob([recoveryCodeFileText(code, now)], { type: 'text/plain;charset=utf-8' }));

/** Bouton « Télécharger (fichier texte) » de l'écran du code. */
export const DownloadCodeButton: React.FC<{ code: string }> = ({ code }) => (
  <Button variant="outlined" onClick={() => downloadRecoveryCode(code)}>
    <Download className="w-4 h-4" aria-hidden="true" /> Télécharger (fichier texte)
  </Button>
);

export const RecoveryCodeCheck: React.FC<{
  code: string;
  busy: boolean;
  /** Groupes recopiés justes : active la sauvegarde. */
  onConfirmed: () => void;
  /** Revenir à l'écran du code (pas encore activé : il peut être réaffiché). */
  onShowAgain: () => void;
  onCancel: () => void;
}> = ({ code, busy, onConfirmed, onShowAgain, onCancel }) => {
  const groups = useMemo(() => pickCheckGroups(), []);
  const [inputs, setInputs] = useState<[string, string]>(['', '']);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (checkGroups(code, groups, inputs)) { setError(null); onConfirmed(); return; }
    setError('Ce n\'est pas ce qui était affiché. Vérifiez votre note, ou revenez au code pour le recopier.');
  };
  const setInput = (i: 0 | 1, v: string) => setInputs(prev => (i === 0 ? [v, prev[1]] : [prev[0], v]));

  return (
    <Notice tone="warning" className="mt-3 p-4!">
      <form onSubmit={submit} aria-labelledby="recovery-check-title">
        <p id="recovery-check-title" ref={titleRef} tabIndex={-1} className="text-sm font-medium outline-none">Vérifions que le code est bien noté</p>
        <p className="mt-2">
          Recopiez les groupes n° {groups[0]} et n° {groups[1]} de votre code (4 caractères chacun), en lisant votre note :
          il n'est plus affiché.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {([0, 1] as const).map(i => (
            <TextField key={groups[i]} label={`Groupe n° ${groups[i]}`} value={inputs[i]} maxLength={6}
              onChange={e => setInput(i, e.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="characters"
              className="font-code" />
          ))}
        </div>
        <p role="alert" className="mt-2 min-h-4 text-xs font-medium text-error">{error}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || inputs.some(v => !v.trim())} isLoading={busy}>Vérifier et activer</Button>
          <Button type="button" variant="outlined" onClick={onShowAgain} disabled={busy}>Revoir le code</Button>
          <Button type="button" variant="text" onClick={onCancel} disabled={busy}>Annuler</Button>
        </div>
      </form>
    </Notice>
  );
};
