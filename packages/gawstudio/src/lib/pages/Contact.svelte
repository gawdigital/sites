<script lang="ts">
  import { GROUP } from '@gaw/company/brands.ts';
  import { COMPANY } from '@gaw/company/company.ts';

  import sale from '#lib/art/sale.webp';
  import Card from '#lib/Card.svelte';
  import MapCard from '#lib/MapCard.svelte';
  import Shell from '#lib/Shell.svelte';
  import { get } from '#lib/translations/index.ts';

  const { t } = get();
  const external = $derived(t('common.opens_in_a_new_tab'));
</script>

<Shell name="contact" title={t('contact.page_title')} claim={t('contact.claim')}>
  {#snippet left()}
    <MapCard order={1} />
    <Card image={sale} square order={3}>
      <h2>{t('contact.billing')}</h2>
      <!-- The company's details are shared data (`@gaw/company`); only their labels are this page's copy. -->
      <p>{COMPANY.name}<br />{t('contact.vat', { dic: COMPANY.dic })}<br />{COMPANY.street}<br />{COMPANY.city}<br />{t('common.country')}</p>
    </Card>
  {/snippet}
  {#snippet right()}
    <!-- The studio's own form comes later (issue #29); the group's form has a topic for the studio. -->
    <Card order={2}>
      <h2>{t('contact.write')}</h2>
      <p>{t('contact.write_text')}</p>
      <a class="btn" href="{GROUP.url}/contact?topic=studio" target="_blank" rel="noopener">{t('common.lets_start')}<span class="sr"> {external}</span></a>
    </Card>
  {/snippet}
</Shell>
