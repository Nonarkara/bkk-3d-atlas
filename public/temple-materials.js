// What a temple is made of.
//
// The forms layer used to carry a flat list of colours and a three-value
// "finish" — gold, white, ceramic — and 302 of the Old Town's 319 temples
// came out the same white plaster (94.7%, measured against
// bkk-heritage-detail.geojson). A mondop that is teak, a chedi that is
// stucco and a prang that is glazed tile all read as the same pale box with
// the same roof, so the Old Town looked like one building repeated. After
// the material rule the mix is plaster 258, teak 44, ceramic 10, gold 4,
// glass 2, iron 1 — every non-plaster one named by its own evidence.
//
// The fix is the material, not the shape. A temple has a *material* — teak,
// roof tile, plaster, glazed ceramic, dull gold, blue glass, iron — and the
// material decides the colour, the trim and the highlights. It is decided
// once, from the building's own evidence (its Thai name and its type), and
// then everything about that building follows from it.
//
// So this table is the single place a temple colour is written down. The
// forms mesh reads it, the map's extrusion paint reads it, the massing layer
// reads it, and the sibling project that draws the same Old Town reads it.
// A test fails if a colour literal turns up anywhere else.
//
// Three steps per material, dark to light: `shade` for the parts turned away
// from the light, `base` for the body, `light` for the ridge, the finial and
// the panels that catch the sun. The mesh is lit by a real directional light
// as well, so the ramp and the lighting agree instead of fighting.
//
// `role` says what a material is for. A `body` material is something a
// building can BE — the classifier may only ever name one of those. A `trim`
// material is part of the architecture that every temple shares: the roof
// tile, the green skirt tile along the eaves, the plinth it stands on.
//
// The gold is deliberately dull. Bright saturated gold is what a colour
// picker reaches for and what a wat never is — temple gilding is a
// low-chroma ochre that reads as metal because of where it sits, not because
// it is neon. It is the same ochre the massing layer already uses for its
// gold roofs (#c9a227), so the two layers of the atlas agree.
//
// The palette is the seven of the technique this atlas borrowed: ไม้สัก
// (teak), หลังคา (roof tile), ทองหม่น (dull gold), ปูน (plaster), กระจกคราม
// (blue glass), เจวร (glazed ceramic) and เงา (shadow). Each one is broken
// into its dark-to-light steps here. Everything else in the table is
// architecture — the skirt tile, the plinth — or the one material that is
// not temple architecture at all, the shophouse.

/**
 * @typedef {{role: 'body'|'trim', shade: number[], base: number[], light: number[],
 *            parts?: Record<string, number[]>}} Material
 */

