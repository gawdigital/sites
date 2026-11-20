<script lang="ts">
  // How a service works, in three steps. On the service's page it ends with the way to its form.
  import Card from './Card.svelte';
  import type { Service } from './site.ts';
  import { get } from './translations/index.ts';

  const STEPS = [1, 2, 3] as const;

  let { name, image, order, href }: { name: Service; image: string; order: number; href?: string } = $props();

  const { t } = get();
</script>

<Card {image} eager={!href} {order}>
  <h2>{t('common.how_it_works')}</h2>
  <ol class="steps">{#each STEPS as step (step)}<li>{t(`${name}.step_${step}`)}</li>{/each}</ol>
  {#if href}<a class="btn" {href}>{t('common.lets_start')}</a>{/if}
</Card>
