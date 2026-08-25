import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const SCRIPT_VERSION = 1;
const CLIENT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIRECTORY = resolve(CLIENT_DIRECTORY, 'public/assets/models/low-poly');
const SQUIRREL_PATH = resolve(OUTPUT_DIRECTORY, 'squirrel.glb');
const FOREST_PATH = resolve(OUTPUT_DIRECTORY, 'forest-props.glb');
const MANIFEST_PATH = resolve(OUTPUT_DIRECTORY, 'manifest.json');

/** Node.js에서 GLTFExporter가 사용하는 브라우저 FileReader 계약을 제공한다. */
class NodeFileReader {
  result = null;
  onloadend = null;

  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      Promise.resolve().then(() => this.onloadend?.());
    });
  }

  readAsDataURL(blob) {
    blob.arrayBuffer().then((result) => {
      const base64 = Buffer.from(result).toString('base64');
      this.result = `data:${blob.type};base64,${base64}`;
      Promise.resolve().then(() => this.onloadend?.());
    });
  }
}

globalThis.FileReader ??= NodeFileReader;

const palette = {
  acorn: 0xb77432,
  acornCap: 0x704423,
  berry: 0xd9475d,
  berryDark: 0x8c2943,
  eye: 0x241a19,
  fence: 0xae713b,
  fenceCut: 0xe2b875,
  leaf: 0x5e9d4b,
  leafDark: 0x397338,
  muzzle: 0xf5d8a9,
  nose: 0x3a2421,
  rock: 0x7d8582,
  rockDark: 0x5f6968,
  squirrel: 0xc87838,
  squirrelDark: 0x874524,
  squirrelLight: 0xeead61,
  trunk: 0x8b5530,
  trunkDark: 0x5e3926,
};

const materials = Object.fromEntries(
  Object.entries(palette).map(([name, color]) => [
    name,
    new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.88, name }),
  ]),
);

