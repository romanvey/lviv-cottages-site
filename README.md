# Котеджі біля Львова — published site

The deployable build of the cottage board. Static: HTML, CSS, one JS file and one
JSON array. Nothing to install, nothing to build — Vercel serves this repo root as-is.

**Do not edit by hand.** This repo is generated. Source, scrapers and the master
dataset live in the toolkit repo: https://github.com/romanvey/lviv-cottages

Regenerate and publish from there:

```bash
IMAGES_BASE=https://pub-16d758e8a84c4d1fb0fb04e06e144f6f.r2.dev/ \
  node scripts/build-public.mjs
./scripts/publish-site.sh
```

## What's here

| file | |
|---|---|
| `index.html`, `style.css`, `app.js` | the board — search, filter by price/guests/distance/amenities, sort |
| `config.js` | `window.IMAGES_BASE`, the photo origin |
| `data/cottages.json` | 639 places, ~1.2 MB |

## Photos

Not in this repo. 5 595 WebP files (587 MB) sit in Cloudflare R2 at
`pub-16d758e8a84c4d1fb0fb04e06e144f6f.r2.dev`, in two tiers:

- `thumbs/<id>/01.webp` — 400 px covers for the card grid, ~1 MB for 60 cards
- `images/<id>/NN.webp` — 1200 px, fetched only when a card is opened

## About the data

Every place was scraped from a public listing site, and **none of it is confirmed** —
prices and capacities are whatever the listing showed on 2026-08-03. Each card links
to its source. Owner phone numbers are deliberately not published here.
