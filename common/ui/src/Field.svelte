<script lang="ts">
  // A one-line field, its label inside. Only a required field has the indicator dot; `status` is what a screen
  // reader hears of it at rest, and the fields script keeps both current.
  let {
    label,
    name,
    type = 'text',
    required = true,
    status,
    autocomplete,
    pattern,
    title,
  }: {
    label: string;
    name: string;
    type?: 'text' | 'email' | 'tel' | 'url' | 'date';
    required?: boolean;
    /** "Required, not filled in yet." in the page's language. */
    status: string;
    autocomplete?: AutoFill;
    pattern?: string;
    /** What the pattern asks for, e.g. `name@example.com`. */
    title?: string;
  } = $props();
</script>

<label class={['fld fbox', required && 'req']}><span class="lb">{label}</span><input {type} {name} {required} {autocomplete} aria-describedby={required ? `st-${name}` : undefined} {pattern} {title}>{#if required}<span class="dot" aria-hidden="true"></span><span class="sr" id="st-{name}">{status}</span>{/if}</label>
