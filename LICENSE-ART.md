# Artwork license and provenance

## Source artwork

- **Title:** *Moonlit Landscape*
- **Artist:** Nagasawa Rosetsu 長澤蘆雪 (Japanese, 1754–1799)
- **Date:** 1794–95
- **Medium:** Hanging scroll; ink on silk
- **Repository:** The Metropolitan Museum of Art, New York
- **Object:** 2020.392; Open Access API object `845805`
- **Museum record:** <https://www.metmuseum.org/art/collection/search/845805>
- **Open Access API record:** <https://collectionapi.metmuseum.org/public/collection/v1/objects/845805>
- **Original image:** <https://images.metmuseum.org/CRDImages/as/original/LC-TR_168_1ab_2020_sr1-006.jpg>
- **Local copies:**
  `prototypes/watercolor-bg/art/moonlit-landscape-rosetsu-1794.jpg` and
  `prototypes/watercolor-bg/v3-consolidated/art/moonlit-landscape-rosetsu-1794.jpg`
- **Local SHA-256:** `e0a7a450b4a7aaaf049f3738869febe4ef00d87911e56d4cf7b6fc4b254f8faf`

## License

**Public Domain, supplied under The Met Open Access program / CC0.** The artwork page
labels this image “Public Domain”; the museum's API returns
`"isPublicDomain": true`. The Met's terms state that Open Access works are
provided under Creative Commons Zero (CC0), for commercial or noncommercial use,
without fee or permission:

<https://www.metmuseum.org/policies/terms-and-conditions#open-access>

No attribution is legally required for a public-domain work. The full credit
above is retained as good scholarly practice and to make the derivation auditable.

## What this site derives

The shipped JPEG copies are provenance/reference material, not hotlinks and not
the visible resting background. Each prototype's `tools/derive_art.py` crops the
painted scene out of the scroll mounting and separates high-frequency dark marks
from broad wash tone. Those scalar regions seed the R (ink) and G (mist)
channels of its `art/rosetsu-quantized-field.png`; Rosetsu's reserve moon seeds B
(gold). This is field data, not a flattened reproduction: the shader turns each
channel into grain-thresholded, feathered watercolor coverage. The script also
records 69 deterministic cluster regions in `js/art-data.js` so the derivation
is auditable. The production copy of that generated data, including embedded
field and fallback images, is `watercolor/art-data.js`.

The value roles measured from the scan are hue-quantized into the requested
Moonlit Dragon family (`#314f55`, `#7e958b`, `#d7ba70` on `#e8e1c8`). Every seed
belongs to exactly one pigment field, so interaction cannot average the palette
into brown. At rest, the field reconstructs Rosetsu's moon/cloud/pine/mountain
composition in the prototype's watercolor-blob medium. The fine-brush pointer
locally clears and displaces samples; its damped spring returns exactly to the
image-derived field when the pointer leaves.
