import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { watchForAppUpdates, createSafeReload } from './services/swUpdates';
import { cleanUpStorage } from './lib/storageKeys';
import { localTodayISO } from './lib/dates';
import './index.css';

// La PWA (vite-plugin-pwa, registerType 'autoUpdate') met à jour son service worker en
// arrière-plan dès qu'un nouveau déploiement est disponible — mais un onglet déjà ouvert
// continue d'exécuter le JS DÉJÀ CHARGÉ EN MÉMOIRE tant qu'il n'est pas rechargé. Un tel
// onglet, resté ouvert avec une session valide (persistance activée), peut alors continuer
// à faire tourner sa sauvegarde automatique avec un ANCIEN buildData() qui ignore des
// champs ajoutés depuis — et les faire disparaître silencieusement du fichier Drive
// partagé à la prochaine écriture (constaté en conditions réelles : geminiApiKey,
// pickerApiKey et payslips effacés, alors que les champs plus anciens survivaient).
// `controllerchange` se déclenche exactement quand un nouveau service worker prend le
// contrôle de la page : on recharge alors pour repartir sur du code à jour.
// Le rechargement attend toutefois que rien ne soit en cours (fenêtre ouverte, champ en
// cours de saisie, saisies pas encore envoyées sur Drive : createSafeReload), pour ne jamais
// faire perdre une saisie. Cette attente est sans risque pour le fichier : migrate() garde
// désormais les champs inconnus de l'ancien code, et un fichier écrit avec un schéma plus
// récent n'est jamais écrasé (appOutdated).
if ('serviceWorker' in navigator) {
  // À la TOUTE PREMIÈRE visite, le service worker s'installe et prend le contrôle
  // (clientsClaim) : ça déclenche aussi `controllerchange`, mais il n'y a aucun code
  // obsolète à purger — recharger serait gratuit et visuellement brutal. On ne recharge
  // que si un contrôleur existait déjà (vraie mise à jour d'un onglet ouvert).
  let hadController = !!navigator.serviceWorker.controller;
  const reloadWhenIdle = createSafeReload(() => window.location.reload());
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    reloadWhenIdle();
  });
  // Ce rechargement suppose que le navigateur cherche les mises à jour : une PWA restée
  // ouverte ne le fait jamais seule. Vérification au retour au premier plan et toutes les heures.
  watchForAppUpdates(navigator.serviceWorker);
}

// Ménage du stockage local, une fois au démarrage : clés d'anciennes versions, repères et
// reports expirés (voir lib/storageKeys). Sans effet si le stockage est bloqué.
try { cleanUpStorage(window.localStorage, localTodayISO()); } catch { /* stockage inaccessible */ }

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
