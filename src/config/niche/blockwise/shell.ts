import type { ShellCopy } from "../niche";

export const shell: ShellCopy = {
  commandMenu: {
    placeholder: "Type a command or search…",
    navigateGroup: "Go to",
    actionsGroup: "Actions",
    createAd: "Create ad",
    empty: "No results found.",
  },
  searchButton: "Search",
  trial: {
    ended: "Free creation allowance ended",
    active: "Free creation allowance",
    daysLeft: (days) => `Free creation: ${days} day${days === 1 ? "" : "s"} left`,
    rendersLeft: (remaining, included) => `${remaining}/${included} free renders left`,
    used: (used) => `${used} renders used`,
    upgrade: "Upgrade",
  },
  installApp: "Install app",
  signOut: "Sign out",
  more: "More",
};
