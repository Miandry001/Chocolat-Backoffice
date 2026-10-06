# Saisie Confiserie — guide technique

Ce guide décrit l’architecture et les fonctions de l’application de saisie des
produits de confiserie. Il s’adresse aux personnes qui doivent comprendre,
maintenir ou étendre les flux frontend et backend.

## 1. Vue d’ensemble

L’application est composée de deux projets JavaScript ES modules :

- **Frontend** : React 19, React Router et Vite, dans [`frontend/`](./frontend/).
- **Backend** : Express 5, MongoDB/Mongoose, dans [`backend/`](./backend/).
- **Source externe** : le plugin Vite sert de passerelle vers le Google Sheet
  connecté. Il est défini dans [`frontend/server/`](./frontend/server/).

Le frontend affiche et valide le formulaire pour aider l’utilisateur. Le backend
revalide systématiquement les données, enregistre les traitements dans
MongoDB, conserve les versions et les événements d’audit, et fournit les
statistiques, les suggestions et les fonctions de contrôle qualité. Les deux
côtés partagent plusieurs conventions de champs et de validation ; les
configurations du backend qui sont des copies du frontend doivent rester
synchronisées.

### Structure utile

| Chemin | Rôle |
|---|---|
| [`frontend/src/App.jsx`](./frontend/src/App.jsx) | Authentification, shell de l’application, routes et pages principales : accueil, qualité, données, utilisateurs, connexion Sheets. |
| [`frontend/src/pages/`](./frontend/src/pages/) | Pages de distribution, statistiques et monitoring. |
| [`frontend/src/components/SaisieForm.jsx`](./frontend/src/components/SaisieForm.jsx) | État, dépendances, normalisation et soumission du formulaire de saisie. |
| [`frontend/src/data/fields.js`](./frontend/src/data/fields.js) | Champs, options dynamiques, saisons et valeurs initiales du formulaire. |
| [`frontend/src/data/rules.js`](./frontend/src/data/rules.js) | Règles locales et validation interactive. |
| [`frontend/src/data/textRules.js`](./frontend/src/data/textRules.js) | Normalisation des séparateurs et tri du texte libre. |
| [`backend/src/routes/`](./backend/src/routes/) | Déclaration et protection des routes de l’API. |
| [`backend/src/controllers/`](./backend/src/controllers/) | Adaptation des requêtes HTTP vers les services et dépôts. |
| [`backend/src/services/`](./backend/src/services/) | Logique métier : synchronisation, authentification, suggestions, statistiques et export. |
| [`backend/src/repositories/`](./backend/src/repositories/) | Adaptateurs MongoDB et mémoire partageant une interface commune. |
| [`backend/src/models/index.js`](./backend/src/models/index.js) | Schémas et modèles MongoDB. |
| [`backend/src/rules/index.js`](./backend/src/rules/index.js) | Règles de validation exécutées côté serveur. |
| [`backend/src/validators/index.js`](./backend/src/validators/index.js) | Validation et nettoyage des payloads HTTP. |

## 2. Démarrage, commandes et configuration

Les scripts sont définis dans [`backend/package.json`](./backend/package.json)
et [`frontend/package.json`](./frontend/package.json).

| Action | Dossier | Commande |
|---|---|---|
| Démarrer l’API | `backend` | `npm start` |
| Démarrer l’API en surveillance | `backend` | `npm run dev` |
| Exécuter les tests backend | `backend` | `npm test` |
| Démarrer Vite | `frontend` | `npm run dev` |
| Construire le frontend | `frontend` | `npm run build` |
| Prévisualiser le build | `frontend` | `npm run preview` |

En développement, Vite relaie `/api/v1` vers `API_TARGET` ; par défaut, la
cible est `http://localhost:3001`. Le backend doit donc être démarré
séparément. Il n’existe pas d’API de démonstration ni de comptes ou saisies
préchargés. Les identifiants de test ne sont pas fournis par le frontend.

Le backend requiert `MONGODB_URI` et un `JWT_SECRET` d’au moins 32 octets.
En production, `APP_ORIGIN` doit être l’origine HTTPS exacte. Le compte
administrateur initial est configuré avec `AUTH_BOOTSTRAP_ADMIN_LOGIN` et
`AUTH_BOOTSTRAP_ADMIN_PASSWORD` (12 caractères minimum). Les identifiants
Google Sheets sont utilisés côté serveur, jamais exposés au navigateur.

