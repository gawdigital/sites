<script lang="ts">
  // The background hatch: placed by the hatch script, seeded by the page's name rather than its address, so a
  // page draws the same hatch in every language.
  let { page }: { page: string } = $props();
</script>

<div class="bgh" aria-hidden="true" data-page={page}></div>
