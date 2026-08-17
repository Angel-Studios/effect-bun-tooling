import { Effect, Exit, Layer } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import {
  argv,
  commandArgv,
  commandExecutorLayer,
  commandLine,
  ScriptedCommandExecutor,
  ScriptedProcess,
  TestCommandExecutor,
} from '../src/command';
import { describe, expect, it } from '../src/index';

const spawner = ChildProcessSpawner.ChildProcessSpawner;

// v4's array form takes the arguments as one array; v3's `Command.make` was
// variadic. Every command below goes through this helper so the difference is
// stated once.
const cmd = (command: string, ...args: ReadonlyArray<string>) => ChildProcess.make(command, [...args]);

describe('commandArgv / commandLine', () => {
  it('flattens a StandardCommand into its argv', () => {
    // A v4 `Command` is itself an `Effect`, so these read in pipe style: the
    // Effect language service rejects `commandArgv(command)` as a missed
    // pipeable opportunity.
    expect(cmd('git', 'status', '--short').pipe(commandArgv)).toEqual(['git', 'status', '--short']);
    expect(cmd('git', 'status').pipe(commandLine)).toBe('git status');
  });

  it('a command with no arguments is just the executable', () => {
    expect(cmd('ls').pipe(commandArgv)).toEqual(['ls']);
  });
});

describe('argv matchers', () => {
  it('exact matches only the whole argv', () => {
    const m = argv.exact('git', 'status');
    expect(m.matches(['git', 'status'])).toBe(true);
    expect(m.matches(['git', 'status', '--short'])).toBe(false);
    expect(m.matches(['git'])).toBe(false);
  });

  it('prefix ignores trailing arguments', () => {
    const m = argv.prefix('git', 'status');
    expect(m.matches(['git', 'status', '--short'])).toBe(true);
    expect(m.matches(['git', 'log'])).toBe(false);
  });

  it('matching wraps an arbitrary predicate', () => {
    const m = argv.matching((a) => a.includes('--json'), 'json flag');
    expect(m.matches(['x', '--json'])).toBe(true);
    expect(m.matches(['x'])).toBe(false);
    expect(m.describe).toContain('json flag');
  });
});

describe('TestCommandExecutor', () => {
  it.effect('serves the scripted exit code and stdout', () =>
    Effect.gen(function* () {
      const s = yield* spawner;
      // `exitCode` is a branded number in v4; widening keeps `toBe` comparable.
      const code: number = yield* s.exitCode(cmd('anything'));
      expect(code).toBe(7);
      expect(yield* s.string(cmd('anything'))).toBe('scripted-out');
    }).pipe(Effect.provide(TestCommandExecutor(() => ({ exitCode: 7, stdout: 'scripted-out' })))),
  );

  it.effect('the script sees the argv it was called with', () =>
    Effect.gen(function* () {
      const s = yield* spawner;
      expect(yield* s.string(cmd('echo', 'hello'))).toBe('echo hello');
    }).pipe(Effect.provide(TestCommandExecutor((c) => ({ stdout: commandLine(c) })))),
  );

  // `string` reads stdout alone; `all` is the interleaved stream, and the v4
  // handle gained it as a required member. Reading it proves the double does
  // not simply return an empty stream there.
  it.effect('`all` carries stdout followed by stderr', () =>
    Effect.gen(function* () {
      const s = yield* spawner;
      const c = cmd('x');
      expect(yield* s.string(c)).toBe('OUT');
      expect(yield* s.string(c, { includeStderr: true })).toBe('OUTERR');
    }).pipe(Effect.provide(TestCommandExecutor(() => ({ stdout: 'OUT', stderr: 'ERR' })))),
  );

  it.effect('an exit code the script omits defaults to 0', () =>
    Effect.gen(function* () {
      const s = yield* spawner;
      const code: number = yield* s.exitCode(cmd('x'));
      expect(code).toBe(0);
    }).pipe(Effect.provide(TestCommandExecutor(() => ({})))),
  );
});