Le démarrage API est orchestré au niveau module dans
[`backend/src/server.js`](./backend/src/server.js) : charge les variables
d’environnement, vérifie la configuration, ouvre MongoDB, applique la
migration des anciens index de login, initialise les index Mongoose, crée au
besoin l’administrateur initial, puis écoute sur `PORT` (3001 par défaut).
`createApp()` dans [`backend/src/app.js`](./backend/src/app.js) assemble
Express, Helmet, les limites de requêtes, le parseur JSON, le routeur et la
gestion centralisée des erreurs.

## 3. Parcours d’une saisie

1. `DistributionHomePage` obtient la dernière ligne du classeur via
   `useSourceRow()`, calcule les groupes de 50 et affiche leur statut.
2. `DistributionGroupPage` propose les lignes du bloc. `DistributionLinePage`
   charge la source en lecture seule et la saisie précédente de cette ligne.
3. `SaisieForm` construit les champs à partir de `fields.js`, applique les
   valeurs initiales et les dépendances, normalise les entrées et vérifie les
   règles avant la validation finale.
4. `saveDraft()` convertit l’index frontend en `sourceRow` (index + 1) et
   envoie le payload vers `POST /api/v1/data/sync`. Un brouillon utilise
   `submit: false`; une validation finale utilise `submit: true`.
5. `validateSyncBody()` contrôle la forme du payload. `syncTreatment()` refuse
   les champs inconnus, normalise les valeurs, calcule le diff, valide le jeu
   complet, applique la logique de statut et persiste le traitement, la version,
   les audits et le résultat de validation dans une transaction.
6. Après une soumission réussie, `recordFieldSuggestions()` apprend les
   suggestions libres. La même clé d’idempotence, si elle est fournie, rejoue
   le résultat antérieur sans créer de nouvelle écriture.
7. Le contrôle qualité lit les traitements soumis. Un retour à corriger ajoute
   un commentaire d’audit et place le traitement en `CORRECTION_REQUIRED`.
   L’agent peut alors corriger la ligne et la soumettre à nouveau.

### Index de ligne et groupes

Le formulaire et les routes frontend manipulent un index de ligne commençant à
1, tandis que la ligne source MongoDB est `sourceRow = index + 1` : la ligne 1
du classeur contient les en-têtes. Un bloc de 50 lignes commence aux indices
1, 51, 101, etc. Les statuts de bloc sont `NON ASSIGNE`, `EN COURS`,
`SAISIE TERMINEE` et `VALIDEE`.

## 4. API backend

Toutes les routes sont montées sous `/api/v1` par `buildRouter()` dans
[`backend/src/routes/index.js`](./backend/src/routes/index.js).

| Méthode et route | Protection | Fonction |
|---|---|---|
| `GET /health` | publique | État de l’API et mode de stockage. |
| `POST /auth/login` | origine de confiance | Connexion, cookies de session et CSRF. |
| `GET /auth/me` | session | Profil de la session courante. |
| `POST /auth/logout` | session + CSRF | Révocation de la session et suppression des cookies. |
| `GET /users` | Admin, Superviseur | Liste des utilisateurs. |
| `POST /users` | Admin, Superviseur | Création ; un Superviseur ne peut créer que des Agents. |
| `PATCH /users/:id`, `DELETE /users/:id` | Admin | Modification ou suppression d’un utilisateur. |
| `GET /stats/summary`, `GET /stats/agents` | session | KPI globaux ou performance par agent et période. |
| `GET /quality/treatments` | session | File paginée des traitements en attente de contrôle. |
| `POST /quality/treatments/:sourceRow/return` | Admin, Superviseur | Retour avec commentaire pour correction. |
| `GET /distribution-groups` | session | Statuts des blocs. |
| `PUT /distribution-groups/:groupStart/status` | session + CSRF | Mise à jour du statut d’un bloc valide. |
| `/labels`, `/labels/calculate` | session + CSRF pour calcul | Référentiel des labels et informations calculées. |
| `POST /data/sync` | session + CSRF | Enregistrement d’un brouillon ou d’une soumission. |
| `GET /data/row/:sourceRow` | session | Récupération d’une saisie existante. |
| `GET /data/export` | Admin, Superviseur | Traitements soumis filtrés par date, rôle et agent. |
| `POST /rules/validate` | session + CSRF | Validation sans écriture. |
| `GET /suggestions?field=…&prefix=…` | session | Suggestions de saisie pour un champ. |

Les réponses API utilisent `ok()` et `fail()` dans
[`backend/src/utils/response.js`](./backend/src/utils/response.js). Les erreurs
imprévues sont converties en réponses génériques par `errorHandler()` ; le
message interne et les traces ne sont pas renvoyés au client.

## 5. Référence des fonctions backend

### Applications, routes et contrôleurs

