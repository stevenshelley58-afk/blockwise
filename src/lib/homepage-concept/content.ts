export const withBasePath = (path: string) =>
  `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;

export const AD_EXAMPLES = [
  {
    id: "appraisal",
    label: "Free appraisal",
    title: "Start appraisal conversations.",
    body: "A clear homeowner offer, a polished feed creative, and a simple next step.",
    image:
      "/adstudio-thumbnails/meta/f1eef3fb49b782ab7666cd14a7f793151f5fd439c724085ce68996e9ebb24f78-preview.webp",
    postCopy: "Thinking of selling? Find out what your home could be worth with a free property appraisal.",
    linkTitle: "Find out what your home could be worth",
  },
  {
    id: "consult",
    label: "Seller consult",
    title: "A low-pressure first step.",
    body: "Lead with useful local expertise and invite a no-obligation conversation.",
    image:
      "/adstudio-thumbnails/meta/e5f5c79cf1406642a592ca040d4b93a2ac7dca8d79e0ac4c437c2a8f70a337ec-preview.webp",
    postCopy: "Curious what buyers would pay for your home? Get a free, no-obligation consultation.",
    linkTitle: "Free seller consultation",
  },
  {
    id: "buyers",
    label: "Buyers wanted",
    title: "Make demand feel immediate.",
    body: "A direct creative gives potential sellers a reason to raise their hand.",
    image:
      "/adstudio-thumbnails/meta/fdc9222b4d16c2666d7767372301545b54679819d1beb3359aef4c05170e59b0-preview.webp",
    postCopy: "We have qualified buyers waiting for homes like yours. List with us and meet them.",
    linkTitle: "Meet ready buyers",
  },
  {
    id: "report",
    label: "Market report",
    title: "Useful local information.",
    body: "Create a useful entry point for future sellers who are not ready to book yet.",
    image:
      "/adstudio-thumbnails/meta/eb4bce514070f6ce1566fc8fd2570755157d99eb50518e210739b276a6a1f370-preview.webp",
    postCopy: "What is your suburb really worth right now? Get the latest market report for your area.",
    linkTitle: "Free suburb market report",
  },
] as const;

export const FAQS = [
  {
    question: "Do I need to know Meta Ads Manager?",
    answer:
      "No. Blockwise keeps the creative, approval, campaign status, leads and reporting in one guided workflow.",
  },
  {
    question: "Will an ad go live without my approval?",
    answer:
      "No. You review the creative, copy, destination, budget and schedule before launch.",
  },
  {
    question: "Is ad spend included?",
    answer:
      "No. Your Meta ad spend is separate from Blockwise and is paid through your own connected Meta ad account.",
  },
  {
    question: "What happens after the trial?",
    answer:
      "The product will show the applicable plan and terms before any paid commitment. No card is required to start the trial.",
  },
  {
    question: "Can my team review ads?",
    answer:
      "Yes. The workflow is designed so the right person can review the finished ad before it launches.",
  },
] as const;
