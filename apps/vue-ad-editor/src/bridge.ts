import { fabric } from 'fabric';
import {
  hostContent,
  registerHostActions,
  type FabricScene,
  type HostAsset,
  type HostTemplate,
  type Placement,
} from '@/hostContent';

const CHANNEL = 'blockwise.vue-editor';
const VERSION = 1;
const UPSTREAM = {
  repository: 'https://github.com/ikuaitu/vue-fabric-editor',
  commit: 'b3bdcfb0bd6d8f98e7483cf561ac03ba56c0d889',
  license: 'MIT',
};
const DIMENSIONS = {
  feed: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
} as const;

interface Envelope {
  channel: typeof CHANNEL;
  version: typeof VERSION;
  type: string;
  requestId?: string;
  payload?: any;
}

interface PlacementScene {
  width: number;
  height: number;
  scene: FabricScene;
}

interface InitializePayload {
  allowedOrigin?: string;
  placements: Record<Placement, PlacementScene>;
  activePlacement: Placement;
  fonts?: Array<{ family: string; url: string; descriptors?: FontFaceDescriptors }>;
  templates?: HostTemplate[];
  assets?: HostAsset[];
}

const isPlacement = (value: unknown): value is Placement => value === 'feed' || value === 'story';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function createEditorBridge(canvasEditor: any) {
  const canvas = canvasEditor.fabricCanvas as fabric.Canvas;
  const scenes: Partial<Record<Placement, FabricScene>> = {};
  const imageTargets = new Map<string, fabric.Object>();
  let activePlacement: Placement = 'feed';
  let suppressChanges = false;
  let changedTimer: number | undefined;
  let disposed = false;
  let lastNotified = '';
  let operation = Promise.resolve();

  const send = (type: string, payload?: unknown, requestId?: string) => {
    if (window.parent === window) return;
    const message: Envelope = { channel: CHANNEL, version: VERSION, type, payload };
    if (requestId) message.requestId = requestId;
    window.parent.postMessage(message, window.location.origin);
  };

  const error = (code: string, message: string, requestId?: string, requestType?: string) => {
    send('error', { code, message, requestType }, requestId);
  };

  const sceneFromCanvas = () => {
    const scene = clone(canvasEditor.getJson()) as any;
    Object.assign(scene, DIMENSIONS[activePlacement]);
    const canonicalize = (value: any) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'src' && typeof child === 'string') {
          const url = new URL(child, window.location.origin);
          if (url.origin === window.location.origin) value[key] = url.pathname + url.search;
        } else canonicalize(child);
      }
    };
    canonicalize(scene);
    return scene as FabricScene;
  };

  const normalizeScene = (placement: Placement, scene: FabricScene) => {
    if (!scene || !Array.isArray((scene as any).objects)) {
      throw new Error('Scene must be Fabric canvas JSON with an objects array.');
    }
    const normalized = clone(scene) as any;
    const workspace = normalized.objects.find((item: any) => item?.id === 'workspace');
    if (!workspace) throw new Error('Scene is missing the workspace object.');
    const dimensions = DIMENSIONS[placement];
    Object.assign(normalized, dimensions);
    workspace.left = 0; workspace.top = 0; workspace.scaleX = 1; workspace.scaleY = 1;
    workspace.width = dimensions.width;
    workspace.height = dimensions.height;
    workspace.selectable = false;
    workspace.hasControls = false;
    workspace.evented = false;
    normalized.version ||= fabric.version;
    return normalized as FabricScene;
  };

  const loadScene = async (placement: Placement, scene: FabricScene) => {
    suppressChanges = true;
    try {
      const normalized = normalizeScene(placement, scene);
      await new Promise<void>((resolve, reject) => {
        try {
          canvasEditor.loadJSON(normalized, resolve);
        } catch (cause) {
          reject(cause);
        }
      });
      activePlacement = placement;
      hostContent.activePlacement = placement;
      const workspace = canvas.getObjects().find((object: any) => object.id === 'workspace');
      workspace?.set({ selectable: false, evented: false, hasControls: false });
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      scenes[placement] = sceneFromCanvas();
      lastNotified = JSON.stringify(scenes[placement]);
    } finally {
      suppressChanges = false;
    }
  };

  const snapshotCurrent = () => {
    // Finish the upstream crop handle before serializing its final clip path.
    if ((canvas.getActiveObject() as any)?.clip) canvas.discardActiveObject();
    scenes[activePlacement] = sceneFromCanvas();
    return scenes[activePlacement]!;
  };

  const notifyChanged = () => {
    if (suppressChanges || disposed) return;
    window.clearTimeout(changedTimer);
    changedTimer = window.setTimeout(() => {
      if (suppressChanges) return;
      const scene = snapshotCurrent();
      const serialized = JSON.stringify(scene);
      if (serialized === lastNotified) return;
      lastNotified = serialized;
      send('changed', { placement: activePlacement, scene });
    }, 250);
  };

  const canvasEvents = ['object:added', 'object:modified', 'object:removed', 'text:changed', 'after:render'];
  canvasEvents.forEach((name) => canvas.on(name as any, notifyChanged));

  const loadFonts = async (fonts: InitializePayload['fonts'] = []) => {
    const loaded = await Promise.all(
      fonts.map(async ({ family, url, descriptors }) => {
        const face = new FontFace(family, `url("${url}")`, descriptors);
        await face.load();
        document.fonts.add(face);
        return { name: family, type: 'host', file: url, img: '' };
      })
    );
    const fontPlugin = canvasEditor.getPlugin('FontPlugin');
    if (fontPlugin) fontPlugin.cacheList = loaded;
  };

  // Fit only newly converted template text using the editor's loaded fonts.
  // Removing the transient marker preserves all later user sizing on reopen.
  const fitTemplateText = (scene: FabricScene, placement: Placement) => {
    const visit = (object: any) => {
      const box = object.metadata?.templateTextBox;
      if (object.type === 'textbox' && box) {
        // Repeated bullets and other ornaments are artwork, not readable copy.
        if (!/[\p{L}\p{N}]/u.test(object.text || '')) {
          const { templateTextBox, ...metadata } = object.metadata;
          object.metadata = metadata;
          return;
        }
        const base = Number(object.fontSize);
        const floor = Math.min(base, placement === 'feed' ? 24 : 32);
        const tracking = Number(object.charSpacing || 0) * base / 1000;
        let fitted: fabric.Textbox | undefined;
        for (let size = base; size >= floor; size = Math.max(floor, size - 1)) {
          const candidate = new fabric.Textbox(object.text || '', {
            ...object, width: box.width, fontSize: size, charSpacing: tracking * 1000 / size,
            splitByGrapheme: false,
          });
          const lines = (candidate as any)._textLines.length;
          if (candidate.width! <= box.width + 0.1 && lines <= box.maxLines
              && candidate.height! <= box.height + size * 0.2) {
            fitted = candidate;
            break;
          }
          if (size === floor) break;
        }
        // Honor the pack's existing overflow policy instead of shrinking body
        // copy below its readability floor or letting it cover other layers.
        if (!fitted && box.overflowBehaviour === 'truncate') {
          let text = String(object.text || '');
          while (text.length > 0) {
            const shortened = text.replace(/\s+\S+$/, '');
            text = shortened === text ? text.slice(0, -1) : shortened;
            const candidate = new fabric.Textbox(text + '…', {
              ...object, text: text + '…', width: box.width, fontSize: floor,
              charSpacing: tracking * 1000 / floor, splitByGrapheme: false,
            });
            if (candidate.width! <= box.width + 0.1
                && (candidate as any)._textLines.length <= box.maxLines
                && candidate.height! <= box.height + floor * 0.2) {
              fitted = candidate;
              object.text = candidate.text;
              break;
            }
          }
        }
        if (!fitted) throw new Error('Template text does not fit: ' + object.id);
        object.fontSize = fitted.fontSize;
        object.charSpacing = fitted.charSpacing;
        object.splitByGrapheme = false;
        const { templateTextBox, ...metadata } = object.metadata;
        object.metadata = metadata;
      }
      for (const child of object.objects || []) visit(child);
    };
    for (const object of (scene as any).objects) visit(object);
  };

  const initialize = async (payload: InitializePayload, requestId?: string) => {
    if (payload.allowedOrigin && payload.allowedOrigin !== window.location.origin) {
      throw new Error('allowedOrigin must match the editor origin.');
    }
    if (!payload.placements?.feed || !payload.placements?.story) {
      throw new Error('Both Feed and Story placements are required.');
    }
    for (const placement of ['feed', 'story'] as Placement[]) {
      const supplied = payload.placements[placement];
      const expected = DIMENSIONS[placement];
      if (supplied.width !== expected.width || supplied.height !== expected.height) {
        throw new Error(`${placement} must be ${expected.width} x ${expected.height}.`);
      }
      scenes[placement] = normalizeScene(placement, supplied.scene);
    }
    hostContent.templates = payload.templates || [];
    hostContent.assets = payload.assets || [];
    await loadFonts(payload.fonts);
    fitTemplateText(scenes.feed!, 'feed');
    fitTemplateText(scenes.story!, 'story');
    const requested = isPlacement(payload.activePlacement) ? payload.activePlacement : 'feed';
    await loadScene(requested, scenes[requested]!);
    send('initialized', { activePlacement: requested }, requestId);
  };

  // Render a frozen scene with the same Fabric runtime, without switching the
  // visible canvas or resetting the user's selection and undo history.
  const renderSnapshot = async (placement: Placement, scene: FabricScene) => {
    const output = new fabric.StaticCanvas(null, { ...DIMENSIONS[placement], enableRetinaScaling: false });
    try {
      await new Promise<void>((resolve, reject) => {
        try { output.loadFromJSON(clone(scene), () => resolve()); } catch (cause) { reject(cause); }
      });
      output.setViewportTransform([1, 0, 0, 1, 0, 0]);
      output.renderAll();
      return output.toDataURL({ format: 'png', multiplier: 1, ...DIMENSIONS[placement] });
    } finally { output.dispose(); }
  };

  const exportPlacement = async (placement: Placement, format: 'png' | 'json' | 'both', requestId?: string) => {
    snapshotCurrent();
    if (!scenes[placement]) throw new Error(`No ${placement} scene is loaded.`);
    const scene = clone(scenes[placement]!);
    const payload: Record<string, unknown> = { placement };
    if (format !== 'png') payload.scene = scene;
    if (format !== 'json') payload.pngDataUrl = await renderSnapshot(placement, scene);
    send('exported', payload, requestId);
  };

  const snapshotBoth = async (requestId?: string) => {
    snapshotCurrent();
    if (!scenes.feed || !scenes.story) throw new Error('Both placements must be loaded before saving.');
    // Both JSON scenes are frozen synchronously before either image is rendered.
    const frozen = { feed: clone(scenes.feed), story: clone(scenes.story) };
    const feed = { placement: 'feed', scene: frozen.feed, pngDataUrl: await renderSnapshot('feed', frozen.feed) };
    const story = { placement: 'story', scene: frozen.story, pngDataUrl: await renderSnapshot('story', frozen.story) };
    send('snapshot', { feed, story }, requestId);
  };

  const requestAsset = (kind: 'upload' | 'choose') => {
    const requestId = crypto.randomUUID();
    const selected = canvas.getActiveObject() as any;
    if (selected && (selected.type === 'image' || ['image_slot', 'logo'].includes(selected.metadata?.blockwiseType))) imageTargets.set(requestId, selected);
    send('asset-request', { kind, accept: 'image/*' }, requestId);
  };

  const requestAi = () => {
    const selected = canvas.getActiveObject() as any;
    send(
      'ai-request',
      {
        kind: 'copy-assist',
        selection: selected
          ? { id: selected.id, type: selected.type, text: typeof selected.text === 'string' ? selected.text : undefined }
          : undefined,
        scene: sceneFromCanvas(),
        placement: activePlacement,
      },
      crypto.randomUUID()
    );
  };

  const unregisterActions = registerHostActions({
    requestAsset,
    requestAi,
    save: () => send('saved', { placement: activePlacement, scene: snapshotCurrent() }, crypto.randomUUID()),
    export: () => void exportPlacement(activePlacement, 'both', crypto.randomUUID()),
  });

  const applyAiResult = (payload: any) => {
    const text = payload?.result?.text;
    if (typeof text !== 'string') throw new Error('AI result must contain result.text.');
    const selected = canvas.getActiveObject() as any;
    if (!selected || typeof selected.text !== 'string') {
      throw new Error('Select a text object before applying AI copy.');
    }
    selected.set('text', text);
    selected.setCoords();
    canvas.requestRenderAll();
    notifyChanged();
  };

  const applyAssetResult = async (payload: any) => {
    const asset = payload?.asset as HostAsset | undefined;
    const target = imageTargets.get(payload?.requestId) as any;
    imageTargets.delete(payload?.requestId);
    if (!asset || payload?.cancelled) return;
    await new Promise<void>((resolve, reject) => {
      fabric.Image.fromURL(
        asset.url,
        (image) => {
          if (!image) return reject(new Error('Host asset could not be loaded.'));
          (image as any).id = asset.id;
          (image as any).name = asset.name;
          if (target && canvas.getObjects().includes(target)) {
            const width = target.width * target.scaleX, height = target.height * target.scaleY;
            const scale = Math.max(width / image.width!, height / image.height!);
            const cropWidth = width / scale, cropHeight = height / scale;
            image.set({
              left: target.left, top: target.top, originX: target.originX, originY: target.originY,
              angle: target.angle, opacity: target.opacity,
              cropX: (image.width! - cropWidth) / 2, cropY: (image.height! - cropHeight) / 2,
              width: cropWidth, height: cropHeight, scaleX: scale, scaleY: scale,
            });
            Object.assign(image, { id: target.id, inputKey: target.inputKey, layerId: target.layerId, metadata: target.metadata });
            if (target.clipPath) {
              const clip = clone(target.clipPath.toObject());
              clip.scaleX = (clip.scaleX || 1) * target.width / cropWidth;
              clip.scaleY = (clip.scaleY || 1) * target.height / cropHeight;
              fabric.util.enlivenObjects([clip], (objects: any[]) => { image.clipPath = objects[0]; canvas.requestRenderAll(); }, 'fabric');
            }
            const index = canvas.getObjects().indexOf(target);
            canvas.remove(target); canvas.insertAt(image, index, false); canvas.setActiveObject(image);
            image.setCoords(); canvas.requestRenderAll();
          } else canvasEditor.addBaseType(image, { scale: true });
          resolve();
        },
        { crossOrigin: 'anonymous' }
      );
    });
  };

  const handleMessage = async (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    const message = event.data as Partial<Envelope>;
    if (message?.channel !== CHANNEL || message.version !== VERSION || typeof message.type !== 'string') return;
    try {
      switch (message.type) {
        case 'initialize':
          await initialize(message.payload, message.requestId);
          break;
        case 'load-placement': {
          const placement = message.payload?.placement;
          if (!isPlacement(placement) || !scenes[placement]) throw new Error('Unknown placement.');
          snapshotCurrent();
          await loadScene(placement, scenes[placement]!);
          send('placement-loaded', { placement }, message.requestId);
          break;
        }
        case 'load-scene': {
          const placement = message.payload?.placement;
          if (!isPlacement(placement)) throw new Error('Unknown placement.');
          scenes[placement] = normalizeScene(placement, message.payload?.scene);
          if (placement === activePlacement) await loadScene(placement, scenes[placement]!);
          send('scene-loaded', { placement }, message.requestId);
          break;
        }
        case 'save': {
          const placement = message.payload?.placement;
          if (placement && placement !== activePlacement) throw new Error('Save the active placement or omit placement.');
          send('saved', { placement: activePlacement, scene: snapshotCurrent() }, message.requestId);
          break;
        }
        case 'snapshot':
          await snapshotBoth(message.requestId);
          break;
        case 'export': {
          const placement = message.payload?.placement || activePlacement;
          const format = message.payload?.format || 'both';
          if (!isPlacement(placement) || !['png', 'json', 'both'].includes(format)) throw new Error('Invalid export request.');
          await exportPlacement(placement, format, message.requestId);
          break;
        }
        case 'ai-result':
          applyAiResult(message.payload);
          break;
        case 'asset-result':
          await applyAssetResult(message.payload);
          break;
        default:
          error('unsupported_message', `Unsupported message: ${message.type}`, message.requestId, message.type);
      }
    } catch (cause) {
      error(
        'request_failed',
        cause instanceof Error ? cause.message : 'Editor request failed.',
        message.requestId,
        message.type
      );
    }
  };

  const listener = (event: MessageEvent) => {
    operation = operation.then(() => handleMessage(event), () => handleMessage(event));
  };
  window.addEventListener('message', listener);

  send('ready', {
    capabilities: { placements: ['feed', 'story'], formats: ['png', 'json'] },
    upstream: UPSTREAM,
  });

  return () => {
    disposed = true;
    window.clearTimeout(changedTimer);
    window.removeEventListener('message', listener);
    canvasEvents.forEach((name) => canvas.off(name as any, notifyChanged));
    unregisterActions();
  };
}
