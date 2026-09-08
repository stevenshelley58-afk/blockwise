export type EmailSection = {
  layout?: "list-item";
  heading?: string;
  body?: string;
  bullets?: readonly string[];
  link?: { label: string; href: string };
};
export type EmailChart = {
  kind: "bars";
  title: string;
  unit: string;
  values: ReadonlyArray<{ label: string; value: number }>;
};
export type EmailAdPreview = {
  src: string;
  alt: string;
  label: string;
  detail?: string;
  width?: number;
  height?: number;
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
  leadContact?: { phone: string; email: string; firstName: string; received: string; source: string; campaign: string };
  summary?: { label: string; value: string; caption?: string; metrics: ReadonlyArray<{ label: string; value: string }> };
  visual?: { chart?: EmailChart; adPreviews?: ReadonlyArray<EmailAdPreview> };
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
