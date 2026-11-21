<script lang="ts">
  // The web projects: the two open-source ones we maintain and the partner site we design and build with others. Each
  // card shows the project in a small picture drawn in HTML (code, or the site's feed), what it is, and the way out to
  // its own site. The code in the pictures is the projects' own syntax, not copy, so it is not translated.
  import Divider from '@gaw/ui/Divider.svelte';
  import { EXT } from '@gaw/ui/icons.ts';

  import Shell from '#lib/Shell.svelte';
  import { get } from '#lib/translations/index.ts';

  const { t } = get();

  /** The Curly Message Format's parsers, one per language, each on its language's registry. */
  const PARSERS = [
    ['JavaScript', 'npm'],
    ['Python', 'PyPI'],
    ['Go', 'Go modules'],
    ['PHP', 'Packagist'],
    ['Rust', 'crates.io'],
  ] as const;
</script>

{#snippet visit(url: string, domain: string, name: string)}
  <div class="row"><span class="burl">{domain}</span><a class="btn" href={url} target="_blank" rel="noopener" aria-label={t('web.visit_name', { name })}>{t('web.visit')}<span class="arr ext" aria-hidden="true">{@html EXT}</span></a></div>
{/snippet}

<Shell name="web" title={t('web.page_title')}>

  <section class="shead">
    <div class="kicker">{t('common.g_a_w_digital')}</div>
    <h1>{t('web.web')}</h1>
    <p class="lead">{t('web.lead')}</p>
  </section>

  <Divider title={t('web.open_source')} index="01" />
  <section class="wgrid">
    <article class="card proj i18n">
      <div class="scene"><div class="code" aria-hidden="true">
        <div class="bar"><i></i><i></i><i></i><span>+page.svelte</span></div>
        <pre><span class="k">&lt;script&gt;</span>
  <span class="k">import</span> {'{'} get {'}'} <span class="k">from</span> <span class="s">'$lib/translations'</span>;
  <span class="k">const</span> {'{'} t {'}'} = get();
<span class="k">&lt;/script&gt;</span>

<span class="k">&lt;h1&gt;</span>{'{'}<span class="f">t</span>(<span class="s">'home.title'</span>, {'{'} name {'}'}){'}'}<span class="k">&lt;/h1&gt;</span></pre>
        <div class="out"><span class="c">$</span> npx sv add @sveltekit-i18n</div>
      </div></div><div class="fade"></div>
      <div class="content">
        <div class="tags"><span class="tag hl">{t('web.open_source_tag')}</span><span class="tag soft">SvelteKit</span></div>
        <h2>sveltekit-i18n</h2>
        <p>{t('web.i18n_text')}</p>
        <ul class="facts"><li>{t('web.i18n_runes')}</li><li>{t('web.i18n_typed')}</li><li>{t('web.i18n_loaders')}</li></ul>
        {@render visit('https://sveltekit-i18n.github.io', 'sveltekit-i18n.github.io', 'sveltekit-i18n')}
      </div>
    </article>
    <article class="card proj curly">
      <div class="scene"><div class="code" aria-hidden="true">
        <div class="bar"><i></i><i></i><i></i><span>en.json</span></div>
        <pre><span class="p">"inbox"</span>: <span class="s">"You have <b>{'{{'}count:number;{'}}'}</b> <b>{'{{'}count:plural; one:message; other:messages;{'}}'}</b>."</span></pre>
        <div class="out"><span class="c">{'{'} count: 1234 {'}'} →</span> You have 1,234 messages.</div>
      </div></div><div class="fade"></div>
      <div class="content">
        <div class="tags"><span class="tag hl">{t('web.open_source_tag')}</span><span class="tag soft">{t('web.specification')}</span></div>
        <h2>Curly Message Format</h2>
        <p>{t('web.curly_text')}</p>
        <h3 class="lb">{t('web.parsers')}</h3>
        <ul class="parsers">{#each PARSERS as [language, registry] (language)}<li><b>{language}</b><small>{registry}</small></li>{/each}</ul>
        {@render visit('https://curlymessage.dev', 'curlymessage.dev', 'Curly Message Format')}
      </div>
    </article>
  </section>

  <Divider title={t('web.partner_projects')} index="02" />
  <article class="card proj cesta">
    <div class="scene"></div><div class="fade"></div>
    <div class="content">
      <span class="tag">{t('web.partner_tag')}</span>
      <h2>Cesta.cz</h2>
      <p>{t('web.cesta_text')}</p>
      <ul class="facts"><li>{t('web.cesta_design')}</li><li>{t('web.cesta_development')}</li></ul>
      {@render visit('https://cesta.cz', 'cesta.cz', 'Cesta.cz')}
    </div>
    <div class="feed" aria-hidden="true">
      <div class="fbar"><i class="logo"></i><span class="word">cesta<small>.cz</small></span><i class="pillx"></i></div>
      <div class="fcats"><i class="on"></i><i></i><i></i></div>
      {#each [0, 1, 2] as n (n)}<div class="post"><div class="who"><i class="av"></i><i class="ln1"></i></div><div class="body"><div class="lines"><i></i><i></i><i class="short"></i></div>{#if n !== 1}<i class="img"></i>{/if}</div><div class="acts"><i></i><i></i><i></i></div></div>{/each}
    </div>
  </article>

</Shell>