/** 내보내기용 메시를 만들고 그림자 기본값을 통일한다. */
function mesh(name, geometry, material, position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const result = new THREE.Mesh(geometry, material);
  result.name = name;
  result.position.set(...position);
  result.rotation.set(...rotation);
  result.scale.set(...scale);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

function addEllipsoid(parent, name, position, scale, material, segments = 16) {
  parent.add(
    mesh(
      name,
      new THREE.SphereGeometry(1, segments, Math.max(8, segments / 2)),
      material,
      position,
      [0, 0, 0],
      scale,
    ),
  );
}

/** -Z를 북쪽으로 삼는 다람쥐 리그를 만든다. */
function createSquirrel() {
  const scene = new THREE.Scene();
  scene.name = 'squirrel-low-poly-scene';

  const root = new THREE.Group();
  root.name = 'squirrel';
  root.userData = {
    forwardAxis: '-Z',
    pivot: 'ground-center',
    animation: 'rotate body/head/tail together; animate named leg nodes locally',
  };
  scene.add(root);

  const body = new THREE.Group();
  body.name = 'body';
  addEllipsoid(body, 'body-mass', [0, 0.55, 0.1], [0.55, 0.38, 0.78], materials.squirrel);
  addEllipsoid(body, 'belly', [0, 0.78, -0.08], [0.32, 0.09, 0.48], materials.squirrelLight, 12);
  root.add(body);

  const head = new THREE.Group();
  head.name = 'head';
  addEllipsoid(head, 'head-mass', [0, 0.63, -0.65], [0.47, 0.38, 0.48], materials.squirrel);
  addEllipsoid(head, 'muzzle-left', [-0.17, 0.69, -1.01], [0.19, 0.14, 0.18], materials.muzzle, 12);
  addEllipsoid(head, 'muzzle-right', [0.17, 0.69, -1.01], [0.19, 0.14, 0.18], materials.muzzle, 12);
  addEllipsoid(head, 'nose', [0, 0.71, -1.18], [0.09, 0.08, 0.09], materials.nose, 10);
  addEllipsoid(head, 'eye-left', [-0.27, 0.91, -0.86], [0.065, 0.055, 0.065], materials.eye, 10);
  addEllipsoid(head, 'eye-right', [0.27, 0.91, -0.86], [0.065, 0.055, 0.065], materials.eye, 10);
  head.add(mesh('ear-left', new THREE.ConeGeometry(0.2, 0.48, 8), materials.squirrelDark, [-0.31, 0.97, -0.59], [0.15, 0, -0.2]));
  head.add(mesh('ear-right', new THREE.ConeGeometry(0.2, 0.48, 8), materials.squirrelDark, [0.31, 0.97, -0.59], [0.15, 0, 0.2]));
  root.add(head);

  const tail = new THREE.Group();
  tail.name = 'tail';
  addEllipsoid(tail, 'tail-base', [0.14, 0.57, 0.7], [0.36, 0.31, 0.55], materials.squirrelDark);
  addEllipsoid(tail, 'tail-middle', [0.34, 0.68, 1.08], [0.48, 0.37, 0.62], materials.squirrel);
  addEllipsoid(tail, 'tail-tip', [0.12, 0.77, 1.47], [0.42, 0.32, 0.48], materials.squirrelLight);
  root.add(tail);

  const legGeometry = new THREE.CapsuleGeometry(0.12, 0.28, 4, 8);
  const legDefinitions = [
    ['legFL', -0.43, -0.42],
    ['legFR', 0.43, -0.42],
    ['legBL', -0.43, 0.42],
    ['legBR', 0.43, 0.42],
  ];
  for (const [name, x, z] of legDefinitions) {
    const leg = new THREE.Group();
    leg.name = name;
    leg.userData = { gaitPivot: [x, 0.12, z] };
    leg.position.set(x, 0.12, z);
    leg.add(mesh(`${name}-paw`, legGeometry, materials.squirrelDark, [0, 0, 0], [Math.PI / 2, 0, 0]));
    root.add(leg);
  }

  return { scene, root };
}

function templateGroup(name, catalogX, pivot = 'ground-center') {
  const group = new THREE.Group();
  group.name = name;
  group.position.x = catalogX;
  group.userData = { isTemplate: true, pivot };
  return group;
}

function createTreeTrunk(catalogX) {
  const group = templateGroup('tree-trunk', catalogX);
  group.add(mesh('tree-trunk-main', new THREE.CylinderGeometry(0.42, 0.5, 1.55, 10), materials.trunk, [0, 0.775, 0]));
  group.add(mesh('tree-trunk-ring', new THREE.CylinderGeometry(0.36, 0.38, 0.04, 10), materials.trunkDark, [0, 1.565, 0]));
  return group;
}

function createTreeCanopy(catalogX) {
  const group = templateGroup('tree-canopy', catalogX, 'tree-center-ground');
  addEllipsoid(group, 'canopy-center', [0, 2.05, 0], [1.25, 0.48, 1.18], materials.leaf);
  addEllipsoid(group, 'canopy-north', [0, 1.98, -0.82], [0.83, 0.42, 0.78], materials.leafDark, 12);
  addEllipsoid(group, 'canopy-south', [0.08, 2.02, 0.78], [0.92, 0.43, 0.72], materials.leaf, 12);
  addEllipsoid(group, 'canopy-west', [-0.83, 2.03, 0], [0.74, 0.43, 0.84], materials.leaf, 12);
  addEllipsoid(group, 'canopy-east', [0.84, 2.01, -0.04], [0.76, 0.42, 0.8], materials.leafDark, 12);
  return group;
}

function createBerry(catalogX) {
  const group = templateGroup('berry', catalogX);
  const berries = [
    [-0.22, 0.24, -0.1],
    [0.2, 0.25, -0.12],
    [-0.04, 0.27, 0.21],
    [0.04, 0.43, 0],
  ];
  berries.forEach((position, index) => addEllipsoid(group, `berry-fruit-${index + 1}`, position, [0.24, 0.24, 0.24], index % 2 ? materials.berryDark : materials.berry, 12));
  group.add(mesh('berry-leaf', new THREE.CircleGeometry(0.25, 8), materials.leaf, [0, 0.52, 0], [-Math.PI / 2, 0, 0], [1, 1.4, 1]));
  return group;
}

function createAcorn(catalogX) {
  const group = templateGroup('acorn', catalogX);
  addEllipsoid(group, 'acorn-nut', [0, 0.3, 0.03], [0.36, 0.3, 0.48], materials.acorn, 12);
  group.add(mesh('acorn-cap', new THREE.CylinderGeometry(0.39, 0.32, 0.19, 12), materials.acornCap, [0, 0.54, 0.03]));
  group.add(mesh('acorn-stem', new THREE.CylinderGeometry(0.045, 0.06, 0.25, 7), materials.acornCap, [0.08, 0.73, 0.03], [0, 0, -0.25]));
  return group;
}

function createRockPile(catalogX) {
  const group = templateGroup('rock-pile', catalogX);
  const rocks = [
    [-0.47, 0.3, 0.05, 0.54, 0.3, 0.44],
    [0.35, 0.32, 0.18, 0.48, 0.32, 0.42],
    [0.08, 0.38, -0.34, 0.52, 0.38, 0.45],
  ];
  rocks.forEach(([x, y, z, sx, sy, sz], index) => addEllipsoid(group, `rock-${index + 1}`, [x, y, z], [sx, sy, sz], index === 1 ? materials.rockDark : materials.rock, 8));
  return group;
}

function createFencePanel(catalogX) {
  const group = templateGroup('fence-panel', catalogX);
  // 위에서 보아도 한 줄의 긴 통나무와 간격 있는 둥근 말뚝으로 읽히게 한다.
  group.add(mesh('fence-single-rail', new THREE.CylinderGeometry(0.14, 0.16, 6.45, 10), materials.fence, [0, 0.5, 0], [0, 0, Math.PI / 2]));
  for (const x of [-3.1, -1.55, 0, 1.55, 3.1]) {
    group.add(mesh(`fence-round-post-${x}`, new THREE.CylinderGeometry(0.3, 0.34, 1.18, 12), materials.trunk, [x, 0.59, 0]));
    group.add(mesh(`fence-post-bark-${x}`, new THREE.TorusGeometry(0.27, 0.035, 5, 12), materials.trunkDark, [x, 0.43, 0], [Math.PI / 2, 0, 0]));
    group.add(mesh(`fence-post-cap-${x}`, new THREE.CylinderGeometry(0.23, 0.25, 0.045, 12), materials.fenceCut, [x, 1.2, 0]));
  }
  return group;
}

/** 런타임에서 이름으로 복제할 수 있는 숲 소품 템플릿 카탈로그를 만든다. */
function createForestProps() {
  const scene = new THREE.Scene();
  scene.name = 'forest-props-low-poly-scene';
  const root = new THREE.Group();
  root.name = 'forest-props';
  root.userData = { catalogSpacing: 6, cloneNamedTemplateAtOrigin: true };
  scene.add(root);

  const templates = [
    createTreeTrunk(-15),
    createTreeCanopy(-9),
    createBerry(-3),
    createAcorn(3),
    createRockPile(9),
    createFencePanel(15),
  ];
  root.add(...templates);
  return { scene, root, templates };
}

function round(value) {
  return Number(value.toFixed(4));
}

function boundsFor(object) {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    min: [round(box.min.x), round(box.min.y), round(box.min.z)],
    max: [round(box.max.x), round(box.max.y), round(box.max.z)],
    size: [round(size.x), round(size.y), round(size.z)],
    center: [round(center.x), round(center.y), round(center.z)],
  };
}