| Fonction | Fichier | Responsabilité |
|---|---|---|
| `createApp(repos, options)` | [`backend/src/app.js`](./backend/src/app.js) | Assemble Express, sécurité HTTP, limitation globale et spécifique à la connexion, parsing JSON, routes et middlewares de fin. L’injection des dépôts facilite les tests. |
| `buildRouter(repos, authService)` | [`backend/src/routes/index.js`](./backend/src/routes/index.js) | Instancie les contrôleurs et monte les routes API. Installe l’authentification et la vérification CSRF avant les routes privées, puis applique les rôles sur les opérations sensibles. |
| `makeDataController(repos)` | [`backend/src/controllers/dataController.js`](./backend/src/controllers/dataController.js) | Fabrique les handlers `sync`, `getBySourceRow`, `suggestions` et `validate`. Adapte validation HTTP et services aux réponses API. |
| `makeAuthController(authService)` | [`backend/src/controllers/authController.js`](./backend/src/controllers/authController.js) | Fabrique login, session, logout et opérations utilisateurs. `validateUser()` contrôle nom, prénom, login, rôle et politique de mot de passe; `invalid()` produit une réponse 400. La création traduit les conflits métier en 409. |
| `makeQualityController(repos)` | [`backend/src/controllers/qualityController.js`](./backend/src/controllers/qualityController.js) | `list()` pagine la file QC et joint la dernière validation; `returnForCorrection()` vérifie le commentaire/la ligne, effectue le changement de statut et les événements d’audit en transaction. `valuesFromKV()` et `toQueueItem()` préparent le format consommé par le frontend. |
| `makeStatsController(repos)` | [`backend/src/controllers/statsController.js`](./backend/src/controllers/statsController.js) | `agents()` valide la plage et filtre les Agents sur leur propre profil; `summary()` limite aussi l’Agent à ses propres KPI. `parseDate()` valide une date calendrier; `summarizeAgent()` calcule taux qualité, jours actifs et meilleurs/pires jours; `yesterdayWindow()` calcule la veille au fuseau Nairobi. |
| `makeDistributionGroupController(repos)` | [`backend/src/controllers/distributionGroupController.js`](./backend/src/controllers/distributionGroupController.js) | `list()` normalise l’ancien statut `VALIDE`; `update()` valide le début de bloc, le statut puis délègue au dépôt. `isValidGroupStart()` vérifie l’alignement sur une tranche de 50. |
| `makeDataExportController(repos)` | [`backend/src/controllers/dataExportController.js`](./backend/src/controllers/dataExportController.js) | `listSubmitted()` prépare une réponse minimale à partir des traitements éligibles à l’export. |
| `validateSelectedLabels(body)` | [`backend/src/routes/labelRoutes.js`](./backend/src/routes/labelRoutes.js) | Vérifie la forme, le nombre et la longueur maximale des labels reçus. |

### Services métier

| Fonction | Fichier | Responsabilité |
|---|---|---|
| `syncTreatment(repos, params)` | [`backend/src/services/syncService.js`](./backend/src/services/syncService.js) | Flux central de persistance. Vérifie l’idempotence et les champs autorisés; normalise; compare les valeurs; valide la soumission; calcule le statut; évite les versions inutiles; puis enregistre état courant, version complète, diff, audits, validation et clé d’idempotence de façon transactionnelle. L’erreur `DomainError` transporte le statut et le code HTTP/métier. `summarize()` résume les erreurs par priorité. |
| `createAuthService(repos, options)` | [`backend/src/services/authService.js`](./backend/src/services/authService.js) | Service d’authentification. `login()` compare les hachages parmi tous les comptes au login fourni et refuse les correspondances multiples; `authenticate()` vérifie signature, expiration, session stockée, statut actif et rôle; `createUser()` empêche les doublons nom/prénom/mot de passe et login/mot de passe; `updateUser()` et `deleteUser()` invalident les sessions si nécessaire. |
| `hashPassword(password)` / `verifyPassword(password, encoded)` | [`backend/src/services/authService.js`](./backend/src/services/authService.js) | Hachage scrypt avec sel aléatoire; la vérification contrôle le format et compare les octets de façon résistante aux attaques temporelles. |
| `publicUser(user)` | [`backend/src/services/authService.js`](./backend/src/services/authService.js) | Retire le hachage avant de renvoyer un utilisateur au frontend et sérialise son identifiant. |
| `createCsrfToken()` | [`backend/src/services/authService.js`](./backend/src/services/authService.js) | Produit un jeton aléatoire pour la protection CSRF. `b64url()` et `sign()` servent à encoder et signer les jetons de session. |
| `recordFieldSuggestions(repos, values)` | [`backend/src/services/suggestionService.js`](./backend/src/services/suggestionService.js) | Enregistre les mots rencontrés dans les soumissions; ignore nombre, booléen, vide et valeurs de listes prédéfinies. |
| `findFieldSuggestions(repos, field, prefix)` | [`backend/src/services/suggestionService.js`](./backend/src/services/suggestionService.js) | Fusionne le catalogue immédiat, les suggestions apprises à partir de 20 usages et les valeurs historiques. Déduplique, trie par fréquence puis ordre alphabétique et limite la réponse à huit. |
| `listFilteredExportTreatments(repos, filters)` | [`backend/src/services/dataExportService.js`](./backend/src/services/dataExportService.js) | Valide dates, rôle et nom d’agent; filtre les audits de soumission par agent et date; joint les traitements retenus au nom de l’agent et à la date d’export. `parseDate()` valide les dates et construit des bornes inclusives/exclusives au fuseau Nairobi. |
| `calculateLabelInformation(labels)` | [`backend/src/services/labelService.js`](./backend/src/services/labelService.js) | Déduplique et vérifie les labels puis calcule les indicateurs biologique, équitable, écologique et végétal. Une catégorie est positive dès qu’au moins un label sélectionné l’indique. |
| `getLabels()` | [`backend/src/services/labelService.js`](./backend/src/services/labelService.js) | Renvoie le référentiel des labels. |

