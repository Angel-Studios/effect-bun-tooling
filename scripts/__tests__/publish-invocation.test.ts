import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../workspace';

type Step = { readonly name?: string; readonly run?: string; readonly uses?: string };
type Job = { readonly steps?: readonly Step[] };
type Workflow = { readonly jobs?: Readonly<Record<string, Job>> };

const WORKFLOWS = ['ci.yml', 'release.yml'];

const PUBLISH_INVOCATION = /npm publish\s+("?)([^\s"]+)\1/g;

const runScripts = (workflow: string): readonly string[] => {
  const parsed = Bun.YAML.parse(
    readFileSync(join(repoRoot, '.github', 'workflows', workflow), 'utf8'),
  ) as Workflow;
  return Object.values(parsed.jobs ?? {}).flatMap((job) =>
    (job.steps ?? []).flatMap((step) => (step.run === undefined ? [] : [step.run])),
  );
};

const publishArguments = (workflow: string): readonly string[] =>
  runScripts(workflow).flatMap((script) => [...script.matchAll(PUBLISH_INVOCATION)].map((match) => match[2]));

describe('npm publish is never handed a bare relative path', () => {
  it('finds the publish invocations it is meant to guard', () => {
    const found = WORKFLOWS.flatMap((workflow) => publishArguments(workflow));
    expect(found.length).toBeGreaterThan(0);
  });

  for (const workflow of WORKFLOWS) {
    it(`passes every ${workflow} publish target as an explicit path, so npm cannot read it as a git spec`, () => {
      for (const argument of publishArguments(workflow)) {
        const explicit = argument.startsWith('./') || argument.startsWith('/') || argument.startsWith('$');
        expect({ workflow, argument, explicit }).toEqual({ workflow, argument, explicit: true });
      }
    });
  }

  it('iterates a ./-anchored glob wherever it loops over tarballs', () => {
    for (const workflow of WORKFLOWS) {
      for (const script of runScripts(workflow)) {
        for (const match of script.matchAll(/for \w+ in (\S+)/g)) {
          const glob = match[1];
          if (!glob.includes('.tgz')) continue;
          expect({ workflow, glob, anchored: glob.startsWith('./') || glob.startsWith('/') }).toEqual({
            workflow,
            glob,
            anchored: true,
          });
        }
      }
    }
  });
});
