import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
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
// contrôle de la page : on recharge alors immédiatement pour repartir sur du code à jour,
// avant que la moindre sauvegarde avec un schéma obsolète ne puisse partir. Le filet de
// sécurité local (quarantaine) protège déjà toute modification non enregistrée à ce moment.
if ('serviceWorker' in navigator) {
  // À la TOUTE PREMIÈRE visite, le service worker s'installe et prend le contrôle
  // (clientsClaim) : ça déclenche aussi `controllerchange`, mais il n'y a aucun code
  // obsolète à purger — recharger serait gratuit et visuellement brutal. On ne recharge
  // que si un contrôleur existait déjà (vraie mise à jour d'un onglet ouvert).
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    window.location.reload();
  });
}

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
