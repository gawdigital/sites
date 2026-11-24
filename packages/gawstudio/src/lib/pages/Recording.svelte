<script lang="ts">
  import how from '#lib/art/recording-how.webp';
  import sample from '#lib/art/recording-audio.webp';
  import main from '#lib/art/recording.webp';
  import studio from '#lib/art/studio.webp';
  import Service from '#lib/Service.svelte';
</script>

<Service name="recording" images={{ main, sample, how }} {studio} />