### Validation, normalisation et outils backend

| Fonction | Fichier | Responsabilité |
|---|---|---|
| `validateSyncBody(body)` | [`backend/src/validators/index.js`](./backend/src/validators/index.js) | Contrôle `sourceRow`, `submit` et `values`, puis renvoie des valeurs nettoyées. |
| `validateRulesBody(body)` | [`backend/src/validators/index.js`](./backend/src/validators/index.js) | Valide un payload de contrôle de règles sans écriture. |
| `isPlainObject(object)` / `err(field,message)` | même fichier | Reconnaissent un objet JSON simple et construisent les erreurs de validation standardisées. |
| `checkValues(values, errors)` | [`backend/src/validators/index.js`](./backend/src/validators/index.js) | Limite nombre de clés et taille des valeurs; refuse les clés dangereuses (`$`, point, `__proto__`) et les types non pris en charge. |
| `finish(value, errors)` | [`backend/src/validators/index.js`](./backend/src/validators/index.js) | Lève `ValidationError` si le tableau contient des erreurs. |
| `readIdempotencyKey(req)` / `readActor(req)` | [`backend/src/validators/index.js`](./backend/src/validators/index.js) | Valident/exposent respectivement la clé d’idempotence et l’acteur issu de la session déjà authentifiée. |
| `rulesForField(field)` / `runRules(values, rules)` | [`backend/src/rules/index.js`](./backend/src/rules/index.js) | Génèrent des règles selon la configuration des champs puis les exécutent en triant les erreurs par priorité et ordre du formulaire. |
| `getRules(name, values, customFields)` | [`backend/src/config/vendor/rules.js`](./backend/src/config/vendor/rules.js) | Fusionne les règles de type et les surcharges (ex. entiers ou unité de `Onces Totales`); construit les valeurs autorisées d’un select en fonction de ses parents. |
| `validate(value, rules)` / `validateAll(values, customFields, pluralVerified)` | [`backend/src/config/vendor/rules.js`](./backend/src/config/vendor/rules.js) | Valide une valeur ou un formulaire entier, y compris nombre, min/max, sélection, et confirmation de pluralité. |
| `isEditableField(name)` | [`backend/src/config/fields.js`](./backend/src/config/fields.js) | Vérifie qu’un nom appartient aux champs modifiables et non aux colonnes source en lecture seule. |
| `freeze(object)` / `enumOf(...keys)` / `canTransition(from,to)` | [`backend/src/constants/index.js`](./backend/src/constants/index.js) | Construit les constantes immuables et pseudo-énumérations; vérifie la matrice des transitions de statut. Le module porte aussi les priorités, erreurs, acteurs et actions d’audit. |
| `formatValue(s)` / `normalizeValues(values)` | [`backend/src/utils/normalize.js`](./backend/src/utils/normalize.js) | Applique majuscules, suppression des accents et remplacement des ligatures `œ`/`æ`; la seconde fonction normalise chaque champ avant la validation/persistance. |
| `norm(value)` / `diffValues(before,after)` | [`backend/src/diff/diffEngine.js`](./backend/src/diff/diffEngine.js) | Convertit les valeurs en chaînes comparables puis construit le diff des seules clés dont les valeurs diffèrent. |
| `toKV(object)` / `fromKV(entries)` | [`backend/src/utils/kv.js`](./backend/src/utils/kv.js) | Convertissent l’objet formulaire en tableau MongoDB `{k,v}` et inversement. |
| `readCookies(req)`, `requireTrustedOrigin(req)`, `makeAuthenticate(service)`, `requireCsrf(req)`, `requireRoles(...roles)` | [`backend/src/middlewares/auth.js`](./backend/src/middlewares/auth.js) | Lisent les cookies, vérifient l’origine, authentifient la session, imposent CSRF sur les mutations et restreignent les rôles. `expectedOrigin()` détermine l’origine permise; `cookieOptions()` centralise les attributs des cookies. |
| `errorHandler(err, req, res, next)` / `notFound(req, res)` | [`backend/src/middlewares/errorHandler.js`](./backend/src/middlewares/errorHandler.js) | Convertissent les erreurs connues en statuts/messages sûrs et masquent les détails internes pour les erreurs inattendues. |
| `ok(res, data, meta, status)` / `fail(res, status, errors, meta)` | [`backend/src/utils/response.js`](./backend/src/utils/response.js) | Conservent l’enveloppe commune de réponse succès/erreur. |
| `min()` / `write(level, msg, ctx)` | [`backend/src/utils/logger.js`](./backend/src/utils/logger.js) | Appliquent le seuil `LOG_LEVEL` et écrivent les événements structurés. `logger` expose les méthodes par niveau. |
| `removeUniqueUserLoginIndexes(collection)` | [`backend/src/migrations/userIndexes.js`](./backend/src/migrations/userIndexes.js) | Retire l’ancienne contrainte d’unicité du login, puisque plusieurs utilisateurs peuvent désormais partager un login. |
### Dépôts et modèles

