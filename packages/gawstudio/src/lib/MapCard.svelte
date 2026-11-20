<script lang="ts">
  // Where the studio is: the map's card, on the contact page and beside the booking form.
  import map from './art/map.webp';
  import Card from './Card.svelte';
  import { STUDIO } from './site.ts';
  import { get } from './translations/index.ts';

  let { order }: { order: number } = $props();

  const { t } = get();
</script>

<Card image={map} eager {order}>
  <h2>{t('common.where')}</h2>
  <p>{STUDIO.street}<br />{STUDIO.city}<br />{t('common.country')}</p>
  <a class="btn" href={STUDIO.map} target="_blank" rel="noopener">{t('common.view_map')}<span class="sr"> {t('common.opens_in_a_new_tab')}</span></a>
</Card>
