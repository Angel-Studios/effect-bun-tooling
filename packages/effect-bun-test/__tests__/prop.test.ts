import { Effect, Schema } from 'effect';
import * as fc from 'effect/testing/FastCheck';
import { describe, expect, it } from '../src/index';

// v4 deleted the standalone `Arbitrary` module and reshaped `Schema`, so every
// `prop` form goes through a rewritten schema-to-arbitrary bridge. None of it
// is visible to `tsc`: a bridge that silently produced `undefined` for every
// case would still typecheck, and a property body that never ran would still
// report as a passing test.

describe('prop — array form', () => {
  it.prop('derives values from a Schema', [Schema.String, Schema.Number], ([s, n]) => {
    expect(typeof s).toBe('string');
    expect(typeof n).toBe('number');
  });

  it.prop('accepts a raw FastCheck arbitrary', [fc.constant('fixed')], ([s]) => {
    expect(s).toBe('fixed');
  });

  it.prop('mixes a Schema and a raw arbitrary in one list', [Schema.String, fc.constant(42)], ([s, n]) => {
    expect(typeof s).toBe('string');
    expect(n).toBe(42);
  });
});

describe('prop — record form', () => {
  it.prop('derives values from a Schema', { name: Schema.String, age: Schema.Number }, ({ name, age }) => {
    expect(typeof name).toBe('string');
    expect(typeof age).toBe('number');
  });

  it.prop(
    'derives a composite Schema, not just the scalars',
    { point: Schema.Struct({ x: Schema.Number, y: Schema.Number }), flag: Schema.Boolean },
    ({ point, flag }) => {
      expect(typeof point.x).toBe('number');
      expect(typeof point.y).toBe('number');
      expect(typeof flag).toBe('boolean');
    },
  );
});

describe('prop — Effect-returning forms', () => {
  it.effect.prop('it.effect.prop runs the body as an Effect', { s: Schema.String }, ({ s }) =>
    Effect.sync(() => {
      expect(typeof s).toBe('string');
    }),
  );

  it.live.prop('it.live.prop runs the body as an Effect', { n: Schema.Number }, ({ n }) =>
    Effect.sync(() => {
      expect(typeof n).toBe('number');
    }),
  );
});

// A property whose body never executes is the failure mode `tsc` cannot see,
// so one case counts its own invocations and asserts the count moved.
describe('prop actually runs the body', () => {
  let runs = 0;

  it.prop('the body is invoked once per generated case', [Schema.String], ([s]) => {
    expect(typeof s).toBe('string');
    runs += 1;
  });

  it('the counter proves the property body ran', () => {
    expect(runs).toBeGreaterThan(1);
  });
});
