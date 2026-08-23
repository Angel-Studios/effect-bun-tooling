import { describe, expect, it } from '../src/index.ts';

const SPREAD_CASES = [
  ['a', 1],
  ['b', 2],
] as const;

const seenSpread: Array<string> = [];
const seenScalar: Array<number> = [];

describe('it.each — bun parity on the harness registrar', () => {
  it.each([...SPREAD_CASES])('spreads an array case into positional args: %s', (label, value) => {
    seenSpread.push(`${label}${value}`);
    expect(typeof label).toBe('string');
    expect(typeof value).toBe('number');
  });

  it.each([10, 20, 30])('passes a scalar case as one arg: %p', (value) => {
    seenScalar.push(value);
    expect(typeof value).toBe('number');
  });

  it('registered one case per entry, and the bodies actually ran', () => {
    expect(seenSpread).toEqual(['a1', 'b2']);
    expect(seenScalar).toEqual([10, 20, 30]);
  });

  it.each([1])(
    'honours a trailing TestOptions argument',
    (value) => {
      expect(value).toBe(1);
    },
    { timeout: 2_000 },
  );
});

describe('the harness it carries bun own registrar surface', () => {
  it('exposes each, for, skip, only, skipIf, runIf and fails', () => {
    for (const member of ['each', 'for', 'skip', 'only', 'skipIf', 'runIf', 'fails'] as const) {
      expect(typeof (it as unknown as Record<string, unknown>)[member]).not.toBe('undefined');
    }
  });
});
