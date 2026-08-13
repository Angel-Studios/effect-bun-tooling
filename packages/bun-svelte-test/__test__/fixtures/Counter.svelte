<script lang="ts">
  type Props = {
    readonly start?: number;
    readonly step?: number;
  };

  const LABELS = { bump: 'bump' } as const satisfies Record<string, string>;

  import { untrack } from 'svelte';

  const identity = <T,>(value: T): T => value;

  let { start = 0, step = 1 }: Props = $props();

  
  
  
  let count: number = $state(untrack(() => start));
  const doubled: number = $derived(count * 2);

  const bump = (): void => {
    count = count + identity<number>(step);
  };
</script>

<button type="button" data-testid="bump" onclick={bump}>{LABELS.bump}</button>
<span data-testid="count">{count}</span>
<span data-testid="doubled">{doubled}</span>
