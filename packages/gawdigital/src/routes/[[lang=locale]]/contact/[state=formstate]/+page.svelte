<script lang="ts">
  import { page } from '$app/state';

  import Contact from '#lib/pages/Contact.svelte';
  import type { FormState } from '#lib/forms.ts';
</script>

<Contact state={page.params.state as FormState} />
