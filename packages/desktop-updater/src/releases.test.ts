import { describe, expect, it } from 'vitest';
import {
  assetName,
  compareVersions,
  findUpdate,
  parseReleases,
  parseVersion,
  type Release,
} from './releases';

const digest = (char: string) => `sha256:${char.repeat(64)}`;

function githubRelease(tag: string, assets: string[], extra: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    html_url: `https://github.com/o/r/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
    assets: assets.map((name) => ({
      name,
      browser_download_url: `https://github.com/o/r/releases/download/${tag}/${name}`,
      size: 100,
      digest: digest('a'),
    })),
    ...extra,
  };
}

describe('parseReleases', () => {
  it('reads tags, pages and assets with their SHA-256', () => {
    const [release] = parseReleases([githubRelease('app-v1.0.0', ['app-1.0.0-mac-arm64.zip'])]);
    expect(release).toEqual({
      tag: 'app-v1.0.0',
      pageUrl: 'https://github.com/o/r/releases/tag/app-v1.0.0',
      assets: [
        {
          name: 'app-1.0.0-mac-arm64.zip',
          url: 'https://github.com/o/r/releases/download/app-v1.0.0/app-1.0.0-mac-arm64.zip',
          size: 100,
          sha256: 'a'.repeat(64),
        },
      ],
    });
  });

  it('skips drafts, prereleases and malformed entries', () => {
    const releases = parseReleases([
      githubRelease('app-v2.0.0', [], { draft: true }),
      githubRelease('app-v1.1.0', [], { prerelease: true }),
      { tag_name: 3 },
      null,
      githubRelease('app-v1.0.0', []),
    ]);
    expect(releases.map((release) => release.tag)).toEqual(['app-v1.0.0']);
  });

  it('leaves out digests that are not SHA-256', () => {
    const raw = githubRelease('app-v1.0.0', ['a.zip']);
    raw.assets[0] = { ...raw.assets[0], digest: 'md5:abc' } as (typeof raw.assets)[0];
    expect(parseReleases([raw])[0]?.assets[0]?.sha256).toBeUndefined();
  });

  it('returns nothing for a non-array response', () => {
    expect(parseReleases({ message: 'API rate limit exceeded' })).toEqual([]);
  });
});

describe('versions', () => {
  it('parses plain versions only', () => {
    expect(parseVersion('1.20.3')).toEqual([1, 20, 3]);
    expect(parseVersion('1.2.3-beta.1')).toBeUndefined();
    expect(parseVersion('v1.2.3')).toBeUndefined();
  });

  it('compares numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
  });
});

describe('assetName', () => {
  it('matches the names electron-builder gives release files', () => {
    expect(assetName('pdf-maker', '0.2.0', 'mac-zip', 'arm64')).toBe(
      'pdf-maker-0.2.0-mac-arm64.zip',
    );
    expect(assetName('pdf-maker', '0.2.0', 'win-nsis', 'x64')).toBe('pdf-maker-0.2.0-win-x64.exe');
    expect(assetName('pdf-maker', '0.2.0', 'manual', 'x64')).toBeUndefined();
    expect(assetName('pdf-maker', '0.2.0', 'mac-zip', 'ia32')).toBeUndefined();
  });
});

describe('findUpdate', () => {
  const releases: Release[] = parseReleases([
    githubRelease('other-app-v9.0.0', ['other-app-9.0.0-mac-arm64.zip']),
    githubRelease('app-v0.3.0', ['app-0.3.0-mac-arm64.zip', 'app-0.3.0-win-x64.exe']),
    githubRelease('app-v0.10.0', [
      'app-0.10.0-mac-arm64.zip',
      'app-0.10.0-mac-x64.zip',
      'app-0.10.0-win-x64.exe',
      'app-0.10.0-win-portable.exe',
    ]),
    githubRelease('app-v0.2.0', ['app-0.2.0-mac-arm64.zip']),
  ]);
  const options = {
    name: 'app',
    currentVersion: '0.2.0',
    method: 'mac-zip',
    arch: 'arm64',
  } as const;

  it('picks the newest release of this app, ignoring other apps in the repo', () => {
    const update = findUpdate(releases, options);
    expect(update?.version).toBe('0.10.0');
    expect(update?.pageUrl).toBe('https://github.com/o/r/releases/tag/app-v0.10.0');
    expect(update?.asset?.name).toBe('app-0.10.0-mac-arm64.zip');
  });

  it('picks the file for the platform and CPU', () => {
    expect(findUpdate(releases, { ...options, arch: 'x64' })?.asset?.name).toBe(
      'app-0.10.0-mac-x64.zip',
    );
    expect(findUpdate(releases, { ...options, method: 'win-nsis', arch: 'x64' })?.asset?.name).toBe(
      'app-0.10.0-win-x64.exe',
    );
  });

  it('offers a manual update when there is no file to install from', () => {
    const update = findUpdate(releases, { ...options, method: 'win-nsis', arch: 'arm64' });
    expect(update).toEqual({
      version: '0.10.0',
      pageUrl: 'https://github.com/o/r/releases/tag/app-v0.10.0',
    });
    expect(findUpdate(releases, { ...options, method: 'manual' })?.asset).toBeUndefined();
  });

  it('refuses to install a file without a published checksum', () => {
    const raw = githubRelease('app-v1.0.0', ['app-1.0.0-mac-arm64.zip']);
    raw.assets[0] = { ...raw.assets[0], digest: null } as unknown as (typeof raw.assets)[0];
    const update = findUpdate(parseReleases([raw]), options);
    expect(update?.version).toBe('1.0.0');
    expect(update?.asset).toBeUndefined();
  });

  it('finds nothing when the app is current or newer', () => {
    expect(findUpdate(releases, { ...options, currentVersion: '0.10.0' })).toBeUndefined();
    expect(findUpdate(releases, { ...options, currentVersion: '1.0.0' })).toBeUndefined();
  });
});
