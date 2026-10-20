# Publishing and launch readiness

GitHub Pages serves files from the repository root of whichever source branch
is selected. The source selection is repository configuration, not a fact stored
in this branch; inspect **Settings → Pages** before changing it.

## Branch switch

- `dark` is an orphan holding-site branch. Its tracked publish surface is
  `.nojekyll`, `index.html`, `robots.txt`, and `404.html`. Its `robots.txt`
  blocks crawling, and it displays a minimal unavailable page.
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

## Custom domain and launch order

`main` carries a `CNAME` file containing `landontu.dev`. Once `main` is the
Pages source, GitHub Pages serves the site at that domain and redirects
`landontu.github.io` to it. If DNS or the certificate is not ready at that
moment, the launch is broken or served without HTTPS. Every step below changes
public state and needs the owner's approval; none is part of routine testing.

1. **Verify the domain.** In the account's **Settings → Pages**, add
   `landontu.dev` as a verified domain. At the DNS provider, create the `TXT`
   record GitHub shows at `_github-pages-challenge-landontu.landontu.dev`, wait
   until `dig +short TXT` on that name returns the value, and complete
   verification. This blocks other GitHub accounts from claiming the domain
   once DNS points at Pages. Keep the `TXT` record in place.
2. **Domain on the holding site.** While `dark` is still the source, set the
   custom domain to `landontu.dev` in the repository's **Settings → Pages**.
   The DNS check fails until the next step; that is expected. With branch
   publishing, GitHub may commit a `CNAME` file to `dark`; that is also
   expected.
3. **DNS for the apex.** Only after steps 1 and 2, create apex records pointing
   at GitHub Pages:
   - `A`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
     `185.199.111.153`
   - `AAAA`: `2606:50c0:8000::153`, `2606:50c0:8001::153`,
     `2606:50c0:8002::153`, `2606:50c0:8003::153`
   - Optionally `www` as a `CNAME` to `landontu.github.io`.

   Do not add a wildcard record. If the zone is on Cloudflare, keep these
   records DNS-only (not proxied) until GitHub has issued the certificate.
   Confirm with `dig +short landontu.dev A` and `AAAA`. The domain then serves
   the holding page.
4. **Certificate and HTTPS.** Wait until **Settings → Pages** shows the DNS
   check passing and the certificate issued (usually minutes, occasionally up
   to a day), then enable **Enforce HTTPS**. Confirm that
   `curl -sI https://landontu.dev/` succeeds and that `http://` redirects to
   `https://`.
5. **Stones subdomain.** `stones.landontu.dev` is a separate DNS record for a
   separate host and does not depend on the Pages source. Its portfolio card is
   shown as a muted, non-clickable coming-soon card with no link, so this host
   is not a launch dependency. Require an anonymous 200 over HTTPS before
   linking the card.
6. **Preflight, then source switch.** Recheck the
   [launch-readiness facts](#current-launch-readiness-facts) against `main`
   and confirm steps 1–4 still hold. Only then set the Pages source to `main`
   (see [Branch switch](#branch-switch)). Afterwards, confirm that **Settings →
   Pages** still lists `landontu.dev` with HTTPS enforced, and that
   `https://landontu.github.io/` redirects to `https://landontu.dev/`.

### Indexing

Concealment relies on the `dark` holding site, whose `robots.txt` blocks
crawling. That is not a guarantee against indexing: a search engine can still
list a disallowed URL, without a snippet, if something links to it. A noindex
signal only works on pages crawlers are allowed to fetch, so a `robots.txt`
disallow also hides any noindex on those pages. `main` has no `robots.txt` and
its canonical pages do not set noindex, so search engines may index the site
once `main` is the source. Keep
that switch last, after the domain and HTTPS are confirmed on the holding site,
so the indexable site first appears at its final HTTPS URL. If the owner wants
a soft launch that is not indexable, add noindex to `main`'s pages before the
switch, leave them crawlable (no `robots.txt` disallow), and remove noindex as
a separate, deliberate change.

To roll back, set the source to `dark` again. Keep the custom domain and DNS in
place so the holding site, not a GitHub 404, is served at `landontu.dev`.

## `main` publish surface

There is no generated deployment artifact or allowlist. Selecting the root of
`main` places the root site files and non-excluded content under `assets/`,
`watercolor/`, `prototypes/`, and `screenshots/` inside the Pages source tree.
Unlinked files should not be treated as private. Decide whether to accept that
surface or publish a deliberately reduced artifact before launch.

## Current launch-readiness facts

These are documentation of the current files, not changes to site behavior or
owner-authored content:

- The hero tagline, About movement, About navigation item, and hero About link
  are hidden until owner copy is ready; restoration slots remain in source.
  The watercolor exhibit holds its owner-written text as “Coming soon.”
- WebHome and recall-AID are intentionally absent while their only destinations
  are private repositories. Their cards and screenshots are removed from
  `main` and remain recoverable from git history.
- The Stones card is visible but muted and unlinked (coming soon). Its
  destination is not a dependency for this launch; require an anonymous 200
  before linking it.
- `index.html` has a title and generic description, but no Open Graph or Twitter
  card metadata and no absolute canonical URL.
- `main` has no custom `404.html`, `robots.txt`, or `sitemap.xml`.
- The canonical home page and watercolor exhibit do not set noindex. The
  compatibility-only `about.html` and `portfolio.html` redirect stubs retain
  noindex plus canonical links to avoid indexing duplicate pages.
- [LICENSE-ART.md](../LICENSE-ART.md) covers artwork only, and
  `assets/fonts/OFL.txt` covers the bundled font only. No code license has been
  selected.

Before launch, the owner needs to resolve the copy, intended publish surface,
metadata/404 scope, and code-license choices. Recheck every item against `main`
rather than treating this list as approval to publish.
