<script lang="ts">
  import { page } from '$app/state';

  import Support from '#lib/pages/Support.svelte';
  import type { FormState } from '#lib/forms.ts';
</script>

<Support state={page.params.state as FormState} />
