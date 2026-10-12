# Chromebox Lite v2 validation — October 12, 2026

This is a real EaglercraftX 1.8 u35 test on an Apple M1 Mac, not a Lenovo
Chromebox emulation or a 50+ FPS guarantee. Chromium used ANGLE Metal hardware
rendering at 1280x720, device scale 1, with an uncalibrated 4x main-thread CPU
slowdown. Its Intel GPU, two-core server workload, ChromeOS memory pressure and
fanless thermal behavior are not emulated.

## Asset audit

| Measurement | Previous pack | Redesigned pack |
| --- | ---: | ---: |
| Block PNG names | 147 | 373 |
| All PNG images (including icon/effects) | 148 | 377 |
| ZIP bytes | 47,390 | 109,506 |
| Encoded bytes for 147 shared PNGs | 16,650 | 13,649 |
| Decoded RGBA bytes for those shared PNGs | 53,760 | 44,544 |
| Native combined block/item atlas observed | 512x256 | 512x256 |

All shared images changed. The previous unused `packed_ice.png` was replaced
with the real `ice_packed.png` name, so one old block path is deliberately not
in the shared-path count. Expanded coverage increases total download size;
shared images are about 18% smaller encoded. The atlas allocation stayed the
same (512 KiB for its base RGBA pixels with mipmaps off), so no reduction in
that GPU allocation is claimed. Smaller standalone particle/explosion sheets
retain the original UV layouts. Duplicate named images were retained when
models independently reference them.

The new mix is 272 images at 8x8, 102 at 16x16, one 64x64 particle atlas and two
32x32 images (explosion sheet and icon). Thin details and plants use 16x16 for
readability. Nine valid one-frame animation definitions remain; both old and
new packs already use static effects. PNG palettes preserve alpha and use the
smallest legal bit depth. The builder validates CRCs, palette indexes, decoded
scanline sizes, ZIP integrity, animation indexes and all 373 catalog entries.
Chromium additionally decoded all 377 PNGs successfully.

## Actual gameplay samples

Each pack ran in isolated browser storage with the same fixed seed,
`349874861416572032`, and camera position (181,78,219), yaw 0, pitch 15.
Settings were 2 chunks, Fast graphics, 60 FPS cap, Minimal particles, no shaders,
FXAA, mipmaps, smooth lighting, VSync or dynamic lights, and Quake Pro FOV.
Weather/time were fixed only in the test worlds. Movement held forward six
seconds then backward six seconds in spectator mode. Game frames were counted
at final framebuffer blits, rather than browser animation callbacks or menu FPS.

| Sample (12 seconds each) | Mean FPS | 95th percentile frame interval |
| --- | ---: | ---: |
| Previous pack, stationary | 60.74 | 21.4 ms |
| Redesign, stationary | 60.92 | 21.1 ms |
| Previous pack, movement | 43.42 | 44.0 ms |
| Redesign, movement | 43.76 | 45.2 ms |
| Redesign validated repeat, stationary | 60.66 | 21.3 ms |
| Redesign validated repeat, movement | 42.40 | 46.0 ms |

These short samples show no meaningful speedup. Movement/terrain work remains
more limiting in this stress test than texture detail. JS heap snapshots ranged
roughly 129–141 MB; allocation and GC variation prevent a reliable memory-gain
claim. They are not total browser/system memory. The repeat's raw measurements
and exact renderer are saved in `chromebox-lite-v2-mac.json`.

Early automation attempts remained in a menu and were discarded. The gameplay
comparison above did reach the world, but its first full validation run also
caught an incidental browser favicon 404. The corrected validation explicitly
handles favicon requests and records all failing game HTTP responses; the final
real-client run passed with no failing requests, page errors or texture errors.
The local client's existing `meta:missing_sound` warnings occurred with both
packs; sounds are not changed by this texture work.

## Integration checks

- 20 Worker/unit tests passed, including JSON type, same-origin response and
  revision forwarding/cache headers.
- IndexedDB tests passed: install, repeat launch with no repeated payload fetch,
  updates, preservation of custom packs/manifest fields, malformed manifests,
  folder collisions, simultaneous launch and atomic rollback.
- Settings tests passed: automatic selection, correct priority, no duplicate
  entries, manual opt-out, preservation of other pack selections and controls,
  corrupt settings, compression support and storage failure.
- Both launcher modes passed through the Worker; the opt-out preference was
  applied in about:blank. Storage denial remained nonfatal.
- Native u35 showed Chromebox Lite selected automatically and rendered the
  redesigned terrain, flowers, grass, wood and water in a singleplayer world.

The actual Lenovo is unavailable. A practical ten-minute device comparison is
included in `resource-packs/chromebox-lite/README.md`. This work is local and
uncommitted; deploy the Worker and publish all loader/config/artwork files
alongside script.js only after authorization.
