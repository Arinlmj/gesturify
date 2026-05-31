import React, { useEffect, useRef } from "react";
import * as THREE from "three";

const COLOR_SET = [
  new THREE.Color("#35d9ff"),
  new THREE.Color("#9d5cff"),
  new THREE.Color("#ff9e38"),
  new THREE.Color("#58ffb0"),
  new THREE.Color("#ff4f8d"),
];

const STYLE_LABELS = {
  orb: "粒子球",
  vortex: "旋涡环",
  geometry: "几何场",
};

const ORB_COUNT = 900;
const tmpColor = new THREE.Color();
const tmpVector = new THREE.Vector3();
const GEOMETRY_AXIS = new THREE.Vector3(0.4, 1, 0.25).normalize();

function createParticleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(160,235,255,0.95)");
  gradient.addColorStop(0.55, "rgba(132,92,255,0.42)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 96, 96);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function pointerToWorld(point, camera, rect) {
  const x = (point.x / Math.max(1, rect.width)) * 2 - 1;
  const y = -(point.y / Math.max(1, rect.height)) * 2 + 1;
  const vector = new THREE.Vector3(x, y, 0.55).unproject(camera);
  return vector.multiplyScalar(0.48);
}

function createOrbSeeds(count) {
  return Array.from({ length: count }, (_, index) => {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const face = Math.floor(Math.random() * 6);
    return {
      theta,
      phi,
      phase: Math.random() * Math.PI * 2,
      orbit: 0.4 + Math.random() * 1.4,
      radius: 0.65 + Math.random() * 0.75,
      depth: Math.random(),
      pullDelay: Math.random() * 0.62,
      sideA: Math.random() * 2 - 1,
      sideB: Math.random() * 2 - 1,
      face,
      color: COLOR_SET[index % COLOR_SET.length],
    };
  });
}

function cubeShellOffset(seed, scale) {
  const a = seed.sideA * scale;
  const b = seed.sideB * scale;
  const fixed = scale * (seed.face % 2 === 0 ? 1 : -1);
  switch (Math.floor(seed.face / 2)) {
    case 0:
      return tmpVector.set(fixed, a, b).clone();
    case 1:
      return tmpVector.set(a, fixed, b).clone();
    default:
      return tmpVector.set(a, b, fixed).clone();
  }
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function mixNumber(start, end, amount) {
  return start + (end - start) * amount;
}

function easeInOut(amount) {
  const value = Math.max(0, Math.min(1, amount));
  return value * value * (3 - value * 2);
}

function getSeedPullAmount(seed, grabAmount) {
  const delay = seed.pullDelay * 0.72;
  return easeInOut((grabAmount - delay) / Math.max(0.001, 1 - delay));
}

function applyDepthPull(vector, seed, compact) {
  const farDepth = -2.8 - seed.depth * 3.7;
  const coreDepth = (seed.depth - 0.5) * 0.5;
  vector.z += mixNumber(farDepth, coreDepth, compact);
  return vector;
}

function getStyleOffset(seed, style, rotation, grabAmount) {
  const compact = getSeedPullAmount(seed, grabAmount);
  if (style === "vortex") {
    const spin = mixNumber(0.7, 1.25 + seed.orbit * 0.28, compact);
    const angle = seed.phase + rotation * spin;
    const radius = mixNumber(2.45 + seed.radius * 1.65 + seed.depth * 0.9, 0.24 + seed.radius * 0.15, compact);
    const y = Math.sin(seed.theta * 2 + seed.phase) * mixNumber(1.18 + seed.depth * 0.6, 0.075, compact);
    const z = Math.cos(seed.phi + seed.phase) * mixNumber(0.95, 0.08, compact);
    return applyDepthPull(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius + z), seed, compact);
  }

  if (style === "geometry") {
    const shell = cubeShellOffset(seed, mixNumber(1.85 + seed.radius * 0.95 + seed.depth * 0.55, 0.24 + seed.radius * 0.07, compact));
    shell.applyAxisAngle(GEOMETRY_AXIS, rotation * mixNumber(0.62, 1.1, compact));
    return applyDepthPull(shell, seed, compact);
  }

  const angle = seed.theta + rotation * mixNumber(0.62, 1 + seed.orbit * 0.18, compact);
  const wobble = Math.sin(seed.phase) * mixNumber(0.18, 0.025, compact);
  const radius = mixNumber(2.6 + seed.radius * 1.55 + seed.depth * 1.05, 0.24 + seed.radius * 0.16, compact) + wobble;
  return applyDepthPull(new THREE.Vector3(
    Math.sin(seed.phi) * Math.cos(angle) * radius,
    Math.cos(seed.phi) * radius,
    Math.sin(seed.phi) * Math.sin(angle) * radius,
  ), seed, compact);
}

