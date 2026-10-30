// Écran affiché dans l'onglet d'un écran à onglets (Comptes › Mouvements…) : son en-tête
// (PageHeader) devient un titre de section, lu par les lecteurs d'écran mais masqué à l'écran
// (l'onglet choisi le dit déjà) ; sa phrase d'explication et ses actions restent.
import { createContext } from 'react';

export const InTabPanelContext = createContext(false);
