import { describe, expect, it } from '@packages/effect-bun-test';
import { Effect } from 'effect';
import { flushSync } from 'svelte';
import { compile } from 'svelte/compiler';
import { mountComponent } from '../src/mount';
import Counter from './fixtures/Counter.svelte';
import LegacyGreeting from './fixtures/LegacyGreeting.svelte';

type CounterProps = { start?: number; step?: number };

const makeSut = (props: CounterProps = {}) => {
  const mounted = mountComponent(Counter, props);
  const at = (testId: string): HTMLElement => {
    const element = mounted.container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (element === null) throw new Error(`fixture is missing [data-testid="${testId}"]`);
    return element;
  };
  return {
    ...mounted,
    text: (testId: string): string => at(testId).textContent ?? '',
    click: (testId: string): void => {
      at(testId).click();
      flushSync();
    },
  };
};

describe('.svelte compile + mount', () => {
  it('mounts into the DOM and attaches the container to document.body', () => {
    const sut = makeSut();

    expect(document.body.contains(sut.container)).toBe(true);
    expect(sut.container.querySelector('button')).not.toBeNull();
  });

  it('renders initial $state and $derived from props', () => {
    const sut = makeSut({ start: 7 });

    expect(sut.text('count')).toBe('7');
    expect(sut.text('doubled')).toBe('14');
  });

  it('reacts to a click: $state updates and $derived recomputes after flushSync', () => {
    const sut = makeSut({ start: 0, step: 3 });

    expect(sut.text('count')).toBe('0');
    expect(sut.text('doubled')).toBe('0');

    sut.click('bump');

    expect(sut.text('count')).toBe('3');
    expect(sut.text('doubled')).toBe('6');

    sut.click('bump');

    expect(sut.text('count')).toBe('6');
    expect(sut.text('doubled')).toBe('12');
  });

  it('detaches the container and stops reacting after unmount', () => {
    const sut = makeSut({ start: 1 });
    const button = sut.container.querySelector<HTMLElement>('[data-testid="bump"]');

    sut.unmount();

    expect(document.body.contains(sut.container)).toBe(false);
    expect(sut.container.textContent).toBe('');
    expect(button).not.toBeNull();
  });

  it('isolates instances: two mounts do not share state', () => {
    const first = makeSut({ start: 0 });
    const second = makeSut({ start: 100 });

    first.click('bump');

    expect(first.text('count')).toBe('1');
    expect(second.text('count')).toBe('100');
  });
});

describe('lang="ts" script blocks', () => {
  it.live('compiles TypeScript natively via compile(), with no strip pass', () =>
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        Bun.file(`${import.meta.dir}/fixtures/Counter.svelte`).text(),
      );

      expect(source).toContain('lang="ts"');

      const { js } = compile(source, { generate: 'client', dev: true, filename: 'Counter.svelte' });

      expect(js.code).not.toContain('satisfies');
      expect(js.code).not.toContain(': number');
    }),
  );

  it.live('positive control: the same source is a parse error without lang="ts"', () =>
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        Bun.file(`${import.meta.dir}/fixtures/Counter.svelte`).text(),
      );
      const asJavaScript = source.replace('<script lang="ts">', '<script>');

      expect(() =>
        compile(asJavaScript, { generate: 'client', dev: true, filename: 'Counter.svelte' }),
      ).toThrow();
    }),
  );
});

describe('compile mode is auto-detected, not forced to runes', () => {
  it('mounts a legacy-authored component through the loader', () => {
    const mounted = mountComponent(LegacyGreeting, { name: 'lab' });

    expect(mounted.container.textContent).toContain('hello LAB!');

    mounted.unmount();
  });

  it.live('positive control: the same fixture fails to compile under runes: true', () =>
    Effect.gen(function* () {
      const source = yield* Effect.promise(() =>
        Bun.file(`${import.meta.dir}/fixtures/LegacyGreeting.svelte`).text(),
      );

      expect(() =>
        compile(source, { generate: 'client', dev: true, filename: 'LegacyGreeting.svelte' }),
      ).not.toThrow();

      expect(() =>
        compile(source, {
          generate: 'client',
          dev: true,
          runes: true,
          filename: 'LegacyGreeting.svelte',
        }),
      ).toThrow();
    }),
  );
});
