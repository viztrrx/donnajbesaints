# Chromebox Lite 8x — EaglercraftX / Minecraft 1.8

An original, deliberately simple resource pack for low-powered machines. Uses
8x8 block textures, recognizable ore colors, opaque leaves, and single-frame
water, lava, fire, portal, prismarine and sea lantern textures. Disables the
Eaglercraft title-screen panorama blur. No shaders, extra models or sounds.
Unreplaced textures, items, mobs and interfaces use your existing default assets.

## Install on your Lenovo Chromebox

1. Save `Chromebox-Lite-8x-1.8.zip` to the Chromebox. Keep it zipped.
2. In Eaglercraft open Options > Resource Packs, then use the import/open control
   to select the ZIP. The button wording can vary between client builds.
3. Move Chromebox Lite to the selected/active side and put it above other packs.
4. Click Done and let the game reload its resources.

Eaglercraft documents ZIP imports here:
https://github.com/3kh0/eaglercraft-1.8#resource-packs

## Chromebox Micro: target 40+ FPS

Working hardware assumption: Intel Celeron N4500, Intel UHD integrated graphics,
8 GB RAM, matching Lenovo's Chromebox Micro specifications:
https://news.lenovo.com/pressroom/press-releases/chromebox-micro-for-digital-and-interactive-display-solutions/

This is a suggested manual configuration, not a benchmark or an automatic
preset. Importing a texture pack does not change these game/system settings.
Use the following options where your client exposes them:

| Setting | Starting value |
| --- | --- |
| Actual display/game render resolution | 1280x720 at 60 Hz |
| Render distance | 2 chunks |
| Graphics | Fast |
| Shaders, dynamic lights, ambient occlusion/smooth lighting | Off |
| Clouds, entity shadows | Off |
| Particles | Minimal |
| Mipmap levels | 0 |
| Antialiasing and anisotropic filtering | Off |
| VSync | Off initially |
| Maximum framerate | 60 FPS |
| Field of view | 70 / Normal |
| Other resource packs | Disable during testing |

Change actual display resolution in ChromeOS display settings if available;
changing browser zoom or the text/display-size slider is not the same as
lowering render resolution. If 720p is unavailable, use the closest lower
16:9 resolution offered. Keep the monitor at 60 Hz when available.

Close unused tabs, video playback and other busy apps. Keep the fanless box
uncovered with room around it to dissipate heat. Let chunks finish loading.
Test for ten minutes in a typical world, including walking and turning.

If the game holds 60 comfortably, try 3 then 4 chunks. If it fluctuates between
40 and 60, try a 50 FPS cap if offered to reduce load and peak FPS swings.
A cap cannot raise minimum FPS. If it drops below 40 at 2 chunks, try a lower
actual resolution such as 960x540 if supported. If that makes little difference,
world simulation or chunk generation may be the limit; avoid dense entity areas
and generating new terrain while evaluating steady-state performance.

40+ FPS is a target, not a guaranteed minimum. A 60 FPS cap preserves room above
40 without unlimited rendering; on a 60 Hz monitor, stable 60 gives more even
frame delivery than 40 or 50. VSync off can cause tearing, so try enabling it
only after verifying the game can sustain 60.

## What to expect

8x8 has one quarter the pixels of 16x16 per replaced tile. This does NOT mean
one quarter of total GPU memory or four times the FPS: unchanged textures,
atlas packing, mipmaps, geometry, lighting and game simulation still cost work.
The pack removes multi-frame animation from the replaced effects. Water and
fire remain visible, but no longer animate; leaves look solid. It does not
reduce chunk geometry, particle count, server lag or world-generation work.
Texture simplicity alone does not guarantee faster rendering.

Compare the default pack and this pack in the same location, same direction,
and same video settings. Wait for chunks to load before comparing FPS and
stutters. The exact Lenovo model, CPU, RAM and resolution determine the result.
No real-client gameplay or hardware benchmark has been performed for this pack.

## Files and rebuilding

`preview.png` shows every replacement in rows; `preview-index.txt` lists their
names in the same order. Run `python3 build.py` to reproduce the ZIP and preview.
All replacement artwork is procedurally drawn from scratch. No original game
textures are included. This is a partial performance-oriented resource pack.
