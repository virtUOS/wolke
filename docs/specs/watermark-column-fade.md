# Watermark: column-anchored mark with a right-gutter fade

Issue [#195](https://github.com/virtUOS/wolke/issues/195), design board turn 9
(frames 9a–9f). Supersedes the desktop geometry of #174, #181 and #187 and the
whole #193 exploration. **Desktop only** — the phone geometry of #181 is
unchanged and out of scope.

## 1. What the rule is

The decorative institution mark is a fixed, full-viewport **layer** behind the
launcher content. Inside it sits a centred **column wrapper** of exactly the
launcher's own content width, and the mark is positioned against that wrapper's
right edge.

Two things distinguish this from every previous round:

1. **A gutter fade, not a crop.** The whole layer carries a horizontal gradient
   mask: fully opaque across the content column, linear to transparent over the
   360px immediately to its right. The part of the mark that would otherwise
   float in empty canvas on a wide screen dissolves instead of being cut, so
   there is nothing to drift and nothing that reads as a truncated image (the
   specific failure of the frozen `clip-path` in #193).
2. **Vertical anchoring to content.** The mark's `top` is the measured top of
   the greeting block, not a viewport fraction — so the composition holds
   whatever sits above or below the greeting.

## 2. Geometry

All derived values are ratios of the content column width `C`
(`SHELL_MAX_WIDTH` = 1180px). The handoff quotes pixels for a 960px column; the
ratios carry, the pixels do not.

| | ratio | at C = 1180 |
|---|---|---|
| mark width | 0.65 × C | 767px |
| mark height | width × 47/35 | ≈1030px |
| mark `right` | −0.247 × C | −291px (= 38% of the mark's own width past the column edge) |
| gutter fade | absolute | 360px |

- **Layer:** `position: fixed; inset: 0; z-index: -1; pointer-events: none`,
  masked with
  `linear-gradient(to right, transparent 0, #000 calc(50% - C/2), #000 calc(50% + C/2), transparent calc(50% + C/2 + 360px))`.
- **Column wrapper:** `max-width: C; margin: 0 auto; height: 100%`, relative.
- **Mark:** absolutely positioned in the wrapper, `aspect-ratio: 35/47`, filled
  with `--accent` through a CSS mask of the configured `branding.watermark`.
- `C` is published once as `--launcher-max-width` from `SHELL_MAX_WIDTH`; the
  gradient and the mark both read it, so the number is never restated in CSS.
- The mark may run off the bottom of the viewport (it does at 720p). **Its top
  is never cropped.**
- No width media queries and no width-dependent opacity: the same rule holds at
  1280, 1920, 2560 and 3440.

### Vertical anchor

`top: var(--greeting-top)`. The greeting publishes its own **document** offset
(`getBoundingClientRect().top + scrollY`) as that custom property on mount, on
resize, and whenever the page's layout changes above or below it (a
`ResizeObserver` on the greeting and on `document.body`, which is what the
announcement banner mounting or unmounting moves). `WATERMARK_FALLBACK_TOP` (89px, measured) is only a first-paint
fallback; because the publish happens in a layout effect, a launcher never
paints with it. It is *not* the handoff's 112/62 pair — those assume the
announcement banner sits above the greeting, and in our launcher it sits below
it, so the greeting's own top does not move when a banner appears. The
mechanism is still the right one (anything that does move the greeting — a
wrapping app bar, a future banner above it — is followed automatically), and
the e2e asserts the anchor against the greeting's real position with and
without a banner.

**Fixed layer vs. scrolled greeting.** The layer is `position: fixed`; the
greeting is in flow. The anchor is therefore measured in *document* coordinates
and the two agree at scroll-top — the state the composition is designed in.
Once the page scrolls, the mark stays put and the greeting moves. That is the
design's intent ("stays put while the list scrolls") and it is also what keeps
a ~1030px box out of the document's scrollable overflow, which the viewport
suite depends on.

## 3. Colour and opacity

Fill is `--accent`, never a hex. Opacity is per theme:

- **dark 0.07** — the handoff's value, and the board's 0.08 cap (frame 7e)
  applies: measured Δ15/255 against the dark canvas.
- **light 0.15** — a deliberate departure from the cap, decided on the issue
  (C1). The cap is dark-derived; at 0.07 the accent over the light canvas gives
  only Δ9/255, which is the "barely visible on most screens" that was reported.
  0.15 measures **Δ19/255**. The issue's starting point was 0.18 (Δ23) with an
  instruction to re-judge on the new geometry: the gutter fade concentrates the
  mark over the column rather than letting it bleed across the whole canvas, so
  it carries at less. Judged on a ladder (0.07 / 0.11 / 0.15 / 0.18) rendered
  with the real line-art mark at 1920×1080; 0.18 starts to read as an object
  crossing the card row, 0.11 is still faint, 0.15 is present as a texture.

`WATERMARK_MAX_OPACITY` stays the dark ceiling and is asserted for dark only.

## 4. Phone (unchanged, #181)

Bottom-anchored, `height: 86vh`, `transform: translate(36%, 22%)`, no gutter
mask. Out of scope for #195.

## 5. What the tests pin

Unit (`watermark.test.tsx`): the config gate (no value → no element at all),
decorativeness, the accent token, `--launcher-max-width` as the single source,
the layer's gradient stops, the mark's ratio-derived width/right, the
`var(--greeting-top)` anchor, and the per-theme opacities.

e2e (`issue-174-watermark.spec.ts`): the rendered geometry at every matrix size
**and at 2560×1080 and 3440×1440** — above the matrix is where every
predecessor failed — plus: the mark's top equals the greeting's top at
scroll-top and follows it when the announcement banner mounts; the layer adds
no document scroll; the mark is invisible to the pointer and to assistive tech;
card fill is pixel-identical with the mark on and off; and the shipped default
(unconfigured) renders no element.
