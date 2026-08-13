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

  it('rewrites only the top-level field, leaving a nested dependency version alone', () => {
    const source = [
      '{',
      '  "version": "0.1.1",',
      '  "dependencies": {',
      '    "nested": "1.2.3"',
      '  },',
      '  "peerDependenciesMeta": {',
      '    "thing": { "version": "9.9.9" }',
      '  }',
      '}',
      '',
    ].join('\n');

    const rewritten = withVersion(source, '0.2.0');

    expect(rewritten).toContain('"version": "0.2.0"');
    expect(rewritten).toContain('"nested": "1.2.3"');
    expect(rewritten).toContain('"version": "9.9.9"');
  });

  it('throws when the manifest carries no top-level version field', () => {
    expect(() => withVersion('{\n  "name": "@packages/example"\n}\n', '0.2.0')).toThrow(
      'no top-level version field',
    );
  });
});
