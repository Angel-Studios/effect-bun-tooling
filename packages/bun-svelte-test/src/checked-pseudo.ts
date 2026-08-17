import * as PropertySymbol from 'happy-dom/lib/PropertySymbol.js';
import QuerySelector from 'happy-dom/lib/query-selector/QuerySelector.js';
import SelectorItem from 'happy-dom/lib/query-selector/SelectorItem.js';

const OPTION_TAG_NAME = 'OPTION';
const CHECKED_PSEUDO_NAME = 'checked';
const CHECKED_PSEUDO_TOKEN = ':checked';
const MATCH_PRIORITY_WEIGHT = 10;

const INSTALL_FAILURE_HINT = [
  'bun-svelte-test: the `:checked` correction for happy-dom did NOT take.',
  '',
  'happy-dom implements the `:checked` pseudo-class as INPUT-only. Per the HTML',
  'standard it must also match an `<option>` whose selectedness is true. Svelte 5',
  "reads a bound `<select>` through `select.querySelector(':checked')`, so without",
  'this correction `bind:value` silently reverts to the FIRST non-disabled option on',
  'every change event — and a test that drives the select still passes, asserting a',
  'value it never selected.',
  '',
  'happy-dom additionally caches query-selector results per node and never',
  "invalidates that cache when selectedness changes: `HTMLSelectElement`'s `value`",
  'and `selectedIndex` setters assign option selectedness directly, bypassing the',
  'selectedness-setting algorithm that would be the natural invalidation hook. A',
  'correction that only fixes matching therefore still serves a STALE result to any',
  '`:checked` selector that was queried before the change. Both halves are required;',
  'each is silent on its own.',
  '',
  'Likely causes:',
  '  1. happy-dom was upgraded and `SelectorItem.prototype.matchPseudoItem`, the',
  '     `QuerySelector` static entry points, or the `cache` property symbol was',
  '     renamed, restructured, or removed.',
  '  2. Upstream fixed this and the shim now conflicts. Check',
  '     https://github.com/capricorn86/happy-dom/pull/2268 and delete this module if',
  '     the installed version matches `:checked` against options natively.',
  '  3. Two happy-dom copies are installed, and the globals registered by',
  '     `@happy-dom/global-registrator` come from a different copy than the one',
  '     patched here. Check `bun pm why happy-dom` from this package directory.',
].join('\n');

type PseudoDescriptor = { readonly name?: string };
type SelectorMatch = { readonly priorityWeight: number } | null;
type MatchPseudoItem = (element: unknown, parentChildren: unknown, pseudo: PseudoDescriptor) => SelectorMatch;
type CacheBucket = 'querySelector' | 'querySelectorAll' | 'matches';
type Indexed = Record<PropertyKey, unknown>;

const asIndexed = (value: unknown): Indexed => value as Indexed;

const isSelectedOption = (element: unknown): boolean => {
  const candidate = element as { readonly tagName?: unknown; readonly selected?: unknown } | null;
  return candidate?.tagName === OPTION_TAG_NAME && candidate.selected === true;
};

const dropCachedSelector = (node: unknown, selector: unknown, bucket: CacheBucket): void => {
  if (node === null || node === undefined) return;

  const key = String(selector);
  if (!key.toLowerCase().includes(CHECKED_PSEUDO_TOKEN)) return;

  const cache = asIndexed(node)[PropertySymbol.cache] as Record<string, unknown> | undefined;
  const entries = cache?.[bucket];
  if (entries instanceof Map) entries.delete(key);
};

const dropSelectedOptionsMemo = (nodeList: unknown): void => {
  if (nodeList === null || nodeList === undefined) return;

  const items = asIndexed(nodeList)[PropertySymbol.items];
  if (Array.isArray(items)) {
    delete asIndexed(items)[PropertySymbol.selectedOptions];
  }
};

const patchCheckedMatching = (): void => {
  const prototype = asIndexed(SelectorItem.prototype);
  const original = prototype['matchPseudoItem'] as MatchPseudoItem;

  prototype['matchPseudoItem'] = function patchedMatchPseudoItem(
    this: unknown,
    element: unknown,
    parentChildren: unknown,
    pseudo: PseudoDescriptor,
  ): SelectorMatch {
    if (pseudo?.name === CHECKED_PSEUDO_NAME && isSelectedOption(element)) {
      return { priorityWeight: MATCH_PRIORITY_WEIGHT };
    }
    return original.call(this, element, parentChildren, pseudo);
  };
};

const patchCheckedCacheBypass = (): void => {
  const statics = QuerySelector as unknown as Record<CacheBucket, (...args: unknown[]) => unknown>;

  for (const bucket of ['querySelector', 'querySelectorAll', 'matches'] as const) {
    const original = statics[bucket];
    statics[bucket] = function patchedQuery(this: unknown, ...args: unknown[]): unknown {
      dropCachedSelector(args[0], args[1], bucket);
      const result = original.apply(this, args);
      if (bucket === 'querySelectorAll') dropSelectedOptionsMemo(result);
      return result;
    };
  }
};

const assertCheckedPseudoWorks = (): void => {
  const select = document.createElement('select');
  const first = document.createElement('option');
  const second = document.createElement('option');
  first.value = 'first';
  second.value = 'second';
  select.append(first, second);
  document.body.appendChild(select);

  const failures: string[] = [];
  if (select.querySelector(CHECKED_PSEUDO_TOKEN) !== first) {
    failures.push('  - a freshly built <select> does not report its first option as `:checked`.');
  }
  if (second.matches(CHECKED_PSEUDO_TOKEN)) {
    failures.push('  - an unselected option already matches `:checked`.');
  }
  if (select.querySelectorAll(CHECKED_PSEUDO_TOKEN).length !== 1) {
    failures.push('  - a freshly built <select> does not report exactly one `:checked` option.');
  }
  if (select.selectedOptions.length !== 1) {
    failures.push('  - a freshly built <select> does not report exactly one entry in `selectedOptions`.');
  }

  select.value = 'second';

  if (select.querySelector(CHECKED_PSEUDO_TOKEN) !== second) {
    failures.push('  - `querySelector(":checked")` did not follow the selection (stale cache).');
  }
  const checkedAll = [...select.querySelectorAll(CHECKED_PSEUDO_TOKEN)];
  if (checkedAll.length !== 1 || checkedAll[0] !== second) {
    failures.push('  - `querySelectorAll(":checked")` did not follow the selection (stale cache).');
  }
  if (!second.matches(CHECKED_PSEUDO_TOKEN)) {
    failures.push('  - `option.matches(":checked")` is false for the selected option.');
  }
  if (first.matches(CHECKED_PSEUDO_TOKEN)) {
    failures.push('  - `option.matches(":checked")` is still true for the deselected option (stale cache).');
  }
  const selectedNow = [...select.selectedOptions];
  if (selectedNow.length !== 1 || selectedNow[0] !== second) {
    failures.push('  - `selectedOptions` did not follow the selection (stale memo).');
  }

  select.remove();
  if (failures.length === 0) return;

  throw new Error([INSTALL_FAILURE_HINT, '', 'Failed checks:', ...failures].join('\n'));
};

let installed = false;

export const installCheckedPseudoSupport = (): void => {
  if (installed) return;
  installed = true;

  patchCheckedMatching();
  patchCheckedCacheBypass();
  assertCheckedPseudoWorks();
};
