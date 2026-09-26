import { mkdtemp, readFile } from 'node:fs/promises';
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
