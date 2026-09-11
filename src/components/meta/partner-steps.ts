/**
 * Meta partner access: one source for the four real Meta screens a customer
 * follows to share assets with the Blockwise Business Portfolio.
 *
 * The connect screen shows the four titles in order and links out to Meta.
 * Help carries the screenshots, the tips and the edge cases, so the connect
 * screen stays a checklist instead of a manual.
 */

export type MetaPartnerStep = {
  /** Short instruction for the connect screen. */
  title: string;
  /** Where to look in Meta, shown under the title. */
  where: string;
  /** The full walkthrough for the Help topic. */
  detail: readonly string[];
  /** Extras that only earn their place in Help. */
  tips: readonly string[];
  image: string;
  fullImage?: string;
  fullWidth?: number;
  fullHeight?: number;
  width: number;
  height: number;
  alt: string;
};

export const META_PARTNERS_URL =
  "https://business.facebook.com/settings/partners";

export const META_PARTNER_STEPS: readonly MetaPartnerStep[] = [
  {
    title: "Open Partners",
    where: "Meta Business Settings, under Users",
    detail: [
      "Open Meta Business Settings and choose Users, then Partners.",
      "If Partners is missing, your Meta Business Portfolio owner has to give you access first.",
    ],
    tips: ["Only a Business Portfolio admin can share assets with a partner."],
    image: "/help/meta/partner-access/01-partners.webp",
    width: 378,
    height: 580,
    alt: "Meta Business Settings with Partners selected under Users",
  },
  {
    title: "Give Blockwise access",
    where: "Add, then Give a partner access to your assets",
    detail: [
      "Choose Add, then Give a partner access to your assets.",
      "Do not choose Ask a partner to assign you their assets. That is the other direction.",
    ],
    tips: [],
    image: "/help/meta/partner-access/02-give-access-crop.webp",
    fullImage: "/help/meta/partner-access/02-give-access.webp",
    fullWidth: 1831,
    fullHeight: 237,
    width: 541,
    height: 237,
    alt: "Meta Partners screen with Give a partner access to your assets selected",
  },
  {
    title: "Paste the Blockwise Business ID",
    where: "Partner business ID field, then Next",
    detail: [
      "Copy the Blockwise Business ID and paste it into the Partner business ID field.",
      "The ID only names Blockwise. It grants nothing until you choose assets on the next screen.",
    ],
    tips: [],
    image: "/help/meta/partner-access/03-business-id.webp",
    width: 598,
    height: 306,
    alt: "Meta Add a new partner dialog with the Partner business ID field",
  },
  {
    title: "Choose assets and permissions",
    where: "Your Page, ad account and optional Instagram account",
    detail: [
      "Select your Facebook Page and ad account. Add your linked Instagram professional account if ads should use it.",
      "Assign the assets only when the selection is right.",
    ],
    tips: [
      "For the ad account, turn on both partial-access permissions: Manage campaigns to create and edit ads, and View performance to see reports. Leave Full control off.",
      "Blockwise cannot publish anything until this step is saved in Meta.",
      "You can remove Blockwise from Partners at any time.",
    ],
    image: "/help/meta/partner-access/04-assets-and-permissions.webp",
    width: 670,
    height: 520,
    alt: "Meta Assign assets and permissions screen showing ad account partial-access controls",
  },
] as const;
