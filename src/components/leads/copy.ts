/**
 * Copy for the lead work application.
 *
 * This module is the single place the lead workspace keeps its words so the
 * same screen can be re-labelled for another niche later. It never invents
 * delivery, open or response metrics: every string states what an agent
 * reported or what the system knows.
 */

export const leadsCopy = {
  title: "Leads",
  subtitle: "Work your enquiries, then log what actually happened.",

  views: {
    action: "Needs action",
    all: "All leads",
    pipeline: "Pipeline",
    tasks: "Tasks",
  },

  viewHints: {
    action: "Uncontacted enquiries, overdue follow-ups and unassigned records.",
    all: "Every enquiry in this workspace.",
    pipeline: "Stage by stage. Move a card with its menu.",
    tasks: "Open tasks with their due times.",
  },

  filters: {
    mine: "Mine",
    unassigned: "Unassigned",
    followUpDue: "Follow-up due",
    stage: "Stage",
    source: "Source",
    quality: "Quality",
    anyStage: "Any stage",
    anySource: "Any source",
    anyQuality: "Any quality",
    clear: "Clear filters",
    more: "More filters",
    search: "Search name, email, phone or property",
    exportCsv: "Export CSV",
    exportNote: "Exports the filtered rows below.",
  },

  counts: {
    showing: (shown: number, total: number) => `Showing ${shown} of ${total} filtered enquiries`,
    needsAction: (count: number) => `${count} need action`,
    followUpDue: (count: number) => `${count} follow-up due`,
    waitingForCrm: (count: number) => `${count} waiting for CRM`,
  },

  columns: {
    enquiry: "Enquiry",
    stage: "Stage",
    owner: "Owner",
    next: "Next",
    lastActivity: "Last reported",
  },

  stages: {
    New: "New",
    Contacting: "Contacting",
    Engaged: "Engaged",
    "Appointment booked": "Appointment booked",
    Won: "Won",
    Lost: "Lost",
  },

  quality: {
    high_intent: "High intent",
    valid: "Valid",
    invalid: "Invalid",
    Unlabelled: "Not labelled",
  },

  delivery: {
    pending: "Waiting for CRM",
    delivered: "In CRM",
    error: "CRM delivery failed",
    none: "No CRM record",
  },

  deliveryHint: {
    pending: "Saved by Blockwise. The CRM has not confirmed this enquiry yet.",
    error: "Blockwise saved this enquiry but could not deliver it to the CRM.",
    none: "Blockwise has no delivery record for this enquiry.",
  },

  reasons: {
    uncontacted: "No contact logged",
    overdue: "Follow-up overdue",
    unassigned: "No owner",
    stale: "Saved data, CRM not confirmed",
  },

  actions: {
    email: "Email lead",
    call: "Call",
    logContact: "Log contact",
    logReply: "Log reply",
    addTask: "Add task",
    outcome: "Record outcome",
    reassign: "Reassign",
    archive: "Archive",
    reopen: "Reopen",
    complete: "Done",
    snooze: "Snooze",
    copyEmail: "Copy email address",
    copyMessage: "Copy message",
    openMailApp: "Open mail app",
    close: "Close",
    back: "Back",
    retry: "Try again",
    cancel: "Cancel",
    save: "Save",
  },

  email: {
    dialogTitle: "Email from your own mail app",
    dialogIntro:
      "This opens your own mail app with a draft ready to edit. Blockwise does not send, track or log this email.",
    to: "To",
    subject: "Subject",
    message: "Message",
    tooLong:
      "This draft is too long for a mail link. Copy the address and message instead, then paste them into your mail app.",
    rejectedRecipient:
      "That email address cannot be used in a mail link. Copy the address instead and paste it into your mail app.",
    copiedAddress: "Email address copied.",
    copiedMessage: "Message copied.",
    opened: "Mail app opened. Nothing has been logged against this enquiry.",
    auditNote: "Agent opened their own mail app from Blockwise.",
    auditOnly:
      "Opening, copying or closing this draft is recorded as an audit note only. It does not mark the enquiry contacted and does not complete a task.",
  },

  call: {
    unavailable: "That phone number cannot be used to start a call.",
    note: "Starting a call does not prove it was answered. Log the contact yourself when you have spoken.",
  },

  activity: {
    title: "Activity",
    empty: "No reported activity yet.",
    reportedBy: (actor: string, time: string) => `Reported by ${actor} at ${time}`,
    unknownActor: "An agent",
    unknownTime: "an unrecorded time",
    noteLabel: "Note",
  },

  tasks: {
    title: "Tasks",
    addTitle: "Add a task",
    taskTitle: "Task",
    taskTitlePlaceholder: "Call back about the appraisal",
    purpose: "Purpose",
    dueAt: "Due",
    none: "No open tasks.",
    overdue: "Overdue",
    dueToday: "Due today",
    dueOn: (time: string) => `Due ${time}`,
    noDue: "No due time",
    snoozeTitle: "Snooze task",
    snoozeHint: "Snoozing needs a new due time.",
    open: "Open",
    done: "Done",
    loading: "Loading tasks for this view.",
    partial: "Tasks are loaded for the enquiries shown below.",
  },

  outcome: {
    title: "Record outcome",
    won: "Won",
    lost: "Lost",
    lostReason: "Reason for marking lost",
    lostReasonPlaceholder: "No response after three attempts",
    lostReasonRequired: "A reason is required when marking an enquiry Lost.",
    saved: "Outcome recorded.",
  },

  contact: {
    logContactTitle: "Log contact",
    logContactHint: "Record that you reached this person. Only you know that, so only you can log it.",
    logReplyTitle: "Log reply",
    logReplyHint: "Record that this person replied to you.",
    notePlaceholder: "Optional note",
    followUpAt: "Next follow-up",
    saved: "Logged.",
  },

  states: {
    loading: "Loading enquiries.",
    loadingDetail: "Loading this enquiry.",
    emptyTitle: "Nothing needs action",
    emptyBody: "When an enquiry needs a call, a reply or an owner, it shows up here.",
    emptyAllTitle: "No enquiries yet",
    emptyAllBody: "Enquiries land here as soon as your first ad with a lead form is live.",
    noMatchesTitle: "No enquiries match these filters",
    noMatchesBody: "Change or clear a filter to see more.",
    permissionTitle: "You do not have access to these enquiries",
    permissionBody: "Ask a workspace owner or admin for member access or above.",
    crmUnavailableTitle: "The CRM is not responding",
    crmUnavailableBody:
      "Showing the saved Blockwise data in read-only mode. Editing is disabled until the CRM answers again.",
    deliveryPendingTitle: "Waiting for the CRM",
    staleReadTitle: "This may be out of date",
    staleReadBody: "Another change landed first. Reload the enquiry, then try again.",
    conflictTitle: "Someone changed this enquiry first",
    conflictBody: "Your change was not saved. The stage has been put back where it was.",
    saveFailedTitle: "That change did not save",
    saveFailedBody: "The CRM rejected it. Nothing was changed.",
    notFoundTitle: "That enquiry is not available",
    notFoundBody: "It may have been removed from the CRM. Refresh the list to see the current records.",
    readOnlyBadge: "Read-only",
    reload: "Reload",
    retry: "Try again",
  },

  detail: {
    contact: "Contact",
    property: "Property",
    source: "Source",
    owner: "Owner",
    stage: "Stage",
    nextAction: "Next action",
    noOwner: "Unassigned",
    unknown: "Not recorded",
    notLoaded: "Not loaded",
    duplicateWarning: "Possible duplicate",
    duplicateOf: (name: string) => `Flagged as a possible duplicate of ${name}.`,
    reopen: "Reopen",
  },

  pipeline: {
    moveTo: "Move to",
    listAlternative: "Show as list",
    boardAlternative: "Show as board",
    empty: "No enquiries in this stage.",
    moved: (stage: string) => `Moved to ${stage}.`,
  },

  a11y: {
    results: "Enquiry results",
    filters: "Enquiry filters",
    detail: "Enquiry detail",
    openEnquiry: (name: string) => `Open ${name}`,
    taskList: "Task list",
  },
} as const;
