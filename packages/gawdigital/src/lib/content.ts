// MIDI Control's FAQ as translation keys: its groups, each with its questions and their answers.

export type FaqKeys = { title: string; items: [question: string, answer: string][] }[];

export const MIDI_FAQ: FaqKeys = [
  {
    title: 'midisupport.getting_started',
    items: [
      ['midisupport.do_i_need_firewire_or', 'midisupport.no_the_app_talks_to'],
      ['midisupport.do_i_have_to_enable', 'midisupport.no_the_units_stand_alone'],
      ['midisupport.which_midi_interface_do_i', 'midisupport.any_usb_midi_interface_with'],
      ['midisupport.which_macs_and_macos_versions', 'midisupport.macos_13_ventura_to_macos'],
      ['midisupport.does_it_support_the_fireface', 'midisupport.the_fireface_800_is_supported'],
    ],
  },
  {
    title: 'midisupport.using_the_app',
    items: [
      ['midisupport.why_cant_i_find_eq', 'midisupport.the_fireface_800s_stand_alone'],
      ['midisupport.why_does_the_app_not', 'midisupport.the_front_panel_sends_nothing'],
      ['midisupport.why_does_the_app_ask', 'midisupport.the_unit_never_reports_phantom'],
      ['midisupport.what_happens_when_i_switch', 'midisupport.the_unit_reloads_its_stored'],
      ['midisupport.can_i_use_more_than', 'midisupport.yes_each_unit_is_a'],
    ],
  },
  {
    title: 'midisupport.trial_purchase',
    items: [
      ['midisupport.how_does_the_trial_work', 'midisupport.download_the_app_from_the'],
      ['midisupport.what_happens_after_the_trial', 'midisupport.the_app_is_a_one'],
      ['midisupport.i_bought_it_on_another', 'midisupport.choose_restore_purchases_in_the'],
    ],
  },
];
