import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  URGENCY_LABELS,
  classifyUrgency,
  hoursUnclaimed,
  loadFulfilmentQueue,
  type QueueOrder,
} from "@/lib/adbuilder/video-fulfilment";
import { FULFILMENT_LABELS } from "@/lib/adbuilder/video-types";
import { VideoQueue } from "@/components/operator/video-queue";

export const dynamic = "force-dynamic";

/**
 * The video fulfilment queue.
 *
 * Operator-only, and only paid orders appear: unpaid work is not work yet, and
 * listing it would invite an editor to start on something that may never be
 * bought. The due date shown is the commitment already made to the customer,
 * never a value recomputed for this screen.
 */
export default async function OperatorVideoQueuePage() {
  const { access } = await requirePageSurfaceAccess("operator");
  if (!access.isOperator) {
    return (
      <main className="grid min-h-[50vh] place-items-center">
        <p className="text-sm text-(--muted-foreground)">Not found.</p>
      </main>
    );
  }

  const service = createSupabaseServiceClient();
  const now = new Date();

  let orders: QueueOrder[] = [];
  let loadError = false;
  try {
    orders = await loadFulfilmentQueue(service, {});
  } catch {
    loadError = true;
  }

  // Urgency and waiting time are derived for display; the deadline itself is
  // never recalculated here.
  const rows = orders.map((order) => ({
    ...order,
    urgency: classifyUrgency({
      fulfilmentState: order.fulfilmentState,
      firstDraftDueAt: order.firstDraftDueAt,
      claimedAt: order.claimedAt,
      now,
    }),
    stateLabel: FULFILMENT_LABELS[order.fulfilmentState] ?? order.fulfilmentState,
    unclaimedHours: hoursUnclaimed({ claimedAt: order.claimedAt, createdAt: order.createdAt, now }),
  }));

  return (
    <main className="grid gap-6 p-4 md:p-6">
      <header className="grid gap-1">
        <h1 className="font-display text-xl font-extrabold tracking-tight">Video orders</h1>
        <p className="text-sm text-(--muted-foreground)">
          Paid orders awaiting an editor, soonest deadline first.
        </p>
      </header>

      {loadError ? (
        <p role="alert" className="text-sm text-(--destructive)">
          The queue could not be loaded. Nothing has been lost.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-(--muted-foreground)">No paid video orders are waiting.</p>
      ) : (
        <VideoQueue
          orders={rows.map((row) => ({
            ...row,
            urgencyLabel: URGENCY_LABELS[row.urgency],
          }))}
        />
      )}
    </main>
  );
}
