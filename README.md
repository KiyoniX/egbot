# Bot de leçon quotidienne

> ⚠️ **Projet personnel et expérimental, fourni sans garantie.** Il n'est affilié à aucune plateforme citée. Chaque utilisateur est seul responsable de son usage : respect des conditions d'utilisation des plateformes, du règlement de son établissement ou de son employeur, et de la loi. L'auteur décline toute responsabilité. Lisez l'[avertissement complet](AVERTISSEMENT.md) avant toute utilisation.

Ce bot fait à votre place une leçon en ligne quotidienne : un formulaire de questions suivi d'une correction. Il a été mis au point sur **Gymglish**, et se règle pour d'autres plateformes du même genre. Une seule installation, sur un serveur Linux, gère plusieurs personnes.

Toutes les 15 minutes, pour chaque personne, le bot :

1. cherche s'il y a une nouvelle leçon, soit dans son espace sur la plateforme (**mode web**), soit dans une boîte mail (**mode mail**) ;
2. si oui, lance une IA qui ouvre la leçon dans un navigateur sans écran, déjà connecté au compte de la personne, et la remplit ;
3. termine la leçon côté plateforme, demande l'épisode suivant, et prévient sur Discord avec le temps mis et le compte rendu de l'IA.

Des [extensions](docs/extensions.md) locales peuvent compléter ce déroulé, par exemple avec de nouvelles consignes pour l'IA, des outils supplémentaires ou une autre mesure de la durée.

Tant qu'il n'y a pas de nouvelle leçon, l'IA n'est pas lancée : rien n'est consommé.

> **À savoir avant de l'utiliser.** Le bot fait les leçons à votre place : vous n'apprenez rien, et si la plateforme sert à vous évaluer (école, entreprise), c'est un travail que vous rendez sans l'avoir fait. L'utilisation d'un robot est aussi en général contraire aux conditions d'utilisation de ces plateformes. C'est à chacun de décider, en connaissance de cause.

## Sommaire

