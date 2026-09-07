export const withBasePath = (path: string) =>
  `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;

export const FAQS = [
  {
    question: "What if I don't have a Meta ad account?",
    answer:
      "No problem. We can help you set one up in your name and connect it to Blockwise.",
  },
  {
    question: "Do I need to know Meta Ads Manager?",
    answer:
      "Not at all. Blockwise guides you through creating and approving ads, with campaign updates, leads and reports in one place.",
  },
  {
    question: "Will an ad go live without my approval?",
    answer:
      "No. You approve the design, wording, destination, budget and schedule before anything goes live.",
  },
  {
    question: "Is ad spend included?",
    answer:
      "No. You pay Meta separately through your own ad account. We do it this way so your ad data stays yours, even if you leave Blockwise.",
  },
  {
    question: "What happens after the trial?",
    answer:
      "You can keep running and managing your ads yourself for free. Meta ad spend is still separate. Or choose a monthly plan or a managed account.",
  },
  {
    question: "Can my team review ads?",
    answer:
      "Yes. Your team can review the finished ad before it goes live.",
  },
] as const;
