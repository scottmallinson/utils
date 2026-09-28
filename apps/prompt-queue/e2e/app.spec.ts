import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from '@playwright/test';

const appDir = join(__dirname, '..');
const fakeClaude = join(__dirname, 'fake-claude.mjs');

interface LoggedRun {
  args: string[];
  prompt: string;
  cwd: string;
}

async function launch() {
  const root = await mkdtemp(join(tmpdir(), 'prompt-queue-'));
  const repo = join(root, 'my-app');
  await mkdir(repo);
  const log = join(root, 'runs.jsonl');
  const app = await electron.launch({
    args: [
      appDir,
      // A throwaway profile, so saved state doesn't leak between runs.
      `--user-data-dir=${join(root, 'profile')}`,
      // Chromium refuses to sandbox as root (e.g. in containers).
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    ],
    env: { ...process.env, PROMPT_QUEUE_CLAUDE_PATH: fakeClaude, FAKE_CLAUDE_LOG: log },
  });
  const page = await app.firstWindow();
  const runs = async (): Promise<LoggedRun[]> => {
    const text = await readFile(log, 'utf8').catch(() => '');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };
  return { app, page, repo, runs };
}

async function addRepo(app: ElectronApplication, page: Page, path: string) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, path);
  await page.getByRole('button', { name: 'Add repository' }).first().click();
}

async function queue(page: Page, prompt: string) {
  await page.getByRole('textbox', { name: 'New prompt' }).fill(prompt);
  await page.getByRole('button', { name: 'Add to queue' }).click();
}

const card = (page: Page, title: string) => page.getByRole('article', { name: title });

test('queues prompts, shows progress and handles feedback, errors and limits', async () => {
  const { app, page, repo, runs } = await launch();
  await expect(
    page.getByRole('heading', { name: 'Add a repository to get started' }),
  ).toBeVisible();
  // It found the (fake) CLI, so there's no warning banner.
  await expect(page.getByRole('alert')).toHaveCount(0);

  await addRepo(app, page, repo);
  await expect(page.getByRole('button', { name: /my-app/ }).first()).toBeVisible();

  // Pause first so prompts stay queued while we arrange them.
  await page.getByRole('button', { name: 'Pause queue' }).click();
  await queue(page, 'Tidy the README');
  await queue(page, 'Add a login page [question]');
  await queue(page, 'Fix the flaky test [fail]');

  const queueSection = page.getByRole('region', { name: 'Queue' });
  await expect(queueSection.getByRole('article')).toHaveCount(3);
  await expect(card(page, 'Tidy the README')).toContainText('Paused');

  // Move the question to the front.
  await card(page, 'Add a login page [question]').getByRole('button', { name: 'Move up' }).click();
  await expect(queueSection.getByRole('article').first()).toHaveAccessibleName(
    'Add a login page [question]',
  );

  await page.getByRole('button', { name: 'Resume queue' }).click();

  // The question waits for feedback, and holds the rest of this repo's queue.
  const question = card(page, 'Add a login page [question]');
  await expect(question).toHaveAttribute('data-status', 'needs-feedback');
  await expect(question).toContainText('Waiting on feedback');
  await expect(card(page, 'Tidy the README')).toContainText('Repo waiting on your feedback');
  // Limit meters fill in from what the CLI reported.
  await expect(page.getByText('42% used')).toBeVisible();

  // Reply: it resumes the same session, with permissions changed mid-session.
  await question.getByRole('button', { name: 'Add a login page [question]' }).click();
  const detail = page.getByRole('complementary', { name: 'Prompt details' });
  await expect(detail.getByText('Should I use the existing helper')).toBeVisible();
  await detail.getByLabel('Permissions').selectOption('plan');
  await detail.getByLabel('Reply to Claude').fill('Use the existing helper');
  await detail.getByRole('button', { name: 'Queue reply' }).click();
  await expect(question).toHaveAttribute('data-status', 'completed');
  await expect(detail.getByText('Done: Use the existing helper')).toBeVisible();

  // The rest of the queue then runs in order.
  await expect(card(page, 'Tidy the README')).toHaveAttribute('data-status', 'completed');
  const failed = card(page, 'Fix the flaky test [fail]');
  await expect(failed).toHaveAttribute('data-status', 'error');
  await expect(failed).toContainText('something broke');

  const logged = await runs();
  expect(logged.map((run) => run.prompt)).toEqual([
    'Add a login page [question]',
    'Use the existing helper',
    'Tidy the README',
    'Fix the flaky test [fail]',
  ]);
  const [first, reply] = logged;
  const session = first?.args[first.args.indexOf('--session-id') + 1];
  expect(reply?.args).toEqual(expect.arrayContaining(['--resume', session]));
  expect(reply?.args[reply.args.indexOf('--permission-mode') + 1]).toBe('plan');
  expect(first?.args).toEqual(
    expect.arrayContaining([
      '-p',
      '--output-format',
      'stream-json',
      '--permission-mode',
      'acceptEdits',
    ]),
  );
  expect(logged.every((run) => run.cwd === repo)).toBe(true);

  // Hitting a usage limit puts the prompt back and pauses until the reset.
  await queue(page, 'Refactor the API [limit]');
  const limited = card(page, 'Refactor the API [limit]');
  await expect(page.getByText(/5-hour limit reached: waiting until/)).toBeVisible();
  await expect(limited).toHaveAttribute('data-status', 'queued');
  await expect(limited).toContainText('Waiting for limit');

  await page.screenshot({ path: 'test-results/prompt-queue.png' });
  await app.close();
});