1. [Ce qu'il faut avoir](#ce-quil-faut-avoir)
2. [Choisir l'IA](#choisir-lia)
3. [Installer sur le serveur](#installer-sur-le-serveur)
4. [Configurer](#configurer)
5. [Connecter chaque personne à la plateforme](#connecter-chaque-personne-à-la-plateforme)
6. [Tester, puis activer](#tester-puis-activer)
7. [Ce que fait une leçon, étape par étape](#ce-que-fait-une-leçon-étape-par-étape)
8. [Suivi au quotidien](#suivi-au-quotidien)
9. [Ajouter ou retirer quelqu'un](#ajouter-ou-retirer-quelquun)
10. [Adapter à une autre plateforme](#adapter-à-une-autre-plateforme)
11. [Dépannage](#dépannage)
12. [Mettre à jour, mettre en pause, désinstaller](#mettre-à-jour-mettre-en-pause-désinstaller)
13. [Sécurité](#sécurité)

## Ce qu'il faut avoir

| Élément | Détail |
|---|---|
| Un serveur Linux | Ubuntu Server de préférence, x86 ou ARM. 1 à 2 vCPU, 2 Go de RAM, 10 Go de disque. Une VM, pas un conteneur LXC. Accès SSH. Les droits sudo ne servent qu'une fois, pour les bibliothèques du navigateur. |
| Une IA en ligne de commande | Claude Code, Codex (OpenAI) ou Gemini CLI, avec un abonnement ou une clé API (voir plus bas). |
| Les comptes de la plateforme | Chaque personne doit pouvoir se connecter une fois, par un lien de connexion reçu par mail (Gymglish) ou par un identifiant et un mot de passe. |
| Facultatif : un webhook Discord | Pour être prévenu à chaque leçon. |
| Mode mail seulement : une boîte dédiée | Accessible en IMAP SSL (port 993). Inutile en mode web, le mode conseillé pour Gymglish. |

Aucun port n'est à ouvrir sur le serveur : le bot ne fait que des connexions sortantes.

**Pas de serveur ?** Le guide [Obtenir un serveur gratuit chez Oracle](docs/serveur-oracle-gratuit.md) explique comment en avoir un gratuitement (2 cœurs ARM, 12 Go de RAM, 200 Go), quelle région choisir, et donne d'autres solutions d'hébergement.

## Choisir l'IA

Le bot ne dépend pas d'une IA en particulier : il lance un **agent en ligne de commande** et lui donne le navigateur (Playwright MCP), plus les outils éventuels des [extensions](docs/extensions.md). Le choix se fait avec le champ `agent` de `config.json`, pour tout le monde ou pour une personne seulement.

| `agent` | Outil | Installation | Secret dans `.env` | État |
|---|---|---|---|---|
| `claude` (défaut) | Claude Code (Anthropic) | Installé avec le bot | `CLAUDE_CODE_OAUTH_TOKEN` (abonnement) ou `ANTHROPIC_API_KEY` | Testé en conditions réelles |
| `codex` | Codex CLI (OpenAI) | `npm install @openai/codex` dans le dossier du bot | `CODEX_API_KEY`, ou une connexion `codex login` | Non testé |
| `gemini` | Gemini CLI (Google) | `npm install @google/gemini-cli` dans le dossier du bot | `GEMINI_API_KEY` | Non testé |

Le code de chaque intégration est dans `agents.mjs`. Les deux intégrations non testées suivent la documentation officielle de novembre 2026 : faites le test complet de l'étape 6 avant de les laisser tourner seules.

### Claude (`claude`)

- **Abonnement Claude (Pro, Max)** : sur votre PC, lancez `claude setup-token`, puis copiez le jeton affiché (il commence par `sk-ant-oat01-`) dans `CLAUDE_CODE_OAUTH_TOKEN`. Chaque leçon est décomptée de cet abonnement.
- **Clé API** : mettez-la dans `ANTHROPIC_API_KEY`, l'usage est alors facturé à la consommation.
- `model` dans `config.json` : vide pour le modèle par défaut, ou par exemple `sonnet` ou `haiku`.

### Codex (`codex`)

- Installation : `npm install @openai/codex` dans le dossier du bot (ou une installation globale, le bot la trouve dans le `PATH`).
- **Clé API** : mettez-la dans `CODEX_API_KEY`.
- **Abonnement ChatGPT** : connectez-vous une fois sur le serveur, dans le dossier propre à la personne. OpenAI conseille toutefois les clés API pour l'automatisation.
  ```bash
  CODEX_HOME=users/<id>/codex codex login --device-auth
  ```
- Le bot écrit à chaque leçon la configuration de Codex dans `users/<id>/codex/config.toml`, avec les outils du bot, leur temps maximal d'appel et leur approbation automatique.
- **Point d'attention** : en mode non interactif, Codex annulait les appels d'outils MCP qui demandaient une approbation (ticket `openai/codex#24135`). Le bot règle `default_tools_approval_mode = "approve"` sur ses deux outils, qui est la parade rapportée par les utilisateurs. Si le journal montre « user cancelled MCP tool call », votre version de Codex ne la prend pas en compte.
- Codex n'a pas de limite d'actions : `maxTurns` ne s'applique pas, seul le délai maximal de 45 minutes par leçon compte.

### Gemini (`gemini`)

- Installation : `npm install @google/gemini-cli` dans le dossier du bot.
- **Clé API** Google AI Studio dans `GEMINI_API_KEY`.
- Le bot écrit ses réglages dans `users/<id>/.gemini/settings.json`, les réglages du dossier de travail : les deux outils, marqués de confiance (`trust`) pour s'exécuter sans confirmation, et la limite `maxTurns`.
- En mode non interactif, Gemini refuse de lui-même les autres outils qui demandent une confirmation, comme le shell ou l'écriture de fichiers.
- **Point d'attention** : Google a remplacé Gemini CLI par Antigravity CLI pour les comptes gratuits le 18 juin 2026. Gemini CLI reste utilisable avec une clé API, mais vérifiez que c'est toujours le cas pour la vôtre.

### Ajouter une autre IA

Tout outil qui sait, en ligne de commande et sans intervention humaine, lire une consigne, utiliser des serveurs MCP en `stdio` et écrire sa réponse finale sur la sortie standard peut convenir. Ajoutez une fonction dans l'objet `ADAPTERS` de `agents.mjs`, sur le modèle des trois existantes. Elle reçoit la personne, la consigne et les serveurs MCP des extensions ; elle écrit la configuration MCP au format de l'outil (avec `mcpServers(user, extra)` pour avoir la liste complète), et renvoie `{ stdout, stderr }`. La réponse finale doit se terminer par la ligne `RESULT: …` demandée dans `prompt.md`.

## Installer sur le serveur

Les commandes sont à lancer avec un utilisateur normal, pas `root`.

### 1. Copier le dossier

Depuis le dossier `server`, sur votre PC :

```powershell
tar --exclude=node_modules --exclude=users --exclude=logs --exclude=.env -czf ..\quizbot.tgz .
scp ..\quizbot.tgz utilisateur@adresse-du-serveur:~
```

Sur le serveur :

```bash
mkdir -p ~/quizbot && tar -xzf ~/quizbot.tgz -C ~/quizbot && rm ~/quizbot.tgz
cd ~/quizbot
```

### 2. Installer Node 22

Le paquet Node d'Ubuntu est trop ancien. Prenez l'une des deux méthodes.

Avec sudo :

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Sans sudo, dans votre dossier personnel. Remplacez `linux-x64` par `linux-arm64` sur un serveur ARM.

```bash
mkdir -p ~/.local/node
curl -fsSL https://nodejs.org/dist/latest-v22.x/ | grep -o 'node-v22[^"]*-linux-x64.tar.xz' | head -1 \
  | xargs -I{} curl -fsSL https://nodejs.org/dist/latest-v22.x/{} | tar -xJ -C ~/.local/node --strip-components=1
echo 'export PATH=$HOME/.local/node/bin:$PATH' >> ~/.bashrc && export PATH=$HOME/.local/node/bin:$PATH
node -v
```

### 3. Dépendances, navigateur et fichiers de départ

```bash
bash setup.sh
```

Le script installe les dépendances et Chromium, puis crée `config.json` (à partir de `config.example.json`) et `.env`. L'installation de Chromium demande le mot de passe sudo, pour ses bibliothèques système.

Sans sudo du tout : remplacez dans `setup.sh` la ligne `npx playwright install --with-deps chromium` par `npx playwright install chromium`. Faites ensuite installer les bibliothèques par un administrateur. Par exemple, sur Ubuntu 24.04 et plus récent :

```bash
sudo apt-get install -y libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2 \
  libcups2t64 libgbm1 libpango-1.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  fonts-liberation fonts-noto-color-emoji
```

Pour voir ce qui manque encore : `ldd ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome | grep "not found"`.

### 4. L'IA choisie

Si vous avez choisi `codex` ou `gemini`, installez-la maintenant (voir [Choisir l'IA](#choisir-lia)). Claude Code est déjà installé.

### 5. Secrets

```bash
nano .env
```

Remplissez la clé de votre IA et, si vous le voulez, `DISCORD_WEBHOOK_URL`. Les autres lignes sont expliquées dans le fichier. Une ligne propre à une personne prend le suffixe de son `id`, en majuscules, avec `-` remplacé par `_` (par exemple `GEMINI_API_KEY_ALEX`) ; elle passe avant la ligne commune.

## Configurer

Ouvrez `config.json`. Le fichier de départ est réglé pour Gymglish en mode web : en général, il suffit d'y mettre les personnes.

### Les personnes

```json
"users": [
  { "id": "alex", "name": "Alex", "email": "alex@exemple.fr", "discordMention": "<@123456789>" },
  { "id": "sam",  "name": "Sam",  "email": "sam@exemple.fr",  "agent": "gemini" }
]
```

| Champ | À mettre |
|---|---|
| `id` | Identifiant court, sans espace ni accent (lettres, chiffres, `-`, `_`). Il sert dans les commandes, les noms de dossiers et les suffixes de `.env` : ne le changez plus ensuite. |
| `name` | Nom affiché dans les messages Discord. |
| `email` | L'adresse du compte sur la plateforme. Elle sert à demander le lien de connexion, et en mode mail à trier les mails. |
| `discordMention` | Facultatif : `<@IDENTIFIANT>` pour une personne, `<@&IDENTIFIANT>` pour un rôle, `@everyone`. L'identifiant s'obtient par clic droit, puis « Copier l'identifiant » (mode développeur de Discord activé). |

Une personne peut aussi redéfinir dans son bloc n'importe quel réglage commun : `agent`, `model`, `notes`, `unlockHours`, etc. Les champs inconnus du bot restent disponibles pour les extensions.

### Réglages communs

| Champ | Défaut | Rôle |
|---|---|---|
| `agent` | `claude` | IA qui fait les leçons : `claude`, `codex` ou `gemini`. |
| `model` | vide | Modèle de l'IA ; vide = modèle par défaut de l'outil. |
| `unlockHours` | `6` | Délai minimal entre deux leçons d'une même personne. |
| `retryMinutes` | `60` | Attente avant un nouvel essai après un échec. |
| `maxTurns` | `150` | Nombre maximal d'actions de l'IA par leçon (Claude, Gemini). |
| `notes` | vide | Précisions transmises à l'IA à chaque leçon. |
| `browser`, `headless` | `chromium`, `true` | Navigateur du bot, sans fenêtre. |
| `noSandbox` | `false` | À passer à `true` si Chromium refuse de démarrer (voir Dépannage). |

### Où le bot trouve la leçon

**Mode web**, conseillé pour Gymglish. Le bot ouvre la page des épisodes de la personne, sans IA, et repère le lien de la dernière leçon. Il ne lance l'IA que si cette leçon a un identifiant qu'il n'a pas encore fait. Il faut laisser `imap.host` vide.

| Champ | Valeur pour Gymglish | Rôle |
|---|---|---|
| `quizDomain` | `gymglish.com` | Seuls les liens `https` de ce domaine sont ouverts. |
| `lessonListUrl` | `https://www.gymglish.com/gymglish/workbook/episodes` | Page qui liste la dernière leçon. |
| `lessonLinkPattern` | `/show-lesson/(\\d+)/` | Forme du lien d'une leçon ; le nombre capturé est son identifiant. |
| `loginRequestUrl` | `https://www.gymglish.com/gymglish/workbook/login` | Page où demander un lien de connexion. |
| `finishButton` | `input[type=submit][name=SENDBUTTON][value="Terminer"]` | Bouton de fin, en bas de la correction. |
| `finishUrlPattern` | `/workbook/end` | Page affichée une fois la leçon terminée. |
| `nextEpisodeButton` | `form input[type=submit][value="Prochain épisode"]` | Bouton de la page de fin qui demande l'épisode suivant. Retirez-le pour attendre l'envoi normal de la plateforme. |

**Mode mail**, pour une plateforme qui ne liste pas ses leçons. Chaque personne redirige les mails de leçon vers une boîte dédiée, avec une règle « Rediriger vers » plutôt que « Transférer ». Le bot lit cette boîte en IMAP et y prend le lien de la leçon. Il faut remplir `imap.host` (par exemple `ssl0.ovh.net`), `imap.user`, et `IMAP_PASSWORD` dans `.env`. Deux filtres sont facultatifs : `mailSubjectContains`, un bout de l'objet du mail, et `linkContains`, un bout de l'URL de la leçon. Une messagerie d'école ou d'entreprise (Microsoft 365, Google Workspace) refuse en général l'accès IMAP par mot de passe : c'est pour ça que le mode web existe.

## Connecter chaque personne à la plateforme

Le navigateur du bot garde la session de chaque personne dans `users/<id>/browser-profile`.

### Gymglish et autres connexions par lien

Sur le serveur :

```bash
node login.mjs --user alex --request
```

La plateforme envoie un lien de connexion à l'`email` de la personne. Elle copie ce lien sans cliquer dessus (clic droit, « Copier l'adresse du lien »), puis :

```bash
node login.mjs --user alex --link "https://www.gymglish.com/gymglish/workbook/tl/..."
```

Le script confirme la connexion et affiche la dernière leçon trouvée. Le lien Gymglish (`/workbook/tl/...`) est réutilisable : mettez-le aussi dans `.env` (`LOGIN_LINK_ALEX=...`), et le bot se reconnectera seul quand la session expirera.

### Plateformes à identifiant et mot de passe

Sur un PC avec Chrome, avec le dossier du bot et le même `config.json` :

```powershell
npm ci
node export-session.mjs --user alex
```

Chrome s'ouvre sur la plateforme : la personne se connecte, puis appuie sur Entrée dans le terminal. Copiez le fichier `session-alex.json` dans `~/quizbot` sur le serveur, puis lancez :

```bash
node import-session.mjs --user alex
```

La session est chargée dans le navigateur du bot, et le fichier est supprimé.

## Tester, puis activer

Faites les vérifications dans l'ordre :

```bash
# 1. La leçon est-elle trouvée ?
node find-lesson.mjs --user alex                 # mode web : affiche { id, url }
node --env-file=.env fetch-link.mjs              # mode mail : affiche le lien des 3 derniers jours

# 2. Une leçon complète, tout de suite.
node --env-file=.env run.mjs --user alex --force

# 3. Les notifications Discord (un message par personne).
node --env-file=.env run.mjs --test-discord

# 4. Quand le test 2 donne DONE et que la plateforme montre la leçon terminée : exécution automatique.
bash setup.sh --cron
```

Si Node est installé dans `~/.local/node`, lancez `setup.sh --cron` depuis un terminal où `node` fonctionne : la ligne du cron reprend le `PATH` de ce moment-là. Vérifiez-la avec `crontab -l`.

## Ce que fait une leçon, étape par étape

1. **Recherche** (sans IA). En mode web, le bot ouvre la page des épisodes ; si la session a expiré et qu'un `LOGIN_LINK_<ID>` existe, il se reconnecte. Il ne va plus loin que si la leçon est nouvelle et que `unlockHours` est écoulé.
2. **Extensions** (facultatif) : `beforeLesson` ajoute ses consignes et ses outils.
3. **L'IA fait la leçon** selon `prompt.md`. Elle lit le texte, les fiches d'aide et les questions, puis remplit tout. Elle clique ensuite sur « Voir mon score », puis « Accéder à la correction », relève le score et s'arrête.
4. **Fin de leçon** (sans IA). Le bot clique lui-même sur « Terminer » et attend la page de fin. C'est ce clic qui fait compter la leçon. Il clique ensuite sur « Prochain épisode ».
5. **Notification Discord** : résultat, temps mis (durée de l'exécution, ou celle mesurée par une extension) et résumé de l'IA (nombre de réponses, score affiché).

Si l'étape 4 échoue, la leçon n'est pas notée comme faite : le bot réessaie plus tard, et le signale sur Discord.

## Suivi au quotidien

| Besoin | Commande ou fichier |
|---|---|
| Ce que le bot a fait | `logs/AAAA-MM-JJ.log` : chaque ligne porte l'`id` de la personne. On y trouve le compte rendu de l'IA, la fin de leçon et le temps mis. |
| Sortie du cron | `logs/cron.log` : les mêmes lignes, plus les erreurs éventuelles. |
| Dernière leçon faite, dernier résultat | `users/<id>/state.json` |
| Quelle leçon serait prise maintenant | `node find-lesson.mjs --user <id>` |
| Faire une leçon tout de suite | `node --env-file=.env run.mjs --user <id> --force` |
| Faire une leçon précise | `node --env-file=.env run.mjs --user <id> --url "https://..."` |
| Vérifier le cron | `crontab -l` |
| Changer les consignes de l'IA | `prompt.md` |

Résultats possibles d'une leçon :

| Résultat | Signification | Suite |
|---|---|---|
| `DONE` | Leçon envoyée et terminée. | Leçon suivante quand elle apparaît, après `unlockHours`. |
| `ALREADY_DONE` | Leçon déjà faite, par exemple à la main. | Le bot la termine si besoin, puis attend la suivante. |
| `LOCKED` | Leçon encore verrouillée. | Nouvel essai après `retryMinutes`. |
| `LOGIN_REQUIRED` | La plateforme demande une connexion. | Refaire la connexion de cette personne. |
| `ERROR` | Tout autre problème. | Lire le journal du jour ; nouvel essai après `retryMinutes`. |

Une leçon réussie est toujours annoncée sur Discord. Un échec n'est annoncé qu'une fois, pas à chaque nouvel essai.

## Ajouter ou retirer quelqu'un

Pour ajouter une personne :

1. Ajoutez son bloc dans `users` du `config.json` du serveur.
2. Si elle a sa propre IA ou sa propre clé, ajoutez sa ligne dans `.env` (`..._<ID>`).
3. Connectez-la à la plateforme (voir plus haut).
4. Testez avec `node --env-file=.env run.mjs --user <id> --force`.

Il n'y a rien à relancer : le cron la prend en compte au passage suivant. Les personnes sont traitées l'une après l'autre, jamais en même temps.

Pour retirer quelqu'un, supprimez son bloc de `config.json`, le dossier `users/<id>` et ses lignes de `.env`.

## Adapter à une autre plateforme

1. **Domaine et recherche de la leçon** : `quizDomain`, puis le mode web (`lessonListUrl`, `lessonLinkPattern`) ou le mode mail. Avec `node find-lesson.mjs --user <id>`, vérifiez que la bonne leçon est trouvée.
2. **Fin de leçon** : `finishButton`, `finishUrlPattern` et `nextEpisodeButton` sont des sélecteurs CSS des boutons de la plateforme. Trouvez-les avec l'inspecteur du navigateur (clic droit sur le bouton, « Inspecter »). Si la plateforme n'a pas d'étape de fin, retirez ces trois champs.
3. **Consignes de l'IA** : la partie « Méthode du questionnaire » de `prompt.md` décrit Gymglish (types de questions, boutons, pièges). Réécrivez-la pour la nouvelle plateforme, en gardant les marques `{{...}}` et la ligne `RESULT:` finale.
4. **Connexion** : `login.mjs` pour une connexion par lien (`loginRequestUrl`, et `loginUrlPattern` si la page de connexion n'a pas `/login` dans son adresse), sinon `export-session.mjs` et `import-session.mjs`.

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| Chromium ne démarre pas (« sandbox », « namespace ») | Restriction d'Ubuntu 24.04 et plus récent, ou bot lancé en root. | Passer `noSandbox` à `true`. |
| Chromium ne démarre pas (« error while loading shared libraries ») | Bibliothèques système manquantes. | Installer les paquets de l'étape 3 ; vérifier avec `ldd`. |
| `LOGIN_REQUIRED` | Session expirée. | Refaire `login.mjs --request`, puis `--link`, et mettre le lien dans `LOGIN_LINK_<ID>`. |
| Le bot ne trouve pas la leçon du jour | La plateforme ne l'a pas encore envoyée, ou la leçon précédente n'a pas été terminée. | `node find-lesson.mjs --user <id>` ; ouvrir la correction de la leçon précédente et vérifier qu'elle est terminée. |
| `DONE` mais la plateforme ne compte pas la leçon | L'étape de fin a échoué. | Chercher `Finish` dans le journal ; vérifier `finishButton` et `finishUrlPattern`. |
| Une extension n'est pas prise en compte | Fichier absent, mal placé ou en erreur. | Il doit s'appeler `extensions/index.mjs` ; tester avec `node --check extensions/index.mjs`, puis lire le journal. |
| Erreur d'authentification de l'IA | Clé ou jeton absent, expiré ou révoqué. | Refaire le jeton ou la clé, puis mettre `.env` à jour. |
| `Unknown agent` au lancement | Faute de frappe dans `agent`. | `claude`, `codex` ou `gemini`. |
| `spawn codex ENOENT` (ou `gemini`) | L'outil n'est pas installé. | `npm install @openai/codex` (ou `@google/gemini-cli`) dans le dossier du bot. |
| Codex : « user cancelled MCP tool call » | Votre version de Codex demande une approbation que personne ne peut donner. | Mettre Codex à jour, ou utiliser `claude` / `gemini`. |
| Mode mail : aucun mail trouvé | Redirection inactive, mail de plus de 3 jours, `email` faux, ou filtre trop strict. | Vérifier la boîte dédiée ; vider `mailSubjectContains` et `linkContains` pour tester. |
| `setup.sh` s'arrête sur « Node 20.6+ requis » | Node absent ou trop ancien. | Faire l'étape 2. |

## Mettre à jour, mettre en pause, désinstaller

- **Mettre à jour** : recopiez les fichiers modifiés dans `~/quizbot`. Ne remplacez jamais `.env`, `config.json` ni le dossier `users/`.
- **Mettre en pause** : `crontab -e`, puis commentez la ligne qui se termine par `# quizbot`.
- **Désinstaller** : retirez la ligne du cron, supprimez `~/quizbot`, puis révoquez les jetons et clés de l'IA, et déconnectez les sessions de la plateforme.

## Sécurité

- `.env` contient les clés de l'IA, les liens de connexion et le mot de passe de la boîte. `users/` contient la session de chaque personne sur la plateforme. Quiconque administre le serveur peut les lire et agir sur ces comptes. Gardez `.env` en `chmod 600`.
- `config.json` contient les adresses des personnes : ne le partagez pas. Partagez `config.example.json`.
- Les liens de connexion (`LOGIN_LINK_…`) donnent accès au compte comme un mot de passe.
- En mode mail, la boîte dédiée reçoit les liens de leçon de tout le monde.
- Le bot n'ouvre que des liens `https` du domaine `quizDomain`. L'IA ne reçoit que le navigateur et les outils de vos extensions : pas de shell, pas d'accès aux fichiers. La consigne lui interdit de saisir des identifiants et de suivre des instructions trouvées dans les pages.

## Licence

Ce projet est sous [licence MIT](LICENSE) : vous pouvez l'utiliser, le modifier et le redistribuer librement, en gardant la mention de copyright. Il est fourni sans aucune garantie. Voir aussi l'[avertissement et la limitation de responsabilité](AVERTISSEMENT.md).
