import type * as Command from '@effect/platform/Command';
import * as CommandExecutor from '@effect/platform/CommandExecutor';
import * as PlatformError from '@effect/platform/Error';
import * as Data from 'effect/Data';
import type * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import { NodeInspectSymbol } from 'effect/Inspectable';
import * as Layer from 'effect/Layer';
import * as Ref from 'effect/Ref';
import type * as Scope from 'effect/Scope';
import * as Sink from 'effect/Sink';
import * as Stream from 'effect/Stream';

const encoder = new TextEncoder();

export type OutputSpec = string | Uint8Array | ReadonlyArray<string | Uint8Array>;

const toChunks = (spec: OutputSpec | undefined): ReadonlyArray<Uint8Array> => {
  if (spec === undefined) return [];
  if (typeof spec === 'string') return [encoder.encode(spec)];
  if (spec instanceof Uint8Array) return [spec];
  return spec.map((chunk) => (typeof chunk === 'string' ? encoder.encode(chunk) : chunk));
};

const renderArgv = (argv: ReadonlyArray<string>): string => `${argv.join(' ')}  ${JSON.stringify(argv)}`;

export type TestProcessResult = {
  readonly exitCode?: number;

  readonly stdout?: string | Uint8Array | Stream.Stream<Uint8Array, PlatformError.PlatformError>;

  readonly stderr?: string | Uint8Array | Stream.Stream<Uint8Array, PlatformError.PlatformError>;

  readonly delay?: Duration.DurationInput;

  readonly pid?: number;
};

export type TestCommandScript = (
  command: Command.Command,
) => TestProcessResult | Effect.Effect<TestProcessResult, PlatformError.PlatformError>;

export const commandArgv = (command: Command.Command): ReadonlyArray<string> =>
  command._tag === 'StandardCommand'
    ? [command.command, ...command.args]
    : [...commandArgv(command.left), ...commandArgv(command.right)];

export const commandLine = (command: Command.Command): string => commandArgv(command).join(' ');

const toByteStream = (
  spec: string | Uint8Array | Stream.Stream<Uint8Array, PlatformError.PlatformError> | undefined,
): Stream.Stream<Uint8Array, PlatformError.PlatformError> => {
  if (spec === undefined) return Stream.empty;
  if (typeof spec === 'string') return Stream.make(encoder.encode(spec));
  if (spec instanceof Uint8Array) return Stream.make(spec);
  return spec;
};

const resolveScript = (
  script: TestCommandScript,
  command: Command.Command,
): Effect.Effect<TestProcessResult, PlatformError.PlatformError> =>
  Effect.suspend(() => {
    const resolved = script(command);
    return Effect.isEffect(resolved) ? resolved : Effect.succeed(resolved);
  });

