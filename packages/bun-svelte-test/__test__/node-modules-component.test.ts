import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from '@packages/effect-bun-test';
import { makeFixtureRoot } from '@packages/effect-bun-test/fixture-root';
import { Effect } from 'effect';
import { mountComponent } from '../src/mount';

const PACKAGE_NAME = 'fake-widget';

const fixtures = makeFixtureRoot('node-modules-component');

afterAll(() => {
  fixtures.dispose();
});

const installedComponentConsumer = (): string => {
  const nodeModules = join(fixtures.path(), 'node_modules');
  const installed = join(nodeModules, PACKAGE_NAME);
  mkdirSync(installed, { recursive: true });

  symlinkSync(dirname(Bun.resolveSync('svelte/package.json', import.meta.dir)), join(nodeModules, 'svelte'));

  writeFileSync(
    join(installed, 'package.json'),
    `${JSON.stringify(
      {
        name: PACKAGE_NAME,
        version: '0.0.0',
        type: 'module',
        exports: { './Widget.svelte': './Widget.svelte' },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(installed, 'Widget.svelte'),
    '<script>\n  let { who } = $props();\n</script>\n\n<p data-testid="widget">hello {who} from node_modules</p>\n',
  );

  const consumer = join(fixtures.path(), 'consumer.ts');
  writeFileSync(consumer, `export { default } from '${PACKAGE_NAME}/Widget.svelte';\n`);
  return consumer;
};

describe('a .svelte component imported out of a dependency', () => {
  it.live('compiles and mounts when resolved by specifier from inside node_modules', () =>
    Effect.gen(function* () {
      const consumer = installedComponentConsumer();

      const loaded = yield* Effect.promise(() => import(consumer));
      const mounted = mountComponent(loaded.default, { who: 'lab' });

      expect(mounted.container.textContent).toContain('hello lab from node_modules');
      expect(mounted.container.querySelector('[data-testid="widget"]')).not.toBeNull();

      mounted.unmount();
    }),
  );
});