describe('ScriptedCommandExecutor', () => {
  it.effect('serves an expectation whose argv matcher accepts the spawn', () =>
    Effect.gen(function* () {
      const s = yield* spawner;
      expect(yield* s.string(cmd('git', 'status'))).toBe('on branch main');
      const code: number = yield* s.exitCode(cmd('git', 'push'));
      expect(code).toBe(3);
    }).pipe(
      Effect.provide(
        ScriptedCommandExecutor([
          { argv: ['git', 'status'], stdout: 'on branch main' },
          { argv: ['git', 'push'], exitCode: 3 },
        ]),
      ),
    ),
  );

  // Two separate guarantees, and the second is easy to lose: the rejection
  // reaches the caller as a TYPED PlatformError (so `catch` sees it, not just
  // `catchDefect`), and the violation is ALSO replayed when the layer's scope
  // closes — so a test that swallowed the error still fails rather than
  // passing on a subprocess that was never scripted.
  it.effect('an unmatched spawn is a typed failure AND fails the scope on close', () =>
    Effect.gen(function* () {
      let caught = 'never-ran';
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const s = yield* spawner;
          yield* s.exitCode(cmd('rm', '-rf')).pipe(
            Effect.catch((e) =>
              Effect.sync(() => {
                caught = String(e);
              }),
            ),
          );
        }).pipe(Effect.provide(ScriptedCommandExecutor([{ argv: ['git', 'status'] }]))),
      );

      // `Effect.catch` only sees the typed error channel.
      expect(caught).toContain('unexpected spawn');
      expect(caught).toContain('rm');

      expect(Exit.isFailure(exit)).toBe(true);
      expect(Exit.isFailure(exit) ? String(exit.cause) : '').toContain('rm');
    }),
  );

  it.effect('a predicate matcher selects the expectation', () =>
    Effect.gen(function* () {
      const s = yield* spawner;
      expect(yield* s.string(cmd('tool', '--json', 'x'))).toBe('{}');
    }).pipe(Effect.provide(ScriptedCommandExecutor([{ argv: (a) => a.includes('--json'), stdout: '{}' }]))),
  );
});

describe('ScriptedProcess exhaustion', () => {
  it('assertExhausted throws while an expectation is unconsumed', () => {
    const builder = ScriptedProcess([{ argv: ['a'] }, { argv: ['b'] }]);
    builder.next(['a']);
    expect(() => builder.assertExhausted()).toThrow(/b/);
  });

  it('assertExhausted is silent once every expectation is consumed', () => {
    const builder = ScriptedProcess([{ argv: ['a'] }]);
    builder.next(['a']);
    expect(() => builder.assertExhausted()).not.toThrow();
  });

  it('allowUnconsumed tolerates a leftover expectation', () => {
    const builder = ScriptedProcess([{ argv: ['a'] }, { argv: ['b'] }], { allowUnconsumed: true });
    builder.next(['a']);
    expect(() => builder.assertExhausted()).not.toThrow();
  });

  it('records each call and its outcome', () => {
    const builder = ScriptedProcess([{ argv: ['a'] }]);
    builder.next(['a']);
    expect(builder.calls).toEqual([['a']]);
    expect(builder.log[0]?.outcome).toBe('consumed');
  });

  // `commandExecutorLayer` registers a finalizer, so an unconsumed expectation
  // has to surface when the layer's scope closes rather than passing silently.
  it.effect('an unconsumed expectation becomes a defect when the layer scope closes', () =>
    Effect.gen(function* () {
      const builder = ScriptedProcess([{ argv: ['never-run'] }]);
      const exit = yield* Effect.exit(Effect.void.pipe(Effect.provide(commandExecutorLayer(builder))));

      expect(Exit.isFailure(exit)).toBe(true);
      expect(Exit.isFailure(exit) ? String(exit.cause) : '').toContain('never-run');
    }),
  );

  it.effect('a fully consumed script closes its scope cleanly', () =>
    Effect.gen(function* () {
      const builder = ScriptedProcess([{ argv: ['git'] }]);
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const s = yield* spawner;
          yield* s.exitCode(cmd('git'));
        }).pipe(Effect.provide(commandExecutorLayer(builder))),
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );
});

describe('layer wiring', () => {
  it('TestCommandExecutor produces a Layer providing the spawner', () => {
    expect(Layer.isLayer(TestCommandExecutor(() => ({})))).toBe(true);
  });
});