`createMemoryRepos()` ([`backend/src/repositories/memoryRepos.js`](./backend/src/repositories/memoryRepos.js))
et `createMongoRepos()` ([`backend/src/repositories/mongoRepos.js`](./backend/src/repositories/mongoRepos.js))
présentent la même interface métier. Le dépôt mémoire est utilisé par les tests;
le backend applicatif utilise les modèles Mongoose. `withTransaction(fn)`
fournit le contexte transactionnel; MongoDB propage sa session avec
`AsyncLocalStorage` (`opts()` ajoute cette session aux requêtes), tandis que le
dépôt mémoire prend un snapshot et restaure les collections/map si l’opération
échoue.

| Groupe de méthodes du dépôt | Méthodes | Usage |
|---|---|---|
| `distributionGroups` | `list`, `setStatus` | Liste/stocke les statuts des blocs. |
| `users` | `findByLogin`, `findByLoginCandidates`, `findByName`, `findById`, `list`, `create`, `update`, `delete` | Recherche et gestion des comptes. Les recherches par login/nom retournent aussi les hachages uniquement au service d’authentification. |
| `sessions` | `create`, `find`, `delete`, `deleteByUserId` | Une session active par utilisateur; révocation au logout ou lors de changements de compte. |
| `treatments` | `findByRow`, `listForQuality`, `listForExport`, `insert`, `update`, `findFieldValuesByPrefix` | État courant, file qualité, traitements exportables et suggestions historiques. |
| `versions` | `insert` | Snapshot immuable par version. |
| `audits` | `insertMany` | Journal immuable des actions et changements de champ. |
| `validations` | `insert`, `findLatestByTreatmentIds` | Erreurs de règles associées à chaque version. |
| `statistics` | `getAgentPerformance`, `getHomeSummary` | Agrège soumissions, resoumissions, KPI et métriques d’accueil. |
| `idempotency` | `get`, `set` | Mémorise un résultat de sync par clé. |
| `suggestions` | `increment`, `find` | Compteur d’utilisation et recherche par champ/préfixe. |

[`backend/src/models/index.js`](./backend/src/models/index.js) définit les
collections `Treatment`, `TreatmentVersion`, `AuditLog`, `ValidationResult`,
`IdempotencyKey`, `FieldSuggestion`, `User`, `ActiveSession` et
`DistributionGroup`. Les index matérialisent notamment l’unicité de la ligne
source, l’historique ordonné par version, la recherche qualité, le TTL des
sessions/idempotences et l’unicité d’une suggestion par champ et mot.

## 6. Référence des fonctions frontend

### Authentification, navigation et pages principales

Les fonctions ci-dessous sont définies dans
[`frontend/src/App.jsx`](./frontend/src/App.jsx).

