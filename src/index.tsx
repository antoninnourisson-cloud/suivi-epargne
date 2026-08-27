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
  navigator.serviceWorker.addEventListener('controllerchange', () => {
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
