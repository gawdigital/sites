<script lang="ts">
  // The offer's card, on every page but the contact one. Until the vouchers exist (issue #29) it leads to the contact.
  import { localeOf, pathOf } from '@gaw/i18n/locale.ts';
  import { page } from '$app/state';

  import sale from './art/sale.webp';
  import Card from './Card.svelte';
  import { get } from './translations/index.ts';

  let { order }: { order: number } = $props();

  const { t } = get();
</script>

<Card image={sale} square {order}>
  <h2>{t('common.sale_title')}</h2>
  <a class="btn" href={pathOf('/contact', localeOf(page.url.pathname))}>{t('common.sale_action')}</a>
</Card>
