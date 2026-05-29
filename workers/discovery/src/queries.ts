export type DiscoveryQuery = {
  q: string;
  country: string;
  state: string;
  postcode: string;
};

const wa_suburbs = [
  ["subiaco","6008"],["cottesloe","6011"],["claremont","6010"],["dalkeith","6009"],
  ["fremantle","6160"],["mosman park","6012"],["applecross","6153"],["south perth","6151"],
  ["scarborough","6019"],["joondalup","6027"],["mandurah","6210"],["mt lawley","6050"],
  ["inglewood","6052"],["north perth","6006"],["victoria park","6100"],["maylands","6051"],
  ["floreat","6014"],["trigg","6029"],["hillarys","6025"],["carine","6020"],
  ["burswood","6100"],["belmont","6104"],["canning vale","6155"],["nedlands","6009"],
  ["wembley","6014"],["leederville","6007"],["highgate","6003"],["east perth","6004"],
  ["west perth","6005"],["mount hawthorn","6016"],["bayswater","6053"],["morley","6062"],
  ["dianella","6059"],["yokine","6060"],["tuart hill","6060"],["doubleview","6018"],
  ["churchlands","6018"],["city beach","6015"],["swanbourne","6010"],["peppermint grove","6011"],
  ["mount pleasant","6153"],["bicton","6157"],["palmyra","6157"],["spearwood","6163"],
  ["coogee","6166"],["south fremantle","6162"],["north fremantle","6159"],["east fremantle","6158"],
  ["alfred cove","6154"],["attadale","6156"],["ardross","6153"],["leeming","6149"],
  ["winthrop","6150"],["willetton","6155"],["bull creek","6149"],["riverton","6148"],
  ["rossmoyne","6148"],["shelley","6148"],["como","6152"],["kensington","6151"],
  ["kewdale","6105"],["cloverdale","6105"],["maddington","6109"],["gosnells","6110"],
  ["thornlie","6108"],["beckenham","6107"],["cannington","6107"],["rivervale","6103"],
  ["midland","6056"],["bassendean","6054"],["guildford","6055"],["ascot","6104"],
  ["high wycombe","6057"],["forrestfield","6058"],["wattle grove","6107"],["lesmurdie","6076"],
  ["kalamunda","6076"],["mundaring","6073"],["bullsbrook","6084"],
  ["currambine","6028"],["kinross","6028"],["mullaloo","6027"],["beldon","6027"],
  ["edgewater","6027"],["woodvale","6026"],["kingsley","6026"],["duncraig","6023"],
  ["greenwood","6024"],["warwick","6024"],["padbury","6025"],["sorrento","6020"],
  ["marmion","6020"],["watermans bay","6020"],["north beach","6020"],
  ["wanneroo","6065"],["yanchep","6035"],["two rocks","6037"],["clarkson","6030"],
  ["butler","6036"],["mindarie","6030"],["quinns rocks","6030"]
];

const nsw_suburbs = [
  ["bondi","2026"],["bondi junction","2022"],["vaucluse","2030"],["double bay","2028"],
  ["paddington","2021"],["woollahra","2025"],["coogee","2034"],["maroubra","2035"],
  ["mosman","2088"],["neutral bay","2089"],["cremorne","2090"],["manly","2095"],
  ["balmain","2041"],["newtown","2042"],["surry hills","2010"],["darlinghurst","2010"],
  ["redfern","2016"],["potts point","2011"],["pyrmont","2009"],["leichhardt","2040"],
  ["rozelle","2039"],["glebe","2037"],["chatswood","2067"],["lane cove","2066"],
  ["hunters hill","2110"],["lindfield","2070"],["roseville","2069"],["pymble","2073"],
  ["wahroonga","2076"],["killara","2071"],["randwick","2031"],["clovelly","2031"],
  ["bronte","2024"],["tamarama","2026"],["rose bay","2029"],["bellevue hill","2023"],
  ["cronulla","2230"],["caringbah","2229"],["miranda","2228"],
  ["dee why","2099"],["narrabeen","2101"],["avalon","2107"],
  ["parramatta","2150"],["epping","2121"],["castle hill","2154"],["baulkham hills","2153"]
];

