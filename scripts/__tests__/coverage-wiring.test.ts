import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST_DIR, workspacePackages } from '../workspace';

type BunfigTest = {
  readonly coverageThreshold?: unknown;
  readonly coverageReporter?: readonly string[];
  readonly coveragePathIgnorePatterns?: readonly string[];
};

type ScriptedManifest = { readonly scripts?: Readonly<Record<string, string>> };

const bunfigTest = (dir: string): BunfigTest => {
  const path = join(dir, 'bunfig.toml');
  if (!existsSync(path)) return {};
  const parsed = Bun.TOML.parse(readFileSync(path, 'utf8')) as { test?: BunfigTest };
  return parsed.test ?? {};
};

const scriptsOf = (manifestPath: string): Readonly<Record<string, string>> =>
  (JSON.parse(readFileSync(manifestPath, 'utf8')) as ScriptedManifest).scripts ?? {};

const thresholded = workspacePackages().filter((pkg) => bunfigTest(pkg.dir).coverageThreshold !== undefined);

describe('an armed coverage threshold is a gate only if something passes --coverage', () => {
  it('finds a package that arms one, so the assertions below are not vacuous', () => {
    expect(thresholded.length).toBeGreaterThan(0);
  });

  for (const pkg of thresholded) {
    it(`runs ${pkg.manifest.name}'s own test:unit:once with --coverage, which the DoD invokes`, () => {
      const command = scriptsOf(pkg.manifestPath)['test:unit:once'];
      expect({
        name: pkg.manifest.name,
        command,
        coverage: command?.includes('--coverage') === true,
      }).toEqual({
        name: pkg.manifest.name,
        command,
        coverage: true,
      });
    });

    it(`reports ${pkg.manifest.name}'s coverage through a reporter bun evaluates the threshold against`, () => {
      expect(bunfigTest(pkg.dir).coverageReporter).toContain('text');
    });

    it(`excludes ${pkg.manifest.name}'s build output, which bun's reporter scans in even though no test loads it`, () => {
      // Without this the emitted bundle reports 0% and sinks a threshold that source alone meets,
      // which reads as a coverage regression in code nobody changed.
      expect(bunfigTest(pkg.dir).coveragePathIgnorePatterns).toContain(`${DIST_DIR}/**`);
    });
  }

  it('leaves no second, inert --coverage path that nothing invokes', () => {
    for (const pkg of workspacePackages()) {
      for (const [name, command] of Object.entries(scriptsOf(pkg.manifestPath))) {
        if (!command.includes('--coverage')) continue;
        expect({ pkg: pkg.manifest.name, name, wired: name === 'test:unit:once' }).toEqual({
          pkg: pkg.manifest.name,
          name,
          wired: true,
        });
      }
    }
  });
});