/** @type {Record<string, Material>} */
export const TEMPLE_MATERIALS = {
  // ไม้สัก — teak. The scripture halls, the mondops, the open pavilions.
  teak: { role: 'body', shade: [0.29, 0.17, 0.09], base: [0.48, 0.29, 0.14], light: [0.61, 0.40, 0.21] },
  // ปูน — lime plaster. The whitewashed chedis and the walls of a brick hall.
  plaster: { role: 'body', shade: [0.76, 0.73, 0.66], base: [0.93, 0.91, 0.86], light: [0.97, 0.96, 0.93] },
  // ทองหม่น — dull gilding. Pediments, chofa, finials, a gold chedi.
  // The base is exactly the massing layer's gold roof, #c9a227, so the two
  // layers of the atlas wear the same metal.
  gold: { role: 'body', shade: [0.61, 0.49, 0.09], base: [201 / 255, 162 / 255, 39 / 255], light: [0.88, 0.75, 0.35] },
  // เจวร — glazed ceramic. The prangs: a cool celadon cladding, not plaster.
  ceramic: { role: 'body', shade: [0.44, 0.60, 0.57], base: [0.58, 0.73, 0.69], light: [0.72, 0.84, 0.80] },
  // กระจกคราม — blue glass. The mosaic-clad great chedis, and the panel
  // band in a hall's pediment wall.
  glass: { role: 'body', shade: [0.12, 0.31, 0.40], base: [0.18, 0.44, 0.56], light: [0.35, 0.61, 0.72] },
  // Loha Prasat — blackened iron and steel, the "metal castle". No gold.
  iron: { role: 'body', shade: [0.14, 0.14, 0.16], base: [0.32, 0.32, 0.36], light: [0.43, 0.43, 0.47] },
  // Shophouses are not temple architecture. Warm lime plaster, a dark band at
  // every floor line, plain glazed tile. No gold, no chofa, no skirt tile.
  shophouse: {
    role: 'body',
    shade: [0.62, 0.53, 0.40],
    base: [0.79, 0.68, 0.52],
    light: [0.87, 0.79, 0.66],
    parts: {
      // The string course at each floor line.
      band: [0.36, 0.29, 0.25],
      // Plain glazed tile, with no chofa and no green skirt.
      roof: [0.29, 0.25, 0.23]
    }
  },
  // หลังคา — glazed roof tile.
  roof: { role: 'trim', shade: [0.56, 0.27, 0.13], base: [0.76, 0.38, 0.19], light: [0.87, 0.50, 0.28] },
  // กระเบี้ย — the green border tile along the skirt of a roof.
  skirt: { role: 'trim', shade: [0.15, 0.25, 0.18], base: [0.25, 0.42, 0.30], light: [0.35, 0.55, 0.40] },
  // The stone a temple stands on.
  plinth: { role: 'trim', shade: [0.66, 0.62, 0.54], base: [0.80, 0.76, 0.68], light: [0.87, 0.84, 0.77] },
  // เงา — the shaded face of a surface.
  shadow: { role: 'trim', shade: [0.42, 0.39, 0.33], base: [0.62, 0.60, 0.56], light: [0.72, 0.70, 0.65] }
};

/** The materials a temple body may be made of — the only names a form may carry. */
export const TEMPLE_BODY_MATERIALS = Object.keys(TEMPLE_MATERIALS).filter((n) => TEMPLE_MATERIALS[n].role === 'body');

/** The materials that are part of the architecture rather than the substance. */
export const TEMPLE_TRIM_MATERIALS = Object.keys(TEMPLE_MATERIALS).filter((n) => TEMPLE_MATERIALS[n].role === 'trim');

/** Every material name the table declares, for the tests that police it. */
export const TEMPLE_MATERIAL_NAMES = Object.keys(TEMPLE_MATERIALS);

/**
 * @param {string} name
 * @returns {Material}
 */
function materialOf(name) {
  const m = TEMPLE_MATERIALS[name];
  if (!m) throw new Error(`unknown temple material: ${name}`);
  return m;
}

/**
 * The body colour of a material, as an RGB triple.
 * @param {string} name
 * @returns {number[]}
 */
export function bodyOf(name) {
  return materialOf(name).base;
}

/**
 * The shade step of a material — the parts turned away from the light.
 * @param {string} name
 * @returns {number[]}
 */
export function shadeOf(name) {
  return materialOf(name).shade;
}

/**
 * The light step of a material — ridge, finial, the panels that catch the sun.
 * @param {string} name
 * @returns {number[]}
 */
export function lightOf(name) {
  return materialOf(name).light;
}

/**
 * A named part of a material — the parts only some materials have.
 * @param {string} name
 * @param {string} part
 * @returns {number[]}
 */
export function partOf(name, part) {
  const m = materialOf(name);
  const p = m.parts?.[part];
  if (!p) throw new Error(`material ${name} has no part ${part}`);
  return p;
}

/**
 * A material's colour as a hex string, for the MapLibre paint that draws the
 * extrusion underneath the form. One material, one colour, in both layers.
 * @param {string} name
 * @param {'shade'|'base'|'light'} [step]
 * @returns {string}
 */
export function hexOf(name, step = 'base') {
  const [r, g, b] = materialOf(name)[step];
  const h = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * The same colour as a 0xRRGGBB integer, for the three.js materials that
 * take a number rather than a string.
 * @param {string} name
 * @param {'shade'|'base'|'light'} [step]
 * @returns {number}
 */
export function intOf(name, step = 'base') {
  return parseInt(hexOf(name, step).slice(1), 16);
}
