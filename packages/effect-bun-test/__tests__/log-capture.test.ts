import { Effect, Logger, References } from 'effect';
import { describe, expect, it } from '../src/index';
import { makeLogCapture, renderLogMessage } from '../src/log-capture';

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const NUL = String.fromCharCode(0);
const ESC = String.fromCharCode(27);

describe('renderLogMessage — string leaves are verbatim', () => {
  it('passes a bare string through untouched', () => {
    const s = `alpha${LF}beta${NUL}gamma`;
    expect(renderLogMessage(s)).toBe(s);
  });

  it('preserves control characters inside an array member', () => {
    const out = renderLogMessage(['tag', `body${LF}injected`]);
    expect(out.includes(LF)).toBe(true);
    expect(out.includes('\\n')).toBe(false);
  });

  it('preserves control characters inside an object VALUE', () => {
    const out = renderLogMessage({ reason: `bad${CR}${NUL}value` });
    expect(out.includes(CR)).toBe(true);
    expect(out.includes(NUL)).toBe(true);
    expect(out.includes('\\u0000')).toBe(false);
  });

  it('preserves an ANSI escape byte (terminal-injection payloads)', () => {
    expect(renderLogMessage({ s: `x${ESC}[31m` }).includes(ESC)).toBe(true);
  });

  it('renders an Error name and message verbatim', () => {
    const out = renderLogMessage(new Error(`boom${LF}trailer`));
    expect(out).toContain('Error: boom');
    expect(out.includes(LF)).toBe(true);
  });

  it('renders a cause chain without escaping it', () => {
    const out = renderLogMessage(new Error('outer', { cause: new Error(`inner${LF}x`) }));
    expect(out).toContain('outer');
    expect(out).toContain('inner');
    expect(out.includes(LF)).toBe(true);
  });

  it('still renders structure — keys and values both visible', () => {
    const out = renderLogMessage({ kind: 'quarantine', key: 'plan:demo:skewed', n: 3 });
    expect(out).toContain('kind');
    expect(out).toContain('quarantine');
    expect(out).toContain('plan:demo:skewed');
    expect(out).toContain('3');
  });

  it('degrades a cycle to a marker instead of throwing', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic['self'] = cyclic;
    expect(() => renderLogMessage(cyclic)).not.toThrow();
    expect(renderLogMessage(cyclic)).toContain('[circular]');
  });

  it('bounds depth instead of recursing without limit', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 40; i++) deep = { next: deep };
    expect(() => renderLogMessage(deep)).not.toThrow();
    expect(renderLogMessage(deep)).toContain('[depth-limit]');
  });

  describe('content is never silently erased', () => {
    it('does not erase built-ins whose own enumerable properties are empty', () => {
      expect(renderLogMessage(new Map([['a', 1]]))).toContain('a');
      expect(renderLogMessage(new Set(['needle']))).toContain('needle');
      expect(renderLogMessage(new Date('2020-01-01T00:00:00.000Z'))).toContain('2020-01-01');
      expect(renderLogMessage(/ab+c/g)).toContain('ab+c');
      expect(renderLogMessage(new Uint8Array([1, 2, 3]))).toContain('1, 2, 3');
    });

    it('degrades a throwing getter instead of propagating — a capture must never fail its test', () => {
      const hostile = {
        get boom(): string {
          throw new Error('getter blew up');
        },
      };
      expect(() => renderLogMessage(hostile)).not.toThrow();
      expect(renderLogMessage(hostile)).toContain('unrenderable');
    });

    it('renders BOTH occurrences of a shared sibling reference — a DAG is not a cycle', () => {
      const shared = { s: 'needle' };
      const out = renderLogMessage({ p: shared, q: shared });
      expect(out.match(/needle/g)?.length).toBe(2);
      expect(out).not.toContain('[circular]');
    });
  });

  it('renders primitives without quoting them', () => {
    expect(renderLogMessage(42)).toBe('42');
    expect(renderLogMessage(null)).toBe('null');
    expect(renderLogMessage(undefined)).toBe('undefined');
    expect(renderLogMessage(true)).toBe('true');
    expect(renderLogMessage(10n)).toBe('10n');
  });
});

