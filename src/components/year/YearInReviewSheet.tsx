// Feuille « Votre année » : les pages du récapitulatif annuel, à lire de haut en bas (une
// carte par page : un grand chiffre, une phrase). C'est du contenu, pas un diaporama : rien
// ne défile tout seul, tout est lisible au clavier et par les lecteurs d'écran.
import React, { useId } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { YearInReview, YearPage } from '../../lib/yearReview';
import { Modal } from '../Modal';
import { Button } from '../ui';

interface YearInReviewSheetProps {
  open: boolean;
  onClose: () => void;
  story: YearInReview;
}

const PageCard: React.FC<{ page: YearPage; index: number; total: number; first: boolean }> = ({ page, index, total, first }) => {
  const id = useId();
  return (
    <li>
      <article
        aria-labelledby={id}
        data-page={page.id}
        className={`rounded-2xl p-5 ${first ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-lowest dark:bg-surface-container-low border border-outline-variant text-on-surface'}`}
      >
        <h3 id={id} className={`text-sm font-medium ${first ? '' : 'text-on-surface-variant'}`}>
          <span className="sr-only">{`Page ${index + 1} sur ${total} : `}</span>{page.label}
        </h3>
        <p className={`mt-1 ${first ? 'text-[44px] leading-[52px]' : 'text-[32px] leading-10'} font-normal tracking-tight tabular-nums`}>{page.value}</p>
        <p className={`mt-2 text-sm ${first ? '' : 'text-on-surface-variant'}`}>{page.text}</p>
        {page.items && page.items.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {page.items.map(t => (
              <li key={t} className="px-3 py-1 rounded-lg bg-secondary-container text-on-secondary-container text-xs font-medium">{t}</li>
            ))}
          </ul>
        )}
      </article>
    </li>
  );
};

export const YearInReviewSheet: React.FC<YearInReviewSheetProps> = ({ open, onClose, story }) => {
  const title = `Votre année ${story.year}`;
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return (
    <Modal open={open} onClose={onClose} label={title} variant="sheet" className="max-w-lg p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] leading-7 font-normal text-on-surface flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-300" aria-hidden="true" /> {title}
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            {story.complete ? `L'année ${story.year} en quelques chiffres.` : `Année en cours : chiffres arrêtés au ${today}.`}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer" className="w-11 h-11 -m-3 shrink-0 inline-flex items-center justify-center rounded-full text-on-surface-variant hover:bg-on-surface/8">
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {story.empty ? (
        <p className="mt-5 text-sm text-on-surface-variant">Pas encore de mouvement d'épargne enregistré pour {story.year} : votre année se racontera au fil des mois.</p>
      ) : (
        <ol aria-label={`${title}, ${story.pages.length} pages`} className="mt-5 space-y-3">
          {story.pages.map((p, i) => <PageCard key={p.id} page={p} index={i} total={story.pages.length} first={i === 0} />)}
        </ol>
      )}

      {story.note && <p className="mt-4 text-xs text-on-surface-variant">{story.note}</p>}
      {!story.empty && (
        <p className="mt-4 text-xs text-on-surface-variant">
          « Mis de côté » = versements moins retraits sur vos comptes d'épargne, hors variations de valeur.
          {!story.gamification && ' Bons mois et jalons sont désactivés dans les paramètres.'}
        </p>
      )}
      <div className="mt-5 flex justify-end">
        <Button variant="tonal" onClick={onClose}>Fermer</Button>
      </div>
    </Modal>
  );
};
