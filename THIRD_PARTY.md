# Third-party notices

## img2threejs

<https://github.com/img2threejs/img2threejs>

Apache License 2.0. Copyright the img2threejs authors.

This repository does not vendor that project’s source, forge scripts, or showcase models. The Landmarks layer follows its method: one reference photograph, then a code-only procedural Three.js model, with hidden sides called out as approximate. The result here is line geometry in Sulpher Yellow, not the project’s shaded gallery materials. Reference photographs are credited in [CREDITS.md](CREDITS.md). They are Wikimedia Commons files and are not shipped.

The showcase at <https://img2threejs.github.io/img2threejs-showcase/> was reviewed as evidence of the method (factories of primitives, no imported meshes). None of those demo subjects are used.

## three.js

`public/vendor/three.module.js` is a bundled subset of Three.js r186 (WebGLRenderer, scene graph, and line geometry).

The MIT License. Copyright © 2010-2026 three.js authors.

The full licence text is `public/vendor/three.module.LICENSE`.

## Palette

Plate 052, Sulpher Yellow `#f5ecc2` and Black `#111314`, from [Nonarkara/palette](https://github.com/Nonarkara/palette). The digital values come from Matt DesLauriers’ MIT-licensed `dictionary-of-colour-combinations`. They are conversions, not measurements of printed ink. The plate link is <https://colors.nonarkara.org/#plate-052>. The same boundary is already stated in [CREDITS.md](CREDITS.md).

## MapLibre GL and other viewer libraries

MapLibre GL 4.7.1 and `hls.js` 1.5.17 are loaded from their existing CDN URLs in `public/index.html`. The Landmarks layer does not add a script host. `pmtiles` is the dependency already named in `package.json`.
