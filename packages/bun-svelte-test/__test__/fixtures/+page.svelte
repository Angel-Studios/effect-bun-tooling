<script lang="ts">
  import { page } from '$app/state';
</script>

<span data-testid="pathname">{page.url.pathname}</span>
<span data-testid="route-id">{page.route.id ?? 'no-route'}</span>
<span data-testid="flavour">{String(page.data['flavour'] ?? 'none')}</span>
<span data-testid="status">{page.status}</span>
