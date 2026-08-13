export type CounterSnapshot = {
  readonly count: number;
  readonly doubled: number;
  readonly parity: Parity;
};

export type Parity = 'even' | 'odd';

const STEP_DEFAULT = 1 satisfies number;

let count: number = $state(0);

const doubled: number = $derived(count * 2);

const parity: Parity = $derived(count % 2 === 0 ? 'even' : 'odd');

const clamp = <T extends number>(value: T, min: number): number => (value < min ? min : value);

export const increment = (by: number = STEP_DEFAULT): void => {
  count = count + clamp(by, 0);
};

export const reset = (): void => {
  count = 0;
};

export const readCount = (): number => count;

export const readDoubled = (): number => doubled;

export const snapshot = (): CounterSnapshot => ({ count, doubled, parity });

export const observeDoubled = (sink: number[]): (() => void) =>
  $effect.root(() => {
    $effect(() => {
      sink.push(doubled);
    });
  });
