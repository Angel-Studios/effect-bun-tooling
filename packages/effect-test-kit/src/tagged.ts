import { Cause, Either, Exit, Inspectable, Option } from 'effect';

export type TaggedValue = { readonly _tag: string };

export type Tagged<E extends TaggedValue, Tag extends E['_tag']> = Extract<E, { readonly _tag: Tag }>;

const render = (u: unknown): string => Inspectable.toStringUnknown(u, 2);

function assertTag<E extends TaggedValue, const Tag extends E['_tag']>(
  value: E,
  tag: Tag,
): asserts value is Tagged<E, Tag> {
  if (value._tag !== tag) {
    throw new Error(
      `expectTag: expected a value tagged "${tag}", but received one tagged "${value._tag}".\n` +
        `Actual value:\n${render(value)}`,
    );
  }
}

export function expectTag<E extends TaggedValue, const Tag extends E['_tag']>(
  value: E,
  tag: Tag,
): Tagged<E, Tag> {
  assertTag(value, tag);
  return value;
}

export function expectFailureTag<A, E extends TaggedValue, const Tag extends E['_tag']>(
  exit: Exit.Exit<A, E>,
  tag: Tag,
): Tagged<E, Tag> {
  if (Exit.isSuccess(exit)) {
    throw new Error(
      `expectFailureTag: expected the Exit to FAIL with a value tagged "${tag}", but it SUCCEEDED.\n` +
        `Success value:\n${render(exit.value)}`,
    );
  }
  return expectCauseFailureTag(exit.cause, tag);
}

export function expectCauseFailureTag<E extends TaggedValue, const Tag extends E['_tag']>(
  cause: Cause.Cause<E>,
  tag: Tag,
): Tagged<E, Tag> {
  const failure = Cause.failureOption(cause);
  if (Option.isNone(failure)) {
    throw new Error(
      `expectCauseFailureTag: expected a failure tagged "${tag}", but the Cause carried no ` +
        `typed failure (it was a defect or interruption).\nCause:\n${Cause.pretty(cause)}`,
    );
  }
  return expectTag(failure.value, tag);
}

export function expectLeftTag<R, L extends TaggedValue, const Tag extends L['_tag']>(
  either: Either.Either<R, L>,
  tag: Tag,
): Tagged<L, Tag> {
  if (Either.isRight(either)) {
    throw new Error(
      `expectLeftTag: expected a Left tagged "${tag}", but received a Right.\n` +
        `Right value:\n${render(either.right)}`,
    );
  }
  return expectTag(either.left, tag);
}
