# Credits

## Hero

`assets/hero.png` is a capture of the live atlas at <https://atlas.nonarkara.org> on 2026-10-10. The wide frame is a 1440×900 desktop viewport. The narrow frame is a 390×844 phone viewport. Both are the default landing view. The image is the product UI, not an illustration.

The flat field is Sulpher Yellow `#f5ecc2`, and the 1px rule is Black `#111314`. Those are the two screen colours of [Sanzo Wada](https://github.com/Nonarkara/palette) combination 52 in [`Nonarkara/palette` `data/colors.json`](https://github.com/Nonarkara/palette/blob/main/data/colors.json). They are not a claim about the inks printed in Wada’s book. The dataset is Matt DesLauriers’ MIT-licensed [`dictionary-of-colour-combinations`](https://github.com/mattdesl/dictionary-of-colour-combinations), which credits Dain M. Blodorn Kim’s earlier compilation. The historical combinations are credited to Sanzo Wada. This repository does not reproduce book scans, cover art, or publisher text, and it is not affiliated with Seigensha or the Wada estate.

Plate link used by the Palette exhibition: <https://colors.nonarkara.org/#plate-052>.

The name and the one-line pitch are set in [Inter](https://rsms.me/inter/) (SIL Open Font License), rasterized into the PNG. The font file is not shipped in this repository.

Map tiles and civic data visible in the capture are credited in the README section [Data sources](README.md#data-sources).

## Closing panel

`assets/manga.jpg` is original AI-assisted art made for this project.

## Grand Palace stand-in

`public/models/grand-palace.glb` is an original schematic built from OpenStreetMap footprints in `public/bkk-heritage-detail.geojson` (© OpenStreetMap contributors, ODbL 1.0). Each court building stays on its own footprint and centroid. The ubosot uses three steep overlapping roof tiers with chofa and bai raka, the phra rabiang gallery uses two, the chedi use a bell and a ringed spire, the mondop a square stepped pyramid, and the prasat a corn-cob prang on its cross-shaped plan. Heights of the stupas, mondop, and prasat follow the atlas's existing illustrative tags; hall roof pitch is taken from the photographs below so the silhouette stays steep on the real footprint. It is not a survey, a scan, or an official Fine Arts Department model. The file has no third-party texture and no traced photograph.

These Wikimedia Commons photographs were used only as proportion and silhouette references. They are not textures, and the mesh is not a capture of them.

| Structure | Photograph | Author | Licence | URL |
| --- | --- | --- | --- | --- |
| Ubosot (ordination hall), three roof tiers | Temple du Bouddha d'émeraude ou Wat Phra Kaeo 3 "Chapelle" royale 1 | Bienvenue en Thaïlande | CC BY-SA 4.0 | <https://commons.wikimedia.org/wiki/File:Temple_du_Bouddha_d%27%C3%A9meraude_ou_Wat_Phra_Kaeo_3_%22Chapelle%22_royale_1.jpg> |
| Chofa finial | Chofah of ubosot Wat Phra Kaeo | Heinrich Damm (User:Hdamm) | CC BY 2.0 | <https://commons.wikimedia.org/wiki/File:Chofahwatpkaeo05.jpg> |
| Phra Si Rattana Chedi | Phra Sri Ratana Chedi2 | ScorpianPK | CC BY-SA 3.0 | <https://commons.wikimedia.org/wiki/File:Phra_Sri_Ratana_Chedi2.JPG> |
| Chedi, mondop, and prasat together | Phra Sri Ratana Chedi, Phra Mondop and Prasat Phra Thep Bidon at Wat Phra Kaew | Christophe95 | CC BY-SA 4.0 | <https://commons.wikimedia.org/wiki/File:Phra_Sri_Ratana_Chedi,_Phra_Mondop_and_Prasat_Phra_Thep_Bidon_at_Wat_Phra_Kaew.jpg> |
| Phra Mondop | Phra Mondop, Wat Phra Kaew (1) | Radosław Botev | CC BY 3.0 pl | <https://commons.wikimedia.org/wiki/File:Phra_Mondop,_Wat_Phra_Kaew_(1).jpg> |
| Prasat Phra Thep Bidon | Prasat Phra Thep Bidon 06.23 | Supanut Arunoprayote | CC BY 4.0 | <https://commons.wikimedia.org/wiki/File:Prasat_Phra_Thep_Bidon_06.23.jpg> |
| Phra rabiang galleries | Phra Rabiang gallery telling the mythical story Ramakien (รามเกียรติ์) | 2008guangzhou | CC BY-SA 3.0 | <https://commons.wikimedia.org/wiki/File:Phra_Rabiang_gallery_telling_the_mythical_story_Ramakien_(%E0%B8%A3%E0%B8%B2%E0%B8%A1%E0%B9%80%E0%B8%81%E0%B8%B5%E0%B8%A2%E0%B8%A3%E0%B8%95%E0%B8%B4%E0%B9%8C).JPG> |

## Experimental traffic vision

The opt-in traffic pilot uses [TensorFlow.js](https://github.com/tensorflow/tfjs) and [TensorFlow COCO-SSD](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd), Apache-2.0. Runtime versions and limitations are documented in `docs/digital-twin-pilot.md`. No new camera ownership or imagery licence is implied.

## Data sources

Source names, counts, and licences for the atlas files and live feeds are in the README section [Data sources](README.md#data-sources). OSM-derived files stay under ODbL 1.0. Do not treat this credits note as a licence for the code: this repository has no `LICENSE` file.