const makeProcess = (
  result: TestProcessResult,
  running: Ref.Ref<boolean>,
  settle: Effect.Effect<void>,
): CommandExecutor.Process => ({
  [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
  pid: CommandExecutor.ProcessId(result.pid ?? 1),
  exitCode: settle.pipe(
    Effect.zipRight(Ref.set(running, false)),
    Effect.as(CommandExecutor.ExitCode(result.exitCode ?? 0)),
  ),
  isRunning: Ref.get(running),
  kill: () => Ref.set(running, false),
  stdout: Stream.unwrap(Effect.as(settle, toByteStream(result.stdout))),
  stderr: Stream.unwrap(Effect.as(settle, toByteStream(result.stderr))),
  stdin: Sink.drain,
  toJSON: () => ({ _id: 'TestProcess', pid: result.pid ?? 1, exitCode: result.exitCode ?? 0 }),
  toString: () => `TestProcess(pid=${result.pid ?? 1}, exitCode=${result.exitCode ?? 0})`,
  [NodeInspectSymbol]: () => ({
    _id: 'TestProcess',
    pid: result.pid ?? 1,
    exitCode: result.exitCode ?? 0,
  }),
});

const startProcess = (
  result: TestProcessResult,
): Effect.Effect<CommandExecutor.Process, never, Scope.Scope> =>
  Effect.gen(function* () {
    const running = yield* Ref.make(true);
    const settle =
      result.delay === undefined ? Effect.void : yield* Effect.cached(Effect.sleep(result.delay));
    return makeProcess(result, running, settle);
  });

const start =
  (script: TestCommandScript) =>
  (
    command: Command.Command,
  ): Effect.Effect<CommandExecutor.Process, PlatformError.PlatformError, Scope.Scope> =>
    Effect.flatMap(resolveScript(script, command), startProcess);

export const TestCommandExecutor = (
  script: TestCommandScript,
): Layer.Layer<CommandExecutor.CommandExecutor> =>
  Layer.succeed(CommandExecutor.CommandExecutor, CommandExecutor.makeExecutor(start(script)));

export type ArgvMatcher = {
  readonly describe: string;
  readonly matches: (argv: ReadonlyArray<string>) => boolean;
};

export type ArgvMatcherSpec =
  | ReadonlyArray<string>
  | ((argv: ReadonlyArray<string>) => boolean)
  | ArgvMatcher;

export const argv = {
  exact: (...expected: ReadonlyArray<string>): ArgvMatcher => ({
    describe: `exact ${JSON.stringify(expected)}`,
    matches: (actual) => actual.length === expected.length && expected.every((a, i) => actual[i] === a),
  }),

  prefix: (...expected: ReadonlyArray<string>): ArgvMatcher => ({
    describe: `prefix ${JSON.stringify(expected)}`,
    matches: (actual) => expected.every((a, i) => actual[i] === a),
  }),

  matching: (predicate: (argv: ReadonlyArray<string>) => boolean, label = 'predicate'): ArgvMatcher => ({
    describe: `matching ${label}`,
    matches: predicate,
  }),
};

const normalizeMatcher = (spec: ArgvMatcherSpec): ArgvMatcher => {
  if (Array.isArray(spec)) return argv.exact(...(spec as ReadonlyArray<string>));
  if (typeof spec === 'function') return argv.matching(spec);
  return spec as ArgvMatcher;
};

export type ScriptedExpectation = {
  readonly argv: ArgvMatcherSpec;

  readonly exitCode?: number;

  readonly stdout?: OutputSpec;

  readonly stderr?: OutputSpec;

  readonly delayMs?: number;

  readonly onSpawn?: (argv: ReadonlyArray<string>) => void;

  readonly pid?: number;
};

export type ScriptedProcessOptions = {
  readonly ordered?: boolean;

  readonly allowUnconsumed?: boolean;
};

export type ScriptedHandle = {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;

  readonly exited: Promise<number>;

  readonly exitCode: number | null;
  readonly pid: number;
  readonly kill: (signal?: number | string) => void;
};

export type ScriptedCallOutcome = 'consumed' | 'consumed-out-of-order' | 'out-of-order' | 'unexpected';

export type ScriptedCall = {
  readonly argv: ReadonlyArray<string>;
  readonly outcome: ScriptedCallOutcome;

  readonly index: number | undefined;
};

export class UnexpectedSpawnError extends Data.TaggedError('UnexpectedSpawnError')<{
  readonly argv: ReadonlyArray<string>;
  readonly message: string;
}> {}

export class OutOfOrderSpawnError extends Data.TaggedError('OutOfOrderSpawnError')<{
  readonly argv: ReadonlyArray<string>;
  readonly expectedIndex: number;
  readonly matchedIndex: number;
  readonly message: string;
}> {}

export class UnconsumedExpectationsError extends Data.TaggedError('UnconsumedExpectationsError')<{
  readonly remaining: ReadonlyArray<string>;
  readonly message: string;
}> {}

export type ScriptedProcessViolation = UnexpectedSpawnError | OutOfOrderSpawnError;

export type ScriptedProcessProblem = ScriptedProcessViolation | UnconsumedExpectationsError;

const readableFrom = (chunks: ReadonlyArray<Uint8Array>): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

const makeHandle = (expectation: ScriptedExpectation, pid: number): ScriptedHandle => {
  const code = expectation.exitCode ?? 0;
  let exitCodeValue: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settle: (code: number) => void = () => {};

  const settled = new Promise<number>((resolve) => {
    settle = resolve;
    if (expectation.delayMs === undefined) {
      resolve(code);
    } else {
      timer = setTimeout(() => resolve(code), expectation.delayMs);
    }
  });

  const exited = settled.then((resolved) => {
    exitCodeValue = resolved;
    return resolved;
  });

  return {
    stdout: readableFrom(toChunks(expectation.stdout)),
    stderr: readableFrom(toChunks(expectation.stderr)),
    exited,
    pid,
    get exitCode() {
      return exitCodeValue;
    },
    kill: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      settle(code);
    },
  };
};

