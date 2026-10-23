// Versions mises de côté (Paramètres, Sauvegardes) : ce qui a été remplacé par un choix
// entre deux versions, une restauration ou un import, gardé 30 jours sur cet appareil.
import React, { useCallback, useEffect, useState } from 'react';
import { Download, History, Loader2 } from 'lucide-react';
import { Button } from '../ui';
import { CardSubheading, Hint } from '../settings/SettingsCard';
import { summarizeVersion } from '../../lib/versionDiff';
import { formatEUR } from '../../lib/format';
import { downloadJSON } from '../../services/fileDownload';
import { useToast } from '../Toast';
import type { SetAsideVersion } from '../../services/setAsideVersions';

const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export const SetAsideVersionsPanel: React.FC<{
  list: () => Promise<SetAsideVersion[]>;
  recover: (id: string) => Promise<boolean>;
  confirm: (title: string, message: string, onOk: () => void | Promise<void>, danger?: boolean, confirmLabel?: string) => void;
}> = ({ list, recover, confirm }) => {
  const toast = useToast();
  const [items, setItems] = useState<SetAsideVersion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => { list().then(setItems).catch(() => setItems([])); }, [list]);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="pt-5 mt-5 border-t border-outline-variant">
      <CardSubheading icon={History}>Versions mises de côté</CardSubheading>
      <Hint className="mt-1">Quand vous choisissez entre deux versions, revenez à une copie ou importez un fichier, les données remplacées sont gardées ici 30 jours, sur cet appareil seulement. La déconnexion les efface.</Hint>
      {items === null ? <Loader2 className="w-4 h-4 animate-spin mt-3 text-on-surface-variant" aria-label="Chargement" />
        : items.length === 0 ? <p className="text-sm text-on-surface-variant mt-3">Aucune version mise de côté.</p>
        : (
          <ul className="mt-3 space-y-2">
            {items.map(e => {
              const s = summarizeVersion(e.data);
              return (
                <li key={e.id} className="rounded-xl bg-surface-container p-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                  <div className="min-w-0">
                    <p className="text-sm text-on-surface font-medium">{e.label}</p>
                    <p className="text-xs text-on-surface-variant">
                      Mise de côté le {when(e.setAsideAt)} · épargne {formatEUR(s.totalSavings)} · {s.accountCount} compte{s.accountCount > 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="text" size="sm" onClick={() => downloadJSON(`pecule-version-${e.setAsideAt.slice(0, 10)}.json`, e.data)}
                      aria-label={`Exporter : ${e.label}`}>
                      <Download className="w-4 h-4" aria-hidden="true" /> Exporter
                    </Button>
                    <Button variant="outlined" size="sm" disabled={busy}
                      onClick={() => confirm(
                        'Récupérer cette version ?',
                        'Vos données actuelles seront remplacées par cette version, puis enregistrées sur Drive. Elles sont d\'abord mises de côté à leur tour : vous pourrez y revenir ici.',
                        async () => {
                          setBusy(true);
                          try {
                            const ok = await recover(e.id);
                            toast?.({ message: ok ? 'Version récupérée' : 'Version illisible ou données actuelles impossibles à mettre de côté : rien n\'a été remplacé.', kind: ok ? 'success' : 'error' });
                          } finally { setBusy(false); refresh(); }
                        },
                        true, 'Récupérer cette version',
                      )}>
                      Récupérer
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
};
