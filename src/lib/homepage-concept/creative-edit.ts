export type CreativeEditExample = {
  id: "appraisal" | "consult" | "buyers" | "report";
  label: string;
  account: string;
  avatar: string;
  image: string;
  postCaption: string;
  initialOverlay: string;
  editedOverlay: string;
  domain: string;
  linkTitle: string;
  reactions: string;
  comments: string;
};

export const CREATIVE_EDIT_EXAMPLES: readonly CreativeEditExample[] = [
  {
    id: "appraisal", label: "Free appraisal", account: "Blockwise Realty", avatar: "BR",
    image: "/home/interior-styled.webp",
    postCaption: "Thinking of selling? See what your home could be worth.",
    initialOverlay: "KNOW YOUR HOME'S VALUE", editedOverlay: "GET YOUR FREE APPRAISAL",
    domain: "BLOCKWISEREALTY.COM.AU", linkTitle: "Find out what your home could be worth", reactions: "36", comments: "5",
  },
  {
    id: "consult", label: "Seller consult", account: "West & Co Property", avatar: "W&C",
    image: "/home/subiaco-townhouse.webp",
    postCaption: "A clear plan makes the first property conversation easier.",
    initialOverlay: "READY FOR A NEW PLAN?", editedOverlay: "TALK WITH A LOCAL EXPERT",
    domain: "WESTANDCO.COM.AU", linkTitle: "Book a free seller consultation", reactions: "21", comments: "3",
  },
  {
    id: "buyers", label: "Buyers wanted", account: "Northside Property", avatar: "NP",
    image: "/home/subiaco-townhouse.webp",
    postCaption: "Qualified buyers are looking for their next address now.",
    initialOverlay: "BUYERS ARE LOOKING", editedOverlay: "BRING YOUR HOME TO MARKET",
    domain: "NORTHSIDEPROPERTY.COM.AU", linkTitle: "Meet ready buyers", reactions: "63", comments: "11",
  },
  {
    id: "report", label: "Market report", account: "Harbourline Realty", avatar: "HR",
    image: "/home/interior-styled.webp",
    postCaption: "Prices and buyer activity are moving. See your local numbers.",
    initialOverlay: "WHAT IS YOUR SUBURB WORTH?", editedOverlay: "SEE THE LATEST LOCAL DATA",
    domain: "HARBOURLINEREALTY.COM.AU", linkTitle: "Get your free suburb market report", reactions: "57", comments: "9",
  },
] as const;


/** One shared clock prevents character animations drifting across loops. */
export const CREATIVE_EDIT_CYCLE_MS = 7200;
export function creativeEditFrame(elapsed: number, example: CreativeEditExample) {
  const time = elapsed % CREATIVE_EDIT_CYCLE_MS;
  if (time < 1100) return { phase: "rest", text: example.initialOverlay };
  if (time < 1750) return { phase: "select", text: example.initialOverlay };
  if (time < 3200) return { phase: "type", text: example.editedOverlay.slice(0, Math.floor((time - 1750) / 50)) };
  return { phase: time < 6650 ? "done" : "reset", text: example.editedOverlay };
}
