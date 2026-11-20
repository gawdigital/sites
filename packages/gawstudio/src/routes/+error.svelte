<script lang="ts">
  import { page } from '$app/state';
  import { localeOf, pathOf } from '@gaw/i18n/locale.ts';

  import Card from '#lib/Card.svelte';
  import Shell from '#lib/Shell.svelte';
  import { get } from '#lib/translations/index.ts';

  // The error page renders without any page `load`, so its strings are base translations, in the failing
  // address's own language.
  const { t } = get();
  const missing = $derived(page.status === 404);
</script>

<Shell name="error" title={t(missing ? 'error.page_title' : 'error.page_title_other')} claim={t(missing ? 'error.title_404' : 'error.title')}>
  {#snippet left()}
    <Card square>
      <span class="tag">{t('error.kicker', { status: page.status })}</span>
      <p>{t(missing ? 'error.text_404' : 'error.text')}</p>
      <a class="btn" href={pathOf('/', localeOf(page.url.pathname))}>{t('error.home')}</a>
    </Card>
  {/snippet}
  {#snippet right()}{/snippet}
</Shell>
