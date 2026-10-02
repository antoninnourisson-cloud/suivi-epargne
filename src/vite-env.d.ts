/// <reference types="vite/client" />
interface ImportMetaEnv {
  // URL du Worker (session persistante + notifications). Absente = mode sans serveur.
  readonly VITE_BACKEND_URL?: string;
}
declare const __BUILD_SHA__: string;