| Fonction | Responsabilité |
|---|---|
| `readCookie(name)` / `authenticatedFetch(url, options)` | Lit le jeton CSRF du cookie et l’ajoute aux requêtes mutatives; toutes deux utilisent les cookies same-origin. |
| `getRoleLabel(role)` / `getRoleOptions()` | Présentation et liste des rôles utilisateurs. |
| `formatEAT(date)` / `formatDateInput(date)` | Affichent heure/date au fuseau `Africa/Nairobi`, le second au format date de formulaire. |
| `getNavigation(role)` | Produit les entrées de navigation accessibles selon le rôle. |
| `NotificationBell({notifications})` | Affiche le panneau de notifications, ouvre/ferme les messages, suit le clic extérieur et propose le lien vers une ligne. |
| `AppShell({user,…})` | Cadre des pages authentifiées : navigation, horloge, notifications, déconnexion et documentation latérale. |
| `getSummaryCards(summary)` / `HomePage({user, storageMode})` | Préparent les KPI de l’accueil; `HomePage` recharge le résumé toutes les 30 secondes et affiche l’état de stockage. |
| `QualityPage({users,user})` | Charge les pages de traitements QC, associe les profils aux lignes, filtre côté client, ouvre la ligne dans la distribution et envoie un retour de correction. Ses callbacks `loadTreatments`, `handleSendReturn`, `handleApplyFilters` et `sendFeedback` gèrent respectivement chargement/pagination, navigation, application des filtres et commentaire retour. |
| `DataPage({users})` | Affiche les performances par agent avec filtres date/rôle/nom et lance les exports Excel ou Google Sheets. `exportSubmittedData()` traite téléchargement ou URL de copie; le `load()` de l’effet charge les KPI filtrés. |
| `UserManagementPage({users,setUsers,currentUser})` | Filtre les utilisateurs, crée/modifie les comptes selon l’interface du rôle Admin/Superviseur, supprime les comptes autorisés. `handleSave()` et `handleDelete()` appellent l’API et réconcilient la liste locale. |
| `GoogleSheetConnectionPage()` | `handleConnect()` soumet l’URL au plugin Sheets et présente le nombre de lignes ou l’erreur. |
| `LoginPage({onLogin})` | `handleSubmit()` réalise la connexion, traite les réponses non JSON et présente les erreurs sans exposer de détails sensibles. |
| `Application()` | Vérifie le health check et la session au montage, charge les utilisateurs accessibles, conserve les notifications locales, coordonne les appels de sauvegarde et construit les routes protégées par rôle. `saveDraft()` traduit l’index de ligne et envoie le traitement; `saveDistributionGroupStatus()` et `loadDistributionGroupStatuses()` pilotent les statuts des blocs; `handleLogin()`/`handleLogout()` mettent à jour l’état de session; `renderAuthenticatedRoutes()` décrit les routes disponibles. |
| `App()` | Monte l’application dans `BrowserRouter`. |

### Formulaire et règles de saisie

| Fonction | Fichier | Responsabilité |
|---|---|---|
| `FieldControl(props)` | [`frontend/src/components/SaisieForm.jsx`](./frontend/src/components/SaisieForm.jsx) | Choisit le contrôle (`Select`, `TextInput`, `SuggestionInput`) selon le type de champ, notamment les options dépendantes et les champs personnalisés. |
| `SaisieForm(props)` | même fichier | Initialise le jeu de champs; tient les erreurs et états personnalisés; rend et valide les contrôles; appelle `onSubmit` seulement après validation du formulaire entier. |
| `defaults()` / `getCustomFields(values)` | même fichier | Fusionnent champs vides, valeurs initiales et valeurs par défaut; reconnaissent les anciennes valeurs de select absentes du dictionnaire comme valeurs libres. |
| `setError(name,error)` | même fichier | Ajoute ou supprime une erreur de champ. |
| `handleChange(name,raw)` | même fichier | Normalise l’entrée et réinitialise les champs descendants lorsque changent Type de Produit, Type de Confiserie ou saison. La saisie d’un espace après un nombre dans `Onces Totales` ajoute `GR`; le suffixe reste éditable. |
| `handleBlur(name)` | même fichier | Trie les champs libres éligibles, normalise les séparateurs et valide la valeur au départ du champ. |
| `handleSubmit(event)` | même fichier | Normalise et trie les données, exécute `validateAll()`, focalise le premier champ en erreur puis appelle le callback avec les valeurs acceptées. |
| `handleReset(event)` | même fichier | Restaure les valeurs par défaut et efface erreurs, valeurs personnalisées et confirmations de pluriel. |
| `fieldType(name)`, `getFieldOptions(name, values)`, `emptyValues()` | [`frontend/src/data/fields.js`](./frontend/src/data/fields.js) | Décrivent les champs, génèrent leurs options (dont les dépendances confiserie/saison) et créent le formulaire initial. `fieldId()` crée les identifiants HTML; `isWide()` choisit les champs pleine largeur. |
| `getRules(name, values, customFields)`, `validate(value,rules)`, `validateAll(values,…)` | [`frontend/src/data/rules.js`](./frontend/src/data/rules.js) | Composent et appliquent les règles par défaut et spécifiques; la validation globale ajoute le contrôle de pluriel. |
| `formatValue(s)` / `parseNumber(s)` | même fichier | Normalisent les caractères et acceptent la virgule française lors du calcul des nombres. |
| `hasPluralWord(value)` / `requiresPluralVerification(name,customFields)` | même fichier | Détectent les formes terminées par S/X (avec exceptions) pour demander une confirmation sur les champs concernés. |
| `normalizeSeparators(value)` | [`frontend/src/data/textRules.js`](./frontend/src/data/textRules.js) | Uniformise les espaces autour de `/` et `&`. |
| `compareByInitial(left,right)` / `compareSlashBlocks(left,right)` | même fichier | Fournissent un ordre accent-insensible pour les termes et blocs de texte libre. |
| `sortFreeText(value)` | même fichier | Trie les blocs séparés par slash et les composantes séparées par esperluette, sans changer les champs explicitement exclus. |
| `sortPerfume(value)` | même fichier | Conserve les formulations officielles; sinon trie la partie parfum tout en gardant le préfixe `CHOCOLAT` en tête. |
| `shouldSortFreeText(name,customFields)` | même fichier | Indique les champs de texte libre à trier, en tenant compte des exceptions (marques, libellé produit, spécialité). |

