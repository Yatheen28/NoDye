import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

/* -------------------------------------------------------------------------- */
/* Shaders                                                                    */
/* -------------------------------------------------------------------------- */

// Simplex noise (Ashima Arts / Stefan Gustavson, MIT). Used for gyri.
const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`

const VERTEX = /* glsl */ `
${NOISE_GLSL}
uniform float uDisplace;
uniform float uSeed;
uniform float uFreq;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying float vRidge;

void main() {
  vec3 p = position + vec3(uSeed);
  // Layered noise folded with abs() gives ridge-like gyri and sulci.
  float n = snoise(p * uFreq) * 0.62
          + snoise(p * uFreq * 2.3) * 0.26
          + snoise(p * uFreq * 5.1) * 0.12;
  float ridge = 1.0 - abs(n);
  vRidge = ridge;

  vec3 displaced = position + normal * (ridge * uDisplace);
  vec4 wp = modelMatrix * vec4(displaced, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const FRAGMENT = /* glsl */ `
uniform float uProgress;
uniform float uMinY;
uniform float uMaxY;
uniform float uTime;
uniform float uPulse;   // 0..1 idle "breathing" strength
uniform float uGlow;    // 0..1 completion flare
uniform vec3 uBase;
uniform vec3 uFillCool;
uniform vec3 uFillWarm;
uniform vec3 uRim;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying float vRidge;

void main() {
  float h = clamp((vWorldPos.y - uMinY) / (uMaxY - uMinY), 0.0, 1.0);
  float edge = 0.045;
  float filled = 1.0 - smoothstep(uProgress - edge, uProgress + edge, h);

  // Sulci sit in the noise troughs; darken them for depth.
  float sulcus = smoothstep(0.12, 0.85, vRidge);

  vec3 N = normalize(vNormalW);
  // Key light from upper-front-right plus a cool fill from the opposite side so
  // the unfilled brain is always legible against the dark panel.
  vec3 L = normalize(vec3(0.45, 0.9, 0.55));
  vec3 L2 = normalize(vec3(-0.6, 0.2, -0.4));
  float diff = max(dot(N, L), 0.0);
  float fill2 = max(dot(N, L2), 0.0) * 0.22;
  float wrap = max(dot(N, -L) * 0.15, 0.0);

  vec3 baseCol = mix(uBase * 0.55, uBase, sulcus);
  vec3 fillTone = mix(uFillCool, uFillWarm, smoothstep(0.0, 1.0, h));
  vec3 fillCol = mix(fillTone * 0.55, fillTone, sulcus);
  vec3 col = mix(baseCol, fillCol, filled);
  // Ambient floor (0.5) keeps shadowed regions from collapsing to black.
  col *= 0.5 + diff * 0.72 + fill2 + wrap;
  col += uBase * 0.08;

  vec3 V = normalize(cameraPosition - vWorldPos);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uRim * fres * (mix(0.22, 0.42, filled) + uPulse * 0.22);

  // Thin bright band at the current fill front.
  float active = step(0.002, uProgress) * (1.0 - step(0.998, uProgress));
  float band = exp(-pow((h - uProgress) / 0.010, 2.0));
  col += uRim * band * 1.1 * active;

  // Completion: whole surface lifts and the rim flares briefly.
  col += (uRim * fres * 0.9 + fillTone * 0.25) * uGlow;

  gl_FragColor = vec4(col, 1.0);
}
`

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

const BOUNDS = { minY: -1.32, maxY: 0.78 }

interface BrainPartSpec {
  geometry: THREE.BufferGeometry
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
  displace: number
  freq: number
  seed: number
}

function buildParts(): BrainPartSpec[] {
  const hemi = new THREE.SphereGeometry(1, 160, 120)
  const cere = new THREE.SphereGeometry(1, 72, 56)
  const stem = new THREE.CylinderGeometry(0.15, 0.22, 0.95, 40, 12, false)

  return [
    // Cerebral hemispheres: elongated front-to-back, separated by a fissure.
    {
      geometry: hemi,
      position: [-0.56, 0.05, 0.02],
      rotation: [0, 0, 0.03],
      scale: [0.58, 0.72, 1.0],
      displace: 0.075,
      freq: 3.1,
      seed: 0.0,
    },
    {
      geometry: hemi,
      position: [0.56, 0.05, 0.02],
      rotation: [0, 0, -0.03],
      scale: [0.58, 0.72, 1.0],
      displace: 0.075,
      freq: 3.1,
      seed: 17.3, // different seed so the hemispheres are not mirror copies
    },
    // Cerebellum lobes, tucked under the occipital region.
    {
      geometry: cere,
      position: [-0.3, -0.62, -0.58],
      rotation: [0.2, 0, 0],
      scale: [0.36, 0.3, 0.38],
      displace: 0.05,
      freq: 6.5,
      seed: 4.2,
    },
    {
      geometry: cere,
      position: [0.3, -0.62, -0.58],
      rotation: [0.2, 0, 0],
      scale: [0.36, 0.3, 0.38],
      displace: 0.05,
      freq: 6.5,
      seed: 9.7,
    },
    // Brain stem.
    {
      geometry: stem,
      position: [0, -0.86, -0.22],
      rotation: [0.22, 0, 0],
      scale: [1, 1, 1],
      displace: 0.012,
      freq: 4.0,
      seed: 2.5,
    },
  ]
}

interface SceneProps {
  target: number
  active: boolean
}

function BrainMesh({ target, active }: SceneProps) {
  const parts = useMemo(buildParts, [])
  const smoothed = useRef(0)
  const pulse = useRef(0)
  const glow = useRef(0)
  const groupRef = useRef<THREE.Group>(null)

  const materials = useMemo(
    () =>
      parts.map(
        (p) =>
          new THREE.ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            uniforms: {
              uProgress: { value: 0 },
              uMinY: { value: BOUNDS.minY },
              uMaxY: { value: BOUNDS.maxY },
              uTime: { value: 0 },
              uPulse: { value: 0 },
              uGlow: { value: 0 },
              uDisplace: { value: p.displace },
              uFreq: { value: p.freq },
              uSeed: { value: p.seed },
              // Bright enough to read as a teal-grey brain on #0B1416 at 0%.
              uBase: { value: new THREE.Color('#3A5A60') },
              uFillCool: { value: new THREE.Color('#1E8C86') },
              uFillWarm: { value: new THREE.Color('#D9A75C') },
              uRim: { value: new THREE.Color('#9FE0DA') },
            },
          }),
      ),
    [parts],
  )

  useEffect(() => {
    return () => {
      materials.forEach((m) => m.dispose())
      parts.forEach((p) => p.geometry.dispose())
    }
  }, [materials, parts])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    // Exponential approach: smooth between WebSocket ticks, never snaps.
    // Once the run is over (not active) we approach faster so the last few
    // percent land before the page navigates away.
    const k = 1 - Math.exp(-dt * (active ? 2.6 : 5))
    smoothed.current = THREE.MathUtils.lerp(smoothed.current, target, k)

    // Idle breathing: only when nothing has started yet.
    const idle = !active && target <= 0.001
    const pulseTarget = idle ? 0.5 + 0.5 * Math.sin(t * 1.4) : 0
    pulse.current = THREE.MathUtils.lerp(pulse.current, pulseTarget, 1 - Math.exp(-dt * 4))

    // Completion flare: ramps up when the fill has actually reached the top,
    // then settles to a gentle sustained pulse.
    const done = target >= 0.999 && smoothed.current >= 0.985
    const glowTarget = done ? 0.55 + 0.45 * Math.sin(t * 3.0) : 0
    glow.current = THREE.MathUtils.lerp(glow.current, glowTarget, 1 - Math.exp(-dt * 3.5))

    if (groupRef.current) {
      const s = 1 + (idle ? 0.012 * Math.sin(t * 1.4) : 0) + glow.current * 0.02
      groupRef.current.scale.setScalar(s)
    }

    for (const m of materials) {
      m.uniforms.uProgress.value = smoothed.current
      m.uniforms.uTime.value = t
      m.uniforms.uPulse.value = pulse.current
      m.uniforms.uGlow.value = glow.current
    }
  })

  return (
    <group ref={groupRef} position={[0, 0.12, 0]}>
      {parts.map((p, i) => (
        <mesh
          key={i}
          geometry={p.geometry}
          material={materials[i]}
          position={p.position}
          rotation={p.rotation}
          scale={p.scale}
        />
      ))}
    </group>
  )
}

