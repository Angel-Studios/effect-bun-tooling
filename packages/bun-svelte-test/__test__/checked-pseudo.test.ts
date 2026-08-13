import { describe, expect, it } from 'bun:test';
import { flushSync } from 'svelte';
import { mountComponent } from '../src/mount';
import BoundSelect from './fixtures/BoundSelect.svelte';

const CHOICES = [
  { id: 'alpha', label: 'Alpha' },
  { id: 'beta', label: 'Beta' },
  { id: 'gamma', label: 'Gamma' },
] as const;

const buildSelect = (): HTMLSelectElement => {
  document.body.innerHTML = `
    <select id="target">
      <option value="a">A</option>
      <option value="b">B</option>
      <option value="c">C</option>
    </select>`;
  return document.getElementById('target') as HTMLSelectElement;
};

const optionValues = (nodes: Iterable<Element>): readonly string[] =>
  [...nodes].map((node) => (node as HTMLOptionElement).value);

const driveChange = (select: HTMLSelectElement, value: string): void => {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
};

describe(':checked matches a selected <option>', () => {
  it('finds the implicitly selected first option', () => {
    const select = buildSelect();

    expect((select.querySelector(':checked') as HTMLOptionElement | null)?.value).toBe('a');
    expect(optionValues(select.querySelectorAll(':checked'))).toEqual(['a']);
  });

  it('matches through querySelector, querySelectorAll, matches and closest', () => {
    const select = buildSelect();
    const third = select.options[2] as HTMLOptionElement;
    third.selected = true;

    expect((select.querySelector(':checked') as HTMLOptionElement | null)?.value).toBe('c');
    expect(optionValues(select.querySelectorAll(':checked'))).toEqual(['c']);
    expect(third.matches(':checked')).toBe(true);
    expect((select.options[0] as HTMLOptionElement).matches(':checked')).toBe(false);
    expect(optionValues(document.querySelectorAll('option:checked'))).toEqual(['c']);
  });

  it('does not serve a stale cached result after selectedness changes', () => {
    const select = buildSelect();

    expect((select.querySelector(':checked') as HTMLOptionElement | null)?.value).toBe('a');
    expect(optionValues(select.querySelectorAll(':checked'))).toEqual(['a']);
    expect((select.options[1] as HTMLOptionElement).matches(':checked')).toBe(false);

    select.value = 'b';

    expect((select.querySelector(':checked') as HTMLOptionElement | null)?.value).toBe('b');
    expect(optionValues(select.querySelectorAll(':checked'))).toEqual(['b']);
    expect((select.options[1] as HTMLOptionElement).matches(':checked')).toBe(true);
    expect((select.options[0] as HTMLOptionElement).matches(':checked')).toBe(false);
  });

  it('tracks selection driven through the option property rather than the select', () => {
    const select = buildSelect();

    expect((select.querySelector(':checked') as HTMLOptionElement | null)?.value).toBe('a');

    (select.options[1] as HTMLOptionElement).selected = true;

    expect((select.querySelector(':checked') as HTMLOptionElement | null)?.value).toBe('b');
  });

  it('leaves :checked on inputs alone', () => {
    document.body.innerHTML = `
      <form>
        <input id="cb" type="checkbox" />
        <input id="radio-on" type="radio" name="r" checked />
        <input id="radio-off" type="radio" name="r" />
      </form>`;
    const checkbox = document.getElementById('cb') as HTMLInputElement;

    expect(checkbox.matches(':checked')).toBe(false);
    expect(document.querySelectorAll('input:checked').length).toBe(1);

    checkbox.checked = true;

    expect(checkbox.matches(':checked')).toBe(true);
    expect(document.querySelectorAll('input:checked').length).toBe(2);
  });

  it('follows the selection through the case-insensitive spelling of the pseudo-class', () => {
    const select = buildSelect();

    expect((select.querySelector(':CHECKED') as HTMLOptionElement | null)?.value).toBe('a');

    select.value = 'c';

    expect((select.querySelector(':CHECKED') as HTMLOptionElement | null)?.value).toBe('c');
    expect(optionValues(select.querySelectorAll(':CHECKED'))).toEqual(['c']);
  });

  it('keeps selectedOptions in step with the selection', () => {
    const select = buildSelect();

    expect(optionValues(select.selectedOptions)).toEqual(['a']);

    select.value = 'b';

    expect(optionValues(select.selectedOptions)).toEqual(['b']);

    (select.options[2] as HTMLOptionElement).selected = true;

    expect(optionValues(select.selectedOptions)).toEqual(['c']);
  });

  it('does not reflect the selected property into the [selected] attribute', () => {
    const select = buildSelect();
    const second = select.options[1] as HTMLOptionElement;
    second.selected = true;

    expect(second.selected).toBe(true);
    expect(second.hasAttribute('selected')).toBe(false);
    expect(select.querySelectorAll('[selected]').length).toBe(0);
  });
});

describe('Svelte bind:value on a <select>', () => {
  const echoOf = (container: HTMLElement): string =>
    container.querySelector('[data-testid="picked-echo"]')?.textContent ?? '';

  const selectOf = (container: HTMLElement): HTMLSelectElement =>
    container.querySelector('[data-testid="picked"]') as HTMLSelectElement;

  it('starts at the initial bound value', () => {
    const { container } = mountComponent(BoundSelect, { choices: CHOICES, initial: 'beta' });

    expect(selectOf(container).value).toBe('beta');
    expect(echoOf(container)).toBe('beta');
  });

  it('moves the bound state when a change event is fired', () => {
    const { container } = mountComponent(BoundSelect, { choices: CHOICES, initial: 'alpha' });

    driveChange(selectOf(container), 'gamma');

    expect(selectOf(container).value).toBe('gamma');
    expect(echoOf(container)).toBe('gamma');
  });

  it('does not silently fall back to the first option when a later option is chosen', () => {
    const { container } = mountComponent(BoundSelect, { choices: CHOICES, initial: 'alpha' });

    driveChange(selectOf(container), 'beta');

    expect(echoOf(container)).not.toBe('alpha');
    expect(echoOf(container)).toBe('beta');
  });

  it('tracks repeated changes rather than latching on the first one', () => {
    const { container } = mountComponent(BoundSelect, { choices: CHOICES, initial: 'alpha' });
    const select = selectOf(container);

    driveChange(select, 'gamma');
    expect(echoOf(container)).toBe('gamma');

    driveChange(select, 'beta');
    expect(echoOf(container)).toBe('beta');

    driveChange(select, 'alpha');
    expect(echoOf(container)).toBe('alpha');
  });
});
