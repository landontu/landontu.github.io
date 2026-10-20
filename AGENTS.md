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

- The hero tagline and About movement in `index.html` are deferred and hidden;
  their restoration slots remain in source until owner copy is ready. The
  owner-text area in `watercolor.html` uses “Coming soon.” Do not draft
  replacement copy. The Stones card's one-line description is an intentionally
  empty, marked source slot until the owner writes it.
- Owner text decisions (2026-10-20): the header LT wordmark and the hero
  “Hello, I’m” line are removed (the hero line stays as a restoration comment);
  the portfolio has no eyebrow, a deliberately small heading, three columns at
  75% width, and Stones as a muted coming-soon card. The Desmos Quest card
  shows `assets/projects/desmos-game.gif` (level 1 turning slowly, captured
  headlessly from the release graph https://www.desmos.com/calculator/msmxoizut3
  via `Calc` with the Menus and HUD and Control stick folders hidden; its
  reduced-motion still is `desmos-game.webp`). The This site card image is a
  stale screenshot that predates the header/hero changes; replace it only if
  the owner asks.
- WebHome and recall-AID cards are deferred while their repositories are
  private. Restore them from git history only after public destinations are
  approved.
- The Stones card is a muted, non-clickable coming-soon card (no link,
  `aria-disabled`). Link it to https://stones.landontu.dev only after that host
  returns an anonymous 200 over HTTPS.
- This is a dependency-free static site. Do not introduce a build system just
  to run or publish existing files.
- `about.html` and `portfolio.html` intentionally preserve old URLs by
  redirecting to `index.html`. While About is hidden, `about.html` targets the
  top of the page; restore `index.html#about` when About is published.
- The `dark` branch is an orphan holding site. Changing the GitHub Pages source
  changes public visibility; follow the approval note in the publishing guide.
- Keep implementation rationale next to the relevant code. The detailed
  comments in the watercolor modules are current engineering documentation,
  not cleanup targets.
