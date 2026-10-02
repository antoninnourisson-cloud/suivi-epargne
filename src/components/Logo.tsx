// ================================================
// FILE: src/components/Logo.tsx
// Logo Pécule : une pousse qui sort d'une pièce. Même dessin que les icônes de l'app
// (public/pwa-*.png), ici en vectoriel pour l'interface.
// ================================================
import React from 'react';

export const Logo: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg viewBox="0 0 512 512" className={`${className} rounded-[22%] shrink-0`} aria-hidden="true">
    <rect width="512" height="512" fill="#14532d" />
    <path d="M256 292 V214" stroke="#fef3c7" strokeWidth="22" strokeLinecap="round" fill="none" />
    <path d="M256 208 C256 150 300 116 366 116 C366 178 322 208 256 208 Z" fill="#fbbf24" />
    <path d="M256 238 C256 186 216 156 156 156 C156 212 196 238 256 238 Z" fill="#fef3c7" />
    <circle cx="256" cy="348" r="68" fill="#fbbf24" />
    <circle cx="256" cy="348" r="48" fill="none" stroke="#b45309" strokeWidth="10" />
  </svg>
);
