#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { runScenario } from './_harness.mjs';

const BASE = process.env.LCOS_E2E_WEB_URL ?? 'http://localhost:5273';
const PROJECT = process.env.LCOS_E2E_PROJECT ?? 'lcos-gen2-dev';
const SHOTS = resolve(process.env.LCOS_E2E_SHOT_DIR ?? '.e2e-data/shots');
mkdirSync(SHOTS, { recursive: true });

function near(actual, expected, tolerance = 1.25) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

const exact = await runScenario({
  name: 'R2-figma-exact-main-morphology',
  baseUrl: BASE,
  viewport: { width: 1440, height: 900 },
  async body(h) {
    await h.goto(`/projects/${PROJECT}/main`);
    await h.requireSelector('[data-lcos-project-shell]', { timeout: 30000 });
    await h.requireSelector('.react-flow__node', { timeout: 60000 });
    await h.requireSelector('[data-lcos-source-visual="image"][data-figma-node-id="5388:98"]', { timeout: 60000 });
    await h.requireSelector('[data-lcos-source-visual="image"][data-figma-node-id="5388:111"]', { timeout: 60000 });
    await h.requireSelector('[data-lcos-source-visual="document"]', { timeout: 60000 });
    await h.requireSelector('[data-lcos-source-visual="text"]', { timeout: 60000 });
    await h.requireSelector('[data-lcos-source-visual="audio"]', { timeout: 60000 });
    await h.requireSelector('[data-lcos-glyth-body]', { timeout: 60000 });
    // The exact fixture has nine projected nodes. Waiting for the complete
    // projected set catches a canvas store/SSE race that individual selectors
    // cannot see when some nodes arrive after the first paint.
    await h.page.waitForFunction(
      () => document.querySelectorAll('.react-flow__node').length >= 9,
      undefined,
      { timeout: 60000 },
    );
    // Audio duration is real media metadata, never a caption/static string.
    await h.page.waitForFunction(
      () => {
        const media = document.querySelector('[data-lcos-audio-metadata]');
        return media instanceof HTMLAudioElement && media.readyState >= 1 &&
          Number.isFinite(media.duration) && Math.abs(media.duration - 38) <= 0.5;
      },
      undefined,
      { timeout: 60000 },
    );
    await h.wait(500);

    const metrics = await h.evaluate(() => {
      const viewport = document.querySelector('.react-flow__viewport');
      const zoom = Number(/scale\(([^)]+)\)/.exec(viewport?.style.transform ?? '')?.[1] ?? '1');
      const world = (rect) => ({
        width: rect.width / zoom,
        height: rect.height / zoom,
        left: rect.left / zoom,
        top: rect.top / zoom,
        right: rect.right / zoom,
        bottom: rect.bottom / zoom,
      });
      const by = (selector) => document.querySelector(selector);
      const nearestNode = (child) => child?.closest('.react-flow__node') ?? null;
      const hostOf = (node) => node?.querySelector('[data-lcos-host-surface]') ?? null;
      const hostFacts = (node) => {
        const host = hostOf(node);
        return {
          surface: host?.getAttribute('data-lcos-host-surface') ?? null,
          background: host ? getComputedStyle(host).backgroundColor : null,
          aiBadge: node?.querySelectorAll('[data-lcos-ai-badge]').length ?? -1,
        };
      };
      const nodeFacts = (selector) => {
        const visual = by(selector);
        const node = nearestNode(visual);
        return {
          visual,
          node,
          rect: node ? world(node.getBoundingClientRect()) : null,
          host: hostFacts(node),
        };
      };

      const glythVisual = by('[data-lcos-glyth-body]');
      const glythNode = nearestNode(glythVisual);
      const glythVector = by('[data-lcos-glyth-vector]');
      const glythShape = glythVector?.querySelector('path') ?? null;
      const glythEyes = Array.from(glythVector?.querySelectorAll('[data-lcos-glyth-eyes] path') ?? []);
      const image = nodeFacts('[data-lcos-source-visual="image"][data-figma-node-id="5388:98"]');
      const material = nodeFacts('[data-lcos-source-visual="image"][data-figma-node-id="5388:111"]');
      const documentNode = nodeFacts('[data-lcos-source-visual="document"]');
      const text = nodeFacts('[data-lcos-source-visual="text"]');
      const audio = nodeFacts('[data-lcos-source-visual="audio"]');
      const audioMedia = audio.visual?.querySelector('[data-lcos-audio-metadata]');

      const imageMedia = image.visual?.querySelector('[data-lcos-source-media]') ?? null;
      const imageMarker = image.visual?.querySelector('[data-lcos-source-corner-marker]') ?? null;
      const materialMedia = material.visual?.querySelector('[data-lcos-source-media]') ?? null;
      const materialMarker = material.visual?.querySelector('[data-lcos-source-corner-marker]') ?? null;
      const textMarker = text.visual?.querySelector('[data-lcos-source-corner-marker]') ?? null;
      const bars = Array.from(audio.visual?.querySelectorAll('[data-lcos-wave-bar]') ?? []);
      const barRects = bars.map((element) => element.getBoundingClientRect());
      const waveWidth = barRects.length > 0
        ? (barRects.at(-1).right - barRects[0].left) / zoom
        : 0;
      const firstGap = barRects.length >= 2
        ? (barRects[1].left - barRects[0].left) / zoom - barRects[0].width / zoom
        : Number.NaN;

      const imageMediaWorld = imageMedia ? world(imageMedia.getBoundingClientRect()) : null;
      const imageMarkerWorld = imageMarker ? world(imageMarker.getBoundingClientRect()) : null;
      const materialMediaWorld = materialMedia ? world(materialMedia.getBoundingClientRect()) : null;
      const materialMarkerWorld = materialMarker ? world(materialMarker.getBoundingClientRect()) : null;
      const textMarkerWorld = textMarker ? world(textMarker.getBoundingClientRect()) : null;
      const textWorld = text.visual ? world(text.visual.getBoundingClientRect()) : null;

      return {
        zoom,
        nativeEditorsInsideLcosBodies: document.querySelectorAll('[data-lcos-species-body] .milkdown').length,
        glyth: {
          node: glythNode ? world(glythNode.getBoundingClientRect()) : null,
          vector: glythVector ? world(glythVector.getBoundingClientRect()) : null,
          host: hostFacts(glythNode),
          shape: glythVisual?.getAttribute('data-lcos-glyth-shape') ?? null,
          tone: glythVisual?.getAttribute('data-lcos-glyth-tone') ?? null,
          bodyFill: glythShape ? getComputedStyle(glythShape).fill : null,
          eyeFills: glythEyes.map((eye) => getComputedStyle(eye).fill),
        },
        image: {
          node: image.rect,
          host: image.host,
          media: imageMediaWorld,
          mediaRadius: imageMedia ? getComputedStyle(imageMedia).borderRadius : null,
          marker: imageMarkerWorld,
          markerVisible: imageMarker ? imageMarker.getClientRects().length > 0 : false,
          markerLeftFromMedia: imageMarkerWorld && imageMediaWorld ? imageMarkerWorld.left - imageMediaWorld.left : null,
          markerTopFromMedia: imageMarkerWorld && imageMediaWorld ? imageMarkerWorld.top - imageMediaWorld.top : null,
        },
        material: {
          node: material.rect,
          host: material.host,
          media: materialMediaWorld,
          mediaRadius: materialMedia ? getComputedStyle(materialMedia).borderRadius : null,
          marker: materialMarkerWorld,
          markerVisible: materialMarker ? materialMarker.getClientRects().length > 0 : false,
          markerLeftFromMedia: materialMarkerWorld && materialMediaWorld ? materialMarkerWorld.left - materialMediaWorld.left : null,
          markerTopFromMedia: materialMarkerWorld && materialMediaWorld ? materialMarkerWorld.top - materialMediaWorld.top : null,
        },
        document: {
          node: documentNode.rect,
          host: documentNode.host,
          radius: documentNode.visual ? getComputedStyle(documentNode.visual).borderRadius : null,
          background: documentNode.visual ? getComputedStyle(documentNode.visual).backgroundColor : null,
        },
        text: {
          node: text.rect,
          host: text.host,
          fontSize: text.visual
            ? getComputedStyle(text.visual.querySelector('[data-lcos-node-preview]')).fontSize
            : null,
          lineHeight: text.visual
            ? getComputedStyle(text.visual.querySelector('[data-lcos-node-preview]')).lineHeight
            : null,
          marker: textMarkerWorld,
          markerLeft: textMarkerWorld && textWorld ? textMarkerWorld.left - textWorld.left : null,
          markerTop: textMarkerWorld && textWorld ? textMarkerWorld.top - textWorld.top : null,
        },
        audio: {
          node: audio.rect,
          host: audio.host,
          bars: bars.length,
          waveWidth,
          firstGap,
          caption: audio.visual?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          duration: audioMedia instanceof HTMLAudioElement ? audioMedia.duration : null,
          firstBarColor: bars[0] ? getComputedStyle(bars[0]).backgroundColor : null,
          lastBarColor: bars.at(-1) ? getComputedStyle(bars.at(-1)).backgroundColor : null,
        },
      };
    });

    console.log('[figma-exact]', JSON.stringify(metrics));
    const transparent = (value) => value === 'rgba(0, 0, 0, 0)' || value === 'transparent';

    h.requireEqual(metrics.nativeEditorsInsideLcosBodies, 0, 'Core-bound LCOS bodies must not mount native Milkdown editors underneath');
    h.requireTrue(metrics.glyth.node !== null, 'Glyth node bbox missing');
    h.requireTrue(near(metrics.glyth.node.width, 121) && near(metrics.glyth.node.height, 142), 'Glyth node must be 121×142 world px');
    h.requireTrue(metrics.glyth.vector !== null && near(metrics.glyth.vector.width, 92) && near(metrics.glyth.vector.height, 92), 'Glyth body must be 92×92');
    h.requireEqual(metrics.glyth.host.surface, 'transparent', 'Glyth host surface must be transparent');
    h.requireTrue(transparent(metrics.glyth.host.background), `Glyth host still paints a native background: ${metrics.glyth.host.background}`);
    h.requireEqual(metrics.glyth.host.aiBadge, 0, 'Glyth must not carry native Huabu AI badge');
    h.requireEqual(metrics.glyth.shape, 'blob', 'Current Figma only authorizes the dark blob anchor');
    h.requireEqual(metrics.glyth.tone, 'ink', 'Current Figma Glyth anchor is dark/ink');
    h.requireEqual(metrics.glyth.bodyFill, 'rgb(36, 38, 37)', 'Glyth body must use the current Figma dark anchor');
    h.requireTrue(metrics.glyth.eyeFills.length === 2 && metrics.glyth.eyeFills.every((fill) => fill === 'rgb(255, 255, 255)'), `Glyth eyes must stay white: ${JSON.stringify(metrics.glyth.eyeFills)}`);

    h.requireTrue(metrics.image.node !== null && near(metrics.image.node.width, 410) && near(metrics.image.node.height, 273), 'Main image node must start at 410×273');
    h.requireEqual(metrics.image.host.surface, 'media', 'Main image host surface must be media');
    h.requireTrue(transparent(metrics.image.host.background), `Image host still paints a native background: ${metrics.image.host.background}`);
    h.requireEqual(metrics.image.host.aiBadge, 0, 'Core image must not carry native Huabu AI badge');
    h.requireTrue(metrics.image.media !== null && near(metrics.image.media.width, 410) && near(metrics.image.media.height, 273), 'Main image media must be 410×273');
    h.requireEqual(metrics.image.mediaRadius, '7px', 'Main image media radius must match Figma');
    h.requireTrue(metrics.image.marker !== null && near(metrics.image.marker.width, 11) && near(metrics.image.marker.height, 11), 'Main image marker must be visible 11×11');
    h.requireTrue(metrics.image.markerVisible, 'Main image marker is clipped/hidden');
    h.requireTrue(near(metrics.image.markerLeftFromMedia, 402) && near(metrics.image.markerTopFromMedia, -5), 'Main image marker must keep Figma x=402/y=-5');

    h.requireTrue(metrics.material.node !== null && near(metrics.material.node.width, 205) && near(metrics.material.node.height, 127), 'Material image node must start at 205×127');
    h.requireEqual(metrics.material.host.surface, 'media', 'Material image host surface must be media');
    h.requireTrue(metrics.material.media !== null && near(metrics.material.media.width, 205) && near(metrics.material.media.height, 127), 'Material image media must be 205×127');
    h.requireEqual(metrics.material.mediaRadius, '6px', 'Material image media radius must match Figma');
    h.requireTrue(metrics.material.marker !== null && near(metrics.material.marker.width, 9) && near(metrics.material.marker.height, 9), 'Material image marker must be 9×9');
    h.requireTrue(metrics.material.markerVisible, 'Material image marker is clipped/hidden');
    h.requireTrue(near(metrics.material.markerLeftFromMedia, 196) && near(metrics.material.markerTopFromMedia, -4), 'Material image marker must keep Figma x=196/y=-4');

    h.requireTrue(metrics.document.node !== null && near(metrics.document.node.width, 206) && near(metrics.document.node.height, 154), 'Document node must be 206×154');
    h.requireEqual(metrics.document.host.surface, 'paper', 'Document host surface must be paper');
    h.requireEqual(metrics.document.host.aiBadge, 0, 'Core document must not carry native Huabu AI badge');
    h.requireEqual(metrics.document.radius, '2px', 'Document paper radius must match Figma');
    h.requireEqual(metrics.document.background, 'rgb(255, 254, 249)', 'Document paper color must match Figma');

    h.requireTrue(metrics.text.node !== null && near(metrics.text.node.width, 385) && near(metrics.text.node.height, 142), 'Text node must be 385×142');
    h.requireEqual(metrics.text.host.surface, 'transparent', 'Text host surface must be transparent');
    h.requireTrue(transparent(metrics.text.host.background), `Text host still paints a native background: ${metrics.text.host.background}`);
    h.requireEqual(metrics.text.host.aiBadge, 0, 'Core text must not carry native Huabu AI badge');
    h.requireEqual(metrics.text.fontSize, '37px', 'Text Main typography must be 37px at readable/working LOD');
    h.requireEqual(metrics.text.lineHeight, '58px', 'Text Main line height must be 58px');
    h.requireTrue(metrics.text.marker !== null && near(metrics.text.marker.width, 11) && near(metrics.text.marker.height, 11), 'Text marker must be 11×11');
    h.requireTrue(near(metrics.text.markerLeft, 374) && near(metrics.text.markerTop, 3), 'Text marker must keep Figma x=374/y=3');

    h.requireTrue(metrics.audio.node !== null && near(metrics.audio.node.width, 171) && near(metrics.audio.node.height, 96), 'Audio node must be 171×96');
    h.requireEqual(metrics.audio.host.surface, 'transparent', 'Audio host surface must be transparent');
    h.requireTrue(transparent(metrics.audio.host.background), `Audio host still paints a native background: ${metrics.audio.host.background}`);
    h.requireEqual(metrics.audio.host.aiBadge, 0, 'Core audio must not carry native Huabu AI badge');
    h.requireEqual(metrics.audio.bars, 64, 'Audio must render all 64 Figma bars');
    h.requireTrue(metrics.audio.waveWidth <= 171.01, `Audio waveform overflows: ${metrics.audio.waveWidth}px`);
    h.requireTrue(near(metrics.audio.firstGap, 0.671875, 0.08), `Audio bar gap differs from Figma: ${metrics.audio.firstGap}px`);
    h.requireTrue(near(metrics.audio.duration, 38, 0.5), `Audio media metadata duration must be 38s: ${metrics.audio.duration}`);
    h.requireEqual(metrics.audio.firstBarColor, 'rgb(85, 120, 108)', 'Audio active waveform tone must match Figma');
    h.requireEqual(metrics.audio.lastBarColor, 'rgb(198, 210, 206)', 'Audio tail waveform tone must match Figma');

    await h.screenshot(resolve(SHOTS, 'r2-figma-exact-main-1440.png'));
  },
});

