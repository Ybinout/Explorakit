# Intérieurs des cinq champions — 24 octobre 2026

Assets créés avec l’outil intégré **imagegen**, sans redimensionnement ni filtre logiciel. Référence stylistique : la version simplifiée de 7p. Les quatre anciennes salles et 7p restent inchangés. Les coordonnées de collision sont ajustées au résultat final inspecté : les losanges des estrades se situent vers (224,66) en coordonnées logiques 448×320, et non (224,88) demandé initialement au générateur. Les cinq champions utilisent donc la case (13,4), avec le même centrage visuel (+16,-24) que 7p. Dialogues depuis (13,5).

## Fichiers livrés

- Mounir : `vue-explorakit/src/assets/ville1_arene.png` ; carte `data/maps/ville1_arene.{json,tmx}` (1484×1060, 28×20 cases source de 53 px, moteur 32 px).
- Hoze : `vue-explorakit/src/assets/ville_safe1_arene.png` ; carte `data/maps/ville_safe1_arene.{json,tmx}` (1484×1060, 28×20 cases source de 53 px, moteur 32 px).
- Raph : `vue-explorakit/src/assets/gen_arene5.png` ; carte `data/maps/gen_arene5.{json,tmx}` (1484×1060, 28×20 cases source de 53 px, moteur 32 px).
- Ana : `vue-explorakit/src/assets/ville3_arene.png` ; carte `data/maps/ville3_arene.{json,tmx}` (1484×1060, 28×20 cases source de 53 px, moteur 32 px).
- Wanda : `vue-explorakit/src/assets/ville4_arene.png` ; carte `data/maps/ville4_arene.{json,tmx}` (1484×1060, 28×20 cases source de 53 px, moteur 32 px).

## Prompt commun

Use case: stylized-concept. Create a finished WALKABLE TOP-DOWN OVERWORLD arena interior for RiftMon.
The supplied image is a STYLE AND OUTER FOOTPRINT REFERENCE ONLY. Match its clean medium-resolution pixel-art rendering: broad quiet flat tiles, discrete 2–3 shades per material, crisp stepped outlines, restrained palette, readable silhouette, no stone grain, no marble veins, no scratch/noise texture, no tiny ornament. Polished handheld RPG art. Neither crude huge pixels nor smooth vector/3D. This must fit small pixel-art characters.
Create a distinct architecture for the theme, NOT a recolour of the icy star-window cathedral.
OUTPUT: exactly 1484x1060, 7:5 aspect ratio. Map logical coordinates below refer to 448x320, 28x20 cells. Flat orthographic overhead RPG viewpoint with shallow south-facing wall faces; no perspective vanishing point.
MANDATORY PLAYABLE LAYOUT:
- Closed north wall from y=8 to y=68. Side walls near x=8 and x=440.
- A clear EMPTY champion dais in x=144..304,y=70..98, a small simple diamond floor marker centered precisely x=224,y=88; no throne/statue/object on this marker. Broad shallow steps spanning x=144..304,y=98..112. Keep area x=208..240,y=72..112 completely clear for sprites.
- Completely unobstructed flat fighting hall x=112..336,y=112..256, with only painted/inlaid geometric floor decorations. No rocks, plants, furniture, pedestals or raised obstacles inside this hall.
- Architecture and decorative objects confined to SIDE BANDS x=24..96 and x=352..424. Two pairs of columns near y=134 and y=218. Lantern sources at approximately (20,130),(428,130),(20,215),(428,215), and entrance (196,265),(251,265). Clear boundary between blocked architecture and walkable floor.
- Straight central runner from south to dais, x=208..240,y=112..280. Main floor emblem centred x=224,y=184. Decoration is FLAT, traversable.
- Southern wall at y=268..284 with a plainly OPEN TWO-TILE DOOR at x=208..240,y=272..288, a short threshold, dark navy outside below y=296. Door must align with the centre runner, no obstructing ornament.
- Keep the same room footprint and doorway position as the reference. Broad, open, easy to navigate. All five maps are a cohesive suite, but this image depicts only ONE room.
No characters, Pokemon, text, labels, logos, watermark, UI, grid or fake screenshot. Opaque background.

## Thèmes ajoutés au prompt commun

### Mounir

A rain-and-lake martial arts arena: pale blue ceramic walls, sturdy blue steel columns, turquoise water basins ONLY in the two side alcoves, a wide plain slate-blue central fighting floor with one large simple white wave emblem, a narrow blue runner, and a north wall with a few broad blue glass panels and a simple circular rain crest. Soft cyan lights. Small inset warm lanterns. Water is a side decoration and never crosses the walkable central hall. Elegant, welcoming yet competitive. Not a cathedral.

### Hoze

A warm mountain fortress training hall: ochre sandstone blocks, chunky terracotta-and-bronze pillars, amber side lanterns, sparse dark red hanging banners with a single simple diamond, a broad pale warm stone floor with a large simple terracotta sun/diamond inlay. North wall has a broad recessed sandstone relief of mountain peaks, flat and simplified. Rich red centre runner, no lava, no forge fire, no machinery in the path. Strong, grounded canyon architecture, not a blue cathedral.

### Raph

A refined copper-and-steel champion dojo: industrial gym with broad steel north windows showing muted sunset orange, steel-blue supporting columns with copper bands, clean copper lamp housings and flat burgundy banners, broad cool grey floor with one large simple geometric blade/wing emblem in copper, a narrow oxblood red centre runner. Restrained steel/bug-inspired geometry, not actual creatures, not gears everywhere, not a factory or cathedral. Clear athletic arena atmosphere.

### Ana

A calm luminous botanical arena: ivory stone and pale sage green columns, greenhouse glass along north wall with large simple panes, small symmetrical leafy planters ONLY in the side alcoves, muted rose accent flowers and simple warm gold lamps, pale cream-green floor with one large simple stylized leaf/flower inlay, deep green centre runner. Graceful garden pavilion, readable large leaves, no tangled vines, no tiny botanical texture, no canopy over the walkable floor, not a cathedral.

### Wanda

A dramatic storm and obsidian arena: muted violet and charcoal stone, broad angular basalt columns, large simple violet-glass panels along the north wall with a single abstract lightning crest, cool amethyst side lamps and restrained warm brass trim, broad slate-purple floor with one large simple silver angular storm emblem, deep plum centre runner. Sparse purple crystal clusters in side alcoves. Powerful polished hall, not spooky, no skulls, no spikes, no swirling particle effects baked in, not a blue cathedral.

## Correction du format de Wanda

Edit this arena artwork ONLY to fit exactly 1484 pixels wide by 1060 pixels tall (7:5 canvas). The current image is 1483x1061. Keep all artwork, colours, crisp pixel-art style, room silhouette and object positions as visually identical as possible. Correct only the one-pixel canvas discrepancy. No new decoration or changes to the room. Opaque PNG. Output EXACTLY 1484x1060.

Le premier résultat de Wanda mesurait 1483×1061 ; l’outil intégré a livré la version finale à 1484×1060. Aucun asset intermédiaire référencé par le jeu.