describe('makeLogCapture — end-to-end through the real Effect logger', () => {
  it.live('a raw newline in a single-argument log survives capture', () =>
    Effect.gen(function* () {
      const cap = makeLogCapture();
      yield* Effect.logWarning(`injected${LF}line`).pipe(Effect.provide(cap.layer));
      expect(cap.text().includes(LF)).toBe(true);
    }),
  );

  it.live('a raw newline in a MULTI-argument log survives capture', () =>
    Effect.gen(function* () {
      const cap = makeLogCapture();
      yield* Effect.logWarning('quarantined', `key${LF}injected`).pipe(Effect.provide(cap.layer));
      expect(cap.text().includes(LF)).toBe(true);
      expect(cap.text().includes('\\n')).toBe(false);
    }),
  );

  it.live('an Error payload keeps its text (the array wrapper used to erase it to `[{}]`)', () =>
    Effect.gen(function* () {
      const cap = makeLogCapture();
      yield* Effect.logError(new Error('boom-detail')).pipe(Effect.provide(cap.layer));
      expect(cap.text()).toContain('boom-detail');
      expect(cap.text()).not.toBe('[{}]');
    }),
  );

  it.live('records the level alongside the rendering', () =>
    Effect.gen(function* () {
      const cap = makeLogCapture();
      yield* Effect.logWarning('warn-here').pipe(Effect.provide(cap.layer));
      expect(cap.entries[0]?.level).toBe('Warn');
      expect(cap.entries[0]?.message).toContain('warn-here');
    }),
  );

  it.live('exposes the untouched payload on `raw` for structural assertions', () =>
    Effect.gen(function* () {
      const cap = makeLogCapture();
      yield* Effect.logInfo('a', { k: 1 }).pipe(Effect.provide(cap.layer));
      const raw = cap.entries[0]?.raw;
      expect(Array.isArray(raw)).toBe(true);
      expect((raw as ReadonlyArray<unknown>)[1]).toEqual({ k: 1 });
    }),
  );

  it.live('captures Debug-level logs by default', () =>
    Effect.gen(function* () {
      const cap = makeLogCapture();
      yield* Effect.logDebug('debug-line').pipe(Effect.provide(cap.layer));
      expect(cap.text()).toContain('debug-line');
    }),
  );

  it.live('honours a raised minimumLogLevel', () =>
    Effect.gen(function* () {
      const cap = makeLogCapture({ minimumLogLevel: 'Warn' });
      yield* Effect.logDebug('suppressed').pipe(
        Effect.andThen(Effect.logWarning('kept')),
        Effect.provide(cap.layer),
      );
      expect(cap.text()).not.toContain('suppressed');
      expect(cap.text()).toContain('kept');
    }),
  );

  it.live(
    '`minimumLogLevel: null` keeps the ambient Info default — a migrated capture never widens what it sees',
    () =>
      Effect.gen(function* () {
        const cap = makeLogCapture({ minimumLogLevel: null });
        yield* Effect.logDebug('below-ambient').pipe(
          Effect.andThen(Effect.logInfo('at-ambient')),
          Effect.provide(cap.layer),
        );
        expect(cap.text()).not.toContain('below-ambient');
        expect(cap.text()).toContain('at-ambient');
      }),
  );

  it.live("the default `mode: 'replace'` swaps the default logger out", () =>
    Effect.gen(function* () {
      const cap = makeLogCapture();
      const ambient = yield* References.CurrentLoggers;
      expect(ambient.has(Logger.defaultLogger)).toBe(true);

      const installed = yield* References.CurrentLoggers.pipe(Effect.provide(cap.layer));
      expect(installed.has(Logger.defaultLogger)).toBe(false);
      expect(installed.size).toBe(ambient.size);
    }),
  );

  it.live("`mode: 'add'` keeps the default logger installed and appends the capture", () =>
    Effect.gen(function* () {
      const cap = makeLogCapture({ mode: 'add' });
      const ambient = yield* References.CurrentLoggers;
      expect(ambient.has(Logger.defaultLogger)).toBe(true);

      const installed = yield* References.CurrentLoggers.pipe(Effect.provide(cap.layer));
      expect(installed.has(Logger.defaultLogger)).toBe(true);
      expect(installed.size).toBe(ambient.size + 1);

      yield* Effect.logInfo('appended').pipe(Effect.provide(cap.layer));
      expect(cap.text()).toContain('appended');
    }),
  );

  it.live('`entries` is a live view, and `messages()` / `text()` snapshot it in emission order', () =>
    Effect.gen(function* () {
      const cap = makeLogCapture();
      const liveEntries = cap.entries;
      expect(liveEntries).toHaveLength(0);
      yield* Effect.logInfo('first').pipe(
        Effect.andThen(Effect.logInfo('second')),
        Effect.provide(cap.layer),
      );
      expect(liveEntries).toHaveLength(2);
      expect(cap.messages()).toEqual(['first', 'second']);
      expect(cap.text()).toBe(`first${LF}second`);
    }),
  );

  it.live('`logs` returns the same snapshot as `messages`', () =>
    Effect.gen(function* () {
      const cap = makeLogCapture();
      yield* Effect.logInfo('one').pipe(Effect.provide(cap.layer));
      const viaEffect = yield* cap.logs;
      expect(viaEffect).toEqual(cap.messages());
    }),
  );
});
