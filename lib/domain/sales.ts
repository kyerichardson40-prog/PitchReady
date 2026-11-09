/**
 * The sales setting of a campaign: where conversations happen, what is being offered, what the
 * other person is called and what a good outcome looks like. Stored in the campaign pack as
 * `sales_context`; packs written before it existed are door-to-door fundraising.
 */
export const SALES_CHANNELS = ['door-to-door', 'phone', 'retail', 'b2b-meeting', 'field', 'events', 'video', 'other'] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

export interface SalesContext {
  channel: SalesChannel;
  /** What the rep offers, in a few words: "an optional monthly donation", "a fibre broadband upgrade". */
  offer: string;
  /** What the rep calls the other person: "resident", "customer", "prospect". Lower case, singular. */
  customer_label: string;
  /** What a good result looks like, e.g. "a booked survey" — never required for good feedback. */
  good_outcome: string;
}

export const CHANNEL_INFO: Record<SalesChannel, { label: string; short: string; scene: string }> = {
  'door-to-door': { label: 'Door-to-door', short: 'On the doorstep', scene: 'The rep has knocked on the customer\'s front door unannounced. The customer is at home, may be busy, and can close the door at any time.' },
  phone: { label: 'Phone and telesales', short: 'On the phone', scene: 'An outbound phone call. There are no visual cues, the customer did not expect the call, and they can hang up at any time.' },
  retail: { label: 'Shop floor and retail', short: 'In store', scene: 'The customer is browsing in a shop or showroom and the rep has approached them. They came in for something specific and can walk away.' },
  'b2b-meeting': { label: 'Business meetings (B2B)', short: 'In a meeting', scene: 'A short meeting with a business decision-maker who agreed to talk but is busy, cares about cost, risk and return, and may need to involve others.' },
  field: { label: 'Field sales and home visits', short: 'On a visit', scene: 'A booked visit to the customer\'s home or premises. They agreed to the appointment but have not decided anything and may have doubts.' },
  events: { label: 'Events, stands and street', short: 'At a stand', scene: 'The rep has stopped the customer at a stand, event or in the street. The customer is passing by, did not plan to stop and can walk on.' },
  video: { label: 'Video calls', short: 'On a video call', scene: 'A scheduled video call. The customer agreed to the call but may be distracted, and can end the call at any time.' },
  other: { label: 'Other', short: 'In conversation', scene: 'A short face-to-face or remote sales conversation.' },
};

/** Packs from before sales settings existed were door-to-door fundraising. */
export const LEGACY_SALES_CONTEXT: SalesContext = {
  channel: 'door-to-door', offer: 'an optional monthly donation', customer_label: 'resident', good_outcome: 'a clear, voluntary decision either way',
};

export function salesContextOf(pack: { sales_context?: Partial<SalesContext> | null } | null | undefined): SalesContext {
  const c = pack?.sales_context;
  if (!c) return LEGACY_SALES_CONTEXT;
  const channel = (SALES_CHANNELS as readonly string[]).includes(c.channel ?? '') ? (c.channel as SalesChannel) : 'other';
  return {
    channel,
    offer: (c.offer ?? '').trim() || 'the offer',
    customer_label: (c.customer_label ?? '').trim().toLowerCase() || 'customer',
    good_outcome: (c.good_outcome ?? '').trim() || 'a clear decision either way',
  };
}

export function capitalise(word: string): string {
  return word ? word[0]!.toUpperCase() + word.slice(1) : word;
}

/** Plain-language description of the setting, passed to the AI as data. */
export function salesSettingForAi(c: SalesContext) {
  return {
    channel: CHANNEL_INFO[c.channel].label,
    scene: CHANNEL_INFO[c.channel].scene,
    offer: c.offer,
    the_other_person_is_called: c.customer_label,
    good_outcome_for_the_rep: c.good_outcome,
  };
}