function localBoundsFor(object) {
  const catalogX = object.position.x;
  const bounds = boundsFor(object);
  for (const key of ['min', 'max', 'center']) bounds[key][0] = round(bounds[key][0] - catalogX);
  return bounds;
}

async function exportBinary(scene, outputPath) {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, {
    binary: true,
    onlyVisible: true,
    trs: true,
  });
  await writeFile(outputPath, Buffer.from(result));
}

function readGlbJson(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2) {
    throw new Error('GLB header validation failed');
  }
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error('GLB JSON chunk missing');
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

async function verifyGlbNodes(path, requiredNames) {
  const buffer = await readFile(path);
  const gltf = readGlbJson(buffer);
  const names = new Set((gltf.nodes ?? []).map((node) => node.name));
  const missing = requiredNames.filter((name) => !names.has(name));
  if (missing.length > 0) throw new Error(`${path}: missing nodes: ${missing.join(', ')}`);
  return { byteLength: buffer.byteLength, nodeCount: gltf.nodes?.length ?? 0, requiredNodesPresent: true };
}

function assertBounds(label, bounds, expectedMaximum) {
  bounds.size.forEach((value, axis) => {
    if (!(value > 0) || value > expectedMaximum[axis]) {
      throw new Error(`${label}: invalid axis ${axis} size ${value}`);
    }
  });
  if (bounds.min[1] < -0.001) throw new Error(`${label}: pivot extends below ground (${bounds.min[1]})`);
}

