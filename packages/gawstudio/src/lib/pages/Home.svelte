<script lang="ts">
  import { localeOf, pathOf } from '@gaw/i18n/locale.ts';
  import { page } from '$app/state';

  import hatch from '#lib/art/hatch.svg?raw';
  import mastering from '#lib/art/mastering.webp';
  import mix from '#lib/art/mix.webp';
  import recording from '#lib/art/recording.webp';
  import Card from '#lib/Card.svelte';
  import Sale from '#lib/Sale.svelte';
  import Shell from '#lib/Shell.svelte';
  import { get } from '#lib/translations/index.ts';

  const { t } = get();
  const locale = $derived(localeOf(page.url.pathname));
</script>

<Shell name="home" title={t('home.page_title')} claim={t('home.claim')}>
  {#snippet left()}
    <Card image={recording} eager order={1}>
      <h2>{t('common.recording')}</h2>
      <p>{t('common.recording_text')}</p>
      <a class="btn" href={pathOf('/recording', locale)}>{t('common.show_more')}<span class="sr"> – {t('common.recording')}</span></a>
    </Card>
    <Card image={mastering} order={3}>
      <span class="tag">{t('common.online')}</span>
      <h2>{t('common.mastering')}</h2>
      <p>{t('common.mastering_text')}</p>
      <a class="btn" href={pathOf('/mastering', locale)}>{t('common.show_more')}<span class="sr"> – {t('common.mastering')}</span></a>
    </Card>
    <div class="hatch" aria-hidden="true">{@html hatch}</div>
  {/snippet}
  {#snippet right()}
    <Card image={mix} eager order={2}>
      <span class="tag">{t('common.online')}</span>
      <h2>{t('common.mix')}</h2>
      <p>{t('common.mix_text')}</p>
      <a class="btn" href={pathOf('/mix', locale)}>{t('common.show_more')}<span class="sr"> – {t('common.mix')}</span></a>
    </Card>
    <Sale order={4} />
  {/snippet}
</Shell>
