<script lang="ts">
  
  
  
  
  export let name: string = 'world';

  $: shouted = `${name}!`.toUpperCase();
</script>

<p data-testid="greeting">hello {shouted}</p>