### Distribution, tableaux et composants

| Fonction | Fichier | Responsabilité |
|---|---|---|
| `useSourceRow(rowIndex)` | [`frontend/src/data/useSourceRow.js`](./frontend/src/data/useSourceRow.js) | Charge une ligne source via le plugin Vite, annule les requêtes obsolètes et expose chargement, erreur, limites et valeurs. |
| `groupStatusClass(status)` / `sourceValue(values,field)` | [`frontend/src/pages/DistributionPages.jsx`](./frontend/src/pages/DistributionPages.jsx) | Choisissent la classe de statut et recherchent un champ source indépendamment des accents et de la casse. |
| `Breadcrumbs(items)` / `LinePagination(props)` / `NotFoundPage()` | même fichier | Présentent le chemin courant, changent de ligne à l’intérieur du bloc/vers le bloc voisin et affichent une route invalide. |
| `DistributionHomePage(props)` | même fichier | Calcule les groupes de 50, charge et met à jour leurs statuts, affiche les erreurs par bloc. `saveGroupStatus()` enregistre puis actualise l’état local. |
| `DistributionGroupPage()` | même fichier | Vérifie l’alignement du bloc, calcule sa dernière ligne et liste ses liens de lignes. |
| `DistributionLinePage(props)` | même fichier | Charge l’enregistrement associé à la ligne, fusionne valeurs source et saisie, gère le hors-scope et la validation, puis navigue à la ligne suivante. `saveOutOfScope()`, `handleScopeChange()`, `handleSave()` et `handleFormChange()` coordonnent ces actions. |
| `key(header)` / `lookup(values,attribute)` / `SourceTable(values)` | [`frontend/src/components/SourceTable.jsx`](./frontend/src/components/SourceTable.jsx) | Normalisent les en-têtes, retrouvent les colonnes du classeur et affichent les champs source en lecture seule. |
| `DataTable`, `Field`, `Section`, `Button`, `Select`, `TextInput`, `TextArea` | [`frontend/src/components/ui/`](./frontend/src/components/ui/) | Composants de présentation simples qui standardisent tableau, champ, section, bouton et contrôles HTML. |
| `calculateLabelInformation(selectedLabels)` | [`frontend/src/components/labels/labelRules.js`](./frontend/src/components/labels/labelRules.js) | Version frontend du calcul des quatre attributs dérivés de labels. |
| `LabelMultiSelect({value,onChange})` | [`frontend/src/components/labels/LabelMultiSelect.jsx`](./frontend/src/components/labels/LabelMultiSelect.jsx) | Calcule la liste et les attributs dérivés, puis appelle `toggle(label)` pour ajouter/retirer un label. |
| `groupOf(page,size)` / `Pagination(props)` | [`frontend/src/components/ui/Pagination.jsx`](./frontend/src/components/ui/Pagination.jsx) | Calcule les groupes de pages, valide un changement de page et traite la saisie directe `search(text)`. |
| `activePrefix(value)` / `SuggestionInput(props)` | [`frontend/src/components/ui/SuggestionInput.jsx`](./frontend/src/components/ui/SuggestionInput.jsx) | Isole le dernier segment de texte; attend brièvement puis interroge l’API, annule les appels dépassés et gère sélection clavier/souris via `choose()` et `handleKeyDown()`. |
| `reportClientError(context,error)` / `userErrorMessage(context,error)` | [`frontend/src/utils/clientErrors.js`](./frontend/src/utils/clientErrors.js) | Journalise un contexte d’erreur et choisit un message utilisable par l’interface. |

