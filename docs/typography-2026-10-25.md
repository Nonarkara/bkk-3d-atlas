# English typography refinement

Request: less heavy English, especially bold, without shrinking readable text.

Operational Atlas only: Jost for Latin body and display; existing Sao Chingcha
for Thai; existing monospace for aligned data. Regular text remains regular,
emphasis is 600 rather than 700–900. Sizes, line heights, controls and content
are unchanged. The previous Latin face at 800/900 crowded short labels.

Jost variable files have a verified wght axis 100–900. Their declared Latin
ranges exclude Thai; Thai font files and weight declarations are retained.
Self-hosted files from Google Fonts CSS, Jost v20, on 25 October 2026:

- https://fonts.gstatic.com/s/jost/v20/92zatBhPNqw73oTd4g.woff2
- https://fonts.gstatic.com/s/jost/v20/92zatBhPNqw73ord4iYl.woff2
- Licence: public/fonts/Jost-OFL.txt, upstream
  https://raw.githubusercontent.com/google/fonts/main/ofl/jost/OFL.txt

Proof: /tmp/atlas-type-before.png and /tmp/atlas-type-after.png;
1440/1024/390 captures /tmp/atlas-type-1440.png, -1024.png, -390.png.
Phone title fits its intrinsic width; independent read-only reviewer confirms
lighter English, retained emphasis and unchanged Thai routing. Feed loading
states differ between captures and are not typography changes. No claim of
fluent-reader testing, blocked-font testing or enlarged-text verification.

Regression tests check self-hosted font files, licence, family order, retained
Thai bold face and the maximum UI weight. Production receipt follows release.
