# Mise en service du portail MDM YiDream

1. Appliquer la migration `migrations/20261029000000_mdm_catalog_and_site_requests.sql` dans le SQL Editor du projet Supabase déjà utilisé par YiDream Suite. Elle s’ajoute aux migrations appareils / comptes existantes.
2. Publier YiDream Suite puis ouvrir Administration → Boutique et demandes. Se connecter avec un compte propriétaire ou administrateur approuvé.
3. Choisir la fiche du téléphone et générer un code à usage unique, valable 15 minutes. Sur le téléphone : YiDream → Réglages → Associer à mon administrateur.
4. Publier les APK autorisées dans le catalogue avec leur paquet, URL HTTPS et SHA-256. Le téléphone ne reçoit que le catalogue de son administrateur.
5. Envoyer une demande depuis le téléphone et vérifier son arrivée dans la console. Accepter ou refuser, puis actualiser sur le téléphone.

Les jetons d’appareils sont hachés côté serveur et ne donnent aucun accès administrateur. Les demandes sont limitées à 20 par jour et par appareil ; un identifiant client évite les doubles envois lors d’un nouvel essai réseau.

La décision d’accepter un site n’installe pas un VPN ou un filtre DNS et ne modifie pas le trafic réseau Android. Raccorder la décision à la solution de filtrage retenue avant de présenter un site comme effectivement accessible.

Cette migration a été préparée dans le dépôt. Elle doit être exécutée et ses permissions vérifiées sur le projet Supabase avant une mise en production ; GitHub Pages ne peut pas modifier la base.
