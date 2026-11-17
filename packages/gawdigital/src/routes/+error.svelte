<script lang="ts">
  import { page } from '$app/state';
  import { localeOf, pathOf } from '@gaw/i18n/locale.ts';

  import Shell from '#lib/Shell.svelte';
  import { get } from '#lib/translations/index.ts';

  // The error page renders without any page `load`, so its strings are base translations, in the failing
  // address's own language.
  const { t } = get();
  const missing = $derived(page.status === 404);
</script>

<Shell name="error" title={t(missing ? 'error.page_title' : 'error.page_title_other')} noindex>
  <section class="shead epage">
    <div class="kicker">{t('error.kicker', { status: page.status })}</div>
    <h1>{t(missing ? 'error.title_404' : 'error.title')}</h1>
    <p class="lead">{t(missing ? 'error.text_404' : 'error.text')}</p>
    <div class="row"><a class="btn" href={pathOf('/', localeOf(page.url.pathname))}>{t('error.home')}</a></div>
  </section>
</Shell>
