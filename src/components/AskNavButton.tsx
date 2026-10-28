// « Demander à Pécule » dans la navigation : sous l'ajout rapide du menu latéral (ordinateur)
// et en tête du panneau « Plus » (téléphone). La fenêtre elle-même est chargée à la demande.
import React from 'react';
import { MessageCircleQuestion } from 'lucide-react';

export const AskNavButton: React.FC<{ onClick: () => void; className?: string }> = ({ onClick, className = '' }) => (
  <button type="button" onClick={onClick} aria-haspopup="dialog"
    className={`w-full h-12 px-4 rounded-full bg-secondary-container text-on-secondary-container flex items-center gap-3 text-sm font-medium hover:shadow-sm transition-shadow ${className}`}>
    <MessageCircleQuestion className="w-5 h-5" aria-hidden="true" /> Demander à Pécule
  </button>
);
