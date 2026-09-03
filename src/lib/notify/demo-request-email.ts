import { redactString } from "@/lib/redact";
import {
  parseEmailRecipients,
  sendOperatorEmail,
} from "@/lib/operator/email-service";

export type DemoRequestNotification = {
  name: string;
  email: string;
  agency?: string | null;
  phone?: string | null;
  suburb?: string | null;
  message?: string | null;
  demoRequestId?: string;
};

export type AuditCampaignPlan = DemoRequestNotification & {
  goal?: string | null;
  detectedAds?: number;
  activeAds?: number;
  advertisers?: number;
  topPlatform?: string | null;
  topFormat?: string | null;
  topAngles?: string | null;
  reportUrl: string;
  demoRequestId?: string;
};

export type EmailDeliveryResult = {
  sent: boolean;
  queued: boolean;
  messageId: string | null;
  error: string | null;
};

export async function sendDemoRequestNotification(
  lead: DemoRequestNotification,
): Promise<EmailDeliveryResult> {
  const recipients = parseEmailRecipients(
    process.env.DEMO_NOTIFY_TO || process.env.ALERT_EMAIL_TO || "",
  );
  if (recipients.length === 0) {
    return { sent: false, queued: false, messageId: null, error: "Operator email notification has no recipient." };
  }

  const lines = [
    `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    lead.agency ? `Agency: ${lead.agency}` : null,
    lead.phone ? `Phone: ${lead.phone}` : null,
    lead.suburb ? `Suburb: ${lead.suburb}` : null,
    lead.message ? `Message: ${lead.message}` : null,
  ].filter((line): line is string => Boolean(line));

  try {
    const result = await sendOperatorEmail({
      to: recipients,
      subject: `New demo request — ${lead.name}${lead.suburb ? ` (${lead.suburb})` : ""}`,
      text: lines.join("\n"),
      replyTo: lead.email,
      deliveryProjection: lead.demoRequestId ? { kind: "demo_request_operator", id: lead.demoRequestId } : undefined,
    });
    return { sent: false, queued: true, messageId: result.id, error: null };
  } catch (error) {
    return { sent: false, queued: false, messageId: null, error: deliveryError(error) };
  }
}

export async function sendAuditCampaignPlanEmail(
  lead: AuditCampaignPlan,
): Promise<EmailDeliveryResult> {
  const place = lead.suburb?.trim() || "local";
  const goal = campaignGoalLabel(lead.goal);
  const snapshot = [
    lead.detectedAds != null ? `${lead.detectedAds} ads detected` : null,
    lead.activeAds != null ? `${lead.activeAds} active` : null,
    lead.advertisers != null ? `${lead.advertisers} advertisers` : null,
  ].filter((part): part is string => Boolean(part)).join(" · ");
  const creativeDirection = [lead.topAngles, lead.topFormat, lead.topPlatform]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  const text = [
    `Your ${place} campaign plan`,
    "",
    `Goal: ${goal}`,
    snapshot ? `Observed market: ${snapshot}` : null,
    creativeDirection ? `Observed creative direction: ${creativeDirection}` : null,
    "",
    "Recommended first campaign",
    `Run one ${goal.toLowerCase()} campaign with a finished Feed and Story ad, a short Meta lead form, and one clear call to action. Start with a bounded local budget, review the claims and brand details, then publish from your own Meta ad account.`,
    "",
    "Launch checklist",
    "1. Confirm the offer, audience and location.",
    "2. Review both Feed and Story artwork.",
    "3. Connect the correct Meta ad account and Page.",
    "4. Confirm budget, schedule and lead-form questions.",
    "5. Approve the final campaign before it goes live.",
    "",
    `Open the live market report: ${lead.reportUrl}`,
    "",
    "You requested this one-off plan from Blockwise. Reply to this email if you want help setting it up.",
  ].filter((line): line is string => line !== null);

  try {
    const result = await sendOperatorEmail({
      to: [lead.email],
      subject: `Your ${place} campaign plan`,
      text: text.join("\n"),
      deliveryProjection: lead.demoRequestId ? { kind: "demo_request_customer", id: lead.demoRequestId } : undefined,
    });
    return { sent: false, queued: true, messageId: result.id, error: null };
  } catch (error) {
    return { sent: false, queued: false, messageId: null, error: deliveryError(error) };
  }
}

function campaignGoalLabel(goal: string | null | undefined): string {
  if (goal === "vendor_leads") return "Vendor leads";
  if (goal === "buyer_leads") return "Buyer leads";
  if (goal === "listing_promotion") return "Listing promotion";
  if (goal === "market_update") return "Market update";
  return "Local lead generation";
}

function deliveryError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Email delivery failed.";
  return redactString(message).slice(0, 500);
}
