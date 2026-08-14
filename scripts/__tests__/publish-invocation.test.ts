import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../workspace';

type Step = { readonly name?: string; readonly run?: string; readonly uses?: string };
type Job = { readonly steps?: readonly Step[] };
type Workflow = { readonly jobs?: Readonly<Record<string, Job>> };

const WORKFLOWS = ['ci.yml', 'release.yml'];

const REGISTRY_INVOCATION = /\b(?:npm|pnpm|bun|yarn)\s+publish\b/;
const RELEASE_UPLOAD = /gh release upload\s+"?\$\{?RELEASE_TAG\}?"?\s+(\S+)/;

const runScripts = (workflow: string): readonly string[] => {
  const parsed = Bun.YAML.parse(
    readFileSync(join(repoRoot, '.github', 'workflows', workflow), 'utf8'),
  ) as Workflow;
  return Object.values(parsed.jobs ?? {}).flatMap((job) =>
    (job.steps ?? []).flatMap((step) => (step.run === undefined ? [] : [step.run])),
  );
};

describe('distribution is a GitHub Release tarball, and no workflow publishes to a registry', () => {
  it('parses a run script out of every workflow, so the scan below is not vacuous', () => {
    for (const workflow of WORKFLOWS) {
      expect({ workflow, steps: runScripts(workflow).length > 0 }).toEqual({ workflow, steps: true });
    }
  });

  for (const workflow of WORKFLOWS) {
    it(`runs no package-manager publish anywhere in ${workflow}, dry-run rehearsals included`, () => {
      for (const script of runScripts(workflow)) {
        expect({ workflow, script, publishes: REGISTRY_INVOCATION.test(script) }).toEqual({
          workflow,
          script,
          publishes: false,
        });
      }
    });
  }

  it('uploads every packed tarball to the Release from a ./-anchored glob, which is the whole distribution path', () => {
    const uploads = runScripts('release.yml').flatMap((script) => {
      const match = RELEASE_UPLOAD.exec(script);
      return match?.[1] === undefined ? [] : [match[1]];
    });

    expect(uploads).toEqual(['./dist-tarballs/*.tgz']);
  });
});
