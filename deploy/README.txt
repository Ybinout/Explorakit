URL : https://app.binout.fr/explorakit/
Dossier : /home/ubuntu/dev/explorakit
Serveur : systemctl status explorakit ; journalctl -u explorakit
SQL : MariaDB local, bases explorakit / explorakit_test, secrets dans .env (0600)
Build : npm run build:client
Pour reproduire le build VPS : VUE_APP_PUBLIC_PATH=/explorakit/ npm run build:client
Sur ce serveur, cette valeur est aussi dans vue-explorakit/.env.production.local (non versionné).
Récupérer le client avec git submodule update --init --recursive après chaque mise à jour.
Le commit client à utiliser est enregistré par le sous-module du dépôt principal.
Schéma neuf importé sans les données d'exemple ; onze migrations déjà intégrées.
Ne pas réimporter database/schema.sql sur la base de production existante.
Après mise à jour et vérifications : sudo systemctl restart explorakit
Nginx : /etc/nginx/sites-available/taskflow, seul /explorakit/ ajouté.
Sauvegarde avant ajout : /home/ubuntu/dev/backups/explorakit-deploy-20261011T142608Z/nginx-taskflow.conf