const vic_suburbs = [
  ["toorak","3142"],["south yarra","3141"],["prahran","3181"],["windsor","3181"],
  ["st kilda","3182"],["elwood","3184"],["brighton","3186"],["middle park","3206"],
  ["albert park","3206"],["port melbourne","3207"],["south melbourne","3205"],
  ["hawthorn","3122"],["kew","3101"],["canterbury","3126"],["camberwell","3124"],
  ["malvern","3144"],["armadale","3143"],["caulfield","3162"],["balwyn","3103"],
  ["surrey hills","3127"],["box hill","3128"],["richmond","3121"],["fitzroy","3065"],
  ["collingwood","3066"],["carlton","3053"],["north melbourne","3051"],
  ["northcote","3070"],["thornbury","3071"],["preston","3072"],["essendon","3040"],
  ["moonee ponds","3039"],["ascot vale","3032"],["yarraville","3013"],["williamstown","3016"],
  ["sandringham","3191"],["hampton","3188"],["beaumaris","3193"],["mentone","3194"]
];

const qld_suburbs = [
  ["new farm","4005"],["teneriffe","4005"],["fortitude valley","4006"],
  ["bulimba","4171"],["hawthorne","4171"],["hamilton","4007"],["ascot","4007"],
  ["clayfield","4011"],["wilston","4051"],["paddington","4064"],["toowong","4066"],
  ["st lucia","4067"],["west end","4101"],["kangaroo point","4169"],["south brisbane","4101"],
  ["surfers paradise","4217"],["broadbeach","4218"],["burleigh heads","4220"],
  ["main beach","4217"],["palm beach","4221"],["coolangatta","4225"],
  ["noosa heads","4567"],["sunshine beach","4567"]
];

const sa_suburbs = [
  ["north adelaide","5006"],["unley","5061"],["glenelg","5045"],["norwood","5067"],
  ["burnside","5066"],["walkerville","5081"],["semaphore","5019"]
];

function build(suburbs: Array<[string, string]>, state: string): DiscoveryQuery[] {
  return suburbs.flatMap(([sub, pc]) => [
    { q: `real estate ${sub}`, country: "AU", state, postcode: pc },
    { q: `property ${sub}`,    country: "AU", state, postcode: pc },
  ]);
}

// Brand searches that surface multi-state advertisers
const brands = [
  "ray white","harcourts","lj hooker","raine and horne","first national real estate",
  "century 21 real estate","mcgrath estate agents","belle property","stockdale and leggo",
  "professionals real estate","barry plant","buxton real estate","hocking stuart",
  "marshall white","kay and burton","jellis craig","fletchers real estate","nelson alexander",
  "the agency real estate","biggin scott","starr partners","richardson and wrench",
  "richard matthews real estate","ruschena lawyers","place estate agents"
];

const brandSearches: DiscoveryQuery[] = brands.map((b) => ({
  q: b, country: "AU", state: "WA", postcode: "6000",
}));

// Vertical adjacencies (we may discover boutiques here too)
const verticalSearches: DiscoveryQuery[] = [
  ["just sold perth","WA","6000"],
  ["just sold sydney","NSW","2000"],
  ["just sold melbourne","VIC","3000"],
  ["open home perth","WA","6000"],
  ["auction perth","WA","6000"],
  ["off market perth","WA","6000"],
  ["buyers agent perth","WA","6000"],
  ["property management perth","WA","6000"],
  ["luxury homes perth","WA","6000"],
  ["beach front property","WA","6000"],
  ["riverfront property perth","WA","6000"],
  ["acreage perth","WA","6000"],
].map(([q, st, pc]) => ({ q, country: "AU", state: st, postcode: pc }));

export const queries: DiscoveryQuery[] = [
  ...build(wa_suburbs, "WA"),
  ...build(nsw_suburbs, "NSW"),
  ...build(vic_suburbs, "VIC"),
  ...build(qld_suburbs, "QLD"),
  ...build(sa_suburbs, "SA"),
  ...brandSearches,
  ...verticalSearches,
];
