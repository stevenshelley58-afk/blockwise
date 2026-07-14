import { EmailConsole } from "@/components/operator/email-console";
import { PageHeading } from "@/components/page-heading";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import {
  getOperatorMailboxConfig,
  listOperatorEmails,
  normalizeOperatorEmailContacts,
  type OperatorEmailContact,
  type OperatorEmailSummary,
} from "@/lib/operator/email-service";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function OperatorEmailPage() {
  await requirePageSurfaceAccess("operator");

  const config = getOperatorMailboxConfig();
  let messages: OperatorEmailSummary[] = [];
  let error: string | null = null;
  let contacts: OperatorEmailContact[] = [];
  let contactsError: string | null = null;

  const [mailboxResult, contactsResult] = await Promise.allSettled([
    listOperatorEmails({ limit: 100 }),
    createSupabaseServiceClient().from("profiles").select("id,full_name,email").not("email", "is", null).limit(500),
  ]);

  if (mailboxResult.status === "fulfilled") {
    messages = mailboxResult.value.messages;
  } else {
    error = mailboxResult.reason instanceof Error ? mailboxResult.reason.message : "Unable to load operator mailbox.";
  }

  if (contactsResult.status === "fulfilled" && !contactsResult.value.error) {
    contacts = normalizeOperatorEmailContacts(contactsResult.value.data ?? []);
  } else {
    contactsError = "User directory unavailable. You can still enter an email address.";
  }

  return (
    <main className="content">
      <PageHeading
        eyebrow="Internal mail"
        title="Operator Email"
        description="Read and send Blockwise mail for the operator mailbox without leaving the control plane."
      />
      <EmailConsole
        mailbox={config.mailboxLabel}
        replyAddress={config.replyAddress}
        initialMessages={messages}
        initialError={error}
        contacts={contacts}
        contactsError={contactsError}
      />
    </main>
  );
}
