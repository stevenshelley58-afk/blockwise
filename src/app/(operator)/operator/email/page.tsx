import { EmailConsole } from "@/components/operator/email-console";
import { PageHeading } from "@/components/page-heading";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { getOperatorMailboxConfig, listOperatorEmails, type OperatorEmailSummary } from "@/lib/operator/email-service";

export const dynamic = "force-dynamic";

export default async function OperatorEmailPage() {
  await requirePageSurfaceAccess("operator");

  const config = getOperatorMailboxConfig();
  let messages: OperatorEmailSummary[] = [];
  let error: string | null = null;

  try {
    const inbox = await listOperatorEmails({ limit: 100 });
    messages = inbox.messages;
  } catch (err) {
    error = err instanceof Error ? err.message : "Unable to load operator mailbox.";
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
      />
    </main>
  );
}
