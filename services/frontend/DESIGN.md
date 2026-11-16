# Rawi design system

Rawi searches what was said in Arabic podcasts. Its job is to get someone to the
moment a thing was said, so the transcript is the content and everything else
is apparatus around it.

The tokens live in `src/styles.css` and the primitives in `src/components/ui/`.

## The idea: a transcript read like a manuscript

- **What was said** sits in the main column in Markazi Text, a Naskh made for reading.
- **Where it was said** (the timestamp) sits in the start margin, like a gloss
  beside a manuscript's text. `Gloss` does this layout; it folds above the
  text on narrow screens.
- **What the search found** is highlighted, the way a reader marks a
  book. The words around a match stay quieter (`muted`) than the match.

## Colour

Neutral throughout. The interface is black on a light ground, or near-white on
`#18181a`; the only colour is the highlight on matched words.

| Token             | Light                 | Dark                  | Use                                              |
| ----------------- | --------------------- | --------------------- | ------------------------------------------------ |
| `paper`           | `#fafafa`             | `#18181a`             | Page ground                                      |
| `surface`         | `#ffffff`             | `#222225`             | Fields, popovers, anything raised                |
| `sunken`          | `#f0f0f0`             | `#121214`             | Hover rows, tags, segmented tracks               |
| `ink`             | `#000000`             | `#ededed`             | Text                                             |
| `muted` / `faint` | `#5c5c5c` / `#8f8f8f` | `#a1a1a6` / `#6e6e73` | Secondary text / hints and placeholders          |
| `rule`            | `#e2e2e2`             | `#2e2e32`             | Borders and dividers                             |
| `accent`          | `#000000`             | `#ededed`             | Anything that can be acted on; the same as `ink` |
| `highlight`       | `#ffe066`             | `#e6c35c`             | Matched words only                               |

Because `accent` is the text colour, what can be pressed is told apart by form
instead: buttons have a fill or border, and links and timestamps are underlined.
The map's canvas keeps its fixed `stage` ground (`#18181a`) and its own data colours.

## Type

- **Readex Pro** for the interface, headings and numbers.
- **Markazi Text** only for quoted speech (`text-read`, `text-read-lg`). It has
  a small eye, so its steps are larger than the UI's.
- UI scale is a minor third from 16px: `xs` 13, `sm` 14, `base` 16, `lg` 19,
  `xl` 23, `2xl` 28, `3xl` 34. Line heights run looser than Tailwind's
  defaults, which suit Latin rather than Arabic.
- Counts use Arabic-Indic digits (`arabic()`); timestamps and dates stay Latin
  and left-to-right, matching the YouTube player they link to.
- Sentence-level copy, no all-caps, no English labels in the Arabic interface.

## Shape and depth

- Radius grows with the thing: `mark` 2px (highlights, tags), `control` 6px
  (buttons, fields), `panel` 12px (popovers, the main search box).
- Results are not boxed in cards. Episodes are separated by space and their
  margin; borders are kept for controls and section dividers.
- One shadow, `shadow-float`, and only on things that float (`panelClass`).

## Primitives

| Component                                                    | For                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| `Button` (`primary`, `secondary`, `quiet`; `sm`, `md`, `lg`) | At most one `primary` per view                         |
| `IconButton`                                                 | Icon-only actions; always labelled                     |
| `TextField` (`query`, `field`)                               | `query` is the search box a page is built around       |
| `Segmented` / `Segment`                                      | Two or three exclusive options, such as search mode    |
| `Tabs` / `TabList` / `Tab` / `TabPanel`                      | Views of one thing, such as description and transcript |
| `Chip` / `chipClass`                                         | Filters; `active` when not on their default            |
| `Checkbox`                                                   | Multi-select lists, such as channels                   |
| `Tag` (`plain`, `accent`, `warn`)                            | Non-interactive facts about a result                   |
| `Timestamp`                                                  | A link to a second in an episode                       |
| `Gloss`, `Quote`                                             | The margin layout and quoted speech                    |
| `panelClass`                                                 | Popovers and menus                                     |

## Motion

Only in answer to an action: popovers fade and drop 4px in 150ms, and colour
changes on hover take 150ms. No entrance animations. Reduced motion turns all
of it off.
