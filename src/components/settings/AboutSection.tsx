// « À propos » : version, liens (confidentialité, licence, code source, wiki, contact) et
// historique complet des mises à jour.
import React, { useState } from 'react';
import { ExternalLink, Mail } from 'lucide-react';
import { CHANGELOG, LATEST_VERSION } from '../../changelog';
import { parseISODate } from '../../lib/dates';
import { Button } from '../ui';
import { CardSubheading } from './SettingsCard';

const REPO = 'https://github.com/antoninnourisson-cloud/suivi-epargne';
const SHOWN_FIRST = 3;

const LINKS: { label: string; href: string; external?: boolean }[] = [
  { label: 'Présentation de Pécule', href: 'presentation.html' },
  { label: 'Confidentialité', href: 'confidentialite.html' },
  { label: 'Aide (wiki)', href: `${REPO}/wiki`, external: true },
  { label: 'Code source', href: REPO, external: true },
  { label: 'Licence AGPL-3.0', href: `${REPO}/blob/main/LICENSE`, external: true },
];

const buildSha = typeof __BUILD_SHA__ !== 'undefined' && __BUILD_SHA__ !== 'dev' ? __BUILD_SHA__ : null;

export const AboutSection: React.FC = () => {
  const [all, setAll] = useState(false);
  const entries = all ? CHANGELOG : CHANGELOG.slice(0, SHOWN_FIRST);
  return (
    <div className="space-y-5">
      <p className="text-sm text-on-surface">
        Pécule, version <span className="font-medium tabular-nums">{LATEST_VERSION}</span>
        {buildSha && <span className="text-on-surface-variant"> ({buildSha})</span>}
      </p>

      <ul className="flex flex-wrap gap-2" aria-label="Liens utiles">
        {LINKS.map(l => (
          <li key={l.href}>
            <a href={l.href} {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-sm border border-outline text-sm font-medium text-on-surface-variant hover:bg-on-surface/8">
              {l.label}{l.external && <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />}
            </a>
          </li>
        ))}
        <li>
          <a href="mailto:contact@pecule-app.com"
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-sm border border-outline text-sm font-medium text-on-surface-variant hover:bg-on-surface/8">
            <Mail className="w-3.5 h-3.5" aria-hidden="true" /> contact@pecule-app.com
          </a>
        </li>
      </ul>

      <div className="pt-5 border-t border-outline-variant">
        <CardSubheading>Historique des mises à jour</CardSubheading>
        <ol className="mt-3 space-y-5">
          {entries.map(e => (
            <li key={e.version}>
              <p className="text-sm font-medium text-on-surface">{e.title}</p>
              <p className="text-xs text-on-surface-variant mb-1">
                {parseISODate(e.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} · version {e.version}
              </p>
              <ul className="list-disc pl-5 space-y-1 text-sm text-on-surface-variant">
                {e.items.map((it, i) => <li key={i}>{it}</li>)}
              </ul>
            </li>
          ))}
        </ol>
        {CHANGELOG.length > SHOWN_FIRST && (
          <Button variant="text" className="mt-3 -ml-3" aria-expanded={all} onClick={() => setAll(a => !a)}>
            {all ? 'Afficher seulement les dernières' : `Afficher tout l'historique (${CHANGELOG.length} mises à jour)`}
          </Button>
        )}
      </div>
    </div>
  );
};
