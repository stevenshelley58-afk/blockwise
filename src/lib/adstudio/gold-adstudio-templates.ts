import type { TextSlot } from "./template-design.ts";
import type { AdStudioTemplate } from "./templates.ts";
import { meta002Sample, meta002Template } from "./gold-templates/meta-002.ts";
import { meta003Sample, meta003Template } from "./gold-templates/meta-003.ts";
import { meta004Sample, meta004Template } from "./gold-templates/meta-004.ts";
import { meta005Sample, meta005Template } from "./gold-templates/meta-005.ts";
import { meta006Sample, meta006Template } from "./gold-templates/meta-006.ts";
import { meta007Sample, meta007Template } from "./gold-templates/meta-007.ts";
import { meta008Sample, meta008Template } from "./gold-templates/meta-008.ts";
import { meta009Sample, meta009Template } from "./gold-templates/meta-009.ts";
import { meta010Sample, meta010Template } from "./gold-templates/meta-010.ts";
import { meta011Sample, meta011Template } from "./gold-templates/meta-011.ts";
import { meta012Sample, meta012Template } from "./gold-templates/meta-012.ts";
import { meta013Sample, meta013Template } from "./gold-templates/meta-013.ts";
import { meta014Sample, meta014Template } from "./gold-templates/meta-014.ts";
import { meta015Sample, meta015Template } from "./gold-templates/meta-015.ts";
import { meta016Sample, meta016Template } from "./gold-templates/meta-016.ts";
import { meta017Sample, meta017Template } from "./gold-templates/meta-017.ts";
import { meta018Sample, meta018Template } from "./gold-templates/meta-018.ts";
import { meta019Sample, meta019Template } from "./gold-templates/meta-019.ts";
import { meta020Sample, meta020Template } from "./gold-templates/meta-020.ts";
import { meta021Sample, meta021Template } from "./gold-templates/meta-021.ts";
import { meta022Sample, meta022Template } from "./gold-templates/meta-022.ts";
import { meta023Sample, meta023Template } from "./gold-templates/meta-023.ts";
import { meta024Sample, meta024Template } from "./gold-templates/meta-024.ts";
import { meta025Sample, meta025Template } from "./gold-templates/meta-025.ts";
import { meta026Sample, meta026Template } from "./gold-templates/meta-026.ts";
import { meta027Sample, meta027Template } from "./gold-templates/meta-027.ts";
import { meta028Sample, meta028Template } from "./gold-templates/meta-028.ts";
import { meta029Sample, meta029Template } from "./gold-templates/meta-029.ts";
import { meta030Sample, meta030Template } from "./gold-templates/meta-030.ts";
import { meta031Sample, meta031Template } from "./gold-templates/meta-031.ts";
import { meta032Sample, meta032Template } from "./gold-templates/meta-032.ts";
import { meta033Sample, meta033Template } from "./gold-templates/meta-033.ts";
import { meta034Sample, meta034Template } from "./gold-templates/meta-034.ts";
import { meta035Sample, meta035Template } from "./gold-templates/meta-035.ts";
import { meta036Sample, meta036Template } from "./gold-templates/meta-036.ts";
import { meta037Sample, meta037Template } from "./gold-templates/meta-037.ts";
import { meta038Sample, meta038Template } from "./gold-templates/meta-038.ts";
import { meta039Sample, meta039Template } from "./gold-templates/meta-039.ts";
import { meta040Sample, meta040Template } from "./gold-templates/meta-040.ts";
import { meta041Sample, meta041Template } from "./gold-templates/meta-041.ts";
import { meta042Sample, meta042Template } from "./gold-templates/meta-042.ts";
import { meta043Sample, meta043Template } from "./gold-templates/meta-043.ts";
import { meta044Sample, meta044Template } from "./gold-templates/meta-044.ts";
import { meta045Sample, meta045Template } from "./gold-templates/meta-045.ts";
import { meta046Sample, meta046Template } from "./gold-templates/meta-046.ts";
import { meta047Sample, meta047Template } from "./gold-templates/meta-047.ts";
import { meta048Sample, meta048Template } from "./gold-templates/meta-048.ts";
import { meta049Sample, meta049Template } from "./gold-templates/meta-049.ts";
import { meta050Sample, meta050Template } from "./gold-templates/meta-050.ts";
import { meta051Sample, meta051Template } from "./gold-templates/meta-051.ts";

