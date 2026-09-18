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
| gutter fade | absolute, capped by the gutter | up to 360px |

- **Layer:** `position: fixed; inset: 0; z-index: -1; pointer-events: none`,
  masked with
  `linear-gradient(to right, transparent 0, #000 calc(50% - C/2), #000 calc(50% + C/2), transparent min(100%, calc(50% + C/2 + 360px)))`,
  where `C` is the **rendered** column, `min(100%, --launcher-max-width)` — see
  "How far the fade gets" below.
- **Column wrapper:** `max-width: C; margin: 0 auto; height: 100%`, relative.
- **Mark:** absolutely positioned in the wrapper, `aspect-ratio: 35/47`, filled
  with `--accent` through a CSS mask of the configured `branding.watermark`.
- `C` is published once as `--launcher-max-width` from `SHELL_MAX_WIDTH`; the
  gradient and the mark both read it, so the number is never restated in CSS.
- The mark may run off the bottom of the viewport (it does at 720p). **Its top
  is never cropped.**
- No width media queries and no width-dependent opacity: the same rule holds at
  1280, 1920, 2560 and 3440.

### How far the fade gets

**The fade completes wherever there is gutter to complete it in. Where the
viewport is narrower than the content column there is none, and the mark bleeds
off the viewport edge — a bleed, not a crop, and the same thing the phone rule
in §4 does deliberately.**

The fade needs `C + 720px` of screen to run its full 360px on both sides of a
centred column, i.e. about **1900px**. It is keyed to the *rendered* column and
its far stop is clamped to the layer's own edge, so what actually happens is:

| viewport | gutter each side | what the mark does at the screen edge |
|---|---|---|
| ≥ ~1900px | the full 360px | dissolves, with room to spare |
| C … ~1900px | `(viewport − C) / 2` | dissolves, in less room (50px at 1280) |
| < C (desktop) | none | **bleeds** off the edge at full strength |

Two things this is not:

- It is **not** the frozen `clip-path` of #193. A hard edge across a
  recognisable shape in open canvas reads as a truncated image; that is what
  the fade exists to remove, and above the column width it removes it.
- It is **not** a width-dependent *design*. The rule is one expression at every
  width; the clamp only says that a gradient cannot fade over room that is not
  there. Below the column width the mark runs past a screen edge it is already
  flush against, which is a bleed — the composition the phone rule ships on
  purpose.

