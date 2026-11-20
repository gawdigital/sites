<script lang="ts">
  // The message: a field that grows with the card instead of being resized.
  let {
    label,
    name,
    rows = 6,
    maxlength,
    required = true,
    status,
  }: {
    label: string;
    name: string;
    rows?: number;
    maxlength?: number;
    required?: boolean;
    /** "Required, not filled in yet." in the page's language. */
    status: string;
  } = $props();
</script>

<label class={['fld fbox', required && 'req', 'msg']}><span class="lb">{label}</span><textarea {name} {rows} {required} {maxlength} aria-describedby={required ? `st-${name}` : undefined}></textarea>{#if required}<span class="dot" aria-hidden="true"></span><span class="sr" id="st-{name}">{status}</span>{/if}</label>
