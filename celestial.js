import * as THREE from "three";

// Sky-dome helpers: Preetham sky extensions (twilight, night gradient, Milky
// Way), a magnitude-based star field, and horizon-clipped sun/moon billboards.

// Deterministic PRNG so the sky looks the same on every visit
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOISE_GLSL = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += amp * vnoise(p);
      p = p * 2.03 + 7.1;
      amp *= 0.5;
    }
    return sum / 0.96875;
  }
`;

/* ------------------------------------------------------------------------ */
/* Galactic frame                                                           */
/* ------------------------------------------------------------------------ */

// Stars and the Milky Way are modelled in a local galactic frame:
// x → galactic centre, y → north galactic pole (latitude), z = x × y.
// This maps that frame to J2000 equatorial coordinates (IAU galactic axes:
// centre at RA 266.40°, Dec −28.94°; pole at RA 192.86°, Dec +27.13°).
export const GALACTIC_TO_EQUATORIAL = new THREE.Matrix4()
  .set(
    -0.0548755604, 0.4941094279, -0.867666149, 0,
    -0.8734370902, -0.44482963, -0.1980763734, 0,
    -0.4838350155, 0.7469822445, 0.4559837762, 0,
    0, 0, 0, 1
  )
  .multiply(
    new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1)
  );

/* ------------------------------------------------------------------------ */
/* Preetham sky extension                                                   */
/* ------------------------------------------------------------------------ */

const SKY_EXTRA_PARS = /* glsl */ `
  uniform float uDayMix;
  uniform vec3 uZenithColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uGlowColor;
  uniform float uGlowStrength;
  uniform vec3 uBeltColor;
  uniform float uBeltStrength;
  uniform float uMilkyWay;
  uniform mat3 uWorldToGalactic;

  ${NOISE_GLSL}

  vec3 milkyWay(vec3 g) {
    float lat = g.y;
    float core = pow(max(g.x, 0.0), 2.5); // brighter toward the galactic centre
    float n1 = fbm(g * 3.5);
    float width = 0.085 + 0.09 * core + 0.05 * (n1 - 0.5);
    float band = exp(-(lat * lat) / (width * width));

    float clouds = fbm(g * 9.0 + 3.7);
    float grain = vnoise(g * 150.0); // unresolved star grain
    float dustN = fbm(g * 13.0 + 11.3);

    // Great Rift: dark dust lane hugging the plane, ragged by noise
    float laneY = lat - 0.012 + 0.035 * (n1 - 0.5);
    float lane = exp(-(laneY * laneY) / (0.0009 + 0.0035 * core))
      * smoothstep(0.3, 0.68, dustN + 0.2 * core);
    float dust = smoothstep(0.5, 0.8, dustN);

    float intensity = band * (0.3 + 0.7 * clouds) * (0.45 + 0.55 * core);
    intensity *= 1.0 - 0.8 * lane;
    intensity *= 1.0 - 0.4 * dust;
    intensity *= 0.78 + 0.44 * grain;
    // Central bulge
    intensity += pow(max(g.x, 0.0), 14.0) * exp(-(lat * lat) / 0.02) * 0.6 * (1.0 - 0.6 * lane);

    vec3 tint = mix(
      vec3(0.62, 0.7, 0.92),
      vec3(1.0, 0.86, 0.7),
      clamp(core * 0.9 + clouds * 0.25, 0.0, 1.0)
    );
    return tint * intensity;
  }
`;

const SKY_EXTRA_MAIN = /* glsl */ `
  vec3 skyColor = retColor * uDayMix;
  float h = max(direction.y, 0.0);

  // Twilight / night gradient: airglow-lit horizon, deep zenith
  skyColor += mix(uZenithColor, uHorizonColor, pow(1.0 - h, 5.0));

  // Afterglow hugging the horizon on the sun side
  vec2 dirXZ = normalize(direction.xz + vec2(1e-5));
  vec2 sunXZ = normalize(vSunDirection.xz + vec2(1e-5));
  // Clamp: rounding lets the dot of two unit vectors overshoot ±1, and on
  // Windows (ANGLE/D3D11) pow() of a negative base is NaN. A NaN here
  // poisons the bloom chain and the sky IBL, flashing black boxes on screen.
  float toSun = clamp(dot(dirXZ, sunXZ) * 0.5 + 0.5, 0.0, 1.0);
  float glow = pow(toSun, 4.0) * exp(-h * 6.0)
    + pow(toSun, 20.0) * exp(-h * 20.0) * 1.6;
  skyColor += uGlowColor * glow * uGlowStrength;

  // Belt of Venus: pink anti-twilight arch above the Earth's shadow
  float anti = pow(1.0 - toSun, 2.0);
  float beltY = (h - 0.09) / 0.07;
  float belt = anti * exp(-beltY * beltY);
  float earthShadow = anti * (1.0 - smoothstep(0.0, 0.06, h));
  skyColor += uBeltColor * belt * uBeltStrength;
  skyColor *= 1.0 - earthShadow * uBeltStrength * 6.0;

  if (uMilkyWay > 0.001) {
    vec3 g = uWorldToGalactic * direction;
    // Atmospheric extinction washes the band out near the horizon
    float extinction = smoothstep(0.0, 0.4, h);
    skyColor += milkyWay(g) * uMilkyWay * extinction * 0.12;
  }

  gl_FragColor = vec4(skyColor, 1.0);
