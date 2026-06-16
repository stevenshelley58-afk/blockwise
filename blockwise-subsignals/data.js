/* Blockwise - Ad Radar demo dataset
   Invented agencies + plausible WA real-estate ad copy.
   Media is a styled placeholder (duotone + mono caption), drop real creatives in later. */

window.BLOCKWISE_MARKETS = {
  "Perth, WA":       { count: 1284 },
  "Subiaco":         { count: 318 },
  "Cottesloe":       { count: 264 },
  "Mount Lawley":    { count: 372 },
  "South Perth":     { count: 409 },
  "Fremantle":       { count: 446 },
  "Scarborough":     { count: 388 },
  "Nedlands":        { count: 221 }
};

window.BLOCKWISE_ADS = [
  {
    agency:"Coastline Realty", initials:"CR", c:"#3b6ea5", verified:true, platform:"Facebook",
    type:"Just Listed", suburb:"Cottesloe",
    text:"<b>JUST LISTED ◆ Cottesloe.</b> 4-bed beachside entertainer, 280m to the sand. Private inspections this weekend only - register before it's gone.",
    cap:"4 BED · 2 BATH · COTTESLOE", tag:"Listing creative", g1:"#cfe0e6", g2:"#8fb0bd",
    url:"coastlinerealty.com.au", headline:"Book a private inspection", cta:"Learn More",
    likes:214, comments:31, shares:18, days:6
  },
  {
    agency:"Bluestone Property Co", initials:"BP", c:"#2f5d50", verified:true, platform:"Instagram",
    type:"Open Home", suburb:"Subiaco",
    text:"OPEN SAT 11:00–11:30am. Renovated character home in the heart of Subiaco - walk to cafés, train & parks. Bring your pre-approval.",
    cap:"OPEN SAT · 11AM", tag:"Open home", g1:"#e9ddc9", g2:"#c7ad84",
    url:"bluestoneproperty.com.au", headline:"Add to your Saturday run", cta:"Send Message",
    likes:96, comments:8, shares:5, days:3
  },
  {
    agency:"Harbourview Estate Agents", initials:"HV", c:"#7a3b5d", verified:false, platform:"Both",
    type:"Just Sold", suburb:"South Perth",
    text:"<b>ANOTHER ONE SOLD in 9 days 🔑</b> Thinking of selling in South Perth? See what your home could be worth in today's market.",
    cap:"SOLD · 9 DAYS", tag:"Result post", g1:"#d8d2dd", g2:"#a097b8",
    url:"harbourview.com.au", headline:"What's my home worth?", cta:"Get Quote",
    likes:178, comments:22, shares:14, days:11
  },
  {
    agency:"Meridian Property Group", initials:"MP", c:"#b5612a", verified:true, platform:"Facebook",
    type:"Free Appraisal", suburb:"Mount Lawley",
    text:"What's your Mount Lawley home worth in 2026? Get a free, no-obligation appraisal from an agent who actually lives in the area.",
    cap:"FREE APPRAISAL", tag:"Lead form ad", g1:"#dadbc8", g2:"#aab089",
    url:"meridianproperty.com.au", headline:"Free 2026 appraisal", cta:"Sign Up",
    likes:64, comments:11, shares:6, days:21
  },
  {
    agency:"Latitude Real Estate", initials:"LR", c:"#3a4a8c", verified:false, platform:"Facebook",
    type:"Buyer Demand", suburb:"Perth, WA",
    text:"We have <b>3 qualified buyers</b> looking in your street right now. If you've thought about selling, let's talk before they buy elsewhere.",
    cap:"BUYERS WAITING", tag:"Demand ad", g1:"#cdd6dc", g2:"#94a4ae",
    url:"latitude.com.au", headline:"3 buyers in your suburb", cta:"Send Message",
    likes:142, comments:19, shares:9, days:8
  },
  {
    agency:"Sandgrove Property", initials:"SG", c:"#1f6f78", verified:true, platform:"Instagram",
    type:"Open Home", suburb:"Scarborough",
    text:"Ocean glimpses + a pool. OPEN this Sunday 1:00–1:30pm in Scarborough. Bigger than it photographs - come and see.",
    cap:"OPEN SUN · 1PM", tag:"Open home", g1:"#cfe0e6", g2:"#86aab6",
    url:"sandgrove.com.au", headline:"See it Sunday", cta:"Learn More",
    likes:121, comments:7, shares:4, days:4
  },
  {
    agency:"Parkline Realty", initials:"PL", c:"#8a4b2f", verified:false, platform:"Both",
    type:"Just Listed", suburb:"Nedlands",
    text:"<b>NEW TO MARKET · Nedlands.</b> Family home on 728sqm, walk to the river and UWA. Offers close Tuesday 6pm - don't miss the window.",
    cap:"728SQM · NEDLANDS", tag:"Listing creative", g1:"#e9ddc9", g2:"#c2a679",
    url:"parklinerealty.com.au", headline:"Offers close Tuesday", cta:"Learn More",
    likes:88, comments:14, shares:7, days:5
  },
  {
    agency:"Northcliff & Co", initials:"NC", c:"#4b4b4f", verified:true, platform:"Facebook",
    type:"Market Update", suburb:"Claremont",
    text:"Claremont median is up again this quarter. Download the free Q2 suburb report - sales, days-on-market and price trends in 2 minutes.",
    cap:"Q2 SUBURB REPORT", tag:"Content offer", g1:"#d3d8db", g2:"#9aa6ad",
    url:"northcliff.com.au", headline:"Get the Q2 report", cta:"Download",
    likes:53, comments:5, shares:12, days:18
  },
  {
    agency:"Riverstone Property", initials:"RP", c:"#2d6a4f", verified:false, platform:"Facebook",
    type:"Free Appraisal", suburb:"Applecross",
    text:"Curious, not committed? That's fine. Get a quick price guide for your Applecross home - no agent doorknock, no pressure.",
    cap:"PRICE GUIDE", tag:"Lead form ad", g1:"#dadbc8", g2:"#a7ad84",
    url:"riverstone.com.au", headline:"Quick price guide", cta:"Sign Up",
    likes:71, comments:9, shares:4, days:24
  },
  {
    agency:"Beacon Estate Agents", initials:"BE", c:"#9a3a3a", verified:true, platform:"Both",
    type:"Just Sold", suburb:"Fremantle",
    text:"<b>SOLD above reserve in Freo 🎉</b> 14 groups through, 6 offers. Our buyer list is hungry - thinking of selling this spring?",
    cap:"SOLD · 6 OFFERS", tag:"Result post", g1:"#e8d8d2", g2:"#c39e90",
    url:"beaconagents.com.au", headline:"Join the sold list", cta:"Send Message",
    likes:203, comments:27, shares:16, days:9
  },
  {
    agency:"Foreshore Property Group", initials:"FP", c:"#365a8c", verified:false, platform:"Instagram",
    type:"Buyer Demand", suburb:"Cottesloe",
    text:"Looking for a 3–4 bed in Cottesloe under $2.4m for a relocating family. Off-market welcome. Know someone? Tag them below.",
    cap:"BUYER BRIEF", tag:"Demand ad", g1:"#cfe0e6", g2:"#8eaebb",
    url:"foreshore.com.au", headline:"Off-market wanted", cta:"Send Message",
    likes:64, comments:33, shares:3, days:7
  },
  {
    agency:"Quay Real Estate", initials:"QR", c:"#6b4f9a", verified:true, platform:"Facebook",
    type:"Just Listed", suburb:"East Perth",
    text:"<b>RIVERSIDE APARTMENT · East Perth.</b> 2 bed + study, north light, secure parking. First home open Saturday - beat the rush.",
    cap:"2 BED + STUDY", tag:"Listing creative", g1:"#d8d2dd", g2:"#9b91b6",
    url:"quayrealestate.com.au", headline:"First open Saturday", cta:"Learn More",
    likes:79, comments:6, shares:5, days:4
  },
  {
    agency:"Indigo Property", initials:"IP", c:"#26506e", verified:false, platform:"Both",
    type:"Open Home", suburb:"Mount Lawley",
    text:"Art-deco charm, modern kitchen. OPEN Sat 12:00–12:30pm in Mount Lawley. The one the locals have been waiting for.",
    cap:"OPEN SAT · 12PM", tag:"Open home", g1:"#dadbc8", g2:"#a8ae86",
    url:"indigoproperty.com.au", headline:"Open this Saturday", cta:"Learn More",
    likes:110, comments:10, shares:6, days:5
  },
  {
    agency:"Saltbush Realty", initials:"SB", c:"#7d6b2a", verified:true, platform:"Facebook",
    type:"Market Update", suburb:"Subiaco",
    text:"Is now a good time to sell in Subiaco? Stock is tight and buyers are active. Get our honest 60-second market take for your street.",
    cap:"MARKET TAKE", tag:"Content offer", g1:"#e9ddc9", g2:"#c4a875",
    url:"saltbushrealty.com.au", headline:"Get your street's take", cta:"Learn More",
    likes:47, comments:4, shares:8, days:16
  },
  {
    agency:"Cardinal Property", initials:"CP", c:"#962f45", verified:true, platform:"Both",
    type:"Just Listed", suburb:"Dalkeith",
    text:"<b>PRESTIGE · Dalkeith riverfront.</b> Architect-designed, 5 bed, jetty. By private appointment. Genuine buyers only.",
    cap:"5 BED · RIVERFRONT", tag:"Listing creative", g1:"#d3d8db", g2:"#8f9ca5",
    url:"cardinalproperty.com.au", headline:"Private appointment", cta:"Send Message",
    likes:156, comments:12, shares:11, days:13
  },
  {
    agency:"Vista Estate Agents", initials:"VE", c:"#2a7d6f", verified:false, platform:"Instagram",
    type:"Free Appraisal", suburb:"South Perth",
    text:"Your neighbour just listed. Want to know what that means for your price? Free South Perth appraisal - book a 15-min visit.",
    cap:"FREE APPRAISAL", tag:"Lead form ad", g1:"#cfe0e6", g2:"#89aab4",
    url:"vistaagents.com.au", headline:"Book a 15-min visit", cta:"Sign Up",
    likes:58, comments:7, shares:5, days:19
  }
];
