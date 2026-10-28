// Modèle Gemini utilisé et modèle choisi dans Paramètres. À part de geminiService pour que la
// déconnexion (useAuthSession) puisse effacer le choix sans charger au démarrage tout le
// client Gemini, utile seulement aux écrans qui lisent un document.
import { storageKey } from '../lib/storageKeys';

// Modèle multimodal rapide, adapté à l'extraction structurée d'un document. Isolé en
// constante pour rester simple à faire évoluer : Google déprécie régulièrement les
// anciens modèles (gemini-2.5-flash a par exemple cessé de répondre, l'API renvoyant
// elle-même le nom du modèle de remplacement dans son message d'erreur 404) — si ce
// modèle cesse à son tour de fonctionner, la même erreur indiquera quoi mettre ici.
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

// Modèle choisi dans Paramètres (sur cet appareil) : permet de remplacer un modèle retiré
// par Google sans attendre une mise à jour de l'app.
const MODEL_OVERRIDE_KEY = storageKey('geminiModel');
export const getGeminiModelOverride = (): string => { try { return localStorage.getItem(MODEL_OVERRIDE_KEY) || ''; } catch { return ''; } };
export const setGeminiModelOverride = (m: string) => { try { if (m.trim()) localStorage.setItem(MODEL_OVERRIDE_KEY, m.trim()); else localStorage.removeItem(MODEL_OVERRIDE_KEY); } catch { /* non mémorisé */ } };
