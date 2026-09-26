# PDF Maker: agent notes

Electron desktop app (macOS, Windows) that combines PDFs and images into one PDF. See `README.md`
for the user-facing feature list.

## Stack

- **Electron** + **electron-vite** (main, preload and renderer builds) + **electron-builder**
  (installers).
- **React** renderer, no state library: a single `useReducer` in `App.tsx`.
- **pdf-lib** reads and writes PDFs. **pdf.js** (`pdfjs-dist`) renders page thumbnails.
- **@dnd-kit/sortable** for drag-and-drop and keyboard reordering.
- **Vitest** unit tests, **Playwright** e2e tests against the built Electron app.

## Architecture

```
src/main/index.ts          Window, app menu, IPC: native open/save dialogs, file I/O
src/preload/               contextBridge API exposed as window.api (types in api.ts)
src/renderer/src/
  App.tsx                  State, file drop, menu commands, notices
  components/              Toolbar, PageGrid (sortable cards), PagePreview
  lib/                     Pure logic (tested in Node), plus browser-only helpers
    types.ts               Source (a loaded file) and PageItem (one output page)
    layout.ts              Page sizes, margins, fit-to-page and rotation maths
    importFiles.ts         Bytes -> sources + pages (PDF, PNG, JPEG; other images via converter)
    imageInfo.ts           File sniffing, PNG/JPEG dimensions, EXIF orientation
    buildPdf.ts            Sources + pages + settings -> output PDF bytes
    state.ts               Reducer: add, remove, rotate, move, settings, clear
    thumbnails.ts          pdf.js rendering (browser only)
    convertImage.ts        Canvas re-encoding for WebP/GIF/BMP/etc. (browser only)
    platform.ts            Electron IPC with browser fallbacks (file input, download)
```

Key ideas:

- All PDF work happens in the renderer. The main process only shows dialogs and reads/writes files;
  it validates every IPC argument and can only reveal paths it saved.
- A `PageItem` stores its **display** size (after the source's own `/Rotate` or EXIF rotation) in
  points, plus `sourceRotation` and the user's `rotation`. `computeLayout` decides the output page
  size and where the content goes; `placeRotated` converts that to pdf-lib's rotate-about-corner
  drawing. `PagePreview` uses the same `computeLayout`, so the preview matches the output.
- Rotation is baked into the output content; output pages never carry `/Rotate`.
- Images have no physical size, so they are treated as 96 DPI.
- The renderer also runs in a plain browser (`pnpm dev:web`), with `window.api` undefined.

## Commands

Run from this directory, or from the root with `pnpm --filter pdf-maker <script>`.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the app with hot reload |
| `pnpm dev:web` | Run just the renderer in a browser (no Electron) |
| `pnpm test` | Unit tests |
| `pnpm test:e2e` | Build, then drive the real app with Playwright |
| `pnpm typecheck` | Typecheck main/preload, renderer and tests |
| `pnpm package` | Build installers for the current OS into `release/` |

On Linux without a display (cloud sessions, CI) wrap Electron commands in Xvfb:
`xvfb-run -a pnpm test:e2e`. The e2e test passes `--no-sandbox` when running as root.
Electron downloads its binary on first use (`Downloading Electron binary...`).

## Gotchas

- pdf-lib can't embed a page with no content stream; `buildPdf` outputs a blank page instead.
- pdf-lib can't read encrypted PDFs; import reports a friendly error.
- pdf.js transfers the buffer it is given to its worker, so pass it a copy (`bytes.slice()`).
- dnd-kit's pointer sensor has a 5px activation distance so card buttons stay clickable;
  buttons stop `keydown` propagation so Enter/Space don't pick up the card.
- The e2e test stubs `dialog.showSaveDialog` in the main process to save without a native dialog,
  and simulates file drops by dispatching a `drop` event with a `DataTransfer`.
- `vite` is held at v7 because electron-vite 5 doesn't support v8 yet.
