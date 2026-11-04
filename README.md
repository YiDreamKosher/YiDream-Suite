# YiDream v1.2

Plateforme de gestion d'appareils Android filtrés. Ce dépôt contient l'app Android et le site **YiDream Suite** (configurateur Web ADB).

## Contenu

| Dossier | Rôle |
|---|---|
| `app/` | App Android (Device Owner, package `com.yidream.mdm`) : 3 actions pour l'utilisateur (mises à jour, apps autorisées, supprimer le filtre) |
| `webadb/` | Site YiDream Suite (nouveau design v3.6) + configurateur Web ADB réel, publié sur GitHub Pages |
| `.github/workflows/` | `build-apk.yml` compile l'APK ; `deploy-webadb.yml` compile l'APK, l'embarque dans le site et publie |
| `version.json`, `VERSIONING.md`, `HOW_TO_GET_APK.md` | Système de mise à jour de l'app (inchangé) |

## Ce que fait la v1.2

Fusion du design **Suite** (Admin, Android, iOS, Info) avec la logique du configurateur v1 :

- **YiDream Android** : connexion USB (WebUSB), installation/mise à jour de l'APK (détecté automatiquement sur le site ou choisi à la main), activation Device Owner, blocage par catégories + apps supplémentaires, envoi de la configuration au téléphone.
- **Unlock & Apply 🔒** et **Advanced 🔒** (protégés par mot de passe admin) : code du jour, application de la config, retrait des restrictions, désinstallation.
- **Conditions d'utilisation** à accepter au premier chargement (recopie d'une phrase), consultables dans Info → Legal.
- **Verrou d'origine** : le site refuse de fonctionner hors des adresses listées dans `webadb/src/config.js`.
- Langues EN / FR / HE / YI, thème clair/sombre.
- **YiDream Admin** : tableau de bord revendeur avec comptes e-mail/mot de passe et Google via Supabase ; les fiches appareils/clients sont stockées en base et isolées par compte avec RLS. Le service doit être configuré suivant [`webadb/supabase/SETUP.md`](webadb/supabase/SETUP.md).\n- **iOS**, macOS et Windows : l’interface indique les pistes, mais les commandes MDM ne sont pas encore implémentées.

## Mise en ligne

1. Pousse ce dossier sur la branche `main` (dépôt `YiDreamKosher/YiDream-Suite`).
2. `Settings → Pages → Source : GitHub Actions`.
3. Le workflow compile l'APK et les deux pages puis publie `https://yidreamkosher.github.io/YiDream-Suite/`. Le tableau de bord revendeur s’ouvre avec la tuile Admin ; le configurateur USB Android reste dans YiDream Suite.

Si tu publies sous un autre nom de dépôt, ajoute son chemin dans `allowedSites` (`webadb/src/config.js`), sinon l'écran « Site non autorisé » s'affiche.

## ⚠️ À faire avant de vendre / distribuer

- **Accès administrateur** : les informations d’accès sont confidentielles et doivent être transmises séparément aux seules personnes autorisées. Remplacez tout identifiant ou secret précédemment publié avant la mise en service.
- **Ce verrou n'est pas une vraie sécurité** : il tourne dans le navigateur et le hash est lisible dans le code du site. Il empêche un usage accidentel, pas un attaquant. Pour une offre professionnelle, il faudra une authentification côté serveur (comptes, sessions, isolation par revendeur).
- Le blocage par catégories est appliqué par l'app Android (Device Owner), pas par le site : le site ne fait qu'envoyer `yidream_config.json`.
- Compatibilité non garantie sur tous les téléphones (Device Owner, WebUSB, constructeur). À documenter au fur et à mesure des tests.
- Licence : aucune licence open source n'est incluse. Vérifie l'historique public du dépôt `YiDreamKosher/YiDream` avant une diffusion commerciale.

## Développement local

```bash
cd webadb
npm install
npm run dev     # http://localhost:5173 (le verrou d'origine est levé sur localhost)
```

Windows : WebUSB exige de remplacer le pilote USB du téléphone par WinUSB avec Zadig (détails affichés dans l'onglet Connect).
