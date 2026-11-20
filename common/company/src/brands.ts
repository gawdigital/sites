// The group's brands, once for every site: the name and where it lives. A brand's one-line description is copy, so
// it is in the translation files of the site that shows it, under the brand's id.

export interface Brand {
  id: string;
  name: string;
  /** The domain as it is shown. */
  domain: string;
  /** Its address. */
  url: string;
}

export const GROUP = { id: 'group', name: 'G.A.W.Group', domain: 'gawgroup.cz', url: 'https://gawgroup.cz' } as const satisfies Brand;

/** The brands the group presents, in the order they are shown. */
export const BRANDS = [
  { id: 'digital', name: 'G.A.W.Digital', domain: 'gawdigital.cz', url: 'https://gawdigital.cz' },
  { id: 'studio', name: 'G.A.W.Studio', domain: 'gawstudio.cz', url: 'https://gawstudio.cz' },
] as const satisfies readonly Brand[];

export type BrandId = (typeof BRANDS)[number]['id'];
