# trumap

A map where the labels say what you want. Type "New York" → "Big Apple", and the map
draws it that way. Everything else — panning, zooming, search — keeps working, and
the editor can be hidden so the result looks like an ordinary map.

Static site, no build step, no API keys. Works on GitHub Pages.

## How it works

The base map is OpenStreetMap data served as vector tiles ([OpenFreeMap] / [VersaTiles]),
so labels are rendered in the browser rather than baked into images. Every symbol layer's
`text-field` is rewritten to look up the feature's real name (`name`, `name:latin`, `ref`, …)
in a replacement table and draw the substitute when it matches, otherwise fall back to the
style's original expression. Rendering, collision and placement are untouched.

## Use

- **Add a replacement** — type the original label and what should show instead. The
  input autocompletes from labels currently on screen; `◎` lets you click a label on
  the map to pick it. Matching is exact but case-insensitive.
- **Hide the editor** (`Hide ✕` / `Esc`) — leaves nothing but the map. Come back with
  `Ctrl`/`Cmd`+`Shift`+`E`, three clicks in the top-left corner, or `#k=0` in the URL.
- **Share** — *Copy shareable link* encodes the replacements in the URL and opens with
  the editor hidden. Replacements also persist in `localStorage`.
- **Search** works on the real names and on your invented ones; searching for
  "Big Apple" finds New York.

URL state lives in the hash: `m` = lat,lng,zoom · `s` = base map · `r` = rules · `k` = hidden.

## Deploy

Any static host. For GitHub Pages either:

- **Settings → Pages → Deploy from a branch**, `main` / root, or
- **Settings → Pages → Source: GitHub Actions**, which picks up `.github/workflows/pages.yml`.

## Notes

Search uses [Nominatim], whose usage policy applies — it is fine for casual use, not
for bulk querying. Map data © OpenStreetMap contributors.

[OpenFreeMap]: https://openfreemap.org
[VersaTiles]: https://versatiles.org
[Nominatim]: https://operations.osmfoundation.org/policies/nominatim/
