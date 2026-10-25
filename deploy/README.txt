RiftMon — adresse officielle : https://riftmon.binout.fr/
Knov reste sur https://app.binout.fr/ ; api-test.binout.fr inchangé.
Les anciennes pages app.binout.fr/explorakit/ redirigent vers RiftMon,
en conservant chemins et paramètres (game, drift, colosseum, profils…).
API, Socket.IO et anciens bundles sous /explorakit/ restent disponibles
pour les fenêtres déjà ouvertes. Ne pas supprimer ces anciens bundles.

Noms techniques historiques conservés (pas de migration de données) :
- Dossier /home/ubuntu/dev/explorakit ; client sous-module vue-explorakit.
- Service explorakit.service, HTTP/Socket.IO local 127.0.0.1:3340.
- SQL explorakit / explorakit_test ; secrets .env (0600).
- Clés de stockage locales conservées. Une nouvelle origine web exige
  de se reconnecter ; mêmes identifiants, équipes et sauvegardes serveur.
- Dépôts GitHub existants ; git submodule update --init --recursive.

Build de production à la RACINE, et non sous /explorakit/ :
RELEASE_DIST_DIR=/tmp/riftmon-release-dist VUE_APP_PUBLIC_PATH=/ npm run verify:release -- --mysql
RELEASE_DIST_DIR=/tmp/riftmon-release-dist RELEASE_PUBLIC_PATH=/ npm run test:pwa-browser
RELEASE_DIST_DIR=/tmp/riftmon-release-dist npm run test:riftmon-browser
Le réglage local vue-explorakit/.env.production.local doit également
contenir VUE_APP_PUBLIC_PATH=/ (ignoré par Git).
Ne pas utiliser build:client pour une préparation : il écrase le dist vivant.
Sauvegarder, copier les assets avec rsync -a --exclude=index.html en gardant
les anciens bundles, vérifier la santé, puis remplacer index.html atomiquement.
Un simple changement de frontend ne nécessite aucun redémarrage serveur.

Nginx :
- deploy/nginx-riftmon.conf -> /etc/nginx/sites-available/riftmon,
  lien dans sites-enabled ; domaine indépendant, HTTPS et proxy vers3340.
- deploy/nginx-location.conf remplace UNIQUEMENT les locations de l’ancien
  préfixe du jeu dans /etc/nginx/sites-available/taskflow. Conserver strictement
  le proxy / de Knov vers3333 et ses paramètres/certificats.
- Toujours nginx -t avant systemctl reload nginx (rechargement gracieux).
- Certificat Let's Encrypt dédié riftmon.binout.fr, renouvellement webroot
  /var/www/riftmon-acme, servi en HTTP sous /.well-known/acme-challenge/.
- deploy/riftmon-renew-hook installé en755 dans les hooks deploy Certbot ;
  ne recharge Nginx que lors d’un renouvellement de ce certificat.

PWA : nom RiftMon, manifeste/worker/installables à la racine de son domaine.
Le worker ne met en cache que la page hors ligne, jamais API/jetons/combats.
Les recettes historiques avec un build /explorakit/ continuent à fonctionner
sur serveur de test ; la recette dédiée couvre le vrai montage racine.
Ne jamais réimporter database/schema.sql sur la base de production existante.

Performance HTTP (25 octobre 2026) :
- Le vhost RiftMon active gzip pour JS/CSS/JSON/SVG, sans réencodage des assets.
- server/http/staticAssets.js applique un an/immutable uniquement aux fichiers
  dont le nom contient une empreinte. Index, worker, manifest et sprites aux noms
  fixes doivent continuer à être revalidés. Ne pas appliquer cette règle aux API.
- Après rechargement Nginx, vérifier les nouveaux headers avec une connexion
  neuve : une connexion maintenue peut encore être servie par un ancien worker.
- Rapport et limites : docs/AUDIT_PERFORMANCES_2026-10-25.md.
