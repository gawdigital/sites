<script lang="ts">
  import { MOON, SUN } from './icons.ts';

  let { label }: { label: string } = $props();
</script>

<button class="theme" type="button" aria-label={label}>{@html SUN}{@html MOON}</button>