const persisted = await runScenario({
  name: 'R2-figma-user-geometry-survives-reconcile',
  baseUrl: BASE,
  viewport: { width: 1440, height: 900 },
  async body(h) {
    await h.goto(`/projects/${PROJECT}/main`);
    await h.requireSelector('[data-lcos-source-visual="document"]', { timeout: 60000 });
    const center = await h.evaluate(() => {
      const visual = document.querySelector('[data-lcos-source-visual="document"]');
      const node = visual?.closest('.react-flow__node');
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    h.requireTrue(center !== null, 'Document node center missing');
    await h.page.mouse.click(center.x, center.y);
    await h.requireSelector('[data-lcos-action-arc]', { timeout: 8000 });
    const arcGeometry = await h.evaluate(() => {
      const arc = document.querySelector('[data-lcos-action-arc]');
      const orbs = Array.from(document.querySelectorAll('[data-lcos-action-orb]'));
      const hits = Array.from(document.querySelectorAll('[data-lcos-action-orb-hit]'));
      const icons = Array.from(document.querySelectorAll('[data-lcos-action-orb] svg'));
      return {
        mode: arc?.getAttribute('data-lcos-arc-mode') ?? null,
        orbs: orbs.map((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
        hits: hits.map((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
        icons: icons.map((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
      };
    });
    h.requireEqual(arcGeometry.mode, 'extended-four', 'Production 3-primary + More must use the explicit extended-four Arc mode');
    h.requireEqual(arcGeometry.orbs.length, 4, 'Extended Action Arc must render 4 visible orbs');
    h.requireTrue(arcGeometry.orbs.every((rect) => near(rect.width, 30, 0.5) && near(rect.height, 30, 0.5)), `Action Arc visible orb geometry drifted: ${JSON.stringify(arcGeometry.orbs)}`);
    h.requireTrue(arcGeometry.hits.every((rect) => near(rect.width, 44, 0.5) && near(rect.height, 44, 0.5)), `Action Arc hit target geometry drifted: ${JSON.stringify(arcGeometry.hits)}`);
    h.requireTrue(arcGeometry.icons.every((rect) => near(rect.width, 17, 0.5) && near(rect.height, 17, 0.5)), `Action Arc icon geometry drifted: ${JSON.stringify(arcGeometry.icons)}`);
    await h.page.click('[data-lcos-arc-more]');
    await h.requireSelector('[data-lcos-size-width]', { timeout: 5000 });
    await h.page.locator('[data-lcos-size-width]').fill('250');
    await h.page.locator('[data-lcos-size-height]').fill('180');
    await h.page.click('[data-lcos-size-apply]');
    await h.wait(900);

    const readWorldSize = async () => h.evaluate(() => {
      const viewport = document.querySelector('.react-flow__viewport');
      const zoom = Number(/scale\(([^)]+)\)/.exec(viewport?.style.transform ?? '')?.[1] ?? '1');
      const node = document.querySelector('[data-lcos-source-visual="document"]')?.closest('.react-flow__node');
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { width: rect.width / zoom, height: rect.height / zoom };
    });

    const resized = await readWorldSize();
    h.requireTrue(resized !== null && near(resized.width, 250) && near(resized.height, 180), `Resize did not commit: ${JSON.stringify(resized)}`);

    // Wait for the real structure PUT to become observable on Huabu before
    // closing/reloading the page. The autosave debounce is intentionally
    // asynchronous; a fixed sleep shorter than it races unloadFlush and
    // produces a false "Failed to fetch" from the test browser closing.
    const canvasId = await h.evaluate(async (projectId) => {
      const response = await fetch(`/lcos-core/projects/${encodeURIComponent(projectId)}/workspaces`, {
        headers: { Authorization: 'Bearer dev-token' },
      });
      if (!response.ok) throw new Error(`workspace lookup failed: HTTP ${response.status}`);
      const envelope = await response.json();
      const workspaces = Array.isArray(envelope?.value) ? envelope.value : envelope;
      return Array.isArray(workspaces)
        ? workspaces.find((workspace) => workspace?.preferredSurface === 'main')?.canvasId ?? null
        : null;
    }, PROJECT);
    h.requireNonEmpty(canvasId, 'Main workspace canvasId missing while waiting for persisted geometry');
    await h.page.waitForFunction(
      async ({ canvasId: currentCanvasId }) => {
        try {
          const response = await fetch(`/api/canvas/${encodeURIComponent(currentCanvasId)}`);
          if (!response.ok) return false;
          const payload = await response.json();
          const nodes = payload?.state?.nodes;
          if (!Array.isArray(nodes)) return false;
          return nodes.some((node) => {
            const width = Number(node?.width ?? node?.style?.width);
            const height = Number(node?.height ?? node?.style?.height);
            return Math.abs(width - 250) <= 0.5 && Math.abs(height - 180) <= 0.5;
          });
        } catch {
          return false;
        }
      },
      { canvasId },
      { timeout: 15000 },
    );

    await h.page.reload({ waitUntil: 'domcontentloaded' });
    await h.requireSelector('[data-lcos-source-visual="document"]', { timeout: 60000 });
    await h.wait(800);
    const reloaded = await readWorldSize();
    h.requireTrue(
      reloaded !== null && near(reloaded.width, 250) && near(reloaded.height, 180),
      `Reconcile overwrote persisted user geometry: ${JSON.stringify(reloaded)}`,
    );
  },
});

if (!exact.ok || !persisted.ok) process.exitCode = 1;
