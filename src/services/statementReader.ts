// ================================================
// FILE: src/services/statementReader.ts
// « Lire un relevé » : le fichier choisi sur l'appareil (PDF ou capture d'écran de l'app de
// la banque) est envoyé à Google Gemini avec la clé de l'utilisateur, directement depuis
// l'appareil (jamais au serveur de Pécule, jamais sur Drive : aucune autorisation Google en
// plus). En mode démo, une lecture fictive remplace Gemini pour que tout le parcours
// s'essaie sans clé. Rien n'est enregistré ici : voir lib/statementImport et la commande
// importStatement.
// ================================================
import { extractBankStatement, GeminiError, type ExtractOptions } from './geminiService';
import type { StatementData } from '../lib/statementImport';

/** Taille maximale d'un relevé (même limite que l'avis d'imposition). */
export const STATEMENT_MAX_BYTES = 15 * 1024 * 1024;
/** Types acceptés : PDF ou image (capture d'écran). */
export const STATEMENT_ACCEPT = 'application/pdf,image/*';

// Mode démo (`?demo=1`) : en développement et dans le build des tests de bout en bout
// seulement (même règle que useAuthSession) ; jamais dans le build publié.
const DEMO_ALLOWED: boolean = import.meta.env.DEV || __E2E_DEMO__;
export const isDemoSession = (): boolean => DEMO_ALLOWED && new URLSearchParams(window.location.search).has('demo');

/** Erreur de lecture, avec un message en clair pour l'écran. */
export class StatementReadError extends Error {
  constructor(message: string, readonly kind: 'file' | 'key' | 'busy' | 'failed') { super(message); }
}

const toBase64 = (file: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

/** Type du fichier : celui annoncé, sinon d'après l'extension ; `null` si ni PDF ni image. */
export const statementMimeType = (file: Pick<File, 'type' | 'name'>): string | null => {
  if (file.type === 'application/pdf' || file.type.startsWith('image/')) return file.type;
  if (!file.type && /\.pdf$/i.test(file.name)) return 'application/pdf';
  return null;
};

/** Message en clair pour une erreur de Gemini (clé, saturation, réponse, réseau). */
export const describeStatementError = (e: unknown): StatementReadError => {
  if (e instanceof StatementReadError) return e;
  if (e instanceof GeminiError && e.code === 'AUTH') {
    return new StatementReadError('Gemini refuse la clé enregistrée sur cet appareil : vérifiez-la dans les Paramètres.', 'key');
  }
  if (e instanceof GeminiError && e.code === 'OVERLOADED') {
    return new StatementReadError('Gemini est très sollicité en ce moment (plusieurs essais faits). Réessayez dans quelques minutes, ou actualisez vos soldes à la main.', 'busy');
  }
  if (e instanceof GeminiError) {
    return new StatementReadError("Gemini n'a pas pu lire ce document. Essayez avec le PDF d'origine de votre banque (sans mot de passe) ou une capture plus nette.", 'failed');
  }
  return new StatementReadError('Lecture impossible : vérifiez votre connexion à Internet, puis réessayez.', 'failed');
};

/**
 * Lit un relevé. Lève une StatementReadError (message à afficher) si le fichier ne convient
 * pas, si la clé manque ou si Gemini échoue. Un document qui n'est pas un relevé renvoie un
 * relevé sans compte : à l'écran de le dire.
 */
export const readStatementFile = async (file: File, apiKey: string, options: ExtractOptions & { demo?: boolean } = {}): Promise<StatementData> => {
  const mime = statementMimeType(file);
  if (!mime) throw new StatementReadError('Choisissez un relevé au format PDF, ou une capture d\'écran (image).', 'file');
  if (file.size > STATEMENT_MAX_BYTES) throw new StatementReadError('Fichier trop lourd (15 Mo au plus) : gardez seulement les pages du relevé.', 'file');
  if (file.size === 0) throw new StatementReadError('Ce fichier est vide.', 'file');
  if (options.demo ?? isDemoSession()) {
    const { demoStatement } = await import('../dev/demoStatement');
    return demoStatement();
  }
  if (!apiKey) throw new StatementReadError("La lecture d'un relevé demande une clé Gemini, gardée sur cet appareil.", 'key');
  try {
    return await extractBankStatement(apiKey, await toBase64(file), mime, options);
  } catch (e) {
    throw describeStatementError(e);
  }
};
