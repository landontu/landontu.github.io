# Agent guide

Read [README.md](README.md) first for the project map and local workflow.

## Route by task

- Frontend or UI: read `~/docs/style-guide.md` before editing HTML or CSS, then
  inspect the affected page and its adjacent styles/scripts.
- Watercolor behavior or tuning: start with `watercolor/settings.js`; its
  calibration comments document the invariants behind the controls. Runtime
  modules live beside it in `watercolor/`.
- Publishing or launch readiness: read [docs/PUBLISHING.md](docs/PUBLISHING.md).
- Artwork provenance or derived art: read [LICENSE-ART.md](LICENSE-ART.md).
- General setup and validation: use [README.md](README.md).

## Project constraints

- `index.html` and the owner-text areas in `watercolor.html` contain the owner's
  personal voice. Do not draft or replace owner copy; placeholders and text
  marked as draft require owner input.
- This is a dependency-free static site. Do not introduce a build system just
  to run or publish existing files.
- `about.html` and `portfolio.html` intentionally preserve old URLs by
  redirecting to sections in `index.html`.
- The `dark` branch is an orphan holding site. Changing the GitHub Pages source
  changes public visibility; follow the approval note in the publishing guide.
- Keep implementation rationale next to the relevant code. The detailed
  comments in the watercolor modules are current engineering documentation,
  not cleanup targets.
