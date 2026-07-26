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
    ended: "Trial ended",
    active: "Trial active",
    daysLeft: (days) => `Trial: ${days} day${days === 1 ? "" : "s"} left`,
    packsLeft: (remaining, included) => `${remaining}/${included} free ad packs left`,
    used: (used) => `${used} used`,
    upgrade: "Upgrade",
  },
  installApp: "Install app",
  signOut: "Sign out",
  more: "More",
};
