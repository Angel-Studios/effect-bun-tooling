import { describe, expect, it } from 'bun:test';
import { withVersion } from '../workspace';

const manifest = (version: string): string =>
  ['{', '  "name": "@packages/example",', `  "version": "${version}",`, '  "type": "module"', '}', ''].join(
    '\n',
  );

describe('withVersion', () => {
  it('rewrites the top-level version field', () => {
    expect(withVersion(manifest('0.1.1'), '0.2.0')).toBe(manifest('0.2.0'));
  });

  it('is idempotent, so re-running a release at the same version is not an error', () => {
    expect(withVersion(manifest('0.2.0'), '0.2.0')).toBe(manifest('0.2.0'));
  });

  it('rewrites the top-level field even when a multi-line nested version is line-anchored ahead of it', () => {
    const source = [
      '{',
      '  "name": "@packages/example",',
      '  "peerDependenciesMeta": {',
      '    "thing": {',
      '      "version": "9.9.9"',
      '    }',
      '  },',
      '  "version": "0.1.1",',
      '  "dependencies": {',
      '    "nested": "1.2.3"',
      '  }',
      '}',
      '',
    ].join('\n');

    const rewritten = withVersion(source, '0.2.0');

    expect(rewritten).toBe(source.replace('"version": "0.1.1"', '"version": "0.2.0"'));
    expect(JSON.parse(rewritten)).toMatchObject({
      version: '0.2.0',
      peerDependenciesMeta: { thing: { version: '9.9.9' } },
      dependencies: { nested: '1.2.3' },
    });
  });

  it('rewrites nothing but the version, leaving every other byte of the manifest identical', () => {
    const source = ['{', '  "name": "@packages/example",', '  "version": "0.1.1"', '}', ''].join('\n');

    expect(withVersion(source, '1.10.0')).toBe(
      ['{', '  "name": "@packages/example",', '  "version": "1.10.0"', '}', ''].join('\n'),
    );
  });

  it('throws when the manifest carries no top-level version field', () => {
    expect(() => withVersion('{\n  "name": "@packages/example"\n}\n', '0.2.0')).toThrow(
      'no top-level version field',
    );
  });

  it('throws rather than rewriting a nested version when only a nested one exists', () => {
    const source = ['{', '  "engines": {', '    "version": "1.0.0"', '  }', '}', ''].join('\n');

    expect(() => withVersion(source, '0.2.0')).toThrow('no top-level version field');
  });

  it('refuses a manifest that is not valid JSON, rather than pattern-matching its text', () => {
    expect(() => withVersion('{ "version": "0.1.1",, }', '0.2.0')).toThrow();
  });
});
