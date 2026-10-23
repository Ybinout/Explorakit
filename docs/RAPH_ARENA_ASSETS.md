# Arène de Raph — ressources, 24 octobre 2026

Images créées avec le **mode intégré du skill imagegen**, puis encodées en WebP sans perte via Sharp. Identité des pixels décodés vérifiée. Aucun redimensionnement ni retouche après génération.

- `vue-explorakit/src/assets/battle/raph-wide-v1.webp` : 1536 × 1024, 1 379 752 octets.
- `vue-explorakit/src/assets/battle/raph-mobile-v1.webp` : 1024 × 1536, 1 524 602 octets.
- Socles : dessinés par CSS, séparés du décor et attachés aux mêmes coordonnées que les sprites. Le cadrage mobile ne déplace donc pas le point de contact.
- Musique : fichier fourni `Pokémon Sword & Shield OST - Gym Leader Battle (Full In-Game Version).mp3`, importé sans réencodage dans `vue-explorakit/src/assets/msc/raph.mp3` (9 595 285 octets). SHA-256 `4f0956dc48b293bddb0a24021d928f2afe751e4e12ade69d225e2c374eac1a2f`. Copie d'apport dans `pourtoi` retirée seulement après vérification et publication Git ; une seule source conservée. Les autres musiques ne sont pas des doublons de ce fichier et restent utilisées.

## Prompt paysage

Use case: stylized-concept. Create a finished battle background image for RiftMon, a 2D monster RPG, Raph's gym arena. Landscape 1536x1024. Beautiful crisp pixel art with restrained detail, matching Nintendo DS era environments. Grand indoor steel-and-jade tournament hall: deep teal steel columns, warm amber ceiling lights, red cloth pennants with abstract blade emblems, distant gallery and central closed bronze doorway. Dramatic but welcoming, a worthy arena for an ace steel mantis. Camera at low battle angle, NOT top down, no isometric. Back wall and architectural details only in upper 35 percent, broad empty muted green-grey stone fighting floor fills lower 65 percent and extends to all edges. Floor quiet, subtle perspective joints, no large central emblem. Space for an opponent around x80% y68% and ally at x20% bottom edge. IMPORTANT: do NOT draw circular platforms; the game adds separate precisely anchored platforms. No characters, monsters, spectators, text, lettering, logos, UI, particles, sun, watermark. Strong readable silhouettes, intentional pixel clusters, avoid photorealism and fine noisy texture.

## Prompt portrait

Référence : image paysage produite par le premier prompt.

Use case: stylized-concept. Supporting reference: the supplied landscape image is the exact arena architecture, palette and pixel art style to preserve. Create its MOBILE PORTRAIT battle background variant 1024x1536 for RiftMon. Same indoor steel and jade hall, teal pillars, amber lanterns, red blade banners, bronze central door, crisp pixel art. Recompose for a tall phone rather than cropping the landscape. Back wall entirely in top 32 percent; broad empty subdued green-grey stone battle floor extends from y32% to bottom. Gentle perspective, low horizon for combat, quiet ground with sparse tile joints. The game overlays enemy at x77% y63% and player at x20% bottom edge, so leave ground there. No monsters, people, UI, text, circular platforms or floor emblems (platforms are separate code assets). Match lighting, architecture and style of reference, no blur or photorealism.