const toProcessResult = (expectation: ScriptedExpectation, pid: number): TestProcessResult => ({
  exitCode: expectation.exitCode ?? 0,
  stdout: Stream.fromIterable(toChunks(expectation.stdout)),
  stderr: Stream.fromIterable(toChunks(expectation.stderr)),
  delay: expectation.delayMs,
  pid,
});

const renderRemaining = (
  matchers: ReadonlyArray<ArgvMatcher>,
  consumed: ReadonlyArray<boolean>,
  ordered: boolean,
): ReadonlyArray<string> => {
  const pendingIndex = ordered ? consumed.indexOf(false) : -1;
  return matchers.flatMap((matcher, index) =>
    consumed[index] ? [] : [`  [${index}]${index === pendingIndex ? ' <- pending' : ''} ${matcher.describe}`],
  );
};

const findMatch = (
  matchers: ReadonlyArray<ArgvMatcher>,
  consumed: ReadonlyArray<boolean>,
  actual: ReadonlyArray<string>,
): number => matchers.findIndex((matcher, index) => !consumed[index] && matcher.matches(actual));

type Selection =
  | { readonly _tag: 'Match'; readonly index: number }
  | { readonly _tag: 'OutOfOrder'; readonly pendingIndex: number; readonly matchedIndex: number }
  | { readonly _tag: 'Unexpected' };

const selectUnordered = (
  matchers: ReadonlyArray<ArgvMatcher>,
  consumed: ReadonlyArray<boolean>,
  actual: ReadonlyArray<string>,
): Selection => {
  const index = findMatch(matchers, consumed, actual);
  return index === -1 ? { _tag: 'Unexpected' } : { _tag: 'Match', index };
};

const selectOrdered = (
  matchers: ReadonlyArray<ArgvMatcher>,
  consumed: ReadonlyArray<boolean>,
  actual: ReadonlyArray<string>,
): Selection => {
  const pendingIndex = consumed.indexOf(false);
  if (pendingIndex !== -1 && matchers[pendingIndex]?.matches(actual) === true) {
    return { _tag: 'Match', index: pendingIndex };
  }
  const matchedIndex = findMatch(matchers, consumed, actual);
  return matchedIndex === -1 ? { _tag: 'Unexpected' } : { _tag: 'OutOfOrder', pendingIndex, matchedIndex };
};

const outOfOrderError = (
  actual: ReadonlyArray<string>,
  selection: { readonly pendingIndex: number; readonly matchedIndex: number },
  listing: string,
): OutOfOrderSpawnError =>
  new OutOfOrderSpawnError({
    argv: actual,
    expectedIndex: selection.pendingIndex,
    matchedIndex: selection.matchedIndex,
    message:
      `ScriptedProcess: out-of-order spawn.\n  actual: ${renderArgv(actual)}\n` +
      `It matches expectation [${selection.matchedIndex}], but [${selection.pendingIndex}] was pending ` +
      `and has not run yet. The script is right; the ORDER is wrong — either reorder the expectation ` +
      `list, or drop \`ordered: true\` if the order is not part of the contract under test.\n` +
      `Remaining expectations:\n${listing}`,
  });