### Documentation latérale, statistiques et monitoring

| Fonction | Fichier | Responsabilité |
|---|---|---|
| `maxWidth()` / `clampWidth(value)` / `savedWidth()` | [`frontend/src/components/ui/DocsPanel.jsx`](./frontend/src/components/ui/DocsPanel.jsx) | Calculent les bornes du panneau consignes et récupèrent sa largeur persistée. |
| `DocsPanel()` | même fichier | Affiche les PDF, change d’onglet, ouvre/ferme avec F1/Escape et redimensionne le panneau avec la souris ou le tactile. `startResize()`, `toggleWide()` et le gestionnaire clavier contrôlent les interactions. |
| `dateInNairobi(date)` / `displayDate(value)` / `downloadCsv(filename,rows)` | [`frontend/src/pages/StatisticsPage.jsx`](./frontend/src/pages/StatisticsPage.jsx) | Formattent les bornes et dates de KPI; produisent un CSV échappé et compatible tableur. |
| `QualityDonut(props)` / `DailyProductivityChart({daily})` / `KpiDetail(props)` | même fichier | Affichent le taux qualité, les 14 derniers jours et la synthèse détaillée d’un agent. |
| `StatisticsPage({users,user})` | même fichier | Charge les performances réelles, actualise toutes les 30 secondes, restreint l’Agent à son profil, applique une période et prépare l’export CSV Excel/Power BI. Les callbacks `load()`, `applyRange()` et `exportReport()` assurent chargement, application de période et export. |
| `MetricCard(props)` / `MonitoringPage({storageMode})` | [`frontend/src/pages/MonitoringPage.jsx`](./frontend/src/pages/MonitoringPage.jsx) | Affichent la disponibilité API et le stockage annoncé; `checkApi()` mesure le temps de réponse du health check toutes les 30 secondes. Les métriques historiques de ressources et de sécurité ne sont pas collectées et ne sont pas simulées. |

## 7. Champs, dépendances et règles à maintenir

- Les champs éditables et leurs valeurs initiales figurent dans
  [`frontend/src/data/fields.js`](./frontend/src/data/fields.js) et sa copie
  backend [`backend/src/config/vendor/fields.js`](./backend/src/config/vendor/fields.js).
- Les règles frontend doivent rester cohérentes avec
  [`backend/src/config/vendor/rules.js`](./backend/src/config/vendor/rules.js)
  et le moteur [`backend/src/rules/index.js`](./backend/src/rules/index.js).
- Les dépendances de **Type De Confiserie** déterminent notamment la spécialité,
  la garniture et le creux/plein. Les choix saisonniers pilotent les formes
  saisonnières correspondantes.
- `Compte Total` a une valeur initiale `1`. `Onces Totales` reste un champ
  numérique, mais accepte une unité en texte; l’espace après la partie numérique
  complète automatiquement `GR`. Les entrées sont mises en majuscules.
- Les suggestions prédéfinies par champ vivent dans
  [`backend/src/data/semanticSuggestionCatalog.js`](./backend/src/data/semanticSuggestionCatalog.js).
  Les nouvelles valeurs de dictionnaire ajoutées ici sont disponibles dès leur
  préfixe correspondant; les suggestions apprises requièrent au moins 20 usages.
- La normalisation de texte a plusieurs responsabilités : le client normalise
  les entrées pour guider l’utilisateur; le backend normalise à nouveau avant
  validation et persistance, sans faire confiance au client.

## 8. Tests et changements

Les tests backend sont sous [`backend/test/`](./backend/test/) et se lancent
avec `npm test` depuis `backend`. Pour une modification des règles, commencer
par les tests concernés (`core.test.js`); pour les dictionnaires de
suggestions, exécuter `suggestions.test.js`. Le build frontend se lance avec
`npm run build` depuis `frontend`.

Lorsqu’un changement touche les règles ou la configuration de champs,
vérifier les copies frontend/backend et ajouter des tests des deux comportements
si nécessaire. Pour une modification du workflow, vérifier le statut courant,
les révisions, les audits et les cas idempotents. Pour une route mutative,
vérifier également l’authentification, le rôle et la protection CSRF.
