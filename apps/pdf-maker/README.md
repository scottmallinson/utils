# PDF Maker

A small desktop app for macOS (12 Monterey or later) and Windows that turns a pile of PDFs and
images into a single PDF.

- **Add files** by dragging them onto the window or with **Add files** (⌘O / Ctrl+O).
  Supports PDF, PNG and JPEG, plus WebP, GIF, BMP and AVIF (converted on import).
- **Reorder pages** by dragging them, or focus a page and use Space + arrow keys.
- **Rotate or remove** individual pages, or rotate all of them at once.
- **Choose a layout**: keep each page's original size, or fit everything onto A3, A4, A5,
  US Letter or US Legal, in automatic, portrait or landscape orientation, with optional margins.
  Previews show exactly how each page will come out.
- **Save** the result as a new PDF (⌘S / Ctrl+S). Your original files are never modified.

Everything happens on your computer. Nothing is uploaded anywhere.

## Install

Download the latest `pdf-maker` release for your platform from the
[releases page](https://github.com/scottmallinson/utils/releases):

- **macOS**: `pdf-maker-<version>-mac-arm64.dmg` for Apple silicon, or `-mac-x64.dmg` for Intel.
- **Windows**: the installer, `pdf-maker-<version>-win-x64.exe` (or `-win-arm64.exe` on Arm
  PCs), or `pdf-maker-<version>-win-portable.exe`, which runs without installing.

The app isn't code-signed yet, so the first launch needs a nudge:

- **macOS**: right-click the app, choose **Open**, then **Open** again. If macOS says the app is
  damaged, run `xattr -cr "/Applications/PDF Maker.app"`.
- **Windows**: on the SmartScreen prompt, choose **More info** → **Run anyway**.

## Notes and limits

- Images are placed at 96 DPI when using **Original size**, and scaled to fit otherwise.
- JPEG orientation from cameras and phones (EXIF) is respected.
- Password-protected or encrypted PDFs can't be added yet.
- Links, comments, form fields and bookmarks from source PDFs aren't carried over; page content
  (including selectable text) is.

## Development

From the repo root, `pnpm install`, then in this directory:

```sh
pnpm dev          # run with hot reload
pnpm test         # unit tests
pnpm test:e2e     # build and drive the real app with Playwright
pnpm package      # build installers for your OS into release/
```

Releases are built by GitHub Actions: bump `version` in `package.json`, merge, then push a
`pdf-maker-v<version>` tag. See [`AGENTS.md`](AGENTS.md) for the architecture.
