import { describe, expect, it } from 'bun:test';
import { Context, Effect } from 'effect';
import { UuidLive } from '../src/layer.live';
import { Uuid } from '../src/tag';

const MIGRATION_STABLE_KEY = '@packages/uuid-effect/tag/Uuid';

describe('Uuid context key', () => {
  it('is the migration-stable key, so a repo-boundary move cannot split the DI identity', () => {
    expect(Uuid.key).toBe(MIGRATION_STABLE_KEY);
  });

  it('resolves a layer provided under an independently declared tag carrying the same key', () => {
    class Restated extends Context.Service<Restated, { readonly next: Effect.Effect<string> }>()(
      MIGRATION_STABLE_KEY,
    ) {}
    const viaRestated = Effect.runSync(
      Effect.provide(
        Effect.flatMap(Restated, (s) => s.next),
        UuidLive,
      ),
    );
    expect(viaRestated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
