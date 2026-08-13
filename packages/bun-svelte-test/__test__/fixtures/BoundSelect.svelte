<script lang="ts">
  import { untrack } from 'svelte';

  type Choice = { readonly id: string; readonly label: string };

  const { choices, initial }: { choices: readonly Choice[]; initial: string } = $props();

  let picked = $state(untrack(() => initial));
</script>

<select aria-label="Picked" data-testid="picked" bind:value={picked}>
  {#each choices as choice (choice.id)}
    <option value={choice.id}>{choice.label}</option>
  {/each}
</select>

<p data-testid="picked-echo">{picked}</p>
