import { describe, expect, it } from 'vitest';
import { buildClaudeArgs, isValidModel, resumeCommand } from './args';

const SESSION = '123e4567-e89b-12d3-a456-426614174000';

describe('buildClaudeArgs', () => {
  it('runs headless with stream-json output', () => {
    expect(
      buildClaudeArgs({ options: { model: '', permissionMode: 'default' }, newSessionId: SESSION }),
    ).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--session-id', SESSION]);
  });

  it('adds the permission mode and model, and resumes sessions', () => {
    expect(
      buildClaudeArgs({
        options: { model: 'sonnet', permissionMode: 'plan' },
        resumeSessionId: SESSION,
        newSessionId: 'ignored',
      }),
    ).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'plan',
      '--model',
      'sonnet',
      '--resume',
      SESSION,
    ]);
  });

  it('rejects anything that could be misread as more arguments', () => {
    expect(() =>
      buildClaudeArgs({ options: { model: 'opus --x', permissionMode: 'default' } }),
    ).toThrow();
    expect(() =>
      buildClaudeArgs({
        options: { model: '', permissionMode: 'default' },
        resumeSessionId: 'abc & calc',
      }),
    ).toThrow();
  });
});

describe('isValidModel', () => {
  it.each(['', 'opus', 'claude-sonnet-4-5', 'sonnet[1m]', 'us.anthropic.claude:1'])(
    'allows %s',
    (m) => expect(isValidModel(m)).toBe(true),
  );
  it.each(['a b', 'x;y', '"q"', '$(x)'])('rejects %s', (m) => expect(isValidModel(m)).toBe(false));
});

describe('resumeCommand', () => {
  it('quotes the path for the platform', () => {
    expect(resumeCommand("/code/bob's app", SESSION, 'darwin')).toBe(
      `cd '/code/bob'\\''s app' && claude --resume ${SESSION}`,
    );
    expect(resumeCommand('C:\\code\\app', SESSION, 'win32')).toBe(
      `cd /d "C:\\code\\app" && claude --resume ${SESSION}`,
    );
  });
});
