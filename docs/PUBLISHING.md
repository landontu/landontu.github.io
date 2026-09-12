# Publishing and launch readiness

GitHub Pages serves files from the repository root of whichever source branch
is selected. The source selection is repository configuration, not a fact stored
in this branch; inspect **Settings → Pages** before changing it.

## Branch switch

- `dark` is an orphan holding-site branch. Its tracked publish surface is
  `.nojekyll`, `index.html`, `robots.txt`, and `404.html`. It blocks indexing and
  displays a minimal unavailable page.
- `main` contains the full site. Selecting it is the launch action; do so only
  with the owner's explicit approval.

To conceal the site, set the Pages source to the root of `dark`. To launch it,
set the source to the root of `main`. This can be done in **Settings → Pages** or
with GitHub CLI:

```sh
# Conceal
gh api -X PUT repos/landontu/landontu.github.io/pages \
  -f 'source[branch]=dark' -f 'source[path]=/'

# Launch
gh api -X PUT repos/landontu/landontu.github.io/pages \
  -f 'source[branch]=main' -f 'source[path]=/'
```

These commands change public deployment state. Do not run them as a routine
test or without approval.

## `main` publish surface

There is no generated deployment artifact or allowlist. Selecting the root of
`main` places the root site files and non-excluded content under `assets/`,
`watercolor/`, `prototypes/`, and `screenshots/` inside the Pages source tree.
Unlinked files should not be treated as private. Decide whether to accept that
surface or publish a deliberately reduced artifact before launch.

## Current launch-readiness facts

These are documentation of the current files, not changes to site behavior or
owner-authored content:

- `index.html` and `watercolor.html` still contain owner-text placeholders, and
  the portfolio descriptions in `index.html` are marked as draft.
- `index.html` has a title and generic description, but no Open Graph or Twitter
  card metadata and no absolute canonical URL.
- `main` has no custom `404.html`, `robots.txt`, or `sitemap.xml`.
- [LICENSE-ART.md](../LICENSE-ART.md) covers artwork only. No code license has
  been selected.

Before launch, the owner needs to resolve the copy, intended publish surface,
metadata/404 scope, and code-license choices. Recheck every item against `main`
rather than treating this list as approval to publish.
