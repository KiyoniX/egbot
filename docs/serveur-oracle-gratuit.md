# Obtenir un serveur gratuit chez Oracle pour héberger le bot

Le bot a besoin d'un serveur Linux allumé en permanence. L'offre **Always Free** d'Oracle Cloud en donne un gratuitement, sans limite de durée. C'est sur ce type de serveur que tourne l'installation de référence du bot.

Ce guide reflète l'offre de novembre 2026. Oracle la modifie régulièrement : vérifiez les chiffres sur la [page officielle des ressources Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) avant de vous lancer.

## Ce que l'on obtient vraiment

| Ressource | Offre gratuite actuelle | Pour le bot |
|---|---|---|
| Processeur | **2 OCPU ARM** (Ampere A1, forme `VM.Standard.A1.Flex`), soit 2 cœurs | Largement suffisant. |
| Mémoire | **12 Go** au total | Le bot en utilise environ 1 Go pendant une leçon. |
| Stockage | **200 Go** au total (disques de démarrage compris) | Le bot et le navigateur prennent moins de 2 Go. |
| Réseau | Une adresse IPv4 publique | Le bot n'a besoin d'aucun port ouvert. |

Quelques points à connaître :

- **Les chiffres qui circulent sont souvent périmés.** Oracle offrait autrefois 4 OCPU et 24 Go ; l'offre ARM a été réduite de moitié en 2026 ([InfoQ](https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/), [Linuxiac](https://linuxiac.com/?p=214114)). Certaines pages d'Oracle affichent encore les anciennes valeurs.
- **Ne dépassez pas 2 OCPU et 12 Go**, toutes instances ARM confondues. Au-delà, le compte ne reste pas gratuit : sur un compte gratuit, les instances en trop peuvent être désactivées, puis supprimées.
- **C'est de l'ARM** (architecture `aarch64`), pas du x86. Le bot fonctionne dessus : Node et Chromium existent en ARM, et il a été testé sur une instance Oracle ARM. Lors des téléchargements, prenez les versions `linux-arm64`.
- **Sur un compte gratuit, Oracle peut reprendre une instance inactive.** C'est le cas si, sur 7 jours, l'usage du processeur reste sous 20 % au 95e centile ; pour les instances ARM, le réseau et la mémoire peuvent aussi compter ([règles officielles](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm)). Le bot est très léger, donc concerné : voir [Éviter la reprise de l'instance](#éviter-la-reprise-de-linstance).

## 1. Choisir la bonne région : pas une capitale

À l'inscription, Oracle demande une **région d'origine** (*home region*). **Ce choix est définitif** : les ressources gratuites n'existent que dans cette région.

Les régions des grandes capitales, comme Paris, Londres, Madrid, Stockholm ou Amsterdam, sont très demandées. Leurs serveurs ARM gratuits sont souvent tous pris : la création de l'instance échoue alors avec **« Out of capacity for shape VM.Standard.A1.Flex »**, parfois pendant des semaines.

Prenez plutôt une région proche de chez vous mais moins prisée. En France, **Marseille** (`eu-marseille-1`) convient bien : l'instance de référence du bot y tourne. Milan et Zurich sont d'autres possibilités en Europe. La [liste des régions](https://docs.oracle.com/en-us/iaas/Content/General/Concepts/regions.htm) donne les autres. Pour le bot, la distance avec le serveur n'a pas d'importance.

## 2. Créer le compte

1. Allez sur [oracle.com/cloud/free](https://www.oracle.com/cloud/free/), puis « Start for free » ([inscription directe](https://signup.cloud.oracle.com/)).
2. Renseignez vos coordonnées, puis choisissez la **région d'origine** (voir plus haut).
3. Une **carte bancaire** est demandée pour vérifier votre identité. Oracle fait une petite autorisation, sans débit, et ne facture rien tant que vous restez dans l'offre Always Free. Les cartes prépayées ou virtuelles sont souvent refusées.
4. Le compte commence par 30 jours d'essai avec un crédit. À la fin, il repasse en Always Free. Créez l'instance dans les limites gratuites dès le départ : vous n'aurez rien à changer à la fin de l'essai.

## 3. Créer le serveur

Le guide officiel d'Oracle pour cette étape est [Creating an Instance](https://docs.oracle.com/en-us/iaas/Content/GSG/Tasks/launchinginstance.htm). En résumé :

1. Menu ☰ → **Compute** → **Instances** → **Create instance**.
2. **Nom** : par exemple `bot-lecons`.
3. **Image and shape** → **Edit** :
   - **Image** : *Canonical Ubuntu*, la dernière version LTS. Vérifiez qu'elle est bien en `aarch64`.
   - **Shape** : *Ampere* → `VM.Standard.A1.Flex`, avec **2 OCPU** et **12 Go** de mémoire. C'est le maximum gratuit ; 1 OCPU et 6 Go suffisent aussi au bot.
   - Vérifiez que le badge **« Always Free-eligible »** s'affiche.
4. **Networking** : laissez le réseau virtuel (VCN) créé par défaut, et cochez **Assign a public IPv4 address**.
5. **Add SSH keys** :
   - le plus simple : **Generate a key pair for me**, puis téléchargez la **clé privée** et gardez-la précieusement : elle ne sera plus proposée ;
   - ou bien, si vous avez déjà une clé : **Upload public key files**. Sous Windows, vous pouvez en créer une avec `ssh-keygen -t ed25519` dans PowerShell.
6. **Boot volume** : la taille par défaut (environ 50 Go) suffit. Le total de vos disques ne doit pas dépasser 200 Go.
7. **Create**. Au bout d'une à deux minutes, l'instance passe à l'état *Running*. Notez son **adresse IP publique**.

### Si la création échoue avec « Out of capacity »

- Réessayez plus tard : de la place se libère régulièrement, souvent la nuit.
- Si la région a plusieurs domaines de disponibilité (AD-1, AD-2…), essayez-en un autre.
- Essayez une forme plus petite, par exemple 1 OCPU et 6 Go : elle suffit au bot.
- Passer le compte en **Pay As You Go** (payant à l'usage) donne souvent accès aux serveurs plus facilement, et ce qui reste dans les limites Always Free reste gratuit. Tout dépassement est en revanche facturé : créez alors un **budget avec alerte** (Billing → Budgets).

## 4. Se connecter au serveur

Sous Windows (PowerShell), Linux ou macOS :

```bash
ssh -i chemin/vers/la-cle-privee.key ubuntu@ADRESSE_IP
```

L'utilisateur par défaut des images Ubuntu est `ubuntu`. Si `ssh` refuse une clé « too open » sous Linux ou macOS : `chmod 600 la-cle-privee.key`. Le guide officiel est [Connecting to an Instance](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/accessinginstance.htm).

Une fois connecté, mettez le système à jour :

```bash
sudo apt-get update && sudo apt-get upgrade -y
```

Il n'y a **aucun port à ouvrir** pour le bot : ne touchez ni à la « Security List » d'Oracle ni au pare-feu du serveur.

## 5. Installer le bot

Suivez la section **Installer sur le serveur** du [README](../README.md#installer-sur-le-serveur). Sur Oracle, deux points :

- l'architecture est ARM : dans l'installation de Node sans sudo, remplacez `linux-x64` par **`linux-arm64`** ;
- l'image Ubuntu fournit sudo sans mot de passe à l'utilisateur `ubuntu` : `bash setup.sh` peut installer directement les bibliothèques de Chromium.

## Éviter la reprise de l'instance

Le bot dort la plupart du temps : une instance qui ne fait que lui tourner risque d'être vue comme « inactive » et reprise par Oracle, sur un compte gratuit. Que faire :

- **Passer en Pay As You Go**, avec un budget et une alerte. C'est la solution le plus souvent citée par les utilisateurs, mais Oracle ne s'engage pas, dans sa documentation, à ne plus reprendre les instances d'un compte payant. Vérifiez sur votre compte.
- **Héberger autre chose sur le même serveur** : un site, un petit service, un serveur de jeu… L'usage réel du serveur monte, et le bot n'y prend presque rien.
- **Garder de quoi réinstaller vite** : le dossier du bot, votre `config.json`, votre `.env` (en lieu sûr) et vos liens de connexion. Une réinstallation complète prend une vingtaine de minutes.

## Autres solutions d'hébergement

| Solution | Coût | Lien |
|---|---|---|
| Oracle Cloud Always Free | Gratuit | Ce guide, et [la page de l'offre](https://www.oracle.com/cloud/free/) |
| Petit VPS (Hetzner, OVH, Scaleway…) | 4 à 5 € par mois environ | Par exemple [Hetzner Cloud](https://www.hetzner.com/cloud/) et son [guide de création d'un serveur](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/). Un serveur ARM avec 2 vCPU et 4 Go suffit. |
| Raspberry Pi 4 ou 5 (4 Go et plus) à la maison | Le matériel, puis quelques euros d'électricité par an | [Installer Ubuntu Server sur un Raspberry Pi](https://ubuntu.com/tutorials/how-to-install-ubuntu-on-your-raspberry-pi). C'est de l'ARM aussi : mêmes remarques qu'Oracle. |
| Un PC qui reste allumé | Gratuit | Ubuntu ou une VM Ubuntu. Le bot n'a besoin d'aucun port ouvert, il marche aussi derrière une box. |

Dans tous les cas, il faut une machine Linux allumée en permanence, avec 2 Go de RAM au moins et un accès SSH. La suite de l'installation est la même : voir le [README](../README.md).
