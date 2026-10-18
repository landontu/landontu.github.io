# landontu.github.io

Static personal site and portfolio, served directly by GitHub Pages. The site is
plain HTML, CSS, and JavaScript: there is no dependency install or build step.

The `main` branch contains the work-in-progress full site. The orphan `dark`
branch contains the minimal holding site used to conceal it. See
[Publishing](docs/PUBLISHING.md) before changing the Pages source.

## Run locally

From the repository root:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000/>. Also check `/watercolor.html`,
`/about.html`, and `/portfolio.html`; the last two are compatibility redirects
into sections of the home page.

There is no automated test or lint suite. For a change, smoke-test the affected
page at desktop and mobile widths, check both themes, and confirm the browser
console and local asset requests are clean.

## Repository map

- `index.html` — the one-page home, about, and portfolio experience.
- `about.html`, `portfolio.html` — legacy redirect stubs.
- `watercolor.html` and `watercolor/` — the standalone watercolor exhibit and
  its simulation modules.
- `styles.css`, `watercolor*.css`, `showcase.css`, `site.js` — site presentation
  and behavior.
- `assets/` — project images used by the main page.
- `CNAME` — the `landontu.dev` custom domain GitHub Pages reads once `main` is
  the source. DNS and HTTPS must be ready first; see
  [Publishing](docs/PUBLISHING.md#custom-domain-and-launch-order).
- `prototypes/` and `screenshots/` — development artifacts, not a separate
  build input. They are still inside the `main` Pages source tree.
- `docs/PUBLISHING.md` — branch switch, publish surface, and launch-readiness
  facts.
- `LICENSE-ART.md` — artwork provenance and license scope.
- `AGENTS.md` — task routing and project constraints for coding agents.

## Licensing

`LICENSE-ART.md` covers the source artwork and its derived assets only. This
repository does not currently include a license for the site's code or other
content.
