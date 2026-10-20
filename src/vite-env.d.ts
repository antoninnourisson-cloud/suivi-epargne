/// <reference types="vite/client" />
interface ImportMetaEnv {
  // URL du Worker (session persistante + notifications). Absente = mode sans serveur.
  readonly VITE_BACKEND_URL?: string;
}
declare const __BUILD_SHA__: string;
// Mode démo disponible dans le build de production des tests de bout en bout (vite.config.ts).
declare const __E2E_DEMO__: boolean;
// Version de l'app (vite.config.ts, plugin app-version ; voir src/appVersion.ts).
declare module 'virtual:app-version' {
  export const APP_VERSION: string;
}
