import { describe, expect, it } from 'bun:test';
import { Effect, type Layer } from 'effect';
import { UuidLive } from '../src/layer.live';
import { UuidTest } from '../src/layer.test';
import { Uuid } from '../src/tag';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const run = <A>(program: Effect.Effect<A, never, Uuid>, layer: Layer.Layer<Uuid>): A =>
  Effect.runSync(Effect.provide(program, layer));

describe('UuidLive', () => {
  it('Uuid.next mints a well-formed UUID string', () => {
    expect(run(Uuid.next, UuidLive)).toMatch(UUID_RE);
  });

  it('mints a distinct value on every draw (full-entropy source)', () => {
    const ids = run(
      Effect.gen(function* () {
        const uuid = yield* Uuid;
        return yield* Effect.all([uuid.next, uuid.next, uuid.next, uuid.next]);
      }),
      UuidLive,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the service-handle form and the static accessor resolve the same layer', () => {
    const [viaHandle, viaStatic] = run(
      Effect.gen(function* () {
        const uuid = yield* Uuid;
        const a = yield* uuid.next;
        const b = yield* Uuid.next;
        return [a, b] as const;
      }),
      UuidLive,
    );
    expect(viaHandle).toMatch(UUID_RE);
    expect(viaStatic).toMatch(UUID_RE);
    expect(viaHandle).not.toBe(viaStatic);
  });
});

describe('UuidTest', () => {
  it('emits a deterministic, monotonic, valid-format sequence from the seed', () => {
    const ids = run(
      Effect.gen(function* () {
        const uuid = yield* Uuid;
        return yield* Effect.all([uuid.next, uuid.next, uuid.next]);
      }),
      UuidTest(),
    );
    expect(ids).toEqual([
      '00000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
    for (const id of ids) expect(id).toMatch(UUID_RE);
  });

  it('honors a non-zero seed', () => {
    expect(run(Uuid.next, UuidTest(42))).toBe('00000000-0000-4000-8000-00000000002a');
  });

  it('gives each layer instance its own counter (no shared sequence state)', () => {
    expect(run(Uuid.next, UuidTest())).toBe(run(Uuid.next, UuidTest()));
  });
});
