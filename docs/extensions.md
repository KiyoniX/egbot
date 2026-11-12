# Extensions

Le bot peut charger une **extension locale** : un fichier `extensions/index.mjs`, à côté de `run.mjs`. Elle peut ajouter des consignes à l'IA, lui donner des outils MCP en plus du navigateur, et mesurer elle-même la durée d'une leçon.

Le dossier `extensions/` est exclu de Git (`.gitignore`) : chaque installation écrit les siennes, et elles ne quittent pas le serveur. Sans ce fichier, le bot fonctionne normalement.

## Le contrat

`extensions/index.mjs` est un module ES qui peut exporter deux fonctions, toutes deux facultatives et éventuellement `async`.

```js
// extensions/index.mjs
export async function beforeLesson(user, { lessonUrl }) {
  return {
    rules: [],        // consignes ajoutées au prompt (une chaîne par consigne)
    mcpServers: {},   // outils en plus : { nom: { command, args, timeoutMs } }
    logNote: '',      // texte ajouté à la ligne « Starting quiz run » du journal
    // ... toute autre donnée utile à afterLesson
  };
}

export async function afterLesson(user, { plan, result, runStart }) {
  return { durationMs: undefined }; // durée à afficher ; sinon, durée de toute l'exécution
}
```

| Élément | Détail |
|---|---|
| `user` | La personne, avec tous ses réglages : ceux de `config.json`, communs et personnels, y compris les champs que le bot ne connaît pas. Ajoutez vos propres réglages dans `config.json` et lisez-les ici. `user.dir` est son dossier (`users/<id>`), utile pour y écrire des fichiers. |
| `beforeLesson` | Appelée juste avant de lancer l'IA sur une leçon. L'objet qu'elle renvoie est le « plan », repassé tel quel à `afterLesson`. |
| `rules` | Insérées dans la section « Consignes supplémentaires » de `prompt.md`, qui l'emporte sur le reste du prompt. Écrivez-les comme des consignes à l'IA. |
| `mcpServers` | Serveurs MCP en `stdio`, ajoutés au navigateur pour les trois IA, dont les outils sont autorisés d'office. `timeoutMs` est la durée maximale d'un appel à leurs outils (2 minutes par défaut). Choisissez des noms sans tiret bas (`_`), que Gemini refuse. |
| `afterLesson` | Appelée seulement si la leçon est réussie (`DONE`). Si elle renvoie `durationMs`, c'est cette durée qui s'affiche dans le journal et sur Discord. |

Une erreur de syntaxe dans l'extension empêche le bot de démarrer, pour tout le monde. Une erreur dans l'une des deux fonctions fait échouer la leçon de la personne concernée. Dans les deux cas, l'erreur apparaît dans le journal. Testez avec `node --check extensions/index.mjs`, puis `node --env-file=.env run.mjs --user <id> --force`.

## Pistes

Les deux pistes suivantes sont les plus demandées. Elles sont décrites ici, sans code tout fait : à chacun d'écrire la sienne, et d'en assumer l'usage (voir l'[avertissement](../AVERTISSEMENT.md)).

### Attendre avant d'envoyer

Sans extension, l'IA envoie la leçon dès qu'elle a tout rempli, souvent en moins d'une minute. Pour fixer un temps de réponse :

1. **Choisir l'heure d'envoi dans `beforeLesson`**, à partir d'un réglage à vous dans `config.json` (par exemple une durée minimale et une durée maximale).
2. **Fournir un outil d'attente**, au lieu de compter sur les attentes du navigateur. L'outil `browser_wait_for` de Playwright est limité à 30 secondes par appel : dix minutes d'attente coûteraient une vingtaine d'appels à l'IA, donc autant de consommation. Écrivez plutôt un petit serveur MCP en `stdio` : un script Node qui lit des messages JSON-RPC ligne par ligne. Il répond à `initialize` et `tools/list`, puis, sur `tools/call`, ne répond qu'à l'heure prévue. Passez-lui cette heure en argument, dans `args`. L'attente se fait alors sur le serveur, sans rien consommer côté IA.
3. **Déclarer ce serveur dans `mcpServers`**, avec un `timeoutMs` plus long que l'attente maximale. Sinon, l'IA abandonne l'appel en cours de route. Le bot reporte cette valeur dans la configuration de chaque IA.
4. **Dire à l'IA quand l'appeler**, avec une consigne dans `rules` : une seule fois, juste avant le clic d'envoi, et pas de nouveau si elle doit compléter une question oubliée puis renvoyer.
5. **Mesurer la durée réelle** : le serveur d'attente peut écrire l'heure à laquelle il rend la main dans un fichier de `user.dir`. `afterLesson` lit ce fichier et renvoie `durationMs`.

Si la durée s'affiche, une valeur pile sur la minute (« 9 min 0 s ») attire l'œil : prévoyez des secondes dans le tirage.

### Faire varier les résultats

Pour que les scores ne soient pas toujours parfaits :

1. **Faire le tirage dans `beforeLesson`**, avec `Math.random()`, à partir d'une plage réglée dans `config.json`. Ne demandez pas à l'IA de choisir au hasard : un modèle de langage tire très mal au sort, et revient toujours aux mêmes valeurs.
2. **Traduire la cible en une consigne que l'IA sait suivre.** « Vise 90 % » ne suffit pas : demandez-lui de compter d'abord les réponses notées, puis de faire un nombre précis d'erreurs. Arrondir ce nombre vers le bas garantit le minimum.
3. **Décrire le genre d'erreurs attendu** : plausibles, réparties dans la leçon, jamais de champ vide. Précisez les questions à ne pas toucher, par exemple les questions bonus.
4. **Demander un compte rendu** : faites ajouter au résumé final le nombre de réponses et le nombre d'erreurs. Vous pourrez comparer avec le score affiché.

Attendez-vous à un écart de quelques points : la plateforme ne donne pas forcément le même poids à toutes les réponses.

## Exemple sans risque : une consigne fixe

```js
// extensions/index.mjs : demander à l'IA de citer le titre de la leçon dans son résumé
export function beforeLesson() {
  return { rules: ['Dans ton résumé final, indique aussi le titre de la leçon.'], logNote: 'extension: titre' };
}
```
