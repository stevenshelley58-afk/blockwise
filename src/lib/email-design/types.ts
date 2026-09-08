export type EmailSection = {
  layout?: "list-item";
  heading?: string;
  body?: string;
  bullets?: readonly string[];
  link?: { label: string; href: string };
};
export type EmailMessage = {
  kind: string;
  eyebrow: string;
  subject: string;
  preheader: string;
  greeting: string;
  heading: string;
  intro: string;
  action?: { label: string; href: string };
  oneTimeCode?: string;
  summary?: { label: string; value: string; caption?: string; metrics: ReadonlyArray<{ label: string; value: string }> };
  details?: ReadonlyArray<{ label: string; value: string }>;
  sections?: readonly EmailSection[];
  note?: string;
  signOff?: string;
  transactional: boolean;
  footer?: {
    reason: string;
    businessIdentity: string;
    supportUrl?: string;
    preferencesUrl?: string;
    unsubscribeUrl?: string;
    unsubscribeLabel?: string;
  };
};