async function main() {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const squirrel = createSquirrel();
  const forest = createForestProps();
  const squirrelBounds = boundsFor(squirrel.root);
  assertBounds('squirrel', squirrelBounds, [2.5, 2, 3.4]);

  const templateBounds = Object.fromEntries(
    forest.templates.map((template) => {
      const bounds = localBoundsFor(template);
      assertBounds(template.name, bounds, [7, 4, 4]);
      return [template.name, {
        ...bounds,
        catalogOffset: [template.position.x, 0, 0],
        pivot: template.userData.pivot,
      }];
    }),
  );

  await exportBinary(squirrel.scene, SQUIRREL_PATH);
  await exportBinary(forest.scene, FOREST_PATH);

  const squirrelNodes = ['squirrel', 'body', 'head', 'tail', 'legFL', 'legFR', 'legBL', 'legBR'];
  const forestNodes = ['forest-props', 'tree-trunk', 'tree-canopy', 'berry', 'acorn', 'rock-pile', 'fence-panel'];
  const verification = {
    squirrel: await verifyGlbNodes(SQUIRREL_PATH, squirrelNodes),
    forestProps: await verifyGlbNodes(FOREST_PATH, forestNodes),
    boundsValid: true,
  };

  const manifest = {
    schemaVersion: 1,
    generator: `client/scripts/generate-lowpoly-assets.mjs@${SCRIPT_VERSION}`,
    coordinateSystem: {
      up: '+Y',
      north: '-Z',
      unit: 'game world unit',
    },
    materials: {
      workflow: 'metallic-roughness',
      metalness: 0,
      roughness: 0.88,
      embeddedTextures: false,
    },
    assets: {
      squirrel: {
        file: 'squirrel.glb',
        pivot: 'ground-center',
        forwardAxis: '-Z',
        bounds: squirrelBounds,
        requiredNodes: squirrelNodes,
        gaitNodes: ['legFL', 'legFR', 'legBL', 'legBR'],
      },
      forestProps: {
        file: 'forest-props.glb',
        templateUsage: 'clone the named group, then reset its position to the target world position',
        templates: templateBounds,
        requiredNodes: forestNodes,
      },
    },
    verification,
  };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  globalThis.console.log(`Generated ${SQUIRREL_PATH}`);
  globalThis.console.log(`Generated ${FOREST_PATH}`);
  globalThis.console.log(`Generated ${MANIFEST_PATH}`);
  globalThis.console.log(JSON.stringify(verification, null, 2));
}

await main();
