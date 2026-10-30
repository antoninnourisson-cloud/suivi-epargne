// « Demander à Pécule » : questions en français sur ses propres données, réponses de Google
// Gemini (clé de l'utilisateur). Lecture seule. La conversation ne vit que dans cette fenêtre :
// jamais enregistrée (ni Drive, ni appareil, ni serveur), effacée à la fermeture et à la
// déconnexion (la fenêtre est alors retirée). Le verrou la recouvre sans l'effacer.
import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, MessageCircleQuestion, Send, Sparkles, X } from 'lucide-react';
import type { GlobalAppData } from '../../types';
import type { SalaryTaxEstimate } from '../../lib/finance';
import { buildAskSnapshot } from '../../lib/askSnapshot';
import { askDateLabel, askPecule, describeAskError, ASK_QUESTION_MAX, type ChatTurn } from '../../services/askPecule';
import { Modal } from '../Modal';
import { Button, Chip, IconButton, fieldClass } from '../ui';

export const ASK_SUGGESTIONS = [
  'Combien ai-je épargné ce trimestre ?',
  'Quel compte me rapporte le plus ?',
  'Où en est mon Livret A par rapport au plafond ?',
  "Combien d'intérêts cette année ?",
  'Quels prélèvements arrivent dans les 30 prochains jours ?',
  'Combien me coûtent mes abonnements par an ?',
];

export interface AskPeculeProps {
  data: GlobalAppData;
  geminiApiKey: string;
  taxEstimate?: SalaryTaxEstimate;
  monthPlan?: number;
  onClose: () => void;
  /** Ouvre Paramètres à la rubrique demandée (« Clés et services » quand la clé manque). */
  onOpenSettings: (section: 'keys') => void;
}

export const AskPecule: React.FC<AskPeculeProps> = ({ data, geminiApiKey, taxEstimate, monthPlan, onClose, onOpenSettings }) => {
  // Résumé figé à l'ouverture : toute la conversation porte sur la même photographie.
  const [snapshot] = useState(() => (geminiApiKey ? buildAskSnapshot(data, new Date(), { taxEstimate, monthPlan }) : null));
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; question: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Réponse arrivée après la fermeture : ignorée.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [turns, pending, error]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || pending || !snapshot) return;
    setPending(true);
    setError(null);
    setQuestion('');
    const history = turns;
    setTurns([...history, { role: 'user', text: q }]);
    try {
      const answer = await askPecule(geminiApiKey, snapshot, history, q);
      if (alive.current) setTurns([...history, { role: 'user', text: q }, { role: 'model', text: answer }]);
    } catch (e) {
      if (!alive.current) return;
      console.error('Demander à Pécule : échec', e);
      // La question sans réponse est retirée : elle reste proposée pour réessayer.
      setTurns(history);
      setError({ message: describeAskError(e), question: q });
      setQuestion(q);
    } finally {
      if (alive.current) setPending(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => { e.preventDefault(); void ask(question); };

  return (
    <Modal open onClose={onClose} label="Demander à Pécule" variant="sheet" className="max-w-2xl p-4 sm:p-6" initialFocusRef={snapshot ? inputRef : undefined}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-2xl font-normal text-on-surface flex items-center gap-2 min-w-0">
          <Sparkles className="w-6 h-6 shrink-0 text-primary" aria-hidden="true" /> Demander à Pécule
        </h2>
        <IconButton icon={X} label="Fermer" onClick={onClose} className="-mt-1 -mr-2 shrink-0" />
      </div>

      {!snapshot ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-on-surface-variant">
            Pour répondre à vos questions, Pécule envoie un résumé de vos données à Google Gemini avec votre propre clé.
            Ajoutez-la dans Paramètres, rubrique « Clés et services » : elle est gratuite et reste sur cet appareil.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="text" onClick={onClose}>Fermer</Button>
            <Button variant="tonal" onClick={() => { onOpenSettings('keys'); onClose(); }}><KeyRound className="w-4 h-4" aria-hidden="true" /> Ajouter ma clé Gemini</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-on-surface-variant">Posez une question sur vos comptes, votre épargne ou vos échéances. Pécule ne modifie rien.</p>

          <div className="mt-4 space-y-3" aria-live="polite">
            {turns.length === 0 && !pending && (
              <div>
                <p className="text-xs font-medium text-on-surface-variant mb-2">Suggestions</p>
                <div className="flex flex-wrap gap-2">
                  {ASK_SUGGESTIONS.map(s => (
                    <Chip key={s} kind="suggestion" onClick={() => void ask(s)} className="max-w-full text-left h-auto! min-h-8 py-1.5 whitespace-normal">{s}</Chip>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t, i) => (
              t.role === 'user'
                ? <p key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary-container text-on-primary-container px-4 py-2 text-sm break-words">
                    <span className="sr-only">Vous : </span>{t.text}
                  </p>
                : <div key={i} className="max-w-[95%] rounded-2xl rounded-bl-sm bg-surface-container-high text-on-surface px-4 py-3 text-sm whitespace-pre-line break-words">
                    <span className="sr-only">Pécule : </span>{t.text}
                  </div>
            ))}
            {pending && <p className="text-sm text-on-surface-variant" role="status">Pécule réfléchit…</p>}
            {error && <p className="rounded-xl bg-error-container text-on-error-container px-4 py-3 text-sm" role="alert">{error.message}</p>}
            <div ref={endRef} />
          </div>

          <form onSubmit={onSubmit} className="mt-4 flex items-end gap-2">
            <label htmlFor="ask-question" className="sr-only">Votre question</label>
            <textarea
              id="ask-question" ref={inputRef} rows={2} maxLength={ASK_QUESTION_MAX} value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(question); } }}
              placeholder="Votre question…"
              className={`${fieldClass} h-auto min-h-14 py-3 resize-none flex-1 min-w-0`}
            />
            <Button type="submit" disabled={pending || !question.trim()} className="shrink-0 h-14!" aria-label="Envoyer la question">
              <Send className="w-4 h-4" aria-hidden="true" /> <span className="hidden sm:inline">Envoyer</span>
            </Button>
          </form>

          <p className="mt-3 text-xs text-on-surface-variant">
            Réponses de Google Gemini, d'après vos données du {askDateLabel(snapshot.asOf)}{snapshot.truncated ? ' (résumé raccourci)' : ''}.
            Elles peuvent contenir des erreurs et ne sont pas un conseil financier. La conversation n'est pas enregistrée.
          </p>
        </>
      )}
    </Modal>
  );
};

/**
 * Entrée de l'Accueil : le bouton et sa fenêtre. La fenêtre (donc la conversation) disparaît
 * à sa fermeture, en quittant l'Accueil et à la déconnexion.
 */
export const AskPeculeEntry: React.FC<Omit<AskPeculeProps, 'onClose'>> = props => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
        className="w-full min-h-14 flex items-center gap-3 rounded-full bg-secondary-container text-on-secondary-container px-5 py-2 text-left hover:shadow-sm transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        <MessageCircleQuestion className="w-5 h-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-sm font-medium">Demander à Pécule</span>
          <span className="block text-xs">Une question sur vos comptes ? L'IA répond d'après vos données.</span>
        </span>
      </button>
      {open && <AskPecule {...props} onClose={() => setOpen(false)} />}
    </>
  );
};