The original of this spec claimed the dissolve without qualification, and the
suite asserted it only at 2560, where it held. It was a no-op below ~1900px for
a whole release (issue #199): the gradient was keyed to `SHELL_MAX_WIDTH`
rather than the rendered column and had no clamp, so it ran off the side of the
display still opaque. Both stated behaviours are now pinned — see §5.

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

Fill is `--text`, never a hex — a neutral tint that does not move when the
accent is re-skinned (issue [#212](https://github.com/virtUOS/wolke/issues/212),
exploration board option 7a). Because the fill is the text token, the mark is
dark-on-light in light and light-on-dark under `.dark`; that is intended. It
was `--accent` from #174 through #195; §6 records what the swap cost.

Opacity stays **per theme** — a single flat value is the thing #195 proved
wrong — and both values are set at **luminance parity** with what #195 shipped,
so the swap changes the mark's hue and nothing about its weight:

| | canvas painted | fill | opacity | composited luminance | Δ largest channel |
|---|---|---|---|---|---|
| light | (254.35, 252.25, 248.30) | `--text` | **0.032** | 0.91407 | 7.4/255 |
| dark  | (22, 22, 24)             | `--text` | **0.057** | 0.01669 | 12.7/255 |

Against #195's shipped accent, which those two reproduce: light `--accent`
@0.15 → luminance 0.91407, and dark `--accent` @0.07 → luminance 0.01669. The
phone list-row contrast check (§5) reads back 4.8663 in light and 5.6311 in
dark either way, which is the same statement measured from the other end.

### Why the numbers fell so far, and why that is not a fade

0.15 → 0.032 looks like a large reduction and is not one. **Parity is on
luminance, not on largest-per-channel delta**, and the two metrics disagree
sharply for this swap:

- `--accent` (#F2C879) is a *pale* yellow. Over the near-white light canvas it
  moves the blue channel a lot (Δ127 at full strength) but barely moves
  luminance, because its own luminance is close to the canvas's.
- `--text` (#18181B) is near-black. It moves every channel by ~230 and moves
  luminance hard.

So matching the channel delta — the metric #187 and #195 used, when both fills
under discussion were the same pale yellow — would have made the mark far
*heavier* in light, not equal to it. Matching luminance is what "only the tint
changes" actually means, and it is what the eye and the contrast gate both read.
The same effect runs the other way in dark, where `--text` (#F4F4F5) is lighter
than the accent and so lifts the dark canvas further at equal opacity: parity
there is 0.057, not the 0.07 the per-channel reading suggests.

### The accessibility ceiling this discovered

Light is additionally *capped* near **0.0705**, independently of parity. On the
phone the list rows are transparent and the mark shows through them, so the
mark composites under the row's muted subtitle (`--text-muted`, #6B6B70). At
0.07 that text measures 4.5044 against the mark; at 0.075 it is 4.4580 and
below the 4.5 AA floor the suite enforces. Shipping at 0.032 leaves the check
at 4.8663 — today's value exactly — rather than spending the headroom.

Dark has no such ceiling: `--text` there lightens a very dark canvas, and the
row text stays above 5.4 across the whole plausible range.

### Ceilings from earlier rounds

The board's 0.08 cap (#187, frame 7e) was derived on the dark canvas and both
values now sit under it, so it no longer binds anything and is no longer
asserted as a departure. The #212 handoff's "do not exceed 0.06" ceiling is
likewise satisfied in both themes — though not for the reason it gave; see §6.

## 4. Phone (unchanged, #181)

Bottom-anchored, `height: 86vh`, `transform: translate(36%, 22%)`, no gutter
mask. Out of scope for #195.

## 5. What the tests pin

Unit (`watermark.test.tsx`): the config gate (no value → no element at all),
decorativeness, the `--text` fill token, `--launcher-max-width` as the single source,
the layer's gradient stops, the mark's ratio-derived width/right, the
`var(--greeting-top)` anchor, and the per-theme opacities.

Unit also pins the two halves of the fade expression (issue #199): the rendered
column rather than the cap, and the clamp that ends the fade inside the layer.

e2e (`issue-174-watermark.spec.ts`): the rendered geometry at every matrix size
**and at 2560×1080 and 3440×1440** — above the matrix is where every
predecessor failed — plus the fade read off rendered pixels at **three** widths,
one per row of the table above: 2560 (the full 360px), **1280** (the fade
completes in a 50px gutter — the case #199 found unobserved) and **768** (below
the column, so the mark is still at full strength where the screen ends, and
that is asserted rather than tolerated) — plus: the mark's top equals the greeting's top at
scroll-top and follows it when the announcement banner mounts; the layer adds
no document scroll; the mark is invisible to the pointer and to assistive tech;
card fill is pixel-identical with the mark on and off; and the shipped default
(unconfigured) renders no element.

## 6. Corrections this round made (issue #212)

Two figures that were repeated across the component comment, the tests and this
spec turned out to rest on wrong premises. Both are recorded here so a future
reader does not re-derive them.

**The light canvas is not `--bg`.** `DashboardShell.tsx` paints it as
`color-mix(in srgb, var(--accent) 5%, var(--bg))` — measured (254.35, 252.25,
248.30) — and has since the Editorial design landed (`188756f`, 2026-06-17),
long before the watermark existed. #187 dropped that tint in dark only. Issue
#212's footnote claims the app does not paint (254,252,248) and that the light
canvas is `#FFFFFF`; that is backwards. #195's own measurements were taken
against the real canvas and were correct — its Δ9 at 0.07 and Δ19 at 0.15 both
reproduce to the digit. The #212 figures of Δ20.1 and light @0.087 are what you
get by compositing over pure white instead, and they are not shipped.

**Per-channel parity is not parity.** #212 reasoned from the largest
per-channel delta and concluded dark was "contrast-neutral" at an unchanged
0.07 and light needed 0.087. Measured on luminance, 0.087 in light is ~2.7×
today's weight and fails the phone AA check at 4.3480; and dark at 0.07 is ~14%
heavier than today. The metric was sound while every candidate fill was the
same pale yellow, and stops being sound the moment the fill's luminance moves.
The shipped values (light 0.032, dark 0.057) are luminance parity, per §3.

Consequently the handoff's "do not exceed 0.06" ceiling is met in both themes,
but it was not a constraint this round had to trade against: parity landed
under it on its own.
