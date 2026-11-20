<script lang="ts">
  // A service's page: its card with the way to book, the sound sample, how it works and the offer. Recording adds
  // the studio's card on top of the right column.
  import { localeOf, pathOf } from '@gaw/i18n/locale.ts';
  import { page } from '$app/state';

  import play from './art/play.svg?raw';
  import Card from './Card.svelte';
  import Sale from './Sale.svelte';
  import Shell from './Shell.svelte';
  import { get } from './translations/index.ts';

  const STEPS = [1, 2, 3] as const;

  type Service = 'recording' | 'mix' | 'mastering';

  let {
    name,
    images,
    studio,
  }: { name: Service; images: { main: string; sample: string; how: string }; studio?: string } = $props();

  const { t } = get();
  // Recording is booked, the online services are ordered.
  const action = $derived(t(name === 'recording' ? 'common.book_now' : 'common.order_now'));
  const contact = $derived(pathOf('/contact', localeOf(page.url.pathname)));
</script>

{#snippet main()}
  <Card image={images.main} eager order={1}>
    {#if name !== 'recording'}<span class="tag">{t('common.online')}</span>{/if}
    <h2>{t(`common.${name}`)}</h2>
    <p>{t(`common.${name}_text`)}</p>
    <!-- Booking and ordering come next (issue #29); until then the way in is the contact page. -->
    <a class="btn" href={contact}>{action}</a>
  </Card>
{/snippet}

{#snippet sample()}
  <Card image={images.sample} square order={3}>
    <p>{t(`${name}.sample_text`)}</p>
    <!-- The before/after player is only drawn until there are samples to play. -->
    <div class="audio" role="img" aria-label={t('common.sample')}>
      <span class="toggle"><i></i>{t('common.processed')}</span>
      <span class="player">{@html play}</span>
    </div>
  </Card>
{/snippet}

{#snippet how()}
  <Card image={images.how} order={4}>
    <h2>{t('common.how_it_works')}</h2>
    <ol class="steps">{#each STEPS as step (step)}<li>{t(`${name}.step_${step}`)}</li>{/each}</ol>
    <a class="btn" href={contact}>{t('common.lets_start')}</a>
  </Card>
{/snippet}

<Shell {name} title={t(`${name}.page_title`)} claim={t(`${name}.claim`)} {action}>
  {#snippet left()}
    {@render main()}
    {#if studio}{@render sample()}{/if}
    <Sale order={5} />
  {/snippet}
  {#snippet right()}
    {#if studio}
      <Card image={studio} eager order={2}>
        <h2>{t('recording.the_studio')}</h2>
        <p>{t('recording.studio_text')}</p>
        <a class="btn" href={contact}>{t('common.show_more')}<span class="sr"> – {t('recording.the_studio')}</span></a>
      </Card>
    {:else}
      {@render sample()}
    {/if}
    {@render how()}
  {/snippet}
</Shell>
