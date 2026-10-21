# CE Fun Club Store — Logo Guidelines

**The idea:** a chubby plate (C) and a bubble-handled fork (E), with a little sparkle of *yum*.
Fun, cute, friendly, appetising.

## Logo versions

| Version | File | Use for |
|---|---|---|
| Horizontal lockup | `ce-horizontal-color.svg` | App header, emails, menus, most uses (default) |
| Stacked lockup | `ce-stacked-color.svg` | Square spaces: posters, stickers, login screen, social posts |
| Symbol | `ce-symbol.svg` | When the name is already nearby; avatars, merch, packaging |
| Small-size symbol | `ce-symbol-small.svg` | **Anything under 48 px** — favicon, tiny UI icons (no sparkles, bigger gaps between tines) |
| App icon | `symbol/ce-symbol-app-icon.svg` | Home-screen / PWA icon |

Each lockup and symbol comes in four colourways: `-color`, `-reversed` (for dark backgrounds),
`-black` and `-white` (one-colour: printing, stamps, embroidery, photo overlays).

## Colour

| Name | HEX | RGB | Role |
|---|---|---|---|
| **Paprika** | `#D94A1E` | 217 74 30 | The plate (C), "STORE", app-icon tile, buttons |
| **Espresso** | `#2B1B17` | 43 27 23 | The fork (E), "CE Fun Club", body text |
| **Sunny** | `#FFB627` | 255 182 39 | The sparkles only (and small fun accents: badges, confetti) |
| Cream | `#FFF4E8` | 255 244 232 | Warm background, packaging, cards |
| White | `#FFFFFF` | 255 255 255 | Default background |

Accessibility: Espresso on white = 16.5:1 (all text). Paprika on white = 4.2:1 — fine for the logo, icons,
large text and buttons with white bold labels; use Espresso for small body text.
For print, ask your printer to match the HEX values (approx. CMYK Paprika 0 75 90 10, Espresso 0 35 45 85).

## Typography

The wordmark is **Fredoka SemiBold** ("CE Fun Club") and **Fredoka Medium, wide-tracked** ("STORE"), converted to
outlines — the logo files don't need the font installed. Fredoka is free (SIL Open Font License; on Google Fonts and
npm `@fontsource/fredoka`, copies in `fonts/`). In the web app use Fredoka for headings and buttons, and a plain
readable font (e.g. Inter or Nunito) for body text and menus.

## Clear space

Keep empty space around the logo at least equal to the **thickness of the plate (the C's ring)** on all sides —
about ⅛ of the symbol's height. Nothing (text, edges, other logos) goes inside it.

## Minimum sizes

- Horizontal lockup: **120 px** wide on screen / 30 mm in print
- Stacked lockup: **80 px** wide / 20 mm
- Symbol: 48 px and up → `ce-symbol.svg`; **below 48 px → `ce-symbol-small.svg`** (down to 16 px)

## Backgrounds

- ✅ White, Cream, light photos → full colour
- ✅ Espresso, black or dark photos → `-reversed` (Paprika plate + white fork/text)
- ✅ Paprika → `-white` (the sparkles turn white too)
- ❌ Busy photos with no calm area; mid-tone backgrounds where Paprika disappears

## Please don't

- Recolour the parts (e.g. orange fork, green plate) or add gradients/shadows
- Stretch, squash, rotate or outline the logo
- Retype the name in another font, or rearrange the symbol and name
- Close the C, add a knife/spoon, or change the number of tines
- Move, enlarge or add more sparkles to the logo (use extra sparkles freely *around* it, in illustrations — just not inside the logo)
- Use the detailed symbol below 48 px (use the small-size cut)

## Web app setup

`symbol/` contains `favicon.ico`, `favicon.svg`, PNG icons (16/32/48/180/192/512, maskable) and `site.webmanifest`.
Copy them to your site's public root and paste `symbol/head-snippet.html` into your `<head>`.

---
Trademark note: no trademark search was done. Fredoka is free for logo use (OFL).
The previous "classic" version of the logo is kept in `kit-v1-classic.zip` for reference.
