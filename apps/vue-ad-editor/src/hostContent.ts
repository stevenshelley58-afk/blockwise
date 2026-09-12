import { reactive } from 'vue';

export type Placement = 'feed' | 'story';
export type FabricScene = Record<string, unknown>;

export interface HostTemplate {
  id: string;
  name: string;
  previewUrl?: string;
  placements: Partial<Record<Placement, FabricScene>>;
}

export interface HostAsset {
  id: string;
  name: string;
  url: string;
  thumbnailUrl?: string;
}

export const hostContent = reactive({
  activePlacement: 'feed' as Placement,
  templates: [] as HostTemplate[],
  assets: [] as HostAsset[],
});

type HostActions = {
  requestAsset: (kind: 'upload' | 'choose') => void;
  requestAi: () => void;
  save: () => void;
  export: () => void;
};

let actions: HostActions | null = null;

export function registerHostActions(next: HostActions) {
  actions = next;
  return () => {
    actions = null;
  };
}

export const requestHostAsset = (kind: 'upload' | 'choose') => actions?.requestAsset(kind);
export const requestAiAssist = () => actions?.requestAi();
export const requestHostSave = () => actions?.save();
export const requestHostExport = () => actions?.export();
