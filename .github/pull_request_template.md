## Ce qui change

<!-- Une ou deux phrases : quoi, et pourquoi. Lien vers l'issue si elle existe (« Corrige #12 »). -->

## Vérifications

- [ ] `npm run lint`, `npm run typecheck`, `npm run test:coverage` et `npm run build` passent
- [ ] `npm run e2e` passe (tests de bout en bout en mode démo) ; nouvel écran ou nouveau parcours : test ajouté dans `e2e/`
- [ ] Testé dans le navigateur (mode démo `?demo=1` si possible), sur mobile et en mode sombre si l'interface change
- [ ] Modification visible : entrée ajoutée **en tête** de `src/changelog.ts` (version `AAAA.MM.JJ`, phrases simples)
- [ ] Soldes, fichier de données ou part des parents touchés : invariants de MAINTENANCE.md § 1 respectés, tests ajoutés
- [ ] Chiffre fiscal modifié : source officielle citée
- [ ] Accessibilité : libellés des champs, `aria-label` des boutons icônes, navigation au clavier
- [ ] Aucune donnée réelle (montant, fiche de paie, avis d'imposition) dans le code, les tests ou les captures
- [ ] Documentation à jour si besoin (README, MAINTENANCE, worker/README, page de confidentialité, wiki)