/* -------------------------------------------------------------------------- */
/* 2D fallback (no WebGL)                                                     */
/* -------------------------------------------------------------------------- */

function BrainFallback({ progress }: { progress: number }) {
  const clipY = 100 - progress
  return (
    <svg
      viewBox="0 0 100 100"
      width="60%"
      height="60%"
      style={{ position: 'absolute', left: '20%', top: '15%' }}
      aria-hidden="true"
    >
      <defs>
        <clipPath id="brain-fill">
          <rect x="0" y={clipY} width="100" height={progress} />
        </clipPath>
      </defs>
      <g fill="none" stroke="#3A5A60" strokeWidth={2.5} strokeLinecap="round">
        <path d="M47 15C30 15 14 27 14 45c0 12 7 21 15 25v14h18V15z" />
        <path d="M53 15c17 0 33 12 33 30 0 12-7 21-15 25v14H53V15z" />
      </g>
      <g clipPath="url(#brain-fill)" fill="#1E8C86">
        <path d="M47 15C30 15 14 27 14 45c0 12 7 21 15 25v14h18V15z" />
        <path d="M53 15c17 0 33 12 33 30 0 12-7 21-15 25v14H53V15z" />
      </g>
    </svg>
  )
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/* -------------------------------------------------------------------------- */
/* Public component                                                           */
/* -------------------------------------------------------------------------- */

interface BrainVisualizerProps {
  /** Displayed progress, 0..100. */
  progress: number
  stage: string
  /** Optional secondary line under the stage (e.g. "Slice 40/155", "42s"). */
  detail?: string | null
  /** True while inference is running (faster auto-rotate, no idle pulse). */
  active: boolean
  /** True once the backend has reported completion. */
  complete?: boolean
}

export function BrainVisualizer({
  progress,
  stage,
  detail,
  active,
  complete = false,
}: BrainVisualizerProps) {
  const webgl = useMemo(hasWebGL, [])
  const target = Math.min(1, Math.max(0, progress / 100))
  const idle = !active && !complete && progress <= 0

  return (
    <div
      className={`brain-viz${idle ? ' is-idle' : ''}${complete ? ' is-complete' : ''}`}
      aria-live="polite"
    >
      {webgl ? (
        <Canvas
          // R3F wraps the <canvas> in a div; pin that wrapper to the container
          // so the WebGL buffer always matches .brain-viz's box.
          style={{ position: 'absolute', inset: 0 }}
          camera={{ position: [0, 0.55, 3.7], fov: 36 }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        >
          <BrainMesh target={target} active={active} />
          <OrbitControls
            enablePan={false}
            enableZoom={false}
            autoRotate
            autoRotateSpeed={active ? 0.9 : 0.3}
            minPolarAngle={Math.PI * 0.25}
            maxPolarAngle={Math.PI * 0.72}
            enableDamping
            dampingFactor={0.08}
          />
        </Canvas>
      ) : (
        <BrainFallback progress={Math.round(progress)} />
      )}

      <div className="brain-viz__hud">
        <div>
          <div className="brain-viz__pct">{Math.round(progress)}%</div>
          <div className="brain-viz__stage">{stage}</div>
          {detail && <div className="brain-viz__detail">{detail}</div>}
        </div>
        <div className="brain-viz__hint">
          <span>Drag to rotate</span>
          <span>Fill tracks live slice progress</span>
        </div>
      </div>
    </div>
  )
}