`;

/** Extend three's Preetham Sky with twilight, night gradient and Milky Way. */
export function extendSkyMaterial(material) {
  Object.assign(material.uniforms, {
    uDayMix: { value: 1 },
    uZenithColor: { value: new THREE.Color(0, 0, 0) },
    uHorizonColor: { value: new THREE.Color(0, 0, 0) },
    uGlowColor: { value: new THREE.Color(0, 0, 0) },
    uGlowStrength: { value: 0 },
    uBeltColor: { value: new THREE.Color(0, 0, 0) },
    uBeltStrength: { value: 0 },
    uMilkyWay: { value: 0 },
    uWorldToGalactic: { value: new THREE.Matrix3() },
  });
  material.fragmentShader = material.fragmentShader
    .replace("uniform vec3 up;", `uniform vec3 up;\n${SKY_EXTRA_PARS}`)
    // Preetham's constant "night sky" floor reads as flat grey once the sun
    // sets; fade it out with the sun so the twilight layers take over
    .replace(
      "vec3 L0 = vec3( 0.1 ) * Fex;",
      "vec3 L0 = vec3( 0.1 ) * Fex * smoothstep( 0.0, 20.0, vSunE );"
    )
    .replace("gl_FragColor = vec4( retColor, 1.0 );", SKY_EXTRA_MAIN);
  material.needsUpdate = true;
}

/* ------------------------------------------------------------------------ */
/* Water extension                                                          */
/* ------------------------------------------------------------------------ */

/**
 * three's Water adds a fixed grey (0.1) to reflections, which turns a night sea
 * grey, and only shows specular where the reflection is already bright, so
 * there's no glitter path under a low sun or moon. Expose both as uniforms.
 */
export function extendWaterMaterial(material) {
  material.uniforms.reflectFloor = { value: 0.1 };
  material.uniforms.glitter = { value: 0 };
  material.fragmentShader = material.fragmentShader
    .replace(
      "uniform vec3 waterColor;",
      "uniform vec3 waterColor;\nuniform float reflectFloor;\nuniform float glitter;"
    )
    .replace(
      "( vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight )",
      "( vec3( reflectFloor ) + reflectionSample * 0.9 + ( reflectionSample + vec3( glitter ) ) * specularLight )"
    );
  material.needsUpdate = true;
}

/* ------------------------------------------------------------------------ */
/* Stars                                                                    */
/* ------------------------------------------------------------------------ */

// B-V colour index → linear RGB (Ballesteros temperature + blackbody fit)
function bvToLinearRgb(bv) {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)) / 100;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const r = t <= 66 ? 1 : clamp((329.698727446 * Math.pow(t - 60, -0.1332047592)) / 255);
  const g =
    t <= 66
      ? clamp((99.4708025861 * Math.log(t) - 161.1195681661) / 255)
      : clamp((288.1221695283 * Math.pow(t - 60, -0.0755148492)) / 255);
  const b =
    t >= 66 ? 1 : t <= 19 ? 0 : clamp((138.5177312231 * Math.log(t - 10) - 305.0447927307) / 255);
  // Stars read far less saturated than a blackbody swatch
  const lin = [r, g, b].map((c) => Math.pow(c, 2.2));
  const luma = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
  const out = lin.map((c) => luma + (c - luma) * 0.55);
  const max = Math.max(...out);
  return out.map((c) => c / max);
}

/**
 * Point-source star field. Stars are generated in the local galactic frame, so
 * the object's matrix should map that frame to world space. Visibility is driven by
 * `uLimitMag` (faintest visible magnitude), so stars emerge brightest-first as
 * twilight deepens, the way they do in a real sky.
 */
export function createStarField({ count, radius = 8200 }) {
  const rand = mulberry32(1337);
  const gaussian = () =>
    Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const mags = new Float32Array(count);
  const seeds = new Float32Array(count);
  const twinkles = new Float32Array(count);

  // Cumulative star counts grow ~10^(0.45 m): many faint, very few bright
  const k = 0.45;
  const lo = Math.pow(10, k * -1.5);
  const hi = Math.pow(10, k * 6.6);

  for (let i = 0; i < count; i++) {
    const mag = Math.log10(lo + rand() * (hi - lo)) / k;

    // Fainter stars crowd toward the galactic plane
    const crowd = 0.12 + 0.4 * THREE.MathUtils.clamp((mag - 3) / 3.5, 0, 1);
    const sinLat =
      rand() < crowd
        ? THREE.MathUtils.clamp(gaussian() * 0.16, -1, 1)
        : rand() * 2 - 1;
    const lon = rand() * Math.PI * 2;
    const cosLat = Math.sqrt(1 - sinLat * sinLat);
    positions[i * 3] = radius * cosLat * Math.cos(lon);
    positions[i * 3 + 1] = radius * sinLat;
    positions[i * 3 + 2] = radius * cosLat * Math.sin(lon);

    // B-V mixture: hot blue-white, sun-like, and cool orange giants
    const pick = rand();
    const bv =
      pick < 0.3
        ? 0.0 + gaussian() * 0.22
        : pick < 0.75
          ? 0.62 + gaussian() * 0.22
          : 1.2 + gaussian() * 0.28;
    const [r, g, b] = bvToLinearRgb(THREE.MathUtils.clamp(bv, -0.35, 2.0));
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;

    mags[i] = mag;
    seeds[i] = rand();
    twinkles[i] = 0.3 + rand() * 0.45;
  }

  const points = new THREE.Points(
    pointSourceGeometry(positions, colors, mags, seeds, twinkles),
    createPointSourceMaterial()
  );
  points.frustumCulled = false;
  points.matrixAutoUpdate = false;
  points.renderOrder = 1;
  points.raycast = () => {};
  return points;
}

const PLANET_COLORS = {
  venus: [1, 0.96, 0.88],
  mars: [1, 0.62, 0.42],
  jupiter: [1, 0.95, 0.86],
  saturn: [1, 0.9, 0.72],
};

/**
 * Planets as steady point sources sharing the star shader. Positions (world
 * space) and magnitudes are written by the caller from the ephemeris.
 */
export function createPlanetField(material, names = Object.keys(PLANET_COLORS)) {
  const n = names.length;
  const colors = new Float32Array(names.flatMap((name) => PLANET_COLORS[name]));
  const points = new THREE.Points(
    pointSourceGeometry(
      new Float32Array(n * 3),
      colors,
      new Float32Array(n).fill(99),
      new Float32Array(names.map((_, i) => i / n)),
      new Float32Array(n).fill(0.04) // planets barely scintillate
    ),
    material
  );
  points.userData.names = names;
  points.frustumCulled = false;
  points.renderOrder = 1;
  points.raycast = () => {};
  return points;
}

function pointSourceGeometry(positions, colors, mags, seeds, twinkles) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aMag", new THREE.BufferAttribute(mags, 1));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute("aTwinkle", new THREE.BufferAttribute(twinkles, 1));
  return geometry;
}

function createPointSourceMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLimitMag: { value: -6 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      attribute float aMag;
      attribute float aSeed;
      attribute float aTwinkle;
      uniform float uTime;
      uniform float uLimitMag;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vIntensity;
      varying float vHalo;

      void main() {
        vec3 dir = normalize(mat3(modelMatrix) * position);
        float alt = dir.y;
        float s = max(alt, 0.0);

        // Airmass (Kasten-style) → extinction in magnitudes + reddening
        float airmass = 1.0 / (s + 0.025 * exp(-11.0 * s));
        float mag = aMag + 0.25 * (airmass - 1.0);
        vec3 redden = mix(vec3(1.0, 0.6, 0.36), vec3(1.0), exp(-0.1 * (airmass - 1.0)));

        // Emerge as the sky darkens past each star's magnitude
        float visible = smoothstep(mag - 0.4, mag + 0.9, uLimitMag);
        visible *= smoothstep(-0.005, 0.03, alt);

        // Perceptual brightness (compressed flux), mag 2 ≈ 1.0
        float b = pow(10.0, -0.22 * (mag - 2.0));

        // Scintillation: irregular, stronger low in the sky; planets stay steady
        float t = uTime;
        float seed = aSeed * 43.0;
        float n = sin(t * 2.9 + seed) * 0.5
          + sin(t * 7.3 + seed * 1.7) * 0.3
          + sin(t * 13.1 + seed * 2.3) * 0.2;
        float depth = aTwinkle * mix(0.35, 1.0, 1.0 - smoothstep(0.0, 0.5, alt));
        float twinkle = max(0.0, 1.0 + depth * n);

        // Bright stars low on the horizon flash colours
        vec3 chroma = vec3(1.0)
          + (1.0 - smoothstep(0.0, 0.25, alt)) * min(b, 1.0) * aTwinkle * 0.35
            * vec3(sin(t * 11.0 + seed), sin(t * 9.0 + seed * 2.0), sin(t * 13.0 + seed * 3.0));

        vColor = color * redden * max(chroma, vec3(0.0));
        vIntensity = b * visible * twinkle;
        vHalo = clamp(b - 1.0, 0.0, 4.0);

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uPixelRatio * (2.2 + 1.6 * sqrt(min(b, 9.0)));
        gl_Position = projectionMatrix * mvPosition;
        if (vIntensity < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // cull
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vIntensity;
      varying float vHalo;

      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        // Tight PSF core + faint glow on the brightest stars
        float psf = exp(-r2 * 7.0) + exp(-r2 * 2.2) * 0.06 * vHalo;
        gl_FragColor = vec4(vColor * psf * vIntensity, 0.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: true,
    vertexColors: true,
  });
}

/* ------------------------------------------------------------------------ */
/* Sun & moon billboards                                                    */
/* ------------------------------------------------------------------------ */

// Camera-facing quad built in the vertex shader; clipped at the sea horizon
const BILLBOARD_VERTEX = /* glsl */ `
  uniform vec2 uSize;
  uniform float uSquash;
  uniform vec3 uLightDirection;
  uniform vec3 uNorth;
  varying vec2 vUv;
  varying vec3 vDir;
  varying vec3 vLight;
  varying vec2 vNorth;

  void main() {
    vUv = uv;
    vec3 center = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 world = center
      + right * position.x * uSize.x
      + up * position.y * uSize.y * uSquash;
    vDir = normalize(world - cameraPosition);

    // Moon-to-sun direction and celestial north in the quad's frame
    // (right, up, toward viewer) → exact phase and limb orientation
    vec3 back = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
    vLight = vec3(
      dot(uLightDirection, right),
      dot(uLightDirection, up),
      dot(uLightDirection, back)
    );
    vec2 north = vec2(dot(uNorth, right), dot(uNorth, up));
    vNorth = length(north) > 1e-4 ? normalize(north) : vec2(0.0, 1.0);

    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const HORIZON_CLIP = /* glsl */ `
  float horizonMask(vec3 dir) {
    return smoothstep(-0.0012, 0.0004, dir.y);
  }
`;

function billboardUniforms(size) {
  return {
    uSize: { value: new THREE.Vector2(size, size) },
    uSquash: { value: 1 },
    uLightDirection: { value: new THREE.Vector3(0, 1, 0) },
    uNorth: { value: new THREE.Vector3(0, 1, 0) },
    uColor: { value: new THREE.Color(0xffffff) },
    uOpacity: { value: 0 },
  };
}

function makeBillboard(material) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.frustumCulled = false;
  mesh.raycast = () => {}; // clicks go through the dedicated hit sphere
  return mesh;
}

