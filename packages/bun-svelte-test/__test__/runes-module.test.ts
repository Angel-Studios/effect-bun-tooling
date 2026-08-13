import { beforeEach } from 'bun:test';
import { describe, expect, it } from '@packages/effect-bun-test';
import { Effect } from 'effect';
import { flushSync } from 'svelte';
import { compileModule } from 'svelte/compiler';
import {
  increment,
  observeDoubled,
  readCount,
  readDoubled,
  reset,
  snapshot,
} from './fixtures/counter-store.svelte';

const FIXTURE_PATH = `${import.meta.dir}/fixtures/counter-store.svelte.ts`;

describe('.svelte.ts runes module reactivity', () => {
  beforeEach(() => {
    reset();
    flushSync();
  });

  it('starts from the module initial state', () => {
    expect(readCount()).toBe(0);
    expect(readDoubled()).toBe(0);
  });

  it('recomputes $derived when the $state it reads is mutated', () => {
    expect(readDoubled()).toBe(0);

    increment(5);
    flushSync();

    expect(readCount()).toBe(5);
    expect(readDoubled()).toBe(10);

    increment(1);
    flushSync();

    expect(readCount()).toBe(6);
    expect(readDoubled()).toBe(12);
  });

  it('recomputes every $derived in the module, not just the first', () => {
    expect(snapshot()).toEqual({ count: 0, doubled: 0, parity: 'even' });

    increment(3);
    flushSync();

    expect(snapshot()).toEqual({ count: 3, doubled: 6, parity: 'odd' });

    increment(1);
    flushSync();

    expect(snapshot()).toEqual({ count: 4, doubled: 8, parity: 'even' });
  });

  it('drives a real $effect subscription: it re-runs on module state change', () => {
    const seen: number[] = [];

    const stop = observeDoubled(seen);
    flushSync();

    expect(seen).toEqual([0]);

    increment(2);
    flushSync();

    expect(seen).toEqual([0, 4]);

    stop();

    increment(10);
    flushSync();

    expect(seen).toEqual([0, 4]);
    expect(readDoubled()).toBe(24);
  });
});

describe('the TypeScript strip pass for compileModule()', () => {
  it.live('the fixture really does contain TypeScript that must be stripped', () =>
    Effect.gen(function* () {
      const source = yield* Effect.promise(() => Bun.file(FIXTURE_PATH).text());

      expect(source).toContain('let count: number = $state(0)');
      expect(source).toContain('satisfies number');
      expect(source).toContain('<T extends number>');
    }),
  );

  it.live('positive control: compileModule() rejects the raw TypeScript source', () =>
    Effect.gen(function* () {
      const source = yield* Effect.promise(() => Bun.file(FIXTURE_PATH).text());

      expect(() =>
        compileModule(source, { generate: 'client', dev: true, filename: FIXTURE_PATH }),
      ).toThrow();
    }),
  );

  it.live('compileModule() accepts the source once Bun.Transpiler has stripped it', () =>
    Effect.gen(function* () {
      const source = yield* Effect.promise(() => Bun.file(FIXTURE_PATH).text());
      const stripped = new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(source);

      const { js } = compileModule(stripped, { generate: 'client', dev: true, filename: FIXTURE_PATH });

      expect(js.code).toContain('$.state');
      expect(js.code).toContain('$.derived');
    }),
  );
});