function createPointMaterial(texture) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      pointTexture: { value: texture },
      opacity: { value: 1 },
    },
    vertexShader: `
      attribute float size;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (260.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D pointTexture;
      uniform float opacity;
      varying vec3 vColor;
      void main() {
        vec4 sprite = texture2D(pointTexture, gl_PointCoord);
        gl_FragColor = vec4(vColor, opacity) * sprite;
      }
    `,
    vertexColors: true,
  });
}

export default function EffectStage({
  releaseEvent,
  gesture,
  gesturePoint,
  effectStyle,
  energy,
  density,
  gestureRotation,
  rotationSensitivity,
}) {
  const mountRef = useRef(null);
  const engineRef = useRef(null);
  const handledReleaseIdRef = useRef(null);
  const gestureRef = useRef(gesture);
  const gesturePointRef = useRef(gesturePoint);
  const effectStyleRef = useRef(effectStyle);
  const densityRef = useRef(density);
  const energyRef = useRef(energy);
  const gestureRotationRef = useRef(gestureRotation);
  const rotationSensitivityRef = useRef(rotationSensitivity);

  useEffect(() => {
    gestureRef.current = gesture;
    gesturePointRef.current = gesturePoint;
    effectStyleRef.current = effectStyle;
    densityRef.current = density;
    energyRef.current = energy;
    gestureRotationRef.current = gestureRotation;
    rotationSensitivityRef.current = rotationSensitivity;
  }, [density, effectStyle, energy, gesture, gesturePoint, gestureRotation, rotationSensitivity]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2("#05070c", 0.085);

    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
    camera.position.set(0, 0, 10);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x05070c, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const clock = new THREE.Clock();
    let frameId = 0;
    const bursts = [];
    const particleTexture = createParticleTexture();

    const ambient = new THREE.AmbientLight("#b7dcff", 0.85);
    scene.add(ambient);

    const cyanLight = new THREE.PointLight("#35d9ff", 2.8, 18);
    cyanLight.position.set(-3, 2.5, 5);
    scene.add(cyanLight);

    const amberLight = new THREE.PointLight("#ff9e38", 1.6, 16);
    amberLight.position.set(4, -3, 5);
    scene.add(amberLight);

    const grid = new THREE.GridHelper(24, 48, "#19425a", "#101820");
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -5.2;
    grid.material.transparent = true;
    grid.material.opacity = 0.32;
    scene.add(grid);

    const wireGroup = new THREE.Group();
    const cubeMaterial = new THREE.MeshBasicMaterial({
      color: "#35d9ff",
      wireframe: true,
      transparent: true,
      opacity: 0.2,
    });
    for (let i = 0; i < 5; i += 1) {
      const geometry = new THREE.BoxGeometry(1.2 + i * 0.45, 1.2 + i * 0.45, 1.2 + i * 0.45);
      const cube = new THREE.Mesh(geometry, cubeMaterial.clone());
      cube.position.set((i - 2) * 1.6, Math.sin(i) * 0.7, -1.8 - i * 0.25);
      cube.rotation.set(i * 0.4, i * 0.2, i * 0.17);
      wireGroup.add(cube);
    }
    scene.add(wireGroup);

    const orbSeeds = createOrbSeeds(ORB_COUNT);
    const orbPositions = new Float32Array(ORB_COUNT * 3);
    const orbColors = new Float32Array(ORB_COUNT * 3);
    const orbSizes = new Float32Array(ORB_COUNT);
    for (let i = 0; i < ORB_COUNT; i += 1) {
      const seed = orbSeeds[i];
      const offset = getStyleOffset(seed, "orb", 0, 0);
      orbPositions[i * 3] = offset.x;
      orbPositions[i * 3 + 1] = offset.y;
      orbPositions[i * 3 + 2] = offset.z;
      tmpColor.copy(seed.color).lerp(new THREE.Color("#ffffff"), Math.random() * 0.18);
      orbColors[i * 3] = tmpColor.r;
      orbColors[i * 3 + 1] = tmpColor.g;
      orbColors[i * 3 + 2] = tmpColor.b;
      orbSizes[i] = 0.12 + Math.random() * 0.26;
    }

    const orbGeometry = new THREE.BufferGeometry();
    orbGeometry.setAttribute("position", new THREE.BufferAttribute(orbPositions, 3));
    orbGeometry.setAttribute("color", new THREE.BufferAttribute(orbColors, 3));
    orbGeometry.setAttribute("size", new THREE.BufferAttribute(orbSizes, 1));
    const orbMaterial = createPointMaterial(particleTexture);
    orbMaterial.uniforms.opacity.value = 0.42;
    const orbPoints = new THREE.Points(orbGeometry, orbMaterial);
    scene.add(orbPoints);

    const grabGroup = new THREE.Group();
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: "#58ffb0",
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.018, 10, 128), haloMaterial.clone());
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.014, 10, 128), haloMaterial.clone());
    ringB.rotation.x = Math.PI / 2;
    const cage = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.74, 1),
      new THREE.MeshBasicMaterial({
        color: "#35d9ff",
        wireframe: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
      }),
    );
    grabGroup.add(ringA, ringB, cage);
    scene.add(grabGroup);

    const grabTarget = new THREE.Vector3(0, 0, 0);
    const idleCenter = new THREE.Vector3(0.2, 0.05, -0.4);
    const pullCenter = new THREE.Vector3();

    const resize = () => {
      const width = Math.max(320, mount.clientWidth);
      const height = Math.max(280, mount.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const createBurst = (point, options = {}) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const origin = pointerToWorld(point, camera, rect);
      const count = Math.round((options.density ?? densityRef.current) * 9.5);
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const sizes = new Float32Array(count);
      const velocities = [];
      const baseEnergy = (options.energy ?? energyRef.current) / 100;

      for (let i = 0; i < count; i += 1) {
        positions[i * 3] = origin.x;
        positions[i * 3 + 1] = origin.y;
        positions[i * 3 + 2] = origin.z;

        const color = COLOR_SET[i % COLOR_SET.length];
        tmpColor.copy(color).lerp(new THREE.Color("#ffffff"), Math.random() * 0.22);
        colors[i * 3] = tmpColor.r;
        colors[i * 3 + 1] = tmpColor.g;
        colors[i * 3 + 2] = tmpColor.b;

        sizes[i] = 0.18 + Math.random() * 0.54;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const direction = new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta),
          Math.sin(phi) * Math.sin(theta),
          Math.cos(phi) * 0.68,
        ).normalize();
        const coreRadius = 0.03 + Math.random() * Math.random() * 0.26;
        positions[i * 3] += direction.x * coreRadius;
        positions[i * 3 + 1] += direction.y * coreRadius;
        positions[i * 3 + 2] += direction.z * coreRadius;
        const speed = 1.7 + Math.random() * 5.6 * baseEnergy;
        velocities.push(direction.multiplyScalar(speed));
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

      const material = createPointMaterial(particleTexture);
      const points = new THREE.Points(geometry, material);
      scene.add(points);
      bursts.push({
        points,
        geometry,
        material,
        velocities,
        age: 0,
        life: 1.95,
      });
    };

    engineRef.current = {
      releaseAt(point, options) {
        createBurst(point, options);
      },
    };

    window.addEventListener("resize", resize);
    resize();

    let wasGrabbing = false;
    let lastGestureRotation = 0;
    let handDrivenRotation = 0;
    let grabAmount = 0;

    const animate = () => {
      const delta = Math.min(clock.getDelta(), 0.033);
      const elapsed = clock.elapsedTime;
      const style = effectStyleRef.current;
      const isGrabbing = gestureRef.current === "PINCH" && gesturePointRef.current;
      const rect = renderer.domElement.getBoundingClientRect();

      if (isGrabbing) {
        const currentGestureRotation = gestureRotationRef.current ?? lastGestureRotation;
        if (wasGrabbing) {
          const rotationDelta = normalizeAngle(currentGestureRotation - lastGestureRotation);
          if (Math.abs(rotationDelta) < 0.9) {
            const sensitivity = Math.max(0, (rotationSensitivityRef.current ?? 100) / 100);
            handDrivenRotation += rotationDelta * sensitivity;
          }
        }
        lastGestureRotation = currentGestureRotation;
      }
      wasGrabbing = isGrabbing;
      grabAmount += ((isGrabbing ? 1 : 0) - grabAmount) * Math.min(1, delta * (isGrabbing ? 2.35 : 3.2));

      if (gesturePointRef.current) {
        const nextTarget = pointerToWorld(
          { x: gesturePointRef.current.x * rect.width, y: gesturePointRef.current.y * rect.height },
          camera,
          rect,
        );
        grabTarget.lerp(nextTarget, Math.min(1, delta * 12));
      } else {
        grabTarget.lerp(idleCenter, Math.min(1, delta * 2.5));
      }

      wireGroup.rotation.x = 0.08;
      wireGroup.rotation.y = handDrivenRotation * 0.12;
      grid.material.opacity = 0.24 + Math.sin(elapsed * 0.9) * 0.06;
      cyanLight.intensity = 2.3 + Math.sin(elapsed * 2.3) * 0.55;
      amberLight.intensity = 1.2 + Math.cos(elapsed * 1.8) * 0.35;

      const activeOrbCount = isGrabbing || grabAmount > 0.02 ? ORB_COUNT : Math.min(ORB_COUNT, Math.max(220, Math.round(densityRef.current * 6.4)));
      orbGeometry.setDrawRange(0, activeOrbCount);
      orbMaterial.uniforms.opacity.value += (mixNumber(0.42, 0.98, grabAmount) - orbMaterial.uniforms.opacity.value) * 0.08;
      const orbPositionAttribute = orbGeometry.getAttribute("position");
      pullCenter.copy(idleCenter).lerp(grabTarget, Math.min(1, grabAmount * 1.25));
      for (let i = 0; i < activeOrbCount; i += 1) {
        const desired = getStyleOffset(orbSeeds[i], style, handDrivenRotation, grabAmount);
        desired.add(grabAmount > 0.02 ? pullCenter : idleCenter);
        const follow = isGrabbing ? mixNumber(0.055, 0.2, grabAmount) : grabAmount > 0.02 ? 0.11 : 0.035;
        orbPositionAttribute.array[i * 3] += (desired.x - orbPositionAttribute.array[i * 3]) * follow;
        orbPositionAttribute.array[i * 3 + 1] += (desired.y - orbPositionAttribute.array[i * 3 + 1]) * follow;
        orbPositionAttribute.array[i * 3 + 2] += (desired.z - orbPositionAttribute.array[i * 3 + 2]) * follow;
      }
      orbPositionAttribute.needsUpdate = true;

      grabGroup.position.copy(grabTarget);
      grabGroup.rotation.x = style === "geometry" ? handDrivenRotation * 0.36 : handDrivenRotation * 0.08;
      grabGroup.rotation.y = handDrivenRotation * (style === "vortex" ? 1.35 : 1);
      grabGroup.rotation.z = style === "vortex" ? handDrivenRotation * 0.46 : 0;
      const haloOpacity = isGrabbing ? 0.75 : 0.12;
      ringA.material.opacity += (haloOpacity - ringA.material.opacity) * 0.12;
      ringB.material.opacity = ringA.material.opacity * (style === "vortex" ? 1 : 0.65);
      cage.material.opacity += ((isGrabbing && style === "geometry" ? 0.62 : 0.12) - cage.material.opacity) * 0.1;
      ringA.scale.setScalar(style === "vortex" ? 1.25 : 1);
      ringB.scale.setScalar(style === "orb" ? 0.82 : 1.15);
      cage.scale.setScalar(style === "geometry" ? 1.25 : 0.92);

      for (let b = bursts.length - 1; b >= 0; b -= 1) {
        const burst = bursts[b];
        burst.age += delta;
        const t = burst.age / burst.life;
        const positionAttribute = burst.geometry.getAttribute("position");
        for (let i = 0; i < burst.velocities.length; i += 1) {
          const velocity = burst.velocities[i];
          velocity.multiplyScalar(0.987);
          positionAttribute.array[i * 3] += velocity.x * delta;
          positionAttribute.array[i * 3 + 1] += velocity.y * delta;
          positionAttribute.array[i * 3 + 2] += velocity.z * delta;
        }
        positionAttribute.needsUpdate = true;
        burst.material.uniforms.opacity.value = Math.max(0, 1 - t * t);
        if (t >= 1) {
          scene.remove(burst.points);
          burst.geometry.dispose();
          burst.material.dispose();
          bursts.splice(b, 1);
        }
      }

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      engineRef.current = null;
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
      particleTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    if (!releaseEvent || handledReleaseIdRef.current === releaseEvent.id) return;
    const mount = mountRef.current;
    const engine = engineRef.current;
    if (!mount || !engine) return;
    handledReleaseIdRef.current = releaseEvent.id;
    const rect = mount.getBoundingClientRect();
    engine.releaseAt(
      {
        x: releaseEvent.x * rect.width,
        y: releaseEvent.y * rect.height,
      },
      { style: releaseEvent.style },
    );
  }, [releaseEvent]);

  return (
    <section className="effect-stage" ref={mountRef} aria-label="赛博空间火花 3D 画布">
      <div className="stage-hud stage-hud-top">
        <span>{STYLE_LABELS[effectStyle] ?? "粒子球"}</span>
        <strong>{density}</strong>
      </div>
      <div className="stage-hud stage-hud-bottom">
        <span>{gesture === "PINCH" ? "抓取聚拢" : "释放点"}</span>
        <strong>{releaseEvent ? `${Math.round(releaseEvent.x * 100)}.${Math.round(releaseEvent.y * 100)}` : "等待手势"}</strong>
      </div>
    </section>
  );
}
