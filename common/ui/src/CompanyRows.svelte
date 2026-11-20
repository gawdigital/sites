<script lang="ts">
  // The company's registered details as the rows of a card's list: the seat, the IDs, the register entry and the
  // bank account, with copy buttons beside the values people paste. The details are data (`@gaw/company`), the same
  // on every site; the labels are the page's copy. A page puts its own rows before or after these.
  import CopyButton from './CopyButton.svelte';

  interface Company {
    ico: string;
    dic: string;
    account: string;
    bank: string;
    iban: string;
    bic: string;
  }

  /** A value with a copy button: its label, what the live note calls it, and the button's accessible name. */
  interface Copied {
    label: string;
    what: string;
    copy: string;
  }

  let {
    company,
    seat,
    iban,
    labels,
  }: {
    company: Company;
    /** The seat as HTML, a line each. */
    seat: string;
    /** The IBAN as it is printed, in groups of four. */
    iban: string;
    labels: {
      address: string;
      ico: Copied;
      dic: Copied;
      register: string;
      /** The register entry's sentence. */
      registered: string;
      account: string;
      iban: Copied;
      bic: string;
      /** The copy buttons' text. */
      copy: string;
    };
  } = $props();
</script>

<div class="crow"><dt class="lb">{labels.address}</dt><dd>{@html seat}</dd></div><div class="crow"><dt class="lb">{labels.ico.label}</dt><dd>{company.ico}</dd><CopyButton value={company.ico} what={labels.ico.what} label={labels.ico.copy}>{labels.copy}</CopyButton></div><div class="crow"><dt class="lb">{labels.dic.label}</dt><dd>{company.dic}</dd><CopyButton value={company.dic} what={labels.dic.what} label={labels.dic.copy}>{labels.copy}</CopyButton></div><div class="crow"><dt class="lb">{labels.register}</dt><dd>{labels.registered}</dd></div><div class="crow"><dt class="lb">{labels.account}</dt><dd>{company.account} <small>{company.bank}</small></dd></div><div class="crow"><dt class="lb">{labels.iban.label}</dt><dd class="nw">{iban}</dd><CopyButton value={company.iban} what={labels.iban.what} label={labels.iban.copy}>{labels.copy}</CopyButton></div><div class="crow"><dt class="lb">{labels.bic}</dt><dd>{company.bic}</dd></div>