/** Additive glow billboard (sun corona, moon aureole). */
export function createGlowBillboard(map, size) {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...billboardUniforms(size), map: { value: map } },
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vDir;
      ${HORIZON_CLIP}
      void main() {
        vec4 tex = texture2D(map, vUv);
        float a = tex.a * uOpacity * horizonMask(vDir);
        gl_FragColor = vec4(tex.rgb * uColor * a, 0.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: true,
  });
  const mesh = makeBillboard(material);
  mesh.renderOrder = 2;
  return mesh;
}

/** Lit moon disc: albedo map, true phase and orientation, earthshine, star occlusion. */
export function createMoonBillboard(size) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...billboardUniforms(size),
      map: { value: createMoonAlbedoTexture() },
      uOcclusion: { value: 0 },
      uEarthshine: { value: 0.03 },
    },
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uOcclusion;
      uniform float uEarthshine;
      varying vec2 vUv;
      varying vec3 vDir;
      varying vec3 vLight;
      varying vec2 vNorth;
      ${HORIZON_CLIP}
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float aa = max(fwidth(r) * 1.5, 0.004);
        float disc = 1.0 - smoothstep(1.0 - aa, 1.0, r);
        if (disc <= 0.0) discard;

        vec3 n = vec3(p, sqrt(max(0.0, 1.0 - r * r)));
        float terminator = smoothstep(-0.04, 0.16, dot(n, vLight));
        // Albedo map is drawn north-up; turn it to the sky's north
        vec2 east = vec2(vNorth.y, -vNorth.x);
        vec2 mapUv = vec2(dot(p, east), dot(p, vNorth)) * 0.5 + 0.5;
        float albedo = texture2D(map, mapUv).r;
        float shade = terminator * mix(0.82, 1.0, n.z) + uEarthshine;
        vec3 col = uColor * albedo * shade;

        float mask = disc * horizonMask(vDir);
        // Additive by day (sky shows through the dark limb); occludes stars by night
        gl_FragColor = vec4(col * mask * uOpacity, mask * uOcclusion);
      }
    `,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    extensions: { derivatives: true },
  });
  const mesh = makeBillboard(material);
  mesh.renderOrder = 3;
  return mesh;
}

// Radius of the solid solar disc within the glow texture (fraction of half-size)
export const SUN_GLOW_DISC_FRACTION = 0.12;

export function createSunGlowTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = size * 0.5;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, "rgba(255, 253, 245, 1)");
  g.addColorStop(SUN_GLOW_DISC_FRACTION * 0.9, "rgba(255, 246, 220, 1)");
  g.addColorStop(SUN_GLOW_DISC_FRACTION, "rgba(255, 220, 160, 0.7)");
  g.addColorStop(0.2, "rgba(255, 180, 100, 0.28)");
  g.addColorStop(0.4, "rgba(255, 140, 70, 0.08)");
  g.addColorStop(0.7, "rgba(255, 120, 60, 0.02)");
  g.addColorStop(1, "rgba(255, 110, 50, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createMoonHaloTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = size * 0.5;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, "rgba(220, 230, 255, 0.55)");
  g.addColorStop(0.15, "rgba(200, 215, 245, 0.22)");
  g.addColorStop(0.4, "rgba(170, 190, 230, 0.06)");
  g.addColorStop(1, "rgba(150, 170, 220, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createMoonAlbedoTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const rand = mulberry32(7);

  ctx.fillStyle = "rgb(214, 212, 206)";
  ctx.fillRect(0, 0, size, size);

  // Maria — dark basaltic plains, roughly where they sit on the near side
  const maria = [
    [0.36, 0.3, 0.17], [0.55, 0.26, 0.13], [0.64, 0.42, 0.12],
    [0.27, 0.52, 0.16], [0.47, 0.47, 0.11], [0.72, 0.28, 0.08],
    [0.4, 0.66, 0.09], [0.2, 0.36, 0.1], [0.58, 0.6, 0.07],
  ];
  maria.forEach(([x, y, r]) => {
    for (let j = 0; j < 4; j++) {
      const cx = (x + (rand() - 0.5) * r * 0.6) * size;
      const cy = (y + (rand() - 0.5) * r * 0.6) * size;
      const rr = r * size * (0.6 + rand() * 0.5);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, "rgba(92, 94, 98, 0.42)");
      g.addColorStop(0.7, "rgba(92, 94, 98, 0.26)");
      g.addColorStop(1, "rgba(92, 94, 98, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Craters: dark floor, bright rim offset toward the light
  for (let i = 0; i < 160; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 0.8 + Math.pow(rand(), 3) * 9;
    ctx.fillStyle = "rgba(60, 60, 64, 0.16)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 250, 0.18)";
    ctx.lineWidth = Math.max(0.6, r * 0.25);
    ctx.beginPath();
    ctx.arc(x - r * 0.15, y - r * 0.15, r, Math.PI * 0.9, Math.PI * 1.9);
    ctx.stroke();
  }

  // Tycho with its bright ray system
  const tx = size * 0.46;
  const ty = size * 0.84;
  ctx.strokeStyle = "rgba(255, 255, 250, 0.07)";
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2;
    const len = size * (0.2 + rand() * 0.35);
    ctx.lineWidth = 1 + rand() * 2;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + Math.cos(a) * len, ty + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255, 255, 250, 0.6)";
  ctx.beginPath();
  ctx.arc(tx, ty, 3, 0, Math.PI * 2);
  ctx.fill();

  // Fine regolith speckle
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* ------------------------------------------------------------------------ */
/* Final dither pass                                                        */
/* ------------------------------------------------------------------------ */

// Triangular-noise dither after tone mapping: kills banding in dark gradients
export const DitherShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float n = hash12(gl_FragCoord.xy) + hash12(gl_FragCoord.xy + 71.3) - 1.0;
      color.rgb += n / 255.0;
      gl_FragColor = color;
    }
  `,
};