export const GOLD_SAMPLE_CARD_VERSION = "gold-local-50-v1";

export type GoldTemplateRenderSample = {
  photoFile: string;
  photoFiles?: Record<string, string>;
  text: Partial<Record<TextSlot, string>>;
};

export const GOLD_AD_STUDIO_TEMPLATES: AdStudioTemplate[] = [
  meta002Template,
  meta003Template,
  meta004Template,
  meta005Template,
  meta006Template,
  meta007Template,
  meta008Template,
  meta009Template,
  meta010Template,
  meta011Template,
  meta012Template,
  meta013Template,
  meta014Template,
  meta015Template,
  meta016Template,
  meta017Template,
  meta018Template,
  meta019Template,
  meta020Template,
  meta021Template,
  meta022Template,
  meta023Template,
  meta024Template,
  meta025Template,
  meta026Template,
  meta027Template,
  meta028Template,
  meta029Template,
  meta030Template,
  meta031Template,
  meta032Template,
  meta033Template,
  meta034Template,
  meta035Template,
  meta036Template,
  meta037Template,
  meta038Template,
  meta039Template,
  meta040Template,
  meta041Template,
  meta042Template,
  meta043Template,
  meta044Template,
  meta045Template,
  meta046Template,
  meta047Template,
  meta048Template,
  meta049Template,
  meta050Template,
  meta051Template,
];

export const GOLD_TEMPLATE_RENDER_SAMPLES: Record<string, GoldTemplateRenderSample> = {
  [meta002Template.id]: meta002Sample,
  [meta003Template.id]: meta003Sample,
  [meta004Template.id]: meta004Sample,
  [meta005Template.id]: meta005Sample,
  [meta006Template.id]: meta006Sample,
  [meta007Template.id]: meta007Sample,
  [meta008Template.id]: meta008Sample,
  [meta009Template.id]: meta009Sample,
  [meta010Template.id]: meta010Sample,
  [meta011Template.id]: meta011Sample,
  [meta012Template.id]: meta012Sample,
  [meta013Template.id]: meta013Sample,
  [meta014Template.id]: meta014Sample,
  [meta015Template.id]: meta015Sample,
  [meta016Template.id]: meta016Sample,
  [meta017Template.id]: meta017Sample,
  [meta018Template.id]: meta018Sample,
  [meta019Template.id]: meta019Sample,
  [meta020Template.id]: meta020Sample,
  [meta021Template.id]: meta021Sample,
  [meta022Template.id]: meta022Sample,
  [meta023Template.id]: meta023Sample,
  [meta024Template.id]: meta024Sample,
  [meta025Template.id]: meta025Sample,
  [meta026Template.id]: meta026Sample,
  [meta027Template.id]: meta027Sample,
  [meta028Template.id]: meta028Sample,
  [meta029Template.id]: meta029Sample,
  [meta030Template.id]: meta030Sample,
  [meta031Template.id]: meta031Sample,
  [meta032Template.id]: meta032Sample,
  [meta033Template.id]: meta033Sample,
  [meta034Template.id]: meta034Sample,
  [meta035Template.id]: meta035Sample,
  [meta036Template.id]: meta036Sample,
  [meta037Template.id]: meta037Sample,
  [meta038Template.id]: meta038Sample,
  [meta039Template.id]: meta039Sample,
  [meta040Template.id]: meta040Sample,
  [meta041Template.id]: meta041Sample,
  [meta042Template.id]: meta042Sample,
  [meta043Template.id]: meta043Sample,
  [meta044Template.id]: meta044Sample,
  [meta045Template.id]: meta045Sample,
  [meta046Template.id]: meta046Sample,
  [meta047Template.id]: meta047Sample,
  [meta048Template.id]: meta048Sample,
  [meta049Template.id]: meta049Sample,
  [meta050Template.id]: meta050Sample,
  [meta051Template.id]: meta051Sample,
};
