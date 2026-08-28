# landontu.github.io

## Dark mode / launch

GitHub Pages serves a minimal holding page from the orphan `dark` branch while the launch-ready site remains on `main`. To conceal the site, point Pages at `dark`:

```sh
gh api -X PUT repos/landontu/landontu.github.io/pages -f source[branch]=dark -f source[path]=/
```

To launch the site, point Pages back at `main`:

```sh
gh api -X PUT repos/landontu/landontu.github.io/pages -f source[branch]=main -f source[path]=/
```
