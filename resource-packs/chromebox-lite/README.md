# Chromebox Lite 2.0.0 — minimalist EaglercraftX 1.8 pack

Original artwork designed for clear, quiet-looking Minecraft worlds on a
low-powered Lenovo Chromebox Micro. No sampled Mojang artwork, shaders, custom
models, sounds, fonts, or runtime libraries are included.

## Coverage and style

All 147 previous block textures have been redesigned; the unused `packed_ice`
name is corrected to the actual 1.8 `ice_packed` name. Coverage now includes all
373 block PNG names in the local Minecraft 1.8.8 build. `block-catalog.json`
records the audited names, original dimensions and animation flags, so building
this pack does not require the game JAR.

- Flat, restrained terrain colors; clean dirt, grass sides/overlay, snow and sand.
- Coherent wood tones, broad log bands, simple planks and opaque tinted leaves.
- Clear ore deposits, distinct colored wool/glass/clay and simple stone variants.
- Recognizable flowers, saplings, crops at each growth stage, grass, ferns,
  vines, mushrooms, reeds, cactus and double-height plants.
- Readable crafting tables, furnaces, doors, beds, ladders, brewing/enchanting
  blocks, pistons, hoppers, rails, redstone, utility faces and dimension blocks.
- Static water, lava, portal, fire, prismarine and sea-lantern frames.
- Progressive breaking cracks; a smaller particle sheet, footprints and
  explosion sheet with their native UV grids retained. Damage/critical, heart,
  bubble, flame and smoke feedback remains visible.

The previous pack had no item, armor, mob, chest-entity or game-GUI replacements.
Those categories retain the game's default assets. The pack icon is redesigned;
the existing title-screen blur opt-out is retained. Concrete and stripped logs
are not part of Minecraft 1.8 and are not invented here.

## Automatic use in this project's launcher

On launch, the game frame installs/updates this pack in u35's native IndexedDB
resource-pack folder, then merges its folder name into the verified compressed
settings record before the game starts. It adds the pack at highest priority,
retaining other selected pack names and all non-graphics settings.

The Eaglercraft launcher has an **Automatically use Chromebox Lite** switch,
on by default. Turn it off to retain your own selection on subsequent launches.
You can also switch packs in the game's Options > Resource Packs during play.
With automatic use enabled, Chromebox Lite is reapplied next launch. Preferences
are local to the browser/site, consistent with the existing game's storage.

Only the small `loader/pack-config.js` version record loads each launch. The
versioned same-origin JSON artwork payload is fetched when its installed
revision is absent/outdated. Repeated launches do not re-import current artwork.
An interrupted download, invalid manifest or blocked storage is nonfatal: the
game still starts, and its previously selected packs are kept.

The ZIP remains usable in any compatible 1.8 client: keep it zipped, import it
from Options > Resource Packs and select it. The standalone ZIP does not itself
change graphics settings.

## Graphics settings and performance limits

The project separately applies its existing conservative launch preset:
2 chunks, Fast graphics, 60 FPS cap, minimal particles, no shaders/smooth
lighting/dynamic lights/clouds/entity shadows/FXAA/mipmaps/VSync, and the user's
requested Quake Pro FOV. This adapter uses confirmed u35 settings; it does not
change gameplay mechanics or invent texture-pack performance options.

50+ FPS during ordinary play is a target, not a measured Lenovo guarantee.
The target Chromebox is not available here. Texture colors/detail alone do not
reduce geometry, draw calls, entity work, particle generation or terrain
simulation. Native atlas packing can also erase per-image memory savings.
The loader cannot change ChromeOS display resolution; try actual 1280x720 in
display settings if available, close busy tabs and leave room around the
fanless box for cooling.

### Manual Lenovo comparison

1. Use the same world, position, camera direction, render resolution and game
   settings for both packs. Let chunks finish loading for at least a minute.
2. Compare default/previous pack against this pack. Watch FPS while standing,
   turning, walking near foliage/water and visiting your ordinary play areas.
3. Play each for ten minutes, noting typical FPS, long stalls and terrain-loading
   dips. Avoid comparing a menu to gameplay or warmed terrain to fresh terrain.
4. If below 50, compare 720p against your current resolution. If FPS barely
   changes, CPU/world simulation is more likely limiting than texture fill cost.
   Keep 2 chunks; avoid dense mob farms while testing.

## Build, audit and preview

Run `python3 resource-packs/chromebox-lite/build.py` from the repo root. It uses
Python's standard library and `artwork.py`; no image downloads or dependencies.
It generates the existing ZIP filename, versioned JSON payload, pack-config.js,
full contact sheet/index, selected style preview and `audit-after.json`.

Most solid blocks are 8x8. Plants, rails, wire, thin silhouettes and breaking
cracks use 16x16 for legibility; flow tiles retain twice the base tile width.
The particle sheet is 64x64 (16x16 UV cells), explosion sheet 32x32 (4x4 frames),
and icon 32x32. PNG palettes use the smallest lossless legal bit depth with alpha
preserved. Animation metadata has one valid frame and interpolation disabled.
Required duplicate names are retained because models bind them independently.

The builder checks CRCs, palette indexes, decoded scanline sizes, animation
frames, ZIP integrity and complete block-name coverage. The audit JSON files
separate old/new total sizes from the shared-asset comparison. The expanded ZIP
is larger overall; the shared original image set is smaller, not a claim of a
proportional FPS gain. Runtime browser results are described in the repository's
`eaglercraft/README.md`.
