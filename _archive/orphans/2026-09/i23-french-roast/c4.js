import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
function buildExtrudeShape(points, holes) {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}
function ovalLoop(cx, cy, rx, ry, seg = 24) {
  const loop = [];
  for (let i = 0; i < seg; i += 1) {
    const a = i / seg * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}
function buildExtrudeGeometry(profile) {
  const holes = [...profile.holes ?? [], ...(profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1
  });
}
function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function readLayerNumber(value, keys, fallback) {
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    const record = value;
    for (const key of keys) {
      if (typeof record[key] === "number") return record[key];
    }
  }
  return fallback;
}
function hexToRgb(hex) {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex) ? "#" + hex.slice(1).split("").map((part) => part + part).join("") : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 9075295;
  return [value >> 16 & 255, value >> 8 & 255, value & 255];
}
function materialPalette(spec) {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === "string");
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...Array.isArray(secondary) ? secondary : []];
  return colors.filter((value) => typeof value === "string" && value.startsWith("#"));
}
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
function smoothCurve(value) {
  return value * value * (3 - 2 * value);
}
function periodicHash(x, y, seed, periodX, periodY) {
  const wrappedX = (x % periodX + periodX) % periodX;
  const wrappedY = (y % periodY + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967295;
}
function periodicValueNoise(u, v, seed, periodX, periodY) {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}
function surfaceBands(spec) {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const band = item;
    const frequency = typeof band.frequency === "number" ? band.frequency : 0;
    const amplitude = typeof band.amplitude === "number" ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? "")} ${String(band.role ?? "")}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === "number" ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === "number" ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description)
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false }
  ];
}
function sampleSurface(u, v, bands, seed) {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}
function mixPalette(colors, value) {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix))
  ];
}
function parseRgba(value) {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
function sampleColorGradient(gradient, u, v) {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: "rgba(138,122,95,1)" }, { offset: 1, color: "rgba(138,122,95,1)" }];
  let t;
  if (gradient.type === "radial") {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(1e-3, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix)
  ];
}
function writePixel(data, offset, red, green, blue) {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}
function makeCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}
function createMapTexture(canvas, colorSpace, spec, options) {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === "object" ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === "number" ? repeat[0] : 2,
    typeof repeat[1] === "number" ? repeat[1] : 2
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}
function referenceMapUrl(spec, channel) {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== "object") return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === "number" ? reference.confidence : typeof reference.estimatedFidelity === "number" ? reference.estimatedFidelity : 0;
  const threshold = typeof reference.targetThreshold === "number" ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== "object") return null;
  const map = maps[channel];
  if (!map || typeof map !== "object") return null;
  const record = map;
  const url = typeof record.url === "string" && record.url.trim() ? record.url : record.path;
  return typeof url === "string" && url.trim() ? url : null;
}
function createLoadedMapTexture(url, colorSpace, spec, options) {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === "object" ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === "number" ? repeat[0] : 1,
    typeof repeat[1] === "number" ? repeat[1] : 1
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}
function makeReferenceTextureSet(spec, options) {
  const albedo = referenceMapUrl(spec, "albedo");
  const roughness = referenceMapUrl(spec, "roughness");
  const height = referenceMapUrl(spec, "height");
  const normal = referenceMapUrl(spec, "normal");
  const ao = referenceMapUrl(spec, "ao");
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: "reference-pixel-extraction"
  };
}
function makeProceduralTextureSet(id, spec, options) {
  if (typeof document === "undefined") return null;
  const qualityFirst = (options.qualityPriority ?? "reference-fidelity") === "reference-fidelity";
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === "number" && Number.isFinite(requested) ? requested : qualityFirst ? 1024 : 512;
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size)
  };
  const contexts = {
    albedo: canvases.albedo.getContext("2d"),
    roughness: canvases.roughness.getContext("2d"),
    height: canvases.height.getContext("2d"),
    normal: canvases.normal.getContext("2d"),
    ao: canvases.ao.getContext("2d")
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size)
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === "string" ? spec.baseColor : "#8A7A5F";
  const colors = (palette.length >= 2 ? palette : [fallback, "#6E614B", "#A08F70"]).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ["base"], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ["variation"], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ["amplitude", "variation"], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ["heightCorrelation"], 0.3));
  const colorGradient = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color;
      if (colorGradient) {
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ["strength", "amplitude"], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ["cavityStrength", "strength"], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = (y - 1 + size) % size * size;
    const down = (y + 1) % size * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (heightField[y * size + left] + heightField[y * size + right] + heightField[up + x] + heightField[down + x]) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data,
        offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: "procedural"
  };
}
function createSculptMaterial(id, spec, options) {
  const textures = makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 16777215 : new THREE.Color(typeof spec.baseColor === "string" ? spec.baseColor : "#8A7A5F"),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ["base"], 0.76)),
    metalness: clamp01(readLayerNumber(spec.metalness, ["base"], 0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ["base", "amount"], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ["base"], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ["base", "amount"], 0)),
    ior: Math.max(1, readLayerNumber(spec.ior, ["base", "value"], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ["base", "amount"], 0)),
    attenuationDistance: Math.max(1e-3, readLayerNumber(spec.attenuationDistance, ["base", "value"], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === "string" ? spec.attenuationColor : "#ffffff"),
    sheen: clamp01(readLayerNumber(spec.sheen, ["base", "amount"], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === "string" ? spec.sheenColor : "#ffffff"),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ["base"], 1)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ["base", "amount"], 0)),
    iridescenceIOR: Math.max(1, readLayerNumber(spec.iridescenceIOR, ["base", "value"], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ["base", "amount"], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ["rotation"], 0),
    specularIntensity: clamp01(readLayerNumber(spec.specularIntensity, ["base"], 1)),
    specularColor: new THREE.Color(typeof spec.specularColor === "string" ? spec.specularColor : "#ffffff"),
    emissive: new THREE.Color(typeof spec.emissive === "string" ? spec.emissive : "#000000"),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ["base"], 1)),
    opacity: clamp01(readLayerNumber(spec.opacity, ["base"], 1)),
    transparent: readLayerNumber(spec.transmission, ["base", "amount"], 0) > 0 || readLayerNumber(spec.opacity, ["base"], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ["cutoff", "alphaTest"], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ["strength", "amplitude"], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ["cavityStrength", "strength"], 0.35);
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ["amplitude", "strength"], 0));
    if (bumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = bumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ["amplitude", "strength"], 0));
    if (displacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = displacementScale;
      material.displacementBias = -displacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ["envMapIntensity"], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrTextureSource = textures?.source ?? "flat-fallback";
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.needsUpdate = true;
  return material;
}
function readVector3(value, fallback) {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number")) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}
function readNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function makeAttachmentEndpoint(attachment) {
  if (!attachment || typeof attachment !== "object") return null;
  const record = attachment;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 1e-4) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(5e-3, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(3e-3, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius
  };
}
function createTeeccinoFrenchRoast500gPouchModel(options = {}) {
  const root = new THREE.Group();
  root.name = "Teeccino French Roast 500g Pouch";
  root.userData.reconstructionEvidence = { "itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": { "solved": false, "fovDegrees": 40, "aspect": 1, "orientation": { "yaw": 0, "pitch": 0, "roll": 0 }, "positionHint": [0, 0, 3], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review." }, "approximationNotes": [] };
  const materialMap = {};
  materialMap["film-green"] = createSculptMaterial(
    "film-green",
    { "id": "film-green", "name": "Matte green foil film", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#40600E", "color": "#40600E", "albedo": { "dominant": "#40600E", "secondary": ["#BFB991", "#3F5E0F", "#4C6C1B"], "samplingNotes": "Mean of crops/pouch-body-green.png (#40600E); matte metallised film, low spec.", "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_albedo.png", "url": "base_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction" } }, "colorVariation": { "palette": ["#A65941", "#BFB991", "#3F5E0F", "#4C6C1B", "#2D4605"], "pattern": "reference-derived pixel palette", "amplitude": 0.213, "heightCorrelation": 0.42 }, "textureResolution": 1024, "textureProjection": { "mode": "uv", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale." }, "surfaceFrequencyBands": [{ "id": "macro", "frequency": 2, "amplitude": 0.458, "role": "reference-derived broad albedo and height breakup" }, { "id": "meso", "frequency": 14, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters" }, { "id": "micro", "frequency": 72, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light" }], "roughness": { "base": 0.72, "variation": 0.098, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_roughness.png", "url": "base_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction" }, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother" }, "metalness": 0.05, "normal": { "pattern": "reference-derived height-gradient normal map", "strength": 0.222, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_normal.png", "url": "base_normal.png", "channel": "normal", "source": "reference-pixel-extraction" }, "heightSource": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_height.png", "url": "base_height.png", "channel": "height", "source": "reference-pixel-extraction" }, "space": "tangent" }, "bump": { "pattern": "reference-derived height field", "amplitude": 0.025, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_height.png", "url": "base_height.png", "channel": "height", "source": "reference-pixel-extraction" } }, "displacement": { "pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false }, "ambientOcclusion": { "cavityStrength": 0.38, "contactShadowBias": 0.35, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_ao.png", "url": "base_ao.png", "channel": "ao", "source": "reference-pixel-extraction" }, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot." }, "wear": { "edgeWear": 0, "scratches": [], "chips": [] }, "dirt": { "amount": 0, "cavityBias": 0, "color": "#2F2A22" }, "localOverrides": [{ "id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison." }], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": { "version": "1.0", "sourceImage": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\fr-ref.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": { "albedo": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_albedo.png", "url": "base_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction" }, "roughness": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_roughness.png", "url": "base_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction" }, "height": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_height.png", "url": "base_height.png", "channel": "height", "source": "reference-pixel-extraction" }, "normal": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_normal.png", "url": "base_normal.png", "channel": "normal", "source": "reference-pixel-extraction" }, "ao": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_ao.png", "url": "base_ao.png", "channel": "ao", "source": "reference-pixel-extraction" } }, "diagnostics": { "sourceWidth": 1500, "sourceHeight": 1500, "mapSize": 1024, "cropBBoxPixels": { "x": 293, "y": 20, "width": 917, "height": 1460 }, "mask": { "backgroundColor": "#FFFFFF", "backgroundNoise": 0, "transparentPixelFraction": 0, "foregroundCoverage": 0.4957 }, "mapStats": { "valueRange": 0.5074, "heightP90Gradient": 0.05633, "roughnessBase": 0.705, "roughnessVariation": 0.098, "normalStrength": 0.222, "blurRadius": 21 }, "palette": ["#A65941", "#BFB991", "#3F5E0F", "#4C6C1B", "#2D4605"] }, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"] }, "materialClass": "plastic" },
    options
  );
  materialMap["film-cream"] = createSculptMaterial(
    "film-cream",
    { "id": "film-cream", "name": "Matte cream foil film", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#C2BD93", "color": "#C2BD93", "albedo": { "dominant": "#C2BD93", "secondary": ["#BFB991", "#3F5E0F", "#4C6C1B"], "samplingNotes": "Mean of crops/pouch-body-cream.png (#C2BD93).", "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_albedo.png", "url": "base_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction" } }, "colorVariation": { "palette": ["#A65941", "#BFB991", "#3F5E0F", "#4C6C1B", "#2D4605"], "pattern": "reference-derived pixel palette", "amplitude": 0.213, "heightCorrelation": 0.42 }, "textureResolution": 1024, "textureProjection": { "mode": "uv", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale." }, "surfaceFrequencyBands": [{ "id": "macro", "frequency": 2, "amplitude": 0.458, "role": "reference-derived broad albedo and height breakup" }, { "id": "meso", "frequency": 14, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters" }, { "id": "micro", "frequency": 72, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light" }], "roughness": { "base": 0.74, "variation": 0.098, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_roughness.png", "url": "base_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction" }, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother" }, "metalness": 0.05, "normal": { "pattern": "reference-derived height-gradient normal map", "strength": 0.222, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_normal.png", "url": "base_normal.png", "channel": "normal", "source": "reference-pixel-extraction" }, "heightSource": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_height.png", "url": "base_height.png", "channel": "height", "source": "reference-pixel-extraction" }, "space": "tangent" }, "bump": { "pattern": "reference-derived height field", "amplitude": 0.025, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_height.png", "url": "base_height.png", "channel": "height", "source": "reference-pixel-extraction" } }, "displacement": { "pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false }, "ambientOcclusion": { "cavityStrength": 0.38, "contactShadowBias": 0.35, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_ao.png", "url": "base_ao.png", "channel": "ao", "source": "reference-pixel-extraction" }, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot." }, "wear": { "edgeWear": 0, "scratches": [], "chips": [] }, "dirt": { "amount": 0, "cavityBias": 0, "color": "#2F2A22" }, "localOverrides": [{ "id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison." }], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": { "version": "1.0", "sourceImage": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\fr-ref.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": { "albedo": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_albedo.png", "url": "base_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction" }, "roughness": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_roughness.png", "url": "base_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction" }, "height": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_height.png", "url": "base_height.png", "channel": "height", "source": "reference-pixel-extraction" }, "normal": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_normal.png", "url": "base_normal.png", "channel": "normal", "source": "reference-pixel-extraction" }, "ao": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_ao.png", "url": "base_ao.png", "channel": "ao", "source": "reference-pixel-extraction" } }, "diagnostics": { "sourceWidth": 1500, "sourceHeight": 1500, "mapSize": 1024, "cropBBoxPixels": { "x": 293, "y": 20, "width": 917, "height": 1460 }, "mask": { "backgroundColor": "#FFFFFF", "backgroundNoise": 0, "transparentPixelFraction": 0, "foregroundCoverage": 0.4957 }, "mapStats": { "valueRange": 0.5074, "heightP90Gradient": 0.05633, "roughnessBase": 0.705, "roughnessVariation": 0.098, "normalStrength": 0.222, "blurRadius": 21 }, "palette": ["#A65941", "#BFB991", "#3F5E0F", "#4C6C1B", "#2D4605"] }, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"] }, "materialClass": "plastic" },
    options
  );
  materialMap["label-terracotta"] = createSculptMaterial(
    "label-terracotta",
    { "id": "label-terracotta", "name": "Terracotta label flood", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#B5654A", "color": "#B5654A", "albedo": { "dominant": "#B5654A", "secondary": ["#BFB991", "#3F5E0F", "#4C6C1B"], "samplingNotes": "Mean of crops/label-panel.png (#B5654A); uncoated flood ink, flattest zone on the bag.", "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_albedo.png", "url": "base_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction" } }, "colorVariation": { "palette": ["#A65941", "#BFB991", "#3F5E0F", "#4C6C1B", "#2D4605"], "pattern": "reference-derived pixel palette", "amplitude": 0.213, "heightCorrelation": 0.42 }, "textureResolution": 1024, "textureProjection": { "mode": "uv", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale." }, "surfaceFrequencyBands": [{ "id": "macro", "frequency": 2, "amplitude": 0.458, "role": "reference-derived broad albedo and height breakup" }, { "id": "meso", "frequency": 14, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters" }, { "id": "micro", "frequency": 72, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light" }], "roughness": { "base": 0.78, "variation": 0.098, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_roughness.png", "url": "base_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction" }, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother" }, "metalness": 0, "normal": { "pattern": "reference-derived height-gradient normal map", "strength": 0.222, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_normal.png", "url": "base_normal.png", "channel": "normal", "source": "reference-pixel-extraction" }, "heightSource": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_height.png", "url": "base_height.png", "channel": "height", "source": "reference-pixel-extraction" }, "space": "tangent" }, "bump": { "pattern": "reference-derived height field", "amplitude": 0.025, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_height.png", "url": "base_height.png", "channel": "height", "source": "reference-pixel-extraction" } }, "displacement": { "pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false }, "ambientOcclusion": { "cavityStrength": 0.38, "contactShadowBias": 0.35, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_ao.png", "url": "base_ao.png", "channel": "ao", "source": "reference-pixel-extraction" }, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot." }, "wear": { "edgeWear": 0, "scratches": [], "chips": [] }, "dirt": { "amount": 0, "cavityBias": 0, "color": "#2F2A22" }, "localOverrides": [{ "id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison." }], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": { "version": "1.0", "sourceImage": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\fr-ref.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": { "albedo": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_albedo.png", "url": "base_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction" }, "roughness": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_roughness.png", "url": "base_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction" }, "height": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_height.png", "url": "base_height.png", "channel": "height", "source": "reference-pixel-extraction" }, "normal": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_normal.png", "url": "base_normal.png", "channel": "normal", "source": "reference-pixel-extraction" }, "ao": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_ao.png", "url": "base_ao.png", "channel": "ao", "source": "reference-pixel-extraction" } }, "diagnostics": { "sourceWidth": 1500, "sourceHeight": 1500, "mapSize": 1024, "cropBBoxPixels": { "x": 293, "y": 20, "width": 917, "height": 1460 }, "mask": { "backgroundColor": "#FFFFFF", "backgroundNoise": 0, "transparentPixelFraction": 0, "foregroundCoverage": 0.4957 }, "mapStats": { "valueRange": 0.5074, "heightP90Gradient": 0.05633, "roughnessBase": 0.705, "roughnessVariation": 0.098, "normalStrength": 0.222, "blurRadius": 21 }, "palette": ["#A65941", "#BFB991", "#3F5E0F", "#4C6C1B", "#2D4605"] }, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"] }, "materialClass": "plastic", "clearcoat": { "intensity": 0.04, "roughness": 0.9, "note": "Barely-there coat: the panel is the flattest zone on the bag. Present so the gloss detail d4 has a real material response to grade against." } },
    options
  );
  materialMap["foil-gold"] = createSculptMaterial(
    "foil-gold",
    { "id": "foil-gold", "name": "Gold foil stamp", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#C7A867", "color": "#C7A867", "albedo": { "dominant": "#C7A867", "secondary": ["#BFB991", "#3F5E0F", "#4C6C1B"], "samplingNotes": "Foil stamp; hue estimated from crops/logo-foil.png, which mixes foil with the green field.", "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_albedo.png", "url": "base_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction" } }, "colorVariation": { "palette": ["#A65941", "#BFB991", "#3F5E0F", "#4C6C1B", "#2D4605"], "pattern": "reference-derived pixel palette", "amplitude": 0.213, "heightCorrelation": 0.42 }, "textureResolution": 1024, "textureProjection": { "mode": "uv", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale." }, "surfaceFrequencyBands": [{ "id": "macro", "frequency": 2, "amplitude": 0.458, "role": "reference-derived broad albedo and height breakup" }, { "id": "meso", "frequency": 14, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters" }, { "id": "micro", "frequency": 72, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light" }], "roughness": { "base": 0.28, "variation": 0.098, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_roughness.png", "url": "base_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction" }, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother" }, "metalness": 0.9, "normal": { "pattern": "reference-derived height-gradient normal map", "strength": 0.222, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_normal.png", "url": "base_normal.png", "channel": "normal", "source": "reference-pixel-extraction" }, "heightSource": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_height.png", "url": "base_height.png", "channel": "height", "source": "reference-pixel-extraction" }, "space": "tangent" }, "bump": { "pattern": "reference-derived height field", "amplitude": 0.025, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_height.png", "url": "base_height.png", "channel": "height", "source": "reference-pixel-extraction" } }, "displacement": { "pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false }, "ambientOcclusion": { "cavityStrength": 0.38, "contactShadowBias": 0.35, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_ao.png", "url": "base_ao.png", "channel": "ao", "source": "reference-pixel-extraction" }, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot." }, "wear": { "edgeWear": 0, "scratches": [], "chips": [] }, "dirt": { "amount": 0, "cavityBias": 0, "color": "#2F2A22" }, "localOverrides": [{ "id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison." }], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": { "version": "1.0", "sourceImage": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\fr-ref.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": { "albedo": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_albedo.png", "url": "base_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction" }, "roughness": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_roughness.png", "url": "base_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction" }, "height": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_height.png", "url": "base_height.png", "channel": "height", "source": "reference-pixel-extraction" }, "normal": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_normal.png", "url": "base_normal.png", "channel": "normal", "source": "reference-pixel-extraction" }, "ao": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_ao.png", "url": "base_ao.png", "channel": "ao", "source": "reference-pixel-extraction" } }, "diagnostics": { "sourceWidth": 1500, "sourceHeight": 1500, "mapSize": 1024, "cropBBoxPixels": { "x": 293, "y": 20, "width": 917, "height": 1460 }, "mask": { "backgroundColor": "#FFFFFF", "backgroundNoise": 0, "transparentPixelFraction": 0, "foregroundCoverage": 0.4957 }, "mapStats": { "valueRange": 0.5074, "heightP90Gradient": 0.05633, "roughnessBase": 0.705, "roughnessVariation": 0.098, "normalStrength": 0.222, "blurRadius": 21 }, "palette": ["#A65941", "#BFB991", "#3F5E0F", "#4C6C1B", "#2D4605"] }, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"] }, "materialClass": "metal" },
    options
  );
  materialMap["base"] = createSculptMaterial(
    "base",
    { "id": "base", "name": "Base material", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#8A7A5F", "color": "#8A7A5F", "albedo": { "dominant": "#A65941", "secondary": ["#BFB991", "#3F5E0F", "#4C6C1B"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_albedo.png", "url": "base_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction" } }, "colorVariation": { "palette": ["#A65941", "#BFB991", "#3F5E0F", "#4C6C1B", "#2D4605"], "pattern": "reference-derived pixel palette", "amplitude": 0.213, "heightCorrelation": 0.42 }, "textureResolution": 1024, "textureProjection": { "mode": "uv", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale." }, "surfaceFrequencyBands": [{ "id": "macro", "frequency": 2, "amplitude": 0.458, "role": "reference-derived broad albedo and height breakup" }, { "id": "meso", "frequency": 14, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters" }, { "id": "micro", "frequency": 72, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light" }], "roughness": { "base": 0.705, "variation": 0.098, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_roughness.png", "url": "base_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction" }, "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother" }, "metalness": { "base": 0, "variation": 0 }, "normal": { "pattern": "reference-derived height-gradient normal map", "strength": 0.222, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_normal.png", "url": "base_normal.png", "channel": "normal", "source": "reference-pixel-extraction" }, "heightSource": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_height.png", "url": "base_height.png", "channel": "height", "source": "reference-pixel-extraction" }, "space": "tangent" }, "bump": { "pattern": "reference-derived height field", "amplitude": 0.025, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_height.png", "url": "base_height.png", "channel": "height", "source": "reference-pixel-extraction" } }, "displacement": { "pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false }, "ambientOcclusion": { "cavityStrength": 0.38, "contactShadowBias": 0.35, "map": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_ao.png", "url": "base_ao.png", "channel": "ao", "source": "reference-pixel-extraction" }, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot." }, "wear": { "edgeWear": 0, "scratches": [], "chips": [] }, "dirt": { "amount": 0, "cavityBias": 0, "color": "#2F2A22" }, "localOverrides": [{ "id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison." }], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": { "version": "1.0", "sourceImage": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\fr-ref.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": { "albedo": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_albedo.png", "url": "base_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction" }, "roughness": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_roughness.png", "url": "base_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction" }, "height": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_height.png", "url": "base_height.png", "channel": "height", "source": "reference-pixel-extraction" }, "normal": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_normal.png", "url": "base_normal.png", "channel": "normal", "source": "reference-pixel-extraction" }, "ao": { "path": "C:\\Users\\JustinAdler\\clawd-agentsmith\\tmp\\i23run\\pbr\\base_ao.png", "url": "base_ao.png", "channel": "ao", "source": "reference-pixel-extraction" } }, "diagnostics": { "sourceWidth": 1500, "sourceHeight": 1500, "mapSize": 1024, "cropBBoxPixels": { "x": 293, "y": 20, "width": 917, "height": 1460 }, "mask": { "backgroundColor": "#FFFFFF", "backgroundNoise": 0, "transparentPixelFraction": 0, "foregroundCoverage": 0.4957 }, "mapStats": { "valueRange": 0.5074, "heightP90Gradient": 0.05633, "roughnessBase": 0.705, "roughnessVariation": 0.098, "normalStrength": 0.222, "blurRadius": 21 }, "palette": ["#A65941", "#BFB991", "#3F5E0F", "#4C6C1B", "#2D4605"] }, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"] } },
    options
  );
  const nodes = { root };
  const meshes = {};
  const sockets = {};
  const colliders = {};
  const destructionGroups = {};
  const attachment_film_body_0 = null;
  const endpoint_film_body_0 = makeAttachmentEndpoint(attachment_film_body_0);
  const node_film_body_0 = new THREE.Group();
  node_film_body_0.name = "Front/back film panel (pillowed)__pivot";
  if (endpoint_film_body_0) {
    node_film_body_0.position.copy(endpoint_film_body_0.start);
    node_film_body_0.rotation.set(0, 0, 0);
    node_film_body_0.scale.set(1, 1, 1);
  } else {
    node_film_body_0.position.set(0, 0.66, 0);
    node_film_body_0.rotation.set(-1.5708, 0, 0);
    node_film_body_0.scale.set(1, 1, 1);
  }
  node_film_body_0.userData.sculptComponent = { "id": "film-body", "name": "Front/back film panel (pillowed)", "level": "macro", "role": "body", "importance": 1, "confidence": 0.8, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "A filled flexible pouch is a thin film shell conforming to its contents, not a solid: it pillows outward and creases at the seals.", "geometryDescriptor": { "topologyIntent": "Filled flexible pouch reads as a pillowed slab: rounded-rect profile extruded on Z with a convex bulge at centre, flattening toward the sealed side creases.", "edgeTreatment": { "type": "none", "bevelRadius": 0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": { "points": [[-0.5, 0], [-0.4643, 0.1013], [-0.4286, 0.1357], [-0.3929, 0.1573], [-0.3571, 0.172], [-0.3214, 0.1821], [-0.2857, 0.189], [-0.25, 0.1936], [-0.2143, 0.1966], [-0.1786, 0.1984], [-0.1429, 0.1993], [-0.1071, 0.1998], [-0.0714, 0.2], [-0.0357, 0.2], [0, 0.2], [0.0357, 0.2], [0.0714, 0.2], [0.1071, 0.1998], [0.1429, 0.1993], [0.1786, 0.1984], [0.2143, 0.1966], [0.25, 0.1936], [0.2857, 0.189], [0.3214, 0.1821], [0.3571, 0.172], [0.3929, 0.1573], [0.4286, 0.1357], [0.4643, 0.1013], [0.5, 0], [0.4643, -0.1013], [0.4286, -0.1357], [0.3929, -0.1573], [0.3571, -0.172], [0.3214, -0.1821], [0.2857, -0.189], [0.25, -0.1936], [0.2143, -0.1966], [0.1786, -0.1984], [0.1429, -0.1993], [0.1071, -0.1998], [0.0714, -0.2], [0.0357, -0.2], [0, -0.2], [-0.0357, -0.2], [-0.0714, -0.2], [-0.1071, -0.1998], [-0.1429, -0.1993], [-0.1786, -0.1984], [-0.2143, -0.1966], [-0.25, -0.1936], [-0.2857, -0.189], [-0.3214, -0.1821], [-0.3571, -0.172], [-0.3929, -0.1573], [-0.4286, -0.1357], [-0.4643, -0.1013]], "depth": 1.42 } }, "parent": null, "attachment": null, "dimensions": { "width": 1, "height": 1.42, "depth": 0.4, "units": "relative", "confidence": 0.8 }, "transform": { "position": [0, 0.66, 0], "rotation": [-1.5708, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base" } }, "material": "film-green", "materialLayers": ["base"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "pillow-bulge", "description": "Convex centre bulge of a filled pouch, flattening to sharp side creases", "evidence": "full-object silhouette" }, { "id": "side-crease", "description": "Vertical sealed side edges producing a hard specular line", "evidence": "left/right silhouette edges" }], "surfaceDetail": { "macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": { "dominantAlbedo": "rgba(64, 96, 14, 1.0)", "secondaryAlbedo": "rgba(45, 70, 5, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceCrop": "crops/pouch-body-green.png", "extractionMethod": "arithmetic mean over a hand-placed crop of the reference PNG (deterministic, verified by printing the crop mean)", "note": "Not from extract_part_color_recipe.py: that script's CIE-Lab clustering path was not used here because the JPEG->PNG decode limitation forced a manual crop step." } };
  node_film_body_0.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base" } };
  (nodes["root"] ?? root).add(node_film_body_0);
  nodes["film-body"] = node_film_body_0;
  const mesh_film_body_0Geometry = endpoint_film_body_0 ? new THREE.CylinderGeometry(endpoint_film_body_0.endRadius, endpoint_film_body_0.baseRadius, endpoint_film_body_0.length, 32, 12) : buildExtrudeGeometry({ "points": [[-0.5, 0], [-0.4643, 0.1013], [-0.4286, 0.1357], [-0.3929, 0.1573], [-0.3571, 0.172], [-0.3214, 0.1821], [-0.2857, 0.189], [-0.25, 0.1936], [-0.2143, 0.1966], [-0.1786, 0.1984], [-0.1429, 0.1993], [-0.1071, 0.1998], [-0.0714, 0.2], [-0.0357, 0.2], [0, 0.2], [0.0357, 0.2], [0.0714, 0.2], [0.1071, 0.1998], [0.1429, 0.1993], [0.1786, 0.1984], [0.2143, 0.1966], [0.25, 0.1936], [0.2857, 0.189], [0.3214, 0.1821], [0.3571, 0.172], [0.3929, 0.1573], [0.4286, 0.1357], [0.4643, 0.1013], [0.5, 0], [0.4643, -0.1013], [0.4286, -0.1357], [0.3929, -0.1573], [0.3571, -0.172], [0.3214, -0.1821], [0.2857, -0.189], [0.25, -0.1936], [0.2143, -0.1966], [0.1786, -0.1984], [0.1429, -0.1993], [0.1071, -0.1998], [0.0714, -0.2], [0.0357, -0.2], [0, -0.2], [-0.0357, -0.2], [-0.0714, -0.2], [-0.1071, -0.1998], [-0.1429, -0.1993], [-0.1786, -0.1984], [-0.2143, -0.1966], [-0.25, -0.1936], [-0.2857, -0.189], [-0.3214, -0.1821], [-0.3571, -0.172], [-0.3929, -0.1573], [-0.4286, -0.1357], [-0.4643, -0.1013]], "depth": 1.42 });
  const mesh_film_body_0 = new THREE.Mesh(
    mesh_film_body_0Geometry,
    materialMap["film-green"] ?? new THREE.MeshStandardMaterial({ color: 8947848 })
  );
  mesh_film_body_0.name = "Front/back film panel (pillowed)";
  if (endpoint_film_body_0) {
    mesh_film_body_0.position.copy(endpoint_film_body_0.midpoint);
    mesh_film_body_0.quaternion.copy(endpoint_film_body_0.quaternion);
  }
  mesh_film_body_0.castShadow = options.castShadow ?? true;
  mesh_film_body_0.receiveShadow = options.receiveShadow ?? true;
  mesh_film_body_0.userData.sculptComponent = { "id": "film-body", "name": "Front/back film panel (pillowed)", "level": "macro", "role": "body", "importance": 1, "confidence": 0.8, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "A filled flexible pouch is a thin film shell conforming to its contents, not a solid: it pillows outward and creases at the seals.", "geometryDescriptor": { "topologyIntent": "Filled flexible pouch reads as a pillowed slab: rounded-rect profile extruded on Z with a convex bulge at centre, flattening toward the sealed side creases.", "edgeTreatment": { "type": "none", "bevelRadius": 0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": { "points": [[-0.5, 0], [-0.4643, 0.1013], [-0.4286, 0.1357], [-0.3929, 0.1573], [-0.3571, 0.172], [-0.3214, 0.1821], [-0.2857, 0.189], [-0.25, 0.1936], [-0.2143, 0.1966], [-0.1786, 0.1984], [-0.1429, 0.1993], [-0.1071, 0.1998], [-0.0714, 0.2], [-0.0357, 0.2], [0, 0.2], [0.0357, 0.2], [0.0714, 0.2], [0.1071, 0.1998], [0.1429, 0.1993], [0.1786, 0.1984], [0.2143, 0.1966], [0.25, 0.1936], [0.2857, 0.189], [0.3214, 0.1821], [0.3571, 0.172], [0.3929, 0.1573], [0.4286, 0.1357], [0.4643, 0.1013], [0.5, 0], [0.4643, -0.1013], [0.4286, -0.1357], [0.3929, -0.1573], [0.3571, -0.172], [0.3214, -0.1821], [0.2857, -0.189], [0.25, -0.1936], [0.2143, -0.1966], [0.1786, -0.1984], [0.1429, -0.1993], [0.1071, -0.1998], [0.0714, -0.2], [0.0357, -0.2], [0, -0.2], [-0.0357, -0.2], [-0.0714, -0.2], [-0.1071, -0.1998], [-0.1429, -0.1993], [-0.1786, -0.1984], [-0.2143, -0.1966], [-0.25, -0.1936], [-0.2857, -0.189], [-0.3214, -0.1821], [-0.3571, -0.172], [-0.3929, -0.1573], [-0.4286, -0.1357], [-0.4643, -0.1013]], "depth": 1.42 } }, "parent": null, "attachment": null, "dimensions": { "width": 1, "height": 1.42, "depth": 0.4, "units": "relative", "confidence": 0.8 }, "transform": { "position": [0, 0.66, 0], "rotation": [-1.5708, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base" } }, "material": "film-green", "materialLayers": ["base"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "pillow-bulge", "description": "Convex centre bulge of a filled pouch, flattening to sharp side creases", "evidence": "full-object silhouette" }, { "id": "side-crease", "description": "Vertical sealed side edges producing a hard specular line", "evidence": "left/right silhouette edges" }], "surfaceDetail": { "macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": { "dominantAlbedo": "rgba(64, 96, 14, 1.0)", "secondaryAlbedo": "rgba(45, 70, 5, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceCrop": "crops/pouch-body-green.png", "extractionMethod": "arithmetic mean over a hand-placed crop of the reference PNG (deterministic, verified by printing the crop mean)", "note": "Not from extract_part_color_recipe.py: that script's CIE-Lab clustering path was not used here because the JPEG->PNG decode limitation forced a manual crop step." } };
  node_film_body_0.add(mesh_film_body_0);
  meshes["film-body"] = mesh_film_body_0;
  colliders["film-body"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
  destructionGroups["root"] ?? (destructionGroups["root"] = []);
  destructionGroups["root"].push(node_film_body_0);
  const attachment_top_seal_1 = null;
  const endpoint_top_seal_1 = makeAttachmentEndpoint(attachment_top_seal_1);
  const node_top_seal_1 = new THREE.Group();
  node_top_seal_1.name = "Crimped top seal band__pivot";
  if (endpoint_top_seal_1) {
    node_top_seal_1.position.copy(endpoint_top_seal_1.start);
    node_top_seal_1.rotation.set(0, 0, 0);
    node_top_seal_1.scale.set(1, 1, 1);
  } else {
    node_top_seal_1.position.set(0, 0.725, 0);
    node_top_seal_1.rotation.set(0, 0, 0);
    node_top_seal_1.scale.set(1, 0.13, 0.07);
  }
  node_top_seal_1.userData.sculptComponent = { "id": "top-seal", "name": "Crimped top seal band", "level": "meso", "role": "seal", "importance": 0.7, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat heat-sealed band above the zipper, with fine horizontal crimp ribbing and tapered corner ears.", "geometryDescriptor": { "topologyIntent": "Flat heat-sealed band above the zipper, with fine horizontal crimp ribbing and tapered corner ears.", "edgeTreatment": { "type": "none", "bevelRadius": 0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": null, "attachment": null, "dimensions": { "width": 1, "height": 0.13, "depth": 0.07, "units": "relative", "confidence": 0.8 }, "transform": { "position": [0, 0.725, 0], "rotation": [0, 0, 0], "scale": [1, 0.13, 0.07] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base" } }, "material": "film-green", "materialLayers": ["base"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "crimp-ribbing", "description": "Fine horizontal crimp teeth across the seal band", "evidence": "top-seal crop" }, { "id": "seal-ears", "description": "Tapered upper corners where the seal is trimmed at ~30deg", "evidence": "top-seal crop" }, { "id": "tear-notch", "description": "Small notch at the left end of the zipper line", "evidence": "top-seal crop" }], "surfaceDetail": { "macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": { "dominantAlbedo": "rgba(64, 96, 14, 1.0)", "secondaryAlbedo": "rgba(45, 70, 5, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceCrop": "crops/top-seal.png", "extractionMethod": "arithmetic mean over a hand-placed crop of the reference PNG (deterministic, verified by printing the crop mean)", "note": "Not from extract_part_color_recipe.py: that script's CIE-Lab clustering path was not used here because the JPEG->PNG decode limitation forced a manual crop step." } };
  node_top_seal_1.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base" } };
  (nodes["root"] ?? root).add(node_top_seal_1);
  nodes["top-seal"] = node_top_seal_1;
  const mesh_top_seal_1Geometry = endpoint_top_seal_1 ? new THREE.CylinderGeometry(endpoint_top_seal_1.endRadius, endpoint_top_seal_1.baseRadius, endpoint_top_seal_1.length, 32, 12) : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  const mesh_top_seal_1 = new THREE.Mesh(
    mesh_top_seal_1Geometry,
    materialMap["film-green"] ?? new THREE.MeshStandardMaterial({ color: 8947848 })
  );
  mesh_top_seal_1.name = "Crimped top seal band";
  if (endpoint_top_seal_1) {
    mesh_top_seal_1.position.copy(endpoint_top_seal_1.midpoint);
    mesh_top_seal_1.quaternion.copy(endpoint_top_seal_1.quaternion);
  }
  mesh_top_seal_1.castShadow = options.castShadow ?? true;
  mesh_top_seal_1.receiveShadow = options.receiveShadow ?? true;
  mesh_top_seal_1.userData.sculptComponent = { "id": "top-seal", "name": "Crimped top seal band", "level": "meso", "role": "seal", "importance": 0.7, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Flat heat-sealed band above the zipper, with fine horizontal crimp ribbing and tapered corner ears.", "geometryDescriptor": { "topologyIntent": "Flat heat-sealed band above the zipper, with fine horizontal crimp ribbing and tapered corner ears.", "edgeTreatment": { "type": "none", "bevelRadius": 0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry" }, "parent": null, "attachment": null, "dimensions": { "width": 1, "height": 0.13, "depth": 0.07, "units": "relative", "confidence": 0.8 }, "transform": { "position": [0, 0.725, 0], "rotation": [0, 0, 0], "scale": [1, 0.13, 0.07] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base" } }, "material": "film-green", "materialLayers": ["base"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "crimp-ribbing", "description": "Fine horizontal crimp teeth across the seal band", "evidence": "top-seal crop" }, { "id": "seal-ears", "description": "Tapered upper corners where the seal is trimmed at ~30deg", "evidence": "top-seal crop" }, { "id": "tear-notch", "description": "Small notch at the left end of the zipper line", "evidence": "top-seal crop" }], "surfaceDetail": { "macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": { "dominantAlbedo": "rgba(64, 96, 14, 1.0)", "secondaryAlbedo": "rgba(45, 70, 5, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceCrop": "crops/top-seal.png", "extractionMethod": "arithmetic mean over a hand-placed crop of the reference PNG (deterministic, verified by printing the crop mean)", "note": "Not from extract_part_color_recipe.py: that script's CIE-Lab clustering path was not used here because the JPEG->PNG decode limitation forced a manual crop step." } };
  node_top_seal_1.add(mesh_top_seal_1);
  meshes["top-seal"] = mesh_top_seal_1;
  colliders["top-seal"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
  destructionGroups["root"] ?? (destructionGroups["root"] = []);
  destructionGroups["root"].push(node_top_seal_1);
  const attachment_bottom_gusset_2 = null;
  const endpoint_bottom_gusset_2 = makeAttachmentEndpoint(attachment_bottom_gusset_2);
  const node_bottom_gusset_2 = new THREE.Group();
  node_bottom_gusset_2.name = "Bottom stand-up gusset__pivot";
  if (endpoint_bottom_gusset_2) {
    node_bottom_gusset_2.position.copy(endpoint_bottom_gusset_2.start);
    node_bottom_gusset_2.rotation.set(0, 0, 0);
    node_bottom_gusset_2.scale.set(1, 1, 1);
  } else {
    node_bottom_gusset_2.position.set(0, -0.76, 0);
    node_bottom_gusset_2.rotation.set(-1.5708, 0, 0);
    node_bottom_gusset_2.scale.set(1, 1, 1);
  }
  node_bottom_gusset_2.userData.sculptComponent = { "id": "bottom-gusset", "name": "Bottom stand-up gusset", "level": "meso", "role": "base", "importance": 0.6, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "K-seal gusset that lets the pouch stand; reads as a wedge tucked under the front panel.", "geometryDescriptor": { "topologyIntent": "K-seal gusset that lets the pouch stand; reads as a wedge tucked under the front panel.", "edgeTreatment": { "type": "none", "bevelRadius": 0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": { "points": [[-0.49, 0], [-0.455, 0.0815], [-0.42, 0.1126], [-0.385, 0.1347], [-0.35, 0.1519], [-0.315, 0.1656], [-0.28, 0.1767], [-0.245, 0.1857], [-0.21, 0.193], [-0.175, 0.1988], [-0.14, 0.2032], [-0.105, 0.2064], [-0.07, 0.2085], [-0.035, 0.2097], [0, 0.21], [0.035, 0.2097], [0.07, 0.2085], [0.105, 0.2064], [0.14, 0.2032], [0.175, 0.1988], [0.21, 0.193], [0.245, 0.1857], [0.28, 0.1767], [0.315, 0.1656], [0.35, 0.1519], [0.385, 0.1347], [0.42, 0.1126], [0.455, 0.0815], [0.49, 0], [0.455, -0.0815], [0.42, -0.1126], [0.385, -0.1347], [0.35, -0.1519], [0.315, -0.1656], [0.28, -0.1767], [0.245, -0.1857], [0.21, -0.193], [0.175, -0.1988], [0.14, -0.2032], [0.105, -0.2064], [0.07, -0.2085], [0.035, -0.2097], [0, -0.21], [-0.035, -0.2097], [-0.07, -0.2085], [-0.105, -0.2064], [-0.14, -0.2032], [-0.175, -0.1988], [-0.21, -0.193], [-0.245, -0.1857], [-0.28, -0.1767], [-0.315, -0.1656], [-0.35, -0.1519], [-0.385, -0.1347], [-0.42, -0.1126], [-0.455, -0.0815]], "depth": 0.1 } }, "parent": null, "attachment": null, "dimensions": { "width": 0.98, "height": 0.18, "depth": 0.42, "units": "relative", "confidence": 0.65 }, "transform": { "position": [0, -0.76, 0], "rotation": [-1.5708, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base" } }, "material": "film-cream", "materialLayers": ["base"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "gusset-fold", "description": "Diagonal fold lines converging at the base corners", "evidence": "inferred - not visible in a straight-on front view" }], "surfaceDetail": { "macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": { "dominantAlbedo": "rgba(194, 189, 147, 1.0)", "secondaryAlbedo": "rgba(191, 185, 145, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceCrop": "crops/pouch-body-cream.png", "extractionMethod": "arithmetic mean over a hand-placed crop of the reference PNG (deterministic, verified by printing the crop mean)", "note": "Not from extract_part_color_recipe.py: that script's CIE-Lab clustering path was not used here because the JPEG->PNG decode limitation forced a manual crop step." } };
  node_bottom_gusset_2.userData.actionProfile = { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base" } };
  (nodes["root"] ?? root).add(node_bottom_gusset_2);
  nodes["bottom-gusset"] = node_bottom_gusset_2;
  const mesh_bottom_gusset_2Geometry = endpoint_bottom_gusset_2 ? new THREE.CylinderGeometry(endpoint_bottom_gusset_2.endRadius, endpoint_bottom_gusset_2.baseRadius, endpoint_bottom_gusset_2.length, 32, 12) : buildExtrudeGeometry({ "points": [[-0.49, 0], [-0.455, 0.0815], [-0.42, 0.1126], [-0.385, 0.1347], [-0.35, 0.1519], [-0.315, 0.1656], [-0.28, 0.1767], [-0.245, 0.1857], [-0.21, 0.193], [-0.175, 0.1988], [-0.14, 0.2032], [-0.105, 0.2064], [-0.07, 0.2085], [-0.035, 0.2097], [0, 0.21], [0.035, 0.2097], [0.07, 0.2085], [0.105, 0.2064], [0.14, 0.2032], [0.175, 0.1988], [0.21, 0.193], [0.245, 0.1857], [0.28, 0.1767], [0.315, 0.1656], [0.35, 0.1519], [0.385, 0.1347], [0.42, 0.1126], [0.455, 0.0815], [0.49, 0], [0.455, -0.0815], [0.42, -0.1126], [0.385, -0.1347], [0.35, -0.1519], [0.315, -0.1656], [0.28, -0.1767], [0.245, -0.1857], [0.21, -0.193], [0.175, -0.1988], [0.14, -0.2032], [0.105, -0.2064], [0.07, -0.2085], [0.035, -0.2097], [0, -0.21], [-0.035, -0.2097], [-0.07, -0.2085], [-0.105, -0.2064], [-0.14, -0.2032], [-0.175, -0.1988], [-0.21, -0.193], [-0.245, -0.1857], [-0.28, -0.1767], [-0.315, -0.1656], [-0.35, -0.1519], [-0.385, -0.1347], [-0.42, -0.1126], [-0.455, -0.0815]], "depth": 0.1 });
  const mesh_bottom_gusset_2 = new THREE.Mesh(
    mesh_bottom_gusset_2Geometry,
    materialMap["film-cream"] ?? new THREE.MeshStandardMaterial({ color: 8947848 })
  );
  mesh_bottom_gusset_2.name = "Bottom stand-up gusset";
  if (endpoint_bottom_gusset_2) {
    mesh_bottom_gusset_2.position.copy(endpoint_bottom_gusset_2.midpoint);
    mesh_bottom_gusset_2.quaternion.copy(endpoint_bottom_gusset_2.quaternion);
  }
  mesh_bottom_gusset_2.castShadow = options.castShadow ?? true;
  mesh_bottom_gusset_2.receiveShadow = options.receiveShadow ?? true;
  mesh_bottom_gusset_2.userData.sculptComponent = { "id": "bottom-gusset", "name": "Bottom stand-up gusset", "level": "meso", "role": "base", "importance": 0.6, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "K-seal gusset that lets the pouch stand; reads as a wedge tucked under the front panel.", "geometryDescriptor": { "topologyIntent": "K-seal gusset that lets the pouch stand; reads as a wedge tucked under the front panel.", "edgeTreatment": { "type": "none", "bevelRadius": 0, "segments": 1 }, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": { "points": [[-0.49, 0], [-0.455, 0.0815], [-0.42, 0.1126], [-0.385, 0.1347], [-0.35, 0.1519], [-0.315, 0.1656], [-0.28, 0.1767], [-0.245, 0.1857], [-0.21, 0.193], [-0.175, 0.1988], [-0.14, 0.2032], [-0.105, 0.2064], [-0.07, 0.2085], [-0.035, 0.2097], [0, 0.21], [0.035, 0.2097], [0.07, 0.2085], [0.105, 0.2064], [0.14, 0.2032], [0.175, 0.1988], [0.21, 0.193], [0.245, 0.1857], [0.28, 0.1767], [0.315, 0.1656], [0.35, 0.1519], [0.385, 0.1347], [0.42, 0.1126], [0.455, 0.0815], [0.49, 0], [0.455, -0.0815], [0.42, -0.1126], [0.385, -0.1347], [0.35, -0.1519], [0.315, -0.1656], [0.28, -0.1767], [0.245, -0.1857], [0.21, -0.193], [0.175, -0.1988], [0.14, -0.2032], [0.105, -0.2064], [0.07, -0.2085], [0.035, -0.2097], [0, -0.21], [-0.035, -0.2097], [-0.07, -0.2085], [-0.105, -0.2064], [-0.14, -0.2032], [-0.175, -0.1988], [-0.21, -0.193], [-0.245, -0.1857], [-0.28, -0.1767], [-0.315, -0.1656], [-0.35, -0.1519], [-0.385, -0.1347], [-0.42, -0.1126], [-0.455, -0.0815]], "depth": 0.1 } }, "parent": null, "attachment": null, "dimensions": { "width": 0.98, "height": 0.18, "depth": 0.42, "units": "relative", "confidence": 0.65 }, "transform": { "position": [0, -0.76, 0], "rotation": [-1.5708, 0, 0], "scale": [1, 1, 1] }, "actionProfile": { "animationRole": "static", "pivot": { "mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5 }, "transformChannels": { "translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true }, "sockets": [], "collider": { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." }, "constraints": [], "destruction": { "breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base" } }, "material": "film-cream", "materialLayers": ["base"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{ "id": "gusset-fold", "description": "Diagonal fold lines converging at the base corners", "evidence": "inferred - not visible in a straight-on front view" }], "surfaceDetail": { "macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "" }, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": { "dominantAlbedo": "rgba(194, 189, 147, 1.0)", "secondaryAlbedo": "rgba(191, 185, 145, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.7, "evidenceCrop": "crops/pouch-body-cream.png", "extractionMethod": "arithmetic mean over a hand-placed crop of the reference PNG (deterministic, verified by printing the crop mean)", "note": "Not from extract_part_color_recipe.py: that script's CIE-Lab clustering path was not used here because the JPEG->PNG decode limitation forced a manual crop step." } };
  node_bottom_gusset_2.add(mesh_bottom_gusset_2);
  meshes["bottom-gusset"] = mesh_bottom_gusset_2;
  colliders["bottom-gusset"] = { "type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it." };
  destructionGroups["root"] ?? (destructionGroups["root"] = []);
  destructionGroups["root"].push(node_bottom_gusset_2);
  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups };
  root.userData.lookDevTargets = { "qualityPriority": "reference-fidelity", "materialPass": { "albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": { "requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry" }, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"] }, "lightingPass": { "requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"] }, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."] };
  root.userData.actionReadiness = {
    note: "Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets."
  };
  return root;
}
function createTeeccinoFrenchRoast500gPouchLookDevLights(mode = "neutral") {
  const lights = new THREE.Group();
  lights.name = "Teeccino French Roast 500g Pouch look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === "reference" ? 16773334 : 15922431,
    3554114,
    mode === "grazing" ? 0.28 : mode === "reference" ? 0.72 : 0.85
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === "reference" ? 16764810 : 16774376,
    mode === "grazing" ? 4.2 : mode === "reference" ? 2.6 : 2.15
  );
  if (mode === "grazing") key.position.set(7.5, 1.1, 4);
  else if (mode === "reference") key.position.set(-4.5, 7.5, 5);
  else key.position.set(-4, 6, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -25e-5;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(11060479, mode === "grazing" ? 0.12 : 0.42);
  fill.position.set(4, 3, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(16773572, mode === "grazing" ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{ "id": "key", "type": "directional", "direction": [-0.35, 0.75, 0.85], "intensity": 2.2, "color": "#FFF6E8", "evidence": "Highlight runs down the upper-left of the green field; shadow terminator on the right crease." }, { "id": "fill", "type": "directional", "direction": [0.7, 0.15, 0.6], "intensity": 0.7, "color": "#EAF0FF", "evidence": "Right crease is lifted, not black - a broad fill or white bounce." }, { "id": "rim", "type": "directional", "direction": [0, -0.4, -1], "intensity": 0.5, "color": "#FFFFFF", "evidence": "Faint separation edge along the bottom gusset against the white sweep." }, { "id": "env", "type": "hemisphere", "intensity": 0.45, "color": "#FFFFFF", "evidence": "Overall low-contrast studio ambient; no hard cast shadow." }, { "id": "render-intent", "type": "exposure", "exposure": 1.05, "toneMapping": "ACES filmic", "contactShadow": { "mode": "contact-shadow + soft ground shadow", "opacity": 0.22, "radius": 0.06, "evidence": "Reference is on a white sweep with a faint soft ground shadow directly under the gusset." }, "evidence": "Exposure and ACES filmic tone mapping chosen so terracotta #B5654A and green #40600E hold; gold foil desaturates slightly." }];
  lights.userData.lookDevTargets = { "qualityPriority": "reference-fidelity", "materialPass": { "albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": { "requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry" }, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"] }, "lightingPass": { "requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"] }, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."] };
  return lights;
}
function createTeeccinoFrenchRoast500gPouchEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}
function frameTeeccinoFrenchRoast500gPouchCamera(camera, object, options = {}) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = camera.fov * Math.PI / 180;
  const distance = maxDim / 2 / Math.tan(fov / 2);
  const az = (options.azimuthDeg ?? 0) * Math.PI / 180;
  const el = (options.elevationDeg ?? 0) * Math.PI / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el)
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}
function createTeeccinoFrenchRoast500gPouchPresentationComposer(renderer, scene, camera, options = {}) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10,
      aperture: options.dofAperture ?? 2e-4,
      maxblur: 0.01
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}
function configureTeeccinoFrenchRoast500gPouchRenderer(renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}
function createTeeccinoFrenchRoast500gPouchInspectControls(camera, domElement) {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1;
  controls.maxDistance = 8;
  controls.autoRotate = false;
  return controls;
}
export {
  configureTeeccinoFrenchRoast500gPouchRenderer,
  createTeeccinoFrenchRoast500gPouchEnvironment,
  createTeeccinoFrenchRoast500gPouchInspectControls,
  createTeeccinoFrenchRoast500gPouchLookDevLights,
  createTeeccinoFrenchRoast500gPouchModel,
  createTeeccinoFrenchRoast500gPouchPresentationComposer,
  frameTeeccinoFrenchRoast500gPouchCamera
};