const unexpectedError = (actual: ReadonlyArray<string>, listing: string): UnexpectedSpawnError =>
  new UnexpectedSpawnError({
    argv: actual,
    message:
      `ScriptedProcess: unexpected spawn.\n  actual: ${renderArgv(actual)}\n` +
      (listing === ''
        ? 'All expectations were already consumed — the subject spawned more processes than the script allows.'
        : `It matches NONE of the remaining expectations:\n${listing}`),
  });

type Resolution =
  | { readonly _tag: 'Consumed'; readonly expectation: ScriptedExpectation; readonly pid: number }
  | { readonly _tag: 'Rejected'; readonly error: ScriptedProcessViolation };

const makeEngine = (
  expectations: ReadonlyArray<ScriptedExpectation>,
  options: ScriptedProcessOptions | undefined,
) => {
  const ordered = options?.ordered ?? false;
  const allowUnconsumed = options?.allowUnconsumed ?? false;
  const matchers = expectations.map((expectation) => normalizeMatcher(expectation.argv));
  const consumed = expectations.map(() => false);
  const calls: Array<ReadonlyArray<string>> = [];
  const log: Array<ScriptedCall> = [];
  const violations: Array<ScriptedProcessViolation> = [];
  let ignored = false;

  const reject = (actual: ReadonlyArray<string>, selection: Selection): Resolution => {
    const listing = renderRemaining(matchers, consumed, ordered).join('\n');
    const error =
      selection._tag === 'OutOfOrder'
        ? outOfOrderError(actual, selection, listing)
        : unexpectedError(actual, listing);
    log.push({
      argv: actual,
      outcome: selection._tag === 'OutOfOrder' ? 'out-of-order' : 'unexpected',
      index: undefined,
    });
    violations.push(error);
    return { _tag: 'Rejected', error };
  };

  const accept = (actual: ReadonlyArray<string>, index: number): Resolution => {
    const wasPending = consumed.indexOf(false) === index;
    consumed[index] = true;
    const expectation = expectations[index];
    if (expectation === undefined) {
      return reject(actual, { _tag: 'Unexpected' });
    }
    log.push({
      argv: actual,
      outcome: wasPending ? 'consumed' : 'consumed-out-of-order',
      index,
    });
    expectation.onSpawn?.(actual);
    return { _tag: 'Consumed', expectation, pid: expectation.pid ?? 1000 + index };
  };

  const resolve = (actual: ReadonlyArray<string>): Resolution => {
    calls.push(actual);
    const selection = ordered
      ? selectOrdered(matchers, consumed, actual)
      : selectUnordered(matchers, consumed, actual);
    return selection._tag === 'Match' ? accept(actual, selection.index) : reject(actual, selection);
  };

  const unconsumedError = (): UnconsumedExpectationsError | undefined => {
    if (allowUnconsumed || ignored) return undefined;
    const remaining = renderRemaining(matchers, consumed, ordered);
    if (remaining.length === 0) return undefined;
    return new UnconsumedExpectationsError({
      remaining,
      message:
        `ScriptedProcess: ${remaining.length} expectation(s) were never consumed — the subject ` +
        `spawned fewer processes than the script requires.\nUnconsumed:\n${remaining.join('\n')}\n` +
        `Observed ${calls.length} spawn(s):\n` +
        (calls.length === 0 ? '  (none)' : calls.map((call) => `  ${renderArgv(call)}`).join('\n')) +
        '\nIf this partial run is intentional, say so explicitly with `allowUnconsumed: true` or ' +
        '`ignoreRemaining()`.',
    });
  };

  const firstProblem = (): ScriptedProcessProblem | undefined => violations[0] ?? unconsumedError();

  return {
    ordered,
    allowUnconsumed,
    calls,
    log,
    violations,
    resolve,
    firstProblem,
    ignoreRemaining: () => {
      ignored = true;
    },
  };
};

const engines = new WeakMap<ScriptedProcessBuilder, (argv: ReadonlyArray<string>) => Resolution>();

const foreignBuilderError = new Error(
  'commandExecutorLayer: builder was not produced by ScriptedProcess(). Pass the value returned by ' +
    'ScriptedProcess(expectations) — a hand-rolled object cannot drive the matching engine.',
);

