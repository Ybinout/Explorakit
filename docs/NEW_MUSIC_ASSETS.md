# Musiques fournies — 24 octobre 2026

Copie exacte des cinq MP3 de `/home/ubuntu/dev/pourtoi`, sans réencodage ni changement de qualité. SHA-256 source/destination comparés. Les fichiers apportés restent dans `pourtoi`.

- `/home/ubuntu/dev/pourtoi/Pokemon DPPt- Cave Music.mp3` → `vue-explorakit/src/assets/msc/cave.mp3` ; 2042610 octets ; durée décodée 85.107 s ; SHA-256 `6f3aabd21bbd83d7f232a25d10c100abe5034271bb562634bc70eb9042f3c2cf`.
- `/home/ubuntu/dev/pourtoi/snow.mp3` → `vue-explorakit/src/assets/msc/snow.mp3` ; 2931609 octets ; durée décodée 122.149 s ; SHA-256 `7572312354deaf338e0d4acb648ddbc00659669222b4c3a75b86e330693c00d9`.
- `/home/ubuntu/dev/pourtoi/ANA.mp3` → `vue-explorakit/src/assets/msc/ana.mp3` ; 4355472 octets ; durée décodée 179.421 s ; SHA-256 `c1f9822459b63ce1af7c56c88c74e73c7abbb28612cb3d78d1db50d7e6e61850`.
- `/home/ubuntu/dev/pourtoi/wanda.mp3` → `vue-explorakit/src/assets/msc/wanda.mp3` ; 9353970 octets ; durée décodée 389.747 s ; SHA-256 `8424430753241052fd6e2958fef52d4c3a46075177c4062dad81660796f57517`.
- `/home/ubuntu/dev/pourtoi/7P.mp3` → `vue-explorakit/src/assets/msc/7p.mp3` ; 2771113 octets ; durée décodée 115.461 s ; SHA-256 `4109890daeaab3f7e5997a68fe3def24348bf578109b590b434833c51c2f76af`.

## Affectations

- `cave.mp3` : exploration de toutes les cartes `cave*`, notamment les grottes de Rochebrume. Même instance audio et position de lecture entre les salles.
- `snow.mp3` : Blanchecime (`ville5`), sa boutique et son arène hors combat. Les Routes 13/14 conservent leur musique de route ; le Centre Pokémon partagé conserve le thème village.
- `ana.mp3`, `wanda.mp3`, `7p.mp3` : combats d’arène dans `ville3_arene`, `ville4_arene`, `ville5_arene` respectivement, y compris dans les expéditions.
- Raph conserve son thème dédié ; Mounir/Hoze leur thème actuel. PvP, vagues Colosseum, combats sauvages et dresseurs ordinaires conservent leurs pistes.

Lecture en boucle et volumes existants : exploration 22 % du volume réglé, combats 40 %. Pauses pendant combats/bilans, onglet masqué ou son coupé, puis reprise du fond sans remise à zéro. Les mises à jour de combat ne recréent pas l’audio du champion.

## Vérification

`node --test tests/world-music.test.js` : six tests réussis. Lint/build isolé réussis. `RELEASE_PUBLIC_PATH=/ RELEASE_DIST_DIR=/tmp/riftmon-new-music-dist node --env-file-if-exists=.env scripts/validateNewMusicBrowser.js` : vraie lecture des sept pistes contrôlées (cinq nouvelles, Raph et arène générique), grottes successives, ville/boutique, cinq vrais combats de champions, synchronisation conservant l’instance, absence de superposition combat/exploration, reprise, volume, onglet masqué. Compte et base de test uniquement, aucune erreur navigateur.
