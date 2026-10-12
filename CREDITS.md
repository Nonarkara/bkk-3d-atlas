# Credits

## Hero

`assets/hero.png` is a capture of the live atlas at <https://atlas.nonarkara.org> on 2026-10-10. The wide frame is a 1440×900 desktop viewport. The narrow frame is a 390×844 phone viewport. Both are the default landing view. The image is the product UI, not an illustration.

The flat field is Sulpher Yellow `#f5ecc2`, and the 1px rule is Black `#111314`. Those are the two screen colours of [Sanzo Wada](https://github.com/Nonarkara/palette) combination 52 in [`Nonarkara/palette` `data/colors.json`](https://github.com/Nonarkara/palette/blob/main/data/colors.json). They are not a claim about the inks printed in Wada’s book. The dataset is Matt DesLauriers’ MIT-licensed [`dictionary-of-colour-combinations`](https://github.com/mattdesl/dictionary-of-colour-combinations), which credits Dain M. Blodorn Kim’s earlier compilation. The historical combinations are credited to Sanzo Wada. This repository does not reproduce book scans, cover art, or publisher text, and it is not affiliated with Seigensha or the Wada estate.

Plate link used by the Palette exhibition: <https://colors.nonarkara.org/#plate-052>.

The name and the one-line pitch are set in [Inter](https://rsms.me/inter/) (SIL Open Font License), rasterized into the PNG. The font file is not shipped in this repository.

Map tiles and civic data visible in the capture are credited in the README section [Data sources](README.md#data-sources).

## Closing panel

`assets/manga.jpg` is original AI-assisted art made for this project.

## Wireframe landmarks

The Landmarks toggle draws eight schematic models in Palette plate 052: Sulpher Yellow `#f5ecc2` on the map’s dark field, which stands in for that plate’s Black `#111314`. The lines are original code. The photographs below were the single reference for each silhouette. They are not copied into this repository, and they are not projected onto the models.

The modelling method follows [img2threejs](https://github.com/img2threejs/img2threejs) (Apache-2.0): one photograph, then a procedural Three.js model written by hand, with the hidden sides labelled as approximate. No img2threejs source file is vendored. See [THIRD_PARTY.md](THIRD_PARTY.md).

| Model | Reference | Author | Licence |
| --- | --- | --- | --- |
| Phra Thinang Chakri Maha Prasat | [พระที่นั่งจักรีมหาปราสาท2.jpg](https://commons.wikimedia.org/wiki/File:%E0%B8%9E%E0%B8%A3%E0%B8%B0%E0%B8%97%E0%B8%B5%E0%B9%88%E0%B8%99%E0%B8%B1%E0%B9%88%E0%B8%87%E0%B8%88%E0%B8%B1%E0%B8%81%E0%B8%A3%E0%B8%B5%E0%B8%A1%E0%B8%AB%E0%B8%B2%E0%B8%9B%E0%B8%A3%E0%B8%B2%E0%B8%AA%E0%B8%B2%E0%B8%972.jpg) | Mastertongapollo | CC BY-SA 4.0 |
| Phra Si Rattana Chedi | [Phra Si Rattana Chedi, Wat Phra Kaew, Bangkok.JPG](https://commons.wikimedia.org/wiki/File:Phra_Si_Rattana_Chedi,_Wat_Phra_Kaew,_Bangkok.JPG) | 2008guangzhou | CC BY-SA 3.0 |
| Phra Mondop | No dedicated elevation. Square plan from OSM way behind `bkk-building-23482989`. | — | ODbL 1.0 on the footprint |
| Prasat Phra Thep Bidon | No dedicated elevation. Cruciform plan from OSM way behind `bkk-building-23482990`. This is a prasat, not a Khmer prang. | — | ODbL 1.0 on the footprint |
| Wat Arun | [The Prang of Wat Arun.jpg](https://commons.wikimedia.org/wiki/File:The_Prang_of_Wat_Arun.jpg) | Juanitoooww | CC BY-SA 4.0 |
| Democracy Monument | [Democracy Monument Bangkok.jpg](https://commons.wikimedia.org/wiki/File:Democracy_Monument_Bangkok.jpg) | Rangan Datta Wiki | CC BY-SA 4.0 |
| Giant Swing | [Giant Swing Bangkok Thailand.jpg](https://commons.wikimedia.org/wiki/File:Giant_Swing_Bangkok_Thailand.jpg) | KOSIN SUKHUM | CC BY-SA 4.0 |
| Golden Mount | [Wat Saket, Golden Mount, Bangkok, Thailand.jpg](https://commons.wikimedia.org/wiki/File:Wat_Saket,_Golden_Mount,_Bangkok,_Thailand.jpg) | Vyacheslav Argenberg | CC BY 4.0 |

Three.js r186, used to draw the lines, is MIT. The file in `public/vendor/` is a bundled subset. The licence text is `public/vendor/three.module.LICENSE`.

## Data

Source names, counts, and licences for the atlas files and live feeds are in the README section [Data sources](README.md#data-sources). OSM-derived files stay under ODbL 1.0. Do not treat this credits note as a licence for the code: this repository has no `LICENSE` file.
