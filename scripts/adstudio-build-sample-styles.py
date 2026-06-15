#!/usr/bin/env python3
"""Build the curated sample-style + image-brief map for Ad Studio template cards.

This replaces the old index-rotation logic (which forced 45 templates onto ~4
photos and one layout) with an explicit, hand-curated assignment per template:
a unique AI image prompt, a distinct layout archetype, and explicit style
fields. The output JSON is the single source of truth shared by both the Python
renderer and the TypeScript runtime mapper, and is validated against the
variance distribution targets.

All houses, people, names, addresses and copy are original samples.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ad-template-library" / "sample-styles.json"
TS_OUT = ROOT / "src" / "lib" / "adstudio" / "template-sample-styles.generated.ts"

# Layout archetypes the renderer knows how to draw. High variety on purpose.
LAYOUTS = [
    "feed_minimal",     # full-bleed photo, tiny corner tag, FB feed chrome
    "feed_headline",    # full-bleed photo, bottom gradient, big headline
    "poster_band",      # photo top, bold colour band w/ headline + CTA (salesy)
    "data_card",        # split: photo strip + large stat / numbers panel
    "magazine_split",   # serif text column + photo (premium editorial)
    "framed_polaroid",  # inset photo with white frame, caption (organic)
    "agent_strip",      # photo + agent portrait circle + name bar
    "testimonial",      # quote card over dimmed photo, stars, client name
    "guide_mockup",     # report / checklist cover mockup over blurred photo
    "report_cover",     # editorial cover: title, photo, suburb + period
    "badge_overlay",    # photo + circular SOLD / AUCTION stamp
    "full_bleed_clean", # pure photo, tiny logo, no overlay text
]

# Sample identity pools (deliberately spread so no two adjacent cards match).
SUBURBS = ["Scarborough", "Bicton", "Maylands", "Cottesloe", "Victoria Park",
           "Fremantle", "Mount Lawley", "Subiaco", "Bayswater", "North Perth",
           "Claremont", "Inglewood", "Trigg", "Joondalup", "Midland"]
AGENCIES = ["Coastal & Co Realty", "Harbour Lane Property", "Maison West",
            "Northbank Realty", "Civic Estate Agents", "Jarrah Property",
            "Bluestone Residential", "Foreshore & Park", "Highgate Property Co",
            "Marlow & Vale", "Saltbush Realty", "Terrace Lane Agents"]
AGENTS = ["Sarah Chen", "Elliot Marsh", "Mia Hart", "Daniel Price", "Priya Nair",
          "Tom Walker", "Grace Okafor", "Leo Romano",
          "Hannah Webb", "Noah Sato", "Ava Lindqvist", "Marcus Bell"]
AGENTS_FEMALE = ["Sarah Chen", "Mia Hart", "Priya Nair", "Grace Okafor", "Hannah Webb", "Ava Lindqvist"]
AGENTS_MALE = ["Elliot Marsh", "Daniel Price", "Tom Walker", "Leo Romano", "Noah Sato", "Marcus Bell"]


def agent_name_for(prompt, fallback, seed_val):
    """Pick an agent name whose gender matches a gendered portrait prompt."""
    low = prompt.lower()
    female = bool(re.search(r"\b(female|woman|businesswoman|her)\b", low))
    male = bool(re.search(r"\b(male|man|businessman|his)\b", low))
    if female and not male:
        return AGENTS_FEMALE[seed_val % len(AGENTS_FEMALE)]
    if male and not female:
        return AGENTS_MALE[seed_val % len(AGENTS_MALE)]
    return fallback
ADDRESSES = ["18 Tallow Lane", "42 Beach Street", "7 Station Road",
             "3 Jacaranda Avenue", "29 View Terrace", "11 Market Lane",
             "64 Ridgeway Drive", "5 Coral Court", "120 Heritage Parade",
             "8 Wattle Close", "37 Esplanade", "2 Kiln Street"]

# Coherent Perth-metro geography so locale references inside a card never
# contradict each other (e.g. a Fremantle agent must not "cover" Scarborough).
REGIONS = {
    "Scarborough": ["Trigg", "Doubleview", "Karrinyup"],
    "Bicton": ["Attadale", "Palmyra", "East Fremantle"],
    "Maylands": ["Mount Lawley", "Bayswater", "Inglewood"],
    "Cottesloe": ["Mosman Park", "Peppermint Grove", "Swanbourne"],
    "Victoria Park": ["East Victoria Park", "Burswood", "Lathlain"],
    "Fremantle": ["North Fremantle", "Beaconsfield", "White Gum Valley"],
    "Mount Lawley": ["Inglewood", "Menora", "Highgate"],
    "Subiaco": ["Shenton Park", "Daglish", "Jolimont"],
    "Bayswater": ["Maylands", "Embleton", "Morley"],
    "North Perth": ["Mount Lawley", "Leederville", "Highgate"],
    "Claremont": ["Swanbourne", "Nedlands", "Mount Claremont"],
    "Inglewood": ["Mount Lawley", "Bedford", "Bayswater"],
    "Trigg": ["Scarborough", "North Beach", "Karrinyup"],
    "Joondalup": ["Edgewater", "Connolly", "Currambine"],
    "Midland": ["Bellevue", "Viveash", "Woodbridge"],
}
STREETS = {
    "Scarborough": "Brighton Road", "Bicton": "Preston Point Road",
    "Maylands": "Guildford Road", "Cottesloe": "Marine Parade",
    "Victoria Park": "Shepperton Road", "Fremantle": "South Terrace",
    "Mount Lawley": "Second Avenue", "Subiaco": "Rokeby Road",
    "Bayswater": "King William Street", "North Perth": "Fitzgerald Street",
    "Claremont": "Bay View Terrace", "Inglewood": "Tenth Avenue",
    "Trigg": "West Coast Drive", "Joondalup": "Grand Boulevard",
    "Midland": "Cale Street",
}
GROWTH_12M = ["4.2%", "5.1%", "6.4%", "7.8%", "3.6%", "8.9%"]
GROWTH_5Y = ["24%", "31%", "38%", "44%", "19%", "52%"]
DAYS = ["12", "18", "21", "9", "27", "15"]
BUYERS = ["28", "42", "36", "54", "19", "61"]
MEDIANS = ["$612k", "$740k", "$892k", "$1.05m", "$560k", "$1.22m"]
RENTS = [("$540/wk", "$1,340/wk"), ("$620/wk", "$1,520/wk"), ("$700/wk", "$1,720/wk"),
         ("$480/wk", "$1,180/wk"), ("$820/wk", "$1,980/wk"), ("$590/wk", "$1,460/wk")]
PROJECTS = ["The Grove", "Parkside", "The Marin", "Vue Residences", "Saltwater", "Heritage Walk"]


def _seed(value):
    h = 0
    for ch in value:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h


def make_persona(key, suburb, agency, agent):
    h = _seed(key)
    region = REGIONS.get(suburb, [suburb])
    street = STREETS.get(suburb, "Main Street")
    number = (h % 80) + 3
    rent_before, rent_after = RENTS[(h >> 7) % len(RENTS)]
    region_list = ", ".join(region[:-1]) + " and " + region[-1] if len(region) > 1 else region[0]
    return {
        "agency": agency,
        "agent": agent,
        "suburb": suburb,
        "state": "WA",
        "regionList": region_list,
        "region": region,
        "address": f"{number} {street}, {suburb}",
        "project": PROJECTS[h % len(PROJECTS)],
        "stats": {
            "growth_12m": GROWTH_12M[h % 6],
            "growth_5y": GROWTH_5Y[(h >> 3) % 6],
            "days": DAYS[(h >> 5) % 6],
            "buyers": BUYERS[(h >> 8) % 6],
            "median": MEDIANS[(h >> 11) % 6],
            "rent_before": rent_before,
            "rent_after": rent_after,
        },
    }

# Per-template curation. Each entry:
#   key: (prompt, layout, propertyAge, priceFeel, visualStyle, people,
#         copyDensity, tone)
# Prompts are vivid and varied: era, materials, colour, time-of-day, setting,
# framing (exterior / interior / aerial / street / lifestyle).
NEG = ("no text, no watermark, no logo, no signage, no lettering, "
       "photographic, realistic, high quality")

P = "Real estate photograph, Australian setting. "

T = {
 # ---- Home Value / Appraisal -------------------------------------------------
 "HV-01": (P+"Aerial drone view over a leafy established suburb of mixed 1980s family homes with terracotta roofs, pools and tree-lined streets, soft morning light",
           "data_card", "renovated_character", "mid_market_family", "data_card", "none", "stat_heavy", "practical_local"),
 "HV-02": (P+"A modest pale-yellow 1970s single-storey brick home, neat lawn, rose garden, parked sedan in carport, bright afternoon",
           "feed_headline", "older_affordable", "affordable_entry", "property_photo_first", "none", "minimal_no_overlay", "practical_local"),
 "HV-03": (P+"A renovated weatherboard cottage painted charcoal with white trim, restored picket fence, golden hour street view",
           "full_bleed_clean", "renovated_character", "mid_market_family", "property_photo_first", "none", "minimal_no_overlay", "simple_super_premium"),
 "HV-04": (P+"A premium limestone-and-glass coastal home with manicured hedges and a circular driveway, dusk, warm interior glow",
           "report_cover", "luxury_architectural", "premium_coastal", "super_premium_polished", "none", "small_badge", "simple_super_premium"),
 "HV-05": (P+"Close-up of a contemporary grey rendered townhouse facade with timber accents and a black front door, clean daylight",
           "data_card", "apartment_townhouse", "mid_market_family", "data_card", "none", "stat_heavy", "practical_local"),
 "HV-06": ("Professional studio portrait of a friendly mid-30s female real estate agent in a navy blazer, soft grey background, confident smile, "+NEG,
           "agent_strip", "renovated_character", "mid_market_family", "organic_agent_post", "agent_portrait", "headline_overlay", "soft_organic"),

 # ---- Market Update / Report -------------------------------------------------
 "MU-01": (P+"Wide street-scape of an upmarket tree-lined avenue with character homes and jacarandas in bloom, editorial morning light",
           "report_cover", "renovated_character", "premium_coastal", "super_premium_polished", "none", "small_badge", "quiet_editorial"),
 "MU-02": (P+"Row of pastel-toned semi-detached terraces in an inner-city suburb, parked bikes, overcast even light",
           "data_card", "apartment_townhouse", "mid_market_family", "data_card", "none", "stat_heavy", "practical_local"),
 "MU-03": (P+"Aerial view of a coastal suburb where rooftops meet the ocean, marina and beach, clear blue afternoon",
           "data_card", "luxury_architectural", "premium_coastal", "data_card", "none", "stat_heavy", "practical_local"),
 "MU-04": (P+"Modern multi-unit apartment block with balconies and greenery, low-rise, soft evening light, urban edge",
           "data_card", "apartment_townhouse", "investor_rental", "data_card", "none", "stat_heavy", "practical_local"),

 # ---- Buyer Demand -----------------------------------------------------------
 "BD-01": (P+"A neat brick-and-tile family home with a 'home open' feel, open front door, welcoming porch, late afternoon",
           "data_card", "older_affordable", "mid_market_family", "data_card", "none", "stat_heavy", "practical_local"),
 "BD-02": (P+"A real estate agent addressing a small crowd of prospective buyers on the footpath outside a suburban home at an open inspection, daytime, candid, "+NEG,
           "poster_band", "renovated_character", "mid_market_family", "polished_meta_ad", "agent_in_scene", "full_sales_poster", "urgent_listing"),
 "BD-03": (P+"A charming double-fronted character home behind a low stone wall, established garden, warm sunset",
           "feed_headline", "renovated_character", "mid_market_family", "property_photo_first", "none", "minimal_no_overlay", "practical_local"),

 # ---- Just Sold / Social Proof ----------------------------------------------
 "JS-01": (P+"A bright modern white house with a 'sold' sign on the verge, blue sky, pristine front yard",
           "badge_overlay", "new_build", "mid_market_family", "property_photo_first", "none", "small_badge", "urgent_listing"),
 "JS-02": ("A real estate agent in business attire standing proudly beside a sold sign in front of a suburban home, candid daytime, "+NEG,
           "badge_overlay", "older_affordable", "mid_market_family", "organic_agent_post", "agent_in_scene", "small_badge", "soft_organic"),
 "JS-03": (P+"A real estate agent shaking hands with happy buyers outside an elegant brick character home after a successful auction, bunting, daytime, "+NEG,
           "badge_overlay", "renovated_character", "premium_coastal", "polished_meta_ad", "agent_in_scene", "small_badge", "urgent_listing"),
 "JS-04": (P+"Tidy interior of a sold family living room, staged neutral furniture, large windows, bright and airy",
           "data_card", "renovated_character", "mid_market_family", "data_card", "none", "stat_heavy", "practical_local"),

 # ---- Just Listed / New to Market -------------------------------------------
 "JL-01": (P+"A striking architect-designed black timber and concrete home at twilight, lit pool, dramatic and premium",
           "feed_minimal", "luxury_architectural", "luxury_architectural", "property_photo_first", "none", "minimal_no_overlay", "urgent_listing"),
 "JL-02": (P+"A cheerful first-home-buyer cottage, light blue weatherboard, white fence, sunflowers in the yard, bright morning",
           "feed_headline", "older_affordable", "affordable_entry", "property_photo_first", "none", "minimal_no_overlay", "practical_local"),
 "JL-03": (P+"A renovated red-brick bungalow with a wraparound veranda, hanging plants, casual handheld phone-photo feel, daylight",
           "framed_polaroid", "renovated_character", "mid_market_family", "organic_agent_post", "none", "minimal_no_overlay", "soft_organic"),

 # ---- New Development / Off-the-Plan ----------------------------------------
 "ND-01": (P+"Photoreal architectural render of a sleek new apartment tower with curved balconies and landscaped podium, dusk, premium",
           "full_bleed_clean", "development_render", "luxury_architectural", "super_premium_polished", "none", "minimal_no_overlay", "simple_super_premium"),
 "ND-02": (P+"Photoreal render of a boutique low-rise townhouse development, warm timber and white render, communal courtyard garden, golden hour",
           "magazine_split", "development_render", "premium_coastal", "super_premium_polished", "none", "headline_overlay", "simple_super_premium"),
 "ND-03": (P+"Photoreal render of a modern off-the-plan duplex with rooftop terrace, city skyline behind, clear blue sky",
           "poster_band", "development_render", "luxury_architectural", "super_premium_polished", "none", "full_sales_poster", "urgent_listing"),

 # ---- Open Home / Inspection ------------------------------------------------
 "OH-01": (P+"A family walking up the path to an open home as an agent greets them at the door holding an open-house flag, friendly candid daytime, "+NEG,
           "feed_minimal", "older_affordable", "mid_market_family", "organic_agent_post", "agent_in_scene", "small_badge", "soft_organic"),
 "OH-02": (P+"Bright open-plan interior of a new home with kitchen island, timber floors and sliding doors to a patio, midday light",
           "feed_headline", "new_build", "mid_market_family", "property_photo_first", "none", "headline_overlay", "practical_local"),

 # ---- Auction ----------------------------------------------------------------
 "AU-01": (P+"A grand two-storey federation home dressed for auction, red carpet runner and styled garden, dramatic afternoon light",
           "poster_band", "renovated_character", "premium_coastal", "polished_meta_ad", "none", "full_sales_poster", "urgent_listing"),
 "AU-02": (P+"A sandstone heritage home behind iron gates, auction styling, leafy established street, warm light",
           "badge_overlay", "renovated_character", "premium_coastal", "property_photo_first", "none", "small_badge", "urgent_listing"),
 "AU-03": (P+"A calm modern home interior, dining area with neutral styling, soft natural light, suitable for a guide cover",
           "guide_mockup", "renovated_character", "mid_market_family", "guide_or_report_mockup", "none", "headline_overlay", "practical_local"),

 # ---- Property Management / Landlord ----------------------------------------
 "PM-01": (P+"A tidy rental duplex with low-maintenance native garden and a carport, neat and practical, clear daylight",
           "feed_headline", "apartment_townhouse", "investor_rental", "polished_meta_ad", "none", "headline_overlay", "practical_local"),
 "PM-02": (P+"Exterior of a small block of three rental units, brick, simple landscaping, overcast soft light",
           "data_card", "apartment_townhouse", "investor_rental", "data_card", "none", "stat_heavy", "practical_local"),
 "PM-03": ("A relaxed mid-40s male property manager smiling outside a rental home holding a tablet, candid daytime, "+NEG,
           "framed_polaroid", "apartment_townhouse", "investor_rental", "organic_agent_post", "agent_in_scene", "minimal_no_overlay", "soft_organic"),

 # ---- Investor / Co-living ---------------------------------------------------
 "IN-01": (P+"A modern co-living share house exterior and contemporary fit-out, communal courtyard, golden hour, empty and unoccupied, no people, no person",
           "magazine_split", "new_build", "investor_rental", "super_premium_polished", "none", "headline_overlay", "simple_super_premium"),
 "IN-02": (P+"Aerial view of a dual-occupancy investment property on a battle-axe block, two dwellings, suburban, midday",
           "data_card", "new_build", "investor_rental", "data_card", "none", "stat_heavy", "practical_local"),
 "IN-03": (P+"A practical brick investment home with a granny flat at the rear, neat yard, clear daylight",
           "full_bleed_clean", "older_affordable", "investor_rental", "property_photo_first", "none", "minimal_no_overlay", "practical_local"),
 "IN-04": (P+"Interior of a stylish co-living common room with sofas, kitchenette and study nooks, bright and modern",
           "data_card", "apartment_townhouse", "investor_rental", "data_card", "none", "stat_heavy", "practical_local"),

 # ---- Agency Brand / Agent Intro --------------------------------------------
 "AB-01": ("Confident professional portrait of a smiling late-30s male real estate agent in a charcoal suit, clean studio background, "+NEG,
           "agent_strip", "renovated_character", "premium_coastal", "organic_agent_post", "agent_portrait", "headline_overlay", "soft_organic"),
 "AB-02": ("Warm professional portrait of a mid-40s female real estate agent in a cream blouse, soft natural light, approachable, "+NEG,
           "agent_strip", "renovated_character", "mid_market_family", "organic_agent_post", "agent_portrait", "headline_overlay", "soft_organic"),
 "AB-03": ("A small real estate team of three agents standing together outside their office, smart casual, friendly, daytime, "+NEG,
           "data_card", "renovated_character", "premium_coastal", "data_card", "agent_in_scene", "stat_heavy", "simple_super_premium"),

 # ---- Testimonial / Review ---------------------------------------------------
 "TS-01": ("A happy mature couple smiling outside their home holding house keys, candid warm daytime, "+NEG,
           "testimonial", "older_affordable", "mid_market_family", "organic_agent_post", "owner_lifestyle", "headline_overlay", "soft_organic"),
 "TS-02": ("A young family laughing together on the front steps of their new home, golden afternoon, candid lifestyle, "+NEG,
           "testimonial", "renovated_character", "mid_market_family", "organic_agent_post", "owner_lifestyle", "headline_overlay", "soft_organic"),

 # ---- Lead Magnet / Guide ----------------------------------------------------
 "LM-01": (P+"A bright, styled living room with a checklist and coffee on a table, soft light, suitable for a guide cover",
           "guide_mockup", "renovated_character", "mid_market_family", "guide_or_report_mockup", "none", "headline_overlay", "practical_local"),
 "LM-02": (P+"A tidy home office desk with a laptop, plant and notebook by a window, calm natural light, guide cover style",
           "guide_mockup", "apartment_townhouse", "mid_market_family", "guide_or_report_mockup", "none", "headline_overlay", "practical_local"),
 "LM-03": (P+"An elegant coastal home exterior at dusk suitable for a premium seller's guide cover, warm interior glow",
           "guide_mockup", "luxury_architectural", "premium_coastal", "guide_or_report_mockup", "none", "small_badge", "simple_super_premium"),

 # ---- Downsizer / Over-55s ---------------------------------------------------
 "DS-01": ("A relaxed mature couple in their 60s enjoying coffee on the balcony of a low-maintenance modern apartment overlooking parkland, warm morning, "+NEG,
           "magazine_split", "apartment_townhouse", "premium_coastal", "super_premium_polished", "owner_lifestyle", "headline_overlay", "simple_super_premium"),
 "DS-02": (P+"A single-level modern villa with easy-care garden and wide doorways, accessible and bright, clear daylight, guide cover style",
           "guide_mockup", "new_build", "premium_coastal", "guide_or_report_mockup", "none", "headline_overlay", "practical_local"),
}


# Real ad-engine archetypes (must match creativeSkeletonArchetypeSchema in
# src/lib/ad-template-library/skeleton.ts). The preview card's layout and the
# real ad's archetype are linked here so they cannot silently drift.
CAT_ARCHETYPE = {
    "HV": "appraisal", "MU": "market_stat", "BD": "market_stat", "JS": "just_sold",
    "JL": "listing_hero", "ND": "listing_hero", "OH": "open_home", "AU": "just_sold",
    "PM": "appraisal", "IN": "market_stat", "AB": "social_proof", "TS": "social_proof",
    "LM": "seller_guide", "DS": "seller_guide",
}
LAYOUT_ARCHETYPE = {
    "data_card": "market_stat", "guide_mockup": "seller_guide",
    "testimonial": "social_proof", "badge_overlay": "just_sold",
    "report_cover": "market_stat",
}
ARCHETYPE_OVERRIDES = {
    "AB-03": "social_proof",   # agency benchmark = proof, not a market report
    "IN-03": "listing_hero",   # clean full-bleed investment home reads as a listing
    "OH-02": "open_home",      # keep open-home even though it is a headline layout
    "BD-03": "listing_hero",   # buyer-demand headline over a home photo = listing hero
}
# Which preview layouts are visually faithful to each real archetype.
ALLOWED_LAYOUTS = {
    "appraisal": {"feed_headline", "magazine_split", "agent_strip", "report_cover", "full_bleed_clean", "framed_polaroid"},
    "market_stat": {"data_card", "report_cover", "poster_band", "magazine_split"},
    "just_sold": {"badge_overlay", "poster_band", "feed_minimal"},
    "listing_hero": {"full_bleed_clean", "feed_minimal", "feed_headline", "poster_band", "magazine_split", "framed_polaroid"},
    "open_home": {"feed_minimal", "feed_headline"},
    "coming_soon": {"full_bleed_clean", "feed_minimal", "magazine_split", "poster_band"},
    "seller_guide": {"guide_mockup", "magazine_split", "report_cover"},
    "social_proof": {"testimonial", "framed_polaroid", "agent_strip", "data_card"},
}


def archetype_for(key, layout):
    cat = key.split("-")[0]
    if key in ARCHETYPE_OVERRIDES:
        return ARCHETYPE_OVERRIDES[key]
    return LAYOUT_ARCHETYPE.get(layout) or CAT_ARCHETYPE[cat]


def build() -> dict:
    keys = list(T.keys())
    out: dict[str, dict] = {}
    for i, key in enumerate(keys):
        prompt, layout, age, price, visual, people, density, tone = T[key]
        agent = AGENTS[i % len(AGENTS)]
        if people in ("agent_portrait", "agent_in_scene"):
            agent = agent_name_for(prompt, agent, _seed(key))
        persona = make_persona(key, SUBURBS[i % len(SUBURBS)], AGENCIES[i % len(AGENCIES)], agent)
        archetype = archetype_for(key, layout)
        if layout not in ALLOWED_LAYOUTS[archetype]:
            raise SystemExit(f"{key}: layout '{layout}' is not faithful to archetype '{archetype}'")
        out[key] = {
            "prompt": prompt,
            "persona": persona,
            "archetype": archetype,
            "negativePrompt": NEG,
            "layout": layout,
            "propertyAge": age,
            "priceFeel": price,
            "visualStyle": visual,
            "people": people,
            "copyDensity": density,
            "tone": tone,
            "sampleSuburb": persona["suburb"],
            "sampleState": "WA",
            "agencyName": persona["agency"],
            "agentName": persona["agent"],
            "address": persona["address"],
        }
    return out


def variance_errors(styles: dict) -> list[str]:
    vals = list(styles.values())
    total = len(vals)
    min20 = math.ceil(total * 0.2)
    min15 = math.ceil(total * 0.15)

    def count(pred) -> int:
        return sum(1 for s in vals if pred(s))

    checks = [
        ("no-person", count(lambda s: s["people"] == "none"), min20),
        ("agent-led", count(lambda s: s["people"] in ("agent_portrait", "agent_in_scene")), min20),
        ("property-only", count(lambda s: s["people"] == "none" and s["visualStyle"] == "property_photo_first"), min20),
        ("minimal/no-overlay", count(lambda s: s["copyDensity"] == "minimal_no_overlay"), min20),
        ("text-heavy", count(lambda s: s["copyDensity"] in ("stat_heavy", "full_sales_poster")), min20),
        ("organic", count(lambda s: s["visualStyle"] == "organic_agent_post"), min15),
        ("super-premium", count(lambda s: s["visualStyle"] == "super_premium_polished"), min15),
        ("older/affordable", count(lambda s: s["propertyAge"] == "older_affordable" or s["priceFeel"] in ("affordable_entry", "cheap_and_cheerful")), min15),
        ("new/luxury", count(lambda s: s["propertyAge"] in ("new_build", "luxury_architectural", "development_render")), min15),
    ]
    errors = []
    print("Variance distribution (total %d):" % total)
    for label, actual, minimum in checks:
        ok = actual >= minimum
        print(f"  {'OK ' if ok else 'LOW'} {label:20s} {actual:2d} (min {minimum})")
        if not ok:
            errors.append(f"{label}: {actual} < {minimum}")
    # layout spread
    from collections import Counter
    lc = Counter(s["layout"] for s in vals)
    print("Layouts used:", dict(lc))
    if len(lc) < 8:
        errors.append(f"only {len(lc)} distinct layouts")
    return errors



def emit_ts(styles: dict) -> None:
    fields = ["layout", "archetype", "propertyAge", "priceFeel", "visualStyle", "people",
              "copyDensity", "tone", "sampleSuburb", "sampleState", "agencyName",
              "agentName", "address"]
    lines = [
        "// AUTO-GENERATED by scripts/adstudio-build-sample-styles.py. Do not edit by hand.",
        "// Curated per-template sample-card style + layout assignment.",
        "",
        "export type CuratedSamplePersona = {",
        "  agency: string;",
        "  agent: string;",
        "  suburb: string;",
        "  state: string;",
        "  regionList: string;",
        "  region: string[];",
        "  address: string;",
        "  project: string;",
        "  stats: {",
        "    growth_12m: string;",
        "    growth_5y: string;",
        "    days: string;",
        "    buyers: string;",
        "    median: string;",
        "    rent_before: string;",
        "    rent_after: string;",
        "  };",
        "};",
        "",
        "export type CuratedTemplateSampleStyle = {",
        "  layout: string;",
        "  archetype: string;",
        "  propertyAge: string;",
        "  priceFeel: string;",
        "  visualStyle: string;",
        "  people: string;",
        "  copyDensity: string;",
        "  tone: string;",
        "  sampleSuburb: string;",
        "  sampleState: string;",
        "  agencyName: string;",
        "  agentName: string;",
        "  address: string;",
        "  persona: CuratedSamplePersona;",
        "};",
        "",
        "export const CURATED_TEMPLATE_SAMPLE_STYLES: Record<string, CuratedTemplateSampleStyle> = {",
    ]
    for key, style in styles.items():
        parts = ", ".join(f'{f}: {json.dumps(style[f])}' for f in fields)
        persona = json.dumps(style["persona"])
        lines.append(f'  {json.dumps(key)}: {{ {parts}, persona: {persona} }},')
    lines.append("};")
    lines.append("")
    lines.append("export const ARCHETYPE_ALLOWED_LAYOUTS: Record<string, string[]> = {")
    for arch, layouts in sorted(ALLOWED_LAYOUTS.items()):
        lines.append(f"  {json.dumps(arch)}: {json.dumps(sorted(layouts))},")
    lines.append("};")
    lines.append("")
    TS_OUT.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    styles = build()
    errors = variance_errors(styles)
    if errors:
        raise SystemExit("Variance targets not met:\n" + "\n".join(errors))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(styles, indent=2), encoding="utf-8")
    emit_ts(styles)
    print("Wrote %d curated styles" % len(styles))


if __name__ == "__main__":
    main()
