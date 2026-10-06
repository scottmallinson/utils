import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, type Page, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { makePdf, makePng } from '../src/renderer/src/lib/__fixtures__/fixtures';

const appDir = join(__dirname, '..');

async function dropFiles(page: Page, files: { name: string; type: string; bytes: Uint8Array }[]) {
  await page.evaluate(
    (serialised) => {
      const transfer = new DataTransfer();
      for (const file of serialised) {
        transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
      }
      window.dispatchEvent(
        new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
      );
    },
    files.map((file) => ({ ...file, bytes: Array.from(file.bytes) })),
  );
}

test('adds files, arranges pages and saves a PDF', async () => {
  // A throwaway profile keeps saved settings from leaking between runs.
  const userData = await mkdtemp(join(tmpdir(), 'pdf-maker-profile-'));
  const app = await electron.launch({
    args: [
      appDir,
      `--user-data-dir=${userData}`,
      // Chromium refuses to sandbox as root (e.g. in containers).
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    ],
  });
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Drop PDFs or images here' })).toBeVisible();

  await dropFiles(page, [
    {
      name: 'doc.pdf',
      type: 'application/pdf',
      bytes: await makePdf([
        [200, 100],
        [100, 200],
      ]),
    },
    { name: 'picture.png', type: 'image/png', bytes: makePng(40, 20) },
  ]);

  const cards = page.locator('.page-card');
  await expect(cards).toHaveCount(3);
  await expect(page.locator('.page-card img')).toHaveCount(3);
  await expect(page.getByText('3 pages from 2 files')).toBeVisible();
  await expect(page.getByLabel('Page size')).toHaveValue('a4');

  await page.getByLabel('Page size').selectOption('source');
  await page.getByRole('button', { name: 'Rotate page 1 right' }).click();

  // Move the image to the front with the keyboard.
  // dnd-kit measures and animates between key presses, so give it a moment.
  await cards.nth(2).focus();
  for (const key of ['Space', 'ArrowLeft', 'ArrowLeft', 'Space']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
  await expect(cards.first()).toHaveAccessibleName(/picture\.png/);

  const output = join(await mkdtemp(join(tmpdir(), 'pdf-maker-')), 'out.pdf');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, output);
  await page.getByRole('button', { name: 'Save PDF' }).click();
  await expect(page.getByText('Saved out.pdf')).toBeVisible();

  const saved = await PDFDocument.load(await readFile(output));
  const sizes = saved.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
  expect(sizes).toEqual([
    [30, 15],
    [100, 200],
    [100, 200],
  ]);

  await app.close();
});

type Shown = { message: string; buttons?: string[] };

test('checks for updates from the menu and remembers a skipped version', async () => {
  // Stands in for GitHub's releases API.
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify([
        {
          tag_name: 'pdf-maker-v9.9.9',
          html_url: 'https://example.com/pdf-maker-v9.9.9',
          draft: false,
          prerelease: false,
          assets: [],
        },
      ]),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const userData = await mkdtemp(join(tmpdir(), 'pdf-maker-profile-'));
  const app = await electron.launch({
    args: [
      appDir,
      `--user-data-dir=${userData}`,
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    ],
    env: { ...process.env, UTILS_UPDATE_RELEASES_URL: `http://127.0.0.1:${port}/releases` },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');

  // Playwright's Electron evaluate sometimes loses its result to garbage collection once the
  // main process gets busy, so these steps retry, and the first one only acts once.
  // Record each message box, answering "Skip This Version" (the second button), then check.
  await expect(async () => {
    await app.evaluate(({ dialog, Menu }) => {
      const scope = globalThis as unknown as { shown?: Shown[] };
      if (scope.shown) return;
      const shown: Shown[] = [];
      scope.shown = shown;
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const options = args.at(-1) as Shown;
        shown.push({ message: options.message, buttons: options.buttons });
        return { response: 1, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
      Menu.getApplicationMenu()?.getMenuItemById('check-for-updates')?.click();
    });
  }).toPass();

  // The development build can't install itself, so it offers the download page.
  await expect(async () => {
    const shown = await app.evaluate(() => (globalThis as unknown as { shown: Shown[] }).shown);
    expect(shown).toEqual([
      {
        message: 'PDF Maker 9.9.9 is available',
        buttons: ['Open Download Page', 'Skip This Version', 'Later'],
      },
    ]);
  }).toPass();
  await expect
    .poll(async () => JSON.parse(await readFile(join(userData, 'updates.json'), 'utf8')))
    .toEqual({ autoCheck: true, skipVersion: '9.9.9' });

  await app.close();
  server.close();
});
