# Credits

## Hero

`assets/hero.svg` is an original drawing for this repository.

The mood — brush, empty paper, a river, a few vertical strokes — is inspired by the ink and negative space of Takehiko Inoue’s manga *Vagabond*. The file does not copy panels, characters, lettering, costumes, or compositions from that work. Takehiko Inoue, Kodansha, and the publishers of *Vagabond* are not affiliated with this project and have not endorsed it.

Colour is [Sanzo Wada](https://github.com/Nonarkara/palette) combination **52**, two colours only:

| Role | Name in the dataset | Hex | Job in the hero |
| --- | --- | --- | --- |
| Dominant field | Sulpher Yellow | `#f5ecc2` | Paper. About 62% of the width. |
| Counter-field | Black | `#111314` | Ink. The right-hand mass. |

Those hex values are the screen conversions in [`Nonarkara/palette` `data/colors.json`](https://github.com/Nonarkara/palette/blob/main/data/colors.json). They are not a claim about the inks printed in Wada’s book. The dataset is Matt DesLauriers’ MIT-licensed [`dictionary-of-colour-combinations`](https://github.com/mattdesl/dictionary-of-colour-combinations), which credits Dain M. Blodorn Kim’s earlier compilation. The historical combinations are credited to Sanzo Wada. This repository does not reproduce book scans, cover art, or publisher text, and it is not affiliated with Seigensha or the Wada estate.

Plate link used by the Palette exhibition: <https://colors.nonarkara.org/#plate-052>.

Night colours follow the night-reading rule used with that Palette work: take the lighter colour, shade it 35% toward black, then darken until relative luminance is at most 0.14, and draw with white ink.

| Step | Value |
| --- | --- |
| Sulpher Yellow, 35% toward black | `rgb(159, 153, 126)`, luminance about 0.32 |
| Scaled again until luminance ≤ 0.14 | `#6c6856` (`rgb(108, 104, 86)`), luminance about 0.138 |
| Night ink | `#ffffff` |

Computed contrast for this file: black `#111314` on `#f5ecc2` is about 15.7:1. White on `#6c6856` is about 5.6:1. The SVG switches with `prefers-color-scheme`. The paper tooth is SVG turbulence, not a scanned sheet of washi.

## Data

Source names, counts, and licences for the atlas files and live feeds are in the README section [Data sources](README.md#data-sources). OSM-derived files stay under ODbL 1.0. Do not treat this credits note as a licence for the code: this repository has no `LICENSE` file.
