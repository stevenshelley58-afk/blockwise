import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ActivityTimeline } from "../src/components/leads/activity-timeline.tsx";
import { ContextPanel } from "../src/components/leads/context-panel.tsx";
import { LeadWorkspace } from "../src/components/leads/lead-workspace.tsx";
import {
  DeliveryChip,
  DuplicateChip,
  ErrorCard,
  EmptyState,
  ListSkeleton,
  QualityChip,
  ReadOnlyBanner,
  StageChip,
} from "../src/components/leads/states.tsx";
import type { LeadActivity } from "../src/components/leads/types.ts";

const TIME_ZONE = "UTC";

test("the lead workspace exposes four views, a loading state and its filters", () => {
  const html = renderToStaticMarkup(
    createElement(LeadWorkspace, {
      workspaceId: "workspace-test",
      canSeeUnassigned: true,
      initialLeadId: null,
      initialView: "action",
      timeZone: TIME_ZONE,
    }),
  );

  for (const view of ["Needs action", "All leads", "Pipeline", "Tasks"]) {
    assert.ok(html.includes(">" + view + "<"), "every view must be reachable: missing " + view);
  }
  assert.match(html, /role="tab"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /Mine/);
  assert.match(html, /Unassigned/);
  assert.match(html, /Follow-up due/);
  // The first paint is a real loading state, not an empty claim.
  assert.match(html, /animate-pulse/);
  assert.doesNotMatch(html, /No enquiries match/);
  // No customer Inbox or Email-flows destination is added anywhere.
  assert.doesNotMatch(html, /Inbox<\/a>/);
  assert.doesNotMatch(html, /href="\/email-flows/);
});

test("stage, quality, duplicate and delivery stay visually and semantically distinct", () => {
  const stage = renderToStaticMarkup(createElement(StageChip, { stage: "New" }));
  assert.match(stage, /border-\(--line-heavy\)/);
  assert.doesNotMatch(stage, /bg-success-soft|bg-warning-soft|bg-error-soft/);
  assert.ok(stage.includes("New"), "the stage shows its own name");
  assert.doesNotMatch(stage, /Possible duplicate/);

  const quality = renderToStaticMarkup(createElement(QualityChip, { quality: "high_intent" }));
  assert.match(quality, /font-mono/);
  assert.ok(quality.includes("High intent"));

  const duplicate = renderToStaticMarkup(createElement(DuplicateChip, null));
  assert.match(duplicate, /bg-warning-soft/);
  assert.ok(duplicate.includes("Possible duplicate"));

  const pending = renderToStaticMarkup(createElement(DeliveryChip, { state: "pending" }));
  assert.match(pending, /bg-warning-soft/);
  assert.ok(pending.includes("Waiting for CRM"));
  assert.doesNotMatch(pending, /Possible duplicate/);
});

test("activity is always presented as agent-reported, never as a delivery metric", () => {
  const activities: LeadActivity[] = [
    {
      name: "act-1",
      eventId: null,
      type: "contact",
      actor: "agent@example.test",
      source: "blockwise",
      occurredAt: "2026-09-06T09:00:00.000Z",
      recordedAt: "2026-09-06T09:00:00.000Z",
      note: "Spoke on the phone.",
    },
  ];

  const html = renderToStaticMarkup(createElement(ActivityTimeline, { activities, timeZone: TIME_ZONE }));
  assert.match(html, /Reported by agent@example.test at 6 Sept 2026, 9:00 am/);
  assert.match(html, /Contact reported/);
  assert.match(html, /Spoke on the phone\./);
  assert.doesNotMatch(html, /[Dd]elivered/);
  assert.doesNotMatch(html, /[Oo]pen rate/);
  assert.doesNotMatch(html, /[Bb]ounce/);

  const empty = renderToStaticMarkup(createElement(ActivityTimeline, { activities: [], timeZone: TIME_ZONE }));
  assert.match(empty, /No reported activity yet\./);
});

test("empty, error and read-only states each say what to do next", () => {
  const empty = renderToStaticMarkup(
    createElement(EmptyState, { title: "Nothing needs action", body: "When an enquiry needs a call, it shows up here." }),
  );
  assert.match(empty, /border-dashed/);
  assert.match(empty, /Nothing needs action/);

  const error = renderToStaticMarkup(
    createElement(ErrorCard, {
      title: "Someone changed this enquiry first",
      body: "Your change was not saved.",
      onRetry: () => undefined,
    }),
  );
  assert.match(error, /role="alert"/);
  assert.match(error, /bg-error-soft/);
  assert.match(error, /Try again/);

  // A blocker with nothing to retry gets no dead control.
  const blocker = renderToStaticMarkup(
    createElement(ErrorCard, { title: "The CRM is not responding", body: "Editing is disabled." }),
  );
  assert.doesNotMatch(blocker, /<button/);

  const readOnly = renderToStaticMarkup(
    createElement(ReadOnlyBanner, { title: "Read-only", body: "Editing is disabled until the CRM answers again." }),
  );
  assert.match(readOnly, /role="status"/);
  assert.match(readOnly, /Read-only/);

  const skeleton = renderToStaticMarkup(createElement(ListSkeleton, { rows: 2 }));
  assert.match(skeleton, /animate-pulse/);
});

test("the context panel keeps a visible close control at every width", () => {
  const html = renderToStaticMarkup(
    createElement(
      ContextPanel,
      {
        open: true,
        onClose: () => undefined,
        title: "Avery Example",
        subtitle: "Fremantle",
        label: "Enquiry detail",
      },
      createElement("p", null, "detail"),
    ),
  );

  assert.match(html, /role="region"/);
  assert.match(html, /aria-label="Enquiry detail"/);
  assert.match(html, /aria-label="Close"/);
  assert.ok(html.includes("Back"), "a phone gets a Back label");
  assert.match(html, /Avery Example/);
  assert.match(html, /xl:sticky/);
});
