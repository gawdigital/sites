<script lang="ts">
  import { page } from '$app/state';

  import Support from '#lib/pages/Support.svelte';
  import type { FormState } from '@gaw/contact/states.ts';
</script>

<Support state={page.params.state as FormState} />