export type ScriptedProcessBuilder = {
  readonly next: (argv: ReadonlyArray<string>) => ScriptedHandle;

  readonly assertExhausted: () => void;

  readonly firstProblem: () => ScriptedProcessProblem | undefined;

  readonly ignoreRemaining: () => void;

  readonly violations: ReadonlyArray<ScriptedProcessViolation>;

  readonly calls: ReadonlyArray<ReadonlyArray<string>>;

  readonly log: ReadonlyArray<ScriptedCall>;

  readonly ordered: boolean;

  readonly allowUnconsumed: boolean;
};

export const ScriptedProcess = (
  expectations: ReadonlyArray<ScriptedExpectation>,
  options?: ScriptedProcessOptions,
): ScriptedProcessBuilder => {
  const engine = makeEngine(expectations, options);

  const next = (actual: ReadonlyArray<string>): ScriptedHandle => {
    const resolution = engine.resolve(actual);
    if (resolution._tag === 'Rejected') throw resolution.error;
    return makeHandle(resolution.expectation, resolution.pid);
  };

  const assertExhausted = (): void => {
    const problem = engine.firstProblem();
    if (problem !== undefined) throw problem;
  };

  const builder: ScriptedProcessBuilder = {
    next,
    assertExhausted,
    firstProblem: engine.firstProblem,
    ignoreRemaining: engine.ignoreRemaining,
    violations: engine.violations,
    calls: engine.calls,
    log: engine.log,
    ordered: engine.ordered,
    allowUnconsumed: engine.allowUnconsumed,
  };
  engines.set(builder, engine.resolve);
  return builder;
};

const verifyOnClose = (
  builder: ScriptedProcessBuilder,
  exit: Exit.Exit<unknown, unknown>,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (!Exit.isSuccess(exit)) return Effect.void;
    const problem = builder.firstProblem();
    return problem === undefined ? Effect.void : Effect.die(problem);
  });

export const scopedScriptedProcess = (
  expectations: ReadonlyArray<ScriptedExpectation>,
  options?: ScriptedProcessOptions,
): Effect.Effect<ScriptedProcessBuilder, never, Scope.Scope> =>
  Effect.gen(function* () {
    const builder = ScriptedProcess(expectations, options);
    yield* Effect.addFinalizer((exit) => verifyOnClose(builder, exit));
    return builder;
  });

const toPlatformError = (violation: ScriptedProcessViolation): PlatformError.PlatformError =>
  new PlatformError.BadArgument({
    module: 'Command',
    method: 'start',
    description: violation.message,
    cause: violation,
  });

const scriptedStart =
  (resolve: (argv: ReadonlyArray<string>) => Resolution) =>
  (
    command: Command.Command,
  ): Effect.Effect<CommandExecutor.Process, PlatformError.PlatformError, Scope.Scope> =>
    Effect.suspend(() => {
      const resolution = resolve(commandArgv(command));
      if (resolution._tag === 'Rejected') {
        const failure = toPlatformError(resolution.error);
        return Effect.fail(failure);
      }
      return startProcess(toProcessResult(resolution.expectation, resolution.pid));
    });

export const ScriptedCommandExecutor = (
  expectations: ReadonlyArray<ScriptedExpectation>,
  options?: ScriptedProcessOptions,
): Layer.Layer<CommandExecutor.CommandExecutor> =>
  Layer.suspend(() => commandExecutorLayer(ScriptedProcess(expectations, options)));

export const commandExecutorLayer = (
  builder: ScriptedProcessBuilder,
): Layer.Layer<CommandExecutor.CommandExecutor> =>
  Layer.scoped(
    CommandExecutor.CommandExecutor,
    Effect.gen(function* () {
      const resolve = engines.get(builder);
      if (resolve === undefined) return yield* Effect.die(foreignBuilderError);
      yield* Effect.addFinalizer((exit) => verifyOnClose(builder, exit));
      return CommandExecutor.makeExecutor(scriptedStart(resolve));
    }),
  );
