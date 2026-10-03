import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Water } from "three/examples/jsm/objects/Water.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { gsap } from "gsap";
import {
  GALACTIC_TO_EQUATORIAL,
  SUN_GLOW_DISC_FRACTION,
  extendSkyMaterial,
  extendWaterMaterial,
  createStarField,
  createPlanetField,
  createGlowBillboard,
  createMoonBillboard,
  createSunGlowTexture,
  createMoonHaloTexture,
  DitherShader,
} from "./celestial.js";
import {
  julianDay,
  skyAt,
  findSunAltitude,
  equatorialToHorizontal,
  planetPosition,
  refraction,
} from "./astronomy.js";

// Global error handler
window.addEventListener("error", function (event) {
  // Display error to user
  const loadingText = document.getElementById("loading-text");
  if (loadingText) {
    loadingText.textContent =
      "An error occurred. Please check console and refresh.";
    loadingText.style.color = "red";
  }

  // Prevent white screen by ensuring loading screen remains visible
  const loadingScreen = document.getElementById("loading-screen");
  if (loadingScreen) {
    loadingScreen.style.opacity = "1";
    loadingScreen.style.display = "flex";
  }

  return false;
});

// Global promise rejection handler
window.addEventListener("unhandledrejection", function (event) {
  return false;
});

// Global Variables
let camera, scene, renderer, sunMesh;
let controls, water, sun;
let canvasPositions = [];
let raycaster, mouse;
let canvases = [];
const numberOfCanvases = 14;
let currentCanvasIndex = 0;
let isNightMode = false;
let nightHintShown = false;
let skyUniforms;
let skyMesh;
let pmremGenerator;
let ambientLight;
let sunLight;
let moonLight;
let moonMesh;
let moonHalo;
let sunDisc;
let stars;
let planets;
let rectLights = [];
let dayEnvironmentMap = null;
let lastEnvironmentBake = -1;
let assetsLoaded = false;
let hasEnteredGallery = false;
let isOrientationChanging = false;
const waterMotion = { timeScale: 0.3 };
const galleryPulse = { value: 0 };

// Resolve public asset URLs against Vite base (works on Vercel root hosting)
const assetUrl = (path) => {
  const clean = path.startsWith("/") ? path.slice(1) : path;
  const base = import.meta.env.BASE_URL || "/";
  return base.endsWith("/") ? `${base}${clean}` : `${base}/${clean}`;
};

// The sky is a real evening: Cannon Beach, Oregon, on 3 August 2025, from
// golden hour (sun 1.6° up) to astronomical night (sun 18° down), 2h22m of
// sky compressed into the transition. Sun, moon (position, size, phase and
// orientation), planets, stars and Milky Way all come from the ephemeris in
// astronomy.js; that evening has a 75%-lit waxing gibbous moon low in the
// south with the galactic centre just above the horizon.
const OBSERVER = { latitude: 45.8918, longitude: -123.9615 };
const EVENING_SEARCH_START = julianDay(new Date("2025-08-03T19:00:00Z")); // local noon
const DAY_SUN_ALTITUDE = 1.6;
const NIGHT_SUN_ALTITUDE = -18;
// The compass is rotated so the golden-hour sun sits here in the scene
// (theta of THREE.Vector3.setFromSphericalCoords)
const SUNSET_SCENE_AZIMUTH = -150;
const CELESTIAL_DISTANCE = 42000;
const SKY_TRANSITION_SECONDS = 10;

const DAY_JD = findSunAltitude(
  EVENING_SEARCH_START,
  EVENING_SEARCH_START + 1,
  DAY_SUN_ALTITUDE,
  OBSERVER
);
const NIGHT_JD = findSunAltitude(
  EVENING_SEARCH_START,
  EVENING_SEARCH_START + 1,
  NIGHT_SUN_ALTITUDE,
  OBSERVER
);
const COMPASS_OFFSET = SUNSET_SCENE_AZIMUTH + skyAt(DAY_JD, OBSERVER).sun.azimuth;

/** Horizontal (altitude, compass azimuth) → world-space unit vector. */
function horizontalToWorld(altitude, azimuth, out = new THREE.Vector3()) {
  return out.setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - altitude),
    THREE.MathUtils.degToRad(COMPASS_OFFSET - azimuth)
  );
}

/** Equatorial (RA/Dec) → world, via the observer's horizon at sidereal time lst. */
function equatorialToWorld(ra, dec, lst, out) {
  const { altitude, azimuth } = equatorialToHorizontal(
    ra,
    dec,
    lst,
    OBSERVER.latitude
  );
  return horizontalToWorld(altitude, azimuth, out);
}

/** Apparent altitude: what you see after atmospheric refraction lifts it. */
const apparentAltitude = (trueAltitude) => trueAltitude + refraction(trueAltitude);

// Sky look keyed by the sun's true altitude (descending). Everything (sky,
// lights, water, stars, post) is sampled from these, so the look follows the
// real sun through sunset → civil → nautical → astronomical twilight, and back
// as a sunrise. Colors are sRGB hex; sky gradient values are additive radiance.
const SKY_KEYFRAMES = [
  {
    sunAltitude: 1.6, // golden-hour day
    turbidity: 8,
    rayleigh: 2.4,
    mieCoefficient: 0.0045,
    mieDirectionalG: 0.86,
    skyDay: 0.5,
    zenith: 0x000000,
    horizon: 0x000000,
    glowColor: 0xff9850,
    glow: 0,
    beltColor: 0xc88aa0,
    belt: 0,
    milkyWay: 0,
    limitMag: -6,
    moon: 0.35,
    ambientColor: 0xfff6e8,
    ambientIntensity: 0.42,
    sunColor: 0xfff2d6,
    sunIntensity: 1.35,
    moonColor: 0xb8c8e8,
    moonIntensity: 0,
    waterColor: 0x012218,
    waterSunColor: 0xfff0d8,
    waterMoonColor: 0x000000,
    waterSize: 0.48,
    waterDistortion: 2.15,
    waterTimeScale: 0.3,
    reflectFloor: 0.1,
    glitter: 0.1,
    rectColor: 0xffa366,
    rectMin: 1.4,
    rectMax: 2.2,
    bloomStrength: 0.22,
    bloomThreshold: 0.88,
    exposure: 1.05,
    sunGlowColor: 0xffffff,
    sunGlow: 0.9,
  },
  {
    sunAltitude: -0.9, // sunset — the disc slips into the sea
    turbidity: 10,
    rayleigh: 3.4,
    mieCoefficient: 0.006,
    mieDirectionalG: 0.92,
    skyDay: 0.7,
    zenith: 0x000000,
    horizon: 0x000000,
    glowColor: 0xff7a38,
    glow: 0.08,
    beltColor: 0xc88aa0,
    belt: 0.012,
    milkyWay: 0,
    limitMag: -4.8,
    moon: 0.45,
    ambientColor: 0xffc8a0,
    ambientIntensity: 0.28,
    sunColor: 0xff9a50,
    sunIntensity: 0.55,
    moonColor: 0xb8c8e8,
    moonIntensity: 0,
    waterColor: 0x061418,
    waterSunColor: 0xff9a58,
    waterMoonColor: 0x000000,
    waterSize: 0.44,
    waterDistortion: 1.9,
    waterTimeScale: 0.24,
    reflectFloor: 0.07,
    glitter: 0.18,
    rectColor: 0xffa366,
    rectMin: 1.5,
    rectMax: 2.4,
    bloomStrength: 0.26,
    bloomThreshold: 0.82,
    exposure: 1.1,
    sunGlowColor: 0xff8c50,
    sunGlow: 1,
  },
  {
    sunAltitude: -4, // civil twilight — afterglow, first bright stars
    turbidity: 10,
    rayleigh: 3.4,
    mieCoefficient: 0.006,
    mieDirectionalG: 0.92,
    skyDay: 0.3,
    zenith: 0x22325e,
    horizon: 0x4a5272,
    glowColor: 0xff6a38,
    glow: 0.12,
    beltColor: 0xb07090,
    belt: 0.02,
    milkyWay: 0,
    limitMag: 1.2,
    moon: 0.6,
    ambientColor: 0x8090b8,
    ambientIntensity: 0.13,
    sunColor: 0xff8040,
    sunIntensity: 0,
    moonColor: 0xb8c8e8,
    moonIntensity: 0.04,
    waterColor: 0x031020,
    waterSunColor: 0x000000,
    waterMoonColor: 0x303848,
    waterSize: 0.4,
    waterDistortion: 1.7,
    waterTimeScale: 0.2,
    reflectFloor: 0.035,
    glitter: 0.25,
    rectColor: 0xffaa66,
    rectMin: 1.65,
    rectMax: 2.6,
    bloomStrength: 0.27,
    bloomThreshold: 0.8,
    exposure: 1.05,
    sunGlowColor: 0xff6030,
    sunGlow: 0,
  },
  {
    sunAltitude: -9, // nautical twilight — the Milky Way begins to show
    turbidity: 10,
    rayleigh: 3.4,
    mieCoefficient: 0.006,
    mieDirectionalG: 0.92,
    skyDay: 0,
    zenith: 0x0c1634,
    horizon: 0x1e2846,
    glowColor: 0x6a3c58,
    glow: 0.02,
    beltColor: 0xb07090,
    belt: 0,
    milkyWay: 0.3,
    limitMag: 4.2,
    moon: 0.9,
    ambientColor: 0x3a4a78,
    ambientIntensity: 0.07,
    sunColor: 0xff8040,
    sunIntensity: 0,
    moonColor: 0xb8c8e8,
    moonIntensity: 0.1,
    waterColor: 0x010a16,
    waterSunColor: 0x000000,
    waterMoonColor: 0x8090a8,
    waterSize: 0.38,
    waterDistortion: 1.55,
    waterTimeScale: 0.16,
    reflectFloor: 0.02,
    glitter: 0.4,
    rectColor: 0xffae6a,
    rectMin: 1.75,
    rectMax: 2.75,
    bloomStrength: 0.29,
    bloomThreshold: 0.78,
    exposure: 1.0,
    sunGlowColor: 0xff6030,
    sunGlow: 0,
  },
  {
    sunAltitude: -18, // astronomical night
    turbidity: 10,
    rayleigh: 3.4,
    mieCoefficient: 0.006,
    mieDirectionalG: 0.92,
    skyDay: 0,
    zenith: 0x050a18,
    horizon: 0x121a2e,
    glowColor: 0x6a3c58,
    glow: 0,
    beltColor: 0xb07090,
    belt: 0,
    milkyWay: 1,
    limitMag: 6.6,
    moon: 1,
    ambientColor: 0x0a1020,
    ambientIntensity: 0.05,
    sunColor: 0xff8040,
    sunIntensity: 0,
    moonColor: 0xb8c8e8,
    moonIntensity: 0.14,
    waterColor: 0x00060c,
    waterSunColor: 0x000000,
    waterMoonColor: 0xa8b8d0,
    waterSize: 0.36,
    waterDistortion: 1.45,
    waterTimeScale: 0.14,
    reflectFloor: 0.012,
    glitter: 0.55,
    rectColor: 0xffb070,
    rectMin: 1.8,
    rectMax: 2.8,
    bloomStrength: 0.3,
    bloomThreshold: 0.78,
    exposure: 1.0,
    sunGlowColor: 0xff6030,
    sunGlow: 0,
  },
];

const COLOR_KEYS = Object.keys(SKY_KEYFRAMES[0]).filter((key) =>
  /Color$|^zenith$|^horizon$/.test(key)
);
// Pre-convert hex → linear THREE.Color once
SKY_KEYFRAMES.forEach((frame) => {
  COLOR_KEYS.forEach((key) => {
    frame[key] = new THREE.Color(frame[key]);
  });
});

const skyState = { progress: 0 };
let skyTween = null;
const skyLook = sampleSkyKeyframes(DAY_SUN_ALTITUDE, {});
const moonDirection = new THREE.Vector3();
const moonToSun = new THREE.Vector3();
const celestialNorth = new THREE.Vector3();
const skyMatrix = new THREE.Matrix4();
const equatorialToWorldMatrix = new THREE.Matrix4();
const basisX = new THREE.Vector3();
const basisY = new THREE.Vector3();
const basisZ = new THREE.Vector3();
// Moonlit sky: same blue as daylight, ~a millionth as bright (linear radiance)
const MOONLIT_ZENITH = new THREE.Color().setRGB(0.004, 0.008, 0.02);
const MOONLIT_HORIZON = new THREE.Color().setRGB(0.006, 0.01, 0.02);

/** Piecewise-linear sample of SKY_KEYFRAMES at a true sun altitude into `out`. */
function sampleSkyKeyframes(altitude, out) {
  let i = 0;
  while (
    i < SKY_KEYFRAMES.length - 2 &&
    altitude < SKY_KEYFRAMES[i + 1].sunAltitude
  ) {
    i++;
  }
  const a = SKY_KEYFRAMES[i];
  const b = SKY_KEYFRAMES[i + 1];
  const t = THREE.MathUtils.clamp(
    (a.sunAltitude - altitude) / (a.sunAltitude - b.sunAltitude),
    0,
    1
  );
  for (const key in a) {
    if (key === "sunAltitude") continue;
    if (a[key] instanceof THREE.Color) {
      out[key] = (out[key] || new THREE.Color()).lerpColors(a[key], b[key], t);
    } else {
      out[key] = a[key] + (b[key] - a[key]) * t;
    }
  }
  return out;
}

// V1: Post-processing
let composer, bloomPass;

// P3: Tab visibility & hover throttle
let isTabVisible = true;
let lastHoverTime = 0;
const HOVER_THROTTLE_MS = 50;

// I3: Hover feedback
let hoveredCanvas = null;

// I5: Detail view / zoom
let isDetailView = false;
let orbitLocked = false;
let savedCameraPosition = null;
let savedControlsTarget = null;

// DOM Elements
const startButton = document.getElementById("start-button");
const loadingScreen = document.getElementById("loading-screen");
const sceneContainer = document.getElementById("scene-container");
const app = document.getElementById("app");
const progressRing = document.querySelector(".progress-ring__circle");
const progressText = document.getElementById("progress-text");
const backgroundMusic = document.getElementById("background-music");
const volumeToggleBtn = document.getElementById("volume-toggle");
const selectSound = new Audio(assetUrl("modernSelect.wav"));
const orientationMessage = document.getElementById("orientation-message");
const artworkCaption = document.getElementById("artwork-caption");
const artworkTitleEl = document.getElementById("artwork-title");
const artworkArtistEl = document.getElementById("artwork-artist");
const detailCloseBtn = document.getElementById("detail-close");

// P4: Memory Management - dispose utility
function disposeObject(obj) {
  if (!obj) return;
  if (obj.geometry) obj.geometry.dispose();
  if (obj.material) {
    if (Array.isArray(obj.material)) {
      obj.material.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    } else {
      if (obj.material.map) obj.material.map.dispose();
      obj.material.dispose();
    }
  }
  if (obj.children) {
    obj.children.forEach((child) => disposeObject(child));
  }
}

// P3: Tab visibility listener
document.addEventListener("visibilitychange", () => {
  isTabVisible = !document.hidden;
});

// P4: Cleanup on page unload
window.addEventListener("beforeunload", () => {
  if (scene) {
    scene.traverse((obj) => disposeObject(obj));
  }
  if (scene?.environment) {
    scene.environment.dispose();
    scene.environment = null;
  }
  dayEnvironmentMap = null;
  if (pmremGenerator) {
    pmremGenerator.dispose();
  }
  if (renderer) {
    renderer.dispose();
  }
  if (composer) {
    composer.dispose();
  }
});

// Constants
const radius = progressRing.r.baseVal.value;
const circumference = radius * 2 * Math.PI;
const canvasYPosition = 25;
const circleRadius = 90;
const GALLERY_LOOK_TARGET = new THREE.Vector3(0, 10, 0);
const CANVAS_VIEW_Y_OFFSET = 2.3;

const artworkInfo = [
  {
    title: "Peacock's Pride", // image0
    artist: "Tri Pham",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "At the Gate", // image1
    artist: "Liz Burkhart",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Sun Star", // image2
    artist: "Tri Pham",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Bride", // image3
    artist: "Ebba Wagner",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Polyfall", // image4
    artist: "Valentina Piraneque Ortiz",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Serene", // image5
    artist: "Mykal Coleman",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Curious Cat", // image6
    artist: "Tri Pham",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Arrival", // image7
    artist: "Liz Burkhart",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Sleepy by the Sea", // image8
    artist: "Tri Pham",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Lunar Eclipse", // image9
    artist: "Valentina Piraneque Ortiz",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "The City", // image10
    artist: "Tri Pham",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Patriot's Parachute", // image11
    artist: "Tri Pham",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Aerial Acrobat", // image12
    artist: "Tri Pham",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Waterfall", // image13
    artist: "Ebba Wagner",
    position: new THREE.Vector3(0, 0, 0),
  },
];

// Set the correct positions for each artwork
for (let i = 0; i < numberOfCanvases; i++) {
  const angle = (i / numberOfCanvases) * Math.PI * 2;
  artworkInfo[i].position.set(
    circleRadius * Math.cos(angle),
    canvasYPosition,
    circleRadius * Math.sin(angle)
  );
}

// Audio Setup
selectSound.volume = 0.15;
backgroundMusic.volume = 0.69;
backgroundMusic.loop = true;

// Progress Ring Setup
progressRing.style.strokeDasharray = `${circumference} ${circumference}`;
progressRing.style.strokeDashoffset = circumference;

// Event Listeners
if (startButton) startButton.addEventListener("click", onStartButtonClick);
if (volumeToggleBtn) volumeToggleBtn.addEventListener("click", toggleMusic);
window.addEventListener("keydown", handleKeyPress);
window.addEventListener("resize", onWindowResize, false);

// Crossfade loading ring → Enter button without layout shift
function revealEnterUI() {
  if (assetsLoaded) return;

  const loadingText = document.getElementById("loading-text");
  if (loadingText) loadingText.textContent = "Ready";
  setProgress(100);

  if (loadingScreen) {
    loadingScreen.classList.add("is-ready");
  }

  // Match CSS transition; unlock interaction after crossfade begins
  window.setTimeout(() => {
    assetsLoaded = true;
    checkOrientation();
  }, 400);
}

// Wait for audio readiness without blocking forever (common host/mobile hang)
function waitForAudio(audioElement, timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (!audioElement) {
      resolve(false);
      return;
    }

    if (audioElement.readyState >= 3) {
      resolve(true);
      return;
    }

    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      audioElement.removeEventListener("canplaythrough", onReady);
      audioElement.removeEventListener("error", onError);
      resolve(ok);
    };

    const onReady = () => finish(true);
    const onError = () => finish(false);

    audioElement.addEventListener("canplaythrough", onReady, { once: true });
    audioElement.addEventListener("error", onError, { once: true });

    try {
      audioElement.load();
    } catch {
      finish(false);
      return;
    }

    setTimeout(() => finish(audioElement.readyState >= 2), timeoutMs);
  });
}

// Point audio at base-aware public paths
if (backgroundMusic) {
  backgroundMusic.src = assetUrl("zenPiano.mp3");
}

function checkOrientation() {
  if (!assetsLoaded) {
    return; // Don't check orientation if assets aren't loaded
  }

  const isLandscape = window.innerWidth > window.innerHeight;
  const isMobile = window.innerWidth <= 1024;

  const showChrome = (show) => {
    if (sceneContainer) sceneContainer.style.display = show ? "block" : "none";
    if (app) app.style.display = show ? "block" : "none";
    if (volumeToggleBtn) {
      volumeToggleBtn.style.display = show && hasEnteredGallery ? "block" : "none";
    }
    if (artworkCaption) {
      artworkCaption.style.display = show && hasEnteredGallery ? "block" : "none";
    }
    if (detailCloseBtn) {
      detailCloseBtn.style.display = show && isDetailView ? "block" : "none";
    }
  };

  if (isMobile && !isLandscape) {
    if (orientationMessage) orientationMessage.style.display = "flex";
    if (loadingScreen) loadingScreen.style.display = "none";
    showChrome(false);
    return;
  }

  if (orientationMessage) orientationMessage.style.display = "none";
  showChrome(true);

  // Only show the loading/enter screen before the user enters the gallery
  if (loadingScreen) {
    if (hasEnteredGallery) {
      loadingScreen.style.display = "none";
    } else {
      loadingScreen.style.display = "flex";
    }
  }
}

// Modified orientation change handler
function handleOrientationChange() {
  isOrientationChanging = true;

  // Use a timeout to ensure screen dimensions are fully updated
  setTimeout(() => {
    checkOrientation();

    // Update camera and renderer after orientation change
    if (camera && renderer) {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      if (controls && !orbitLocked) {
        controls.update();
      }
      render();
    }

    // Allow clicks again after a short delay
    setTimeout(() => {
      isOrientationChanging = false;
    }, 100);
  }, 100);
}

// Main Functions
async function init() {
  const manager = new THREE.LoadingManager();
  const loadingText = document.getElementById("loading-text");

  // Reserve ~90% of the bar for network loads; rest for scene setup
  manager.onProgress = function (_url, itemsLoaded, itemsTotal) {
    if (!itemsTotal) return;
    const progress = (itemsLoaded / itemsTotal) * 90;
    setProgress(progress);
  };

  manager.onError = function () {
    if (loadingText) {
      loadingText.textContent = "Error loading assets. Please refresh.";
      loadingText.style.color = "#ff6b6b";
    }
  };

  const loader = new THREE.TextureLoader(manager);

  function loadTexture(url) {
    const primary = assetUrl(url);
    return new Promise((resolve, reject) => {
      loader.load(
        primary,
        (texture) => resolve(texture),
        undefined,
        () => {
          const fallback = url.startsWith("/") ? url.slice(1) : `/${url}`;
          if (fallback === primary) {
            reject(new Error(`Failed to load texture: ${primary}`));
            return;
          }
          loader.load(
            fallback,
            (texture) => resolve(texture),
            undefined,
            (fallbackErr) =>
              reject(
                fallbackErr || new Error(`Failed to load texture: ${primary}`)
              )
          );
        }
      );
    });
  }

  function prepareTexture(texture, { srgb = false, wrap = false } = {}) {
    if (srgb && "colorSpace" in texture) {
      texture.colorSpace = THREE.SRGBColorSpace;
    } else if (srgb && "encoding" in texture) {
      // three r150 and earlier
      texture.encoding = THREE.sRGBEncoding;
    }
    if (wrap) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    }
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  // P2: Initialize RectAreaLight uniforms before creating lights
  RectAreaLightUniformsLib.init();

  // P3: Renderer with capped pixel ratio, antialias, high-performance
  renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = skyLook.exposure;
  if ("outputColorSpace" in renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  sceneContainer.appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("aria-label", "3D art gallery");
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  scene = new THREE.Scene();

  // Base fill light — intensity/color driven by day/night presets
  ambientLight = new THREE.AmbientLight(
    skyLook.ambientColor,
    skyLook.ambientIntensity
  );
  scene.add(ambientLight);

  // Key lights follow the sun and moon directions
  sunLight = new THREE.DirectionalLight(skyLook.sunColor, skyLook.sunIntensity);
  scene.add(sunLight);
  moonLight = new THREE.DirectionalLight(skyLook.moonColor, 0);
  scene.add(moonLight);

  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    1,
    69000
  );
  camera.position.set(300, 300, 690);

  sun = new THREE.Vector3();
  rectLights = [];

  // Parallel-load all textures (was sequential — major load-time win)
  if (loadingText) loadingText.textContent = "Loading artwork...";
  const textureUrls = [
    "waternormals.jpg",
    "whiteMarble.jpg",
    ...Array.from({ length: numberOfCanvases }, (_, i) => `image${i}.jpg`),
  ];
  const loadedTextures = await Promise.all(textureUrls.map((u) => loadTexture(u)));

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const waterNormals = prepareTexture(loadedTextures[0], { wrap: true });
  waterNormals.anisotropy = Math.min(8, maxAniso);
  const marbleTexture = prepareTexture(loadedTextures[1], { srgb: true });
  marbleTexture.anisotropy = Math.min(4, maxAniso);
  const imageTextures = loadedTextures.slice(2).map((tex) => {
    prepareTexture(tex, { srgb: true });
    tex.anisotropy = Math.min(4, maxAniso);
    return tex;
  });

  setProgress(92);
  if (loadingText) loadingText.textContent = "Building scene...";

  const waterGeometry = new THREE.PlaneGeometry(50000, 50000);
  const waterMapSize = window.innerWidth <= 1024 ? 512 : 1024;

  water = new Water(waterGeometry, {
    textureWidth: waterMapSize,
    textureHeight: waterMapSize,
    waterNormals: waterNormals,
    sunDirection: new THREE.Vector3(),
    sunColor: skyLook.waterSunColor,
    waterColor: skyLook.waterColor,
    distortionScale: skyLook.waterDistortion,
    fog: scene.fog !== undefined,
  });
  extendWaterMaterial(water.material);

  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  const circleRadius = 90;
  const frameDepth = 1.0;
  const frameOffset = 1.5;
  const frameRadius = circleRadius - 0.51;
  const lightRadius = frameRadius + 1.0;
  const lightIntensity = 1.5;
  const lightWidthEven = 20.5;
  const lightHeightEven = 30.5;
  const lightWidthOdd = 30.5;
  const lightHeightOdd = 20.5;
  const lightColor = 0xffa366;

  // Shared frame material — one marble texture upload for all frames
  const frameMaterial = new THREE.MeshStandardMaterial({
    map: marbleTexture,
  });

  for (let i = 0; i < numberOfCanvases; i++) {
    const angle = (i / numberOfCanvases) * Math.PI * 2;

    const isEven = i % 2 === 0;
    const frameWidth = isEven ? 20 + frameOffset * 2 : 30 + frameOffset * 2;
    const frameHeight = isEven ? 30 + frameOffset * 2 : 20 + frameOffset * 2;
    const lightWidth = isEven ? lightWidthEven : lightWidthOdd;
    const lightHeight = isEven ? lightHeightEven : lightHeightOdd;
    const canvasWidth = isEven ? 20 : 30;
    const canvasHeight = isEven ? 30 : 20;

    const frameGeometry = new THREE.BoxGeometry(
      frameWidth,
      frameDepth,
      frameHeight
    );
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
    frame.rotation.x = Math.PI / 2;
    frame.rotation.z = angle - Math.PI / 2;
    frame.position.set(
      frameRadius * Math.cos(angle),
      canvasYPosition - frameDepth / 2 + 0.5,
      frameRadius * Math.sin(angle)
    );
    scene.add(frame);

    const rectLight = new THREE.RectAreaLight(
      lightColor,
      lightIntensity,
      lightWidth,
      lightHeight
    );
    rectLight.position.set(
      lightRadius * Math.cos(angle),
      canvasYPosition,
      lightRadius * Math.sin(angle)
    );
    rectLight.lookAt(new THREE.Vector3(0, canvasYPosition, 0));
    scene.add(rectLight);
    rectLights.push(rectLight);


    const texture = imageTextures[i];
    const canvasGeometry = new THREE.BoxGeometry(canvasWidth, 0, canvasHeight);
    // Unlit artwork: each painting keeps full daylight color regardless of
    // scene day/night lighting (ambient, sun, IBL never tint the photos).
    const canvasMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    const canvas = new THREE.Mesh(canvasGeometry, canvasMaterial);
    canvas.rotation.x = Math.PI / 2;
    canvas.rotation.z = angle - Math.PI / 2;
    // Nudge slightly outward so the unlit image sits cleanly in front of the frame
    const position = new THREE.Vector3(
      (circleRadius + 0.15) * Math.cos(angle),
      canvasYPosition,
      (circleRadius + 0.15) * Math.sin(angle)
    );
    canvas.position.copy(position);
    canvasPositions.push(position);
    scene.add(canvas);
    canvases.push(canvas);
  }

  // One shared breathing pulse; min/max come from the time-of-day sample
  gsap.to(galleryPulse, {
    value: 1,
    duration: 3.0,
    repeat: -1,
    yoyo: true,
    ease: "power1.inOut",
  });

  setProgress(96);

  skyMesh = new Sky();
  skyMesh.scale.setScalar(10000);
  scene.add(skyMesh);

  extendSkyMaterial(skyMesh.material);
  skyUniforms = skyMesh.material.uniforms;

  // Keep PMREM alive so frames get sky IBL that follows the time of day
  pmremGenerator = new THREE.PMREMGenerator(renderer);

  // Invisible wide hit target for sun/moon click (covers the glow, not just the disk)
  const sunGeometry = new THREE.SphereGeometry(5600, 32, 32);
  const sunMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
  scene.add(sunMesh);

  // Sun disc + corona, clipped by the sea horizon so it visibly sets
  sunDisc = createGlowBillboard(createSunGlowTexture(), 1);
  scene.add(sunDisc);

  // Moon at its true angular size, with a faint aureole
  moonMesh = createMoonBillboard(1);
  scene.add(moonMesh);
  moonHalo = createGlowBillboard(createMoonHaloTexture(), 6000);
  scene.add(moonHalo);

  // Stars + Milky Way share the real galactic frame, turned by sidereal time
  stars = createStarField({ count: window.innerWidth <= 1024 ? 4500 : 7500 });
  stars.visible = false;
  scene.add(stars);
  planets = createPlanetField(stars.material);
  scene.add(planets);

  applyTimeOfDay(0, true);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.target.set(0, 10, 0);
  controls.minDistance = 140.0;
  controls.maxDistance = 300.0;
  controls.enableDamping = true;
  controls.zoomSpeed = 0.69;
  controls.rotateSpeed = 0.36;
  controls.dampingFactor = 0.05;
  controls.enablePan = false; // Disable right-click panning
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.NONE,
  };
  controls.update();

  // Prevent context menu on right-click
  renderer.domElement.addEventListener("contextmenu", (e) =>
    e.preventDefault()
  );

  renderer.domElement.addEventListener("click", onCanvasClick);
  renderer.domElement.addEventListener("mousemove", onCanvasHover);

  // I5: Double-click for detail view
  renderer.domElement.addEventListener("dblclick", onCanvasDoubleClick);

  // I5: Long-press for mobile detail view
  let longPressTimer = null;
  let longPressStartPos = null;
  renderer.domElement.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 1) {
        longPressStartPos = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
        longPressTimer = setTimeout(() => {
          onCanvasDoubleClick({
            clientX: longPressStartPos.x,
            clientY: longPressStartPos.y,
          });
        }, 500);
      }
    },
    { passive: true }
  );
  renderer.domElement.addEventListener(
    "touchmove",
    (e) => {
      if (longPressTimer && longPressStartPos && e.touches.length === 1) {
        const dx = e.touches[0].clientX - longPressStartPos.x;
        const dy = e.touches[0].clientY - longPressStartPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > 10) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }
    },
    { passive: true }
  );
  renderer.domElement.addEventListener(
    "touchend",
    () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    },
    { passive: true }
  );

  // I2: Touch Swipe Navigation
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  renderer.domElement.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
      }
    },
    { passive: true }
  );
  renderer.domElement.addEventListener(
    "touchend",
    (e) => {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const elapsed = Date.now() - touchStartTime;
      const dx = touchEndX - touchStartX;
      const dy = touchEndY - touchStartY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx > 50 && elapsed < 500 && absDx > absDy) {
        if (dx < 0) {
          selectSound.play();
          moveToCanvas(currentCanvasIndex - 1);
        } else {
          selectSound.play();
          moveToCanvas(currentCanvasIndex + 1);
        }
      }
    },
    { passive: true }
  );

  // V1: Post-processing pipeline (Bloom)
  composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    skyLook.bloomStrength,
    0.4, // radius
    skyLook.bloomThreshold
  );
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);
  composer.addPass(new ShaderPass(DitherShader));

  // Warm the first frame while audio resolves (non-blocking max 3s)
  if (loadingText) loadingText.textContent = "Almost ready...";
  setProgress(98);
  renderer.render(scene, camera);

  await waitForAudio(backgroundMusic, 3000);

  if (detailCloseBtn) {
    detailCloseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      exitDetailView();
    });
  }

  // Call checkOrientation on page load and whenever the orientation changes
  window.addEventListener("load", checkOrientation);
  window.addEventListener("orientationchange", handleOrientationChange);
  window.addEventListener("resize", handleOrientationChange);

  // Smooth crossfade to Enter — titles stay put (fixed action zone)
  revealEnterUI();
}

function animate() {
  requestAnimationFrame(animate);
  // P3: Skip rendering when tab is not visible
  if (!isTabVisible) return;
  // Detail view owns the camera; OrbitControls would clamp minDistance
  if (!orbitLocked) controls.update();
  render();
}

function render() {
  const seconds = performance.now() * 0.001;
  water.material.uniforms["time"].value += waterMotion.timeScale / 60.0;
  if (stars?.visible) stars.material.uniforms.uTime.value = seconds;
  const rectIntensity =
    skyLook.rectMin + (skyLook.rectMax - skyLook.rectMin) * galleryPulse.value;
  for (const light of rectLights) light.intensity = rectIntensity;
  // V1: Use composer for post-processing
  if (composer) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

// Helper Functions
function setProgress(percent) {
  const offset = circumference - (percent / 100) * circumference;
  progressRing.style.strokeDashoffset = offset;
  progressText.textContent = `${Math.round(percent)}%`;
}

function toggleMusic() {
  if (backgroundMusic.volume > 0) {
    backgroundMusic.volume = 0;
    selectSound.volume = 0;
    volumeToggleBtn.textContent = "Unmute Sound";
  } else {
    selectSound.volume = 0.15;
    backgroundMusic.volume = 0.69;
    volumeToggleBtn.textContent = "Mute Sound";
  }
}

function onStartButtonClick() {
  if (!assetsLoaded || hasEnteredGallery) {
    return;
  }

  try {
    hasEnteredGallery = true;
    selectSound.play().catch(() => {});
    loadingScreen.style.opacity = "0";
    loadingScreen.style.pointerEvents = "none";
    loadingScreen.classList.add("is-exiting");
    sceneContainer.style.opacity = "1";
    if (startButton) startButton.blur();
    renderer.domElement?.focus({ preventScroll: true });

    if (volumeToggleBtn) volumeToggleBtn.style.display = "block";

    setTimeout(() => {
      loadingScreen.style.display = "none";
    }, 2000);

    try {
      animate();
    } catch (error) {
      // Animation error handling
    }

    if (backgroundMusic) {
      backgroundMusic.play().catch(() => {});
    }

    try {
      panToCenter();
    } catch (error) {
      // Camera panning error handling
    }
  } catch (error) {
    // Start button click error handling
  }
}

function handleKeyPress(event) {
  switch (event.key) {
    case "Enter":
      document.getElementById("start-button").click();
      break;
    case "Escape":
      if (isDetailView) {
        exitDetailView();
      }
      break;
    case "m":
    case "M":
      toggleMusic();
      break;
    case "ArrowRight":
      event.preventDefault();
      selectSound.play();
      moveToCanvas(currentCanvasIndex - 1);
      break;
    case "ArrowLeft":
      event.preventDefault();
      selectSound.play();
      moveToCanvas(currentCanvasIndex + 1);
      break;
    case "f":
    case "F":
      toggleFullscreen();
      break;
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  // V1: Resize composer
  if (composer) {
    composer.setSize(window.innerWidth, window.innerHeight);
  }
  if (stars?.material?.uniforms?.uPixelRatio) {
    stars.material.uniforms.uPixelRatio.value = Math.min(
      window.devicePixelRatio,
      2
    );
  }
  if (!orbitLocked) controls.update();
  render();

  // Use the new orientation handler
  handleOrientationChange();
}

// V3: Single continuous intro spiral (no multi-phase stop/reverse)
let introTween = null;

/** Orbit-legal viewpoint in front of a painting (outside minDistance). */
function getCanvasFocusPosition(index) {
  const canvasPos = canvasPositions[index];
  const offset = new THREE.Vector3(
    canvasPos.x - GALLERY_LOOK_TARGET.x,
    canvasPos.y - CANVAS_VIEW_Y_OFFSET - GALLERY_LOOK_TARGET.y,
    canvasPos.z - GALLERY_LOOK_TARGET.z
  );
  const minDist = (controls?.minDistance ?? 140) + 0.5;
  if (offset.length() < minDist) {
    offset.setLength(minDist);
  }
  return GALLERY_LOOK_TARGET.clone().add(offset);
}

function lockOrbitDuringTween() {
  orbitLocked = true;
  if (controls) controls.enabled = false;
}

function unlockOrbitAfterTween() {
  if (isDetailView) return;
  orbitLocked = false;
  if (controls) {
    controls.enabled = true;
    controls.update();
  }
}

function panToCenter() {
  if (!camera || !controls || !canvasPositions.length) return;

  // Cancel any prior intro / camera tweens so nothing fights the path
  if (introTween) introTween.kill();
  gsap.killTweensOf(camera.position);
  gsap.killTweensOf(controls.target);

  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const endPos = getCanvasFocusPosition(0);
  const endTarget = GALLERY_LOOK_TARGET.clone();

  const startAngle = Math.atan2(startPos.z, startPos.x);
  const endAngle = Math.atan2(endPos.z, endPos.x);
  const startRadius = Math.hypot(startPos.x, startPos.z);
  const endRadius = Math.hypot(endPos.x, endPos.z);
  const startY = startPos.y;
  const endY = endPos.y;

  // One direction only: clockwise spiral that lands on the first artwork.
  // Enough arc to feel scenic, never reverses or "changes its mind".
  let angleSpan = startAngle - endAngle;
  while (angleSpan < Math.PI * 1.15) angleSpan += Math.PI * 2;
  while (angleSpan > Math.PI * 1.85) angleSpan -= Math.PI * 2;

  // Smoothstep: C1 continuous (no corner at start/end)
  const smoothstep = (t) => t * t * (3 - 2 * t);
  // Gentler approach near the end so we ease into the painting
  const smoothstep2 = (t) => smoothstep(smoothstep(t));

  const state = { t: 0 };
  lockOrbitDuringTween();

  introTween = gsap.to(state, {
    t: 1,
    duration: 7.5,
    // Single ease for the whole path — no phase boundaries
    ease: "none",
    onUpdate: () => {
      const t = state.t;
      // Spatial params use smoothsteps so velocity eases without multi-phase stops
      const aT = smoothstep(t); // angle progresses smoothly
      const rT = smoothstep2(t); // radius eases in more toward the end
      const yT = smoothstep(t);

      const angle = startAngle - angleSpan * aT;
      const radius = startRadius + (endRadius - startRadius) * rT;
      const y = startY + (endY - startY) * yT;

      camera.position.set(
        Math.cos(angle) * radius,
        y,
        Math.sin(angle) * radius
      );

      // Look target eases once toward gallery center — no mid-path retarget
      const lookT = smoothstep(t);
      controls.target.set(
        startTarget.x + (endTarget.x - startTarget.x) * lookT,
        startTarget.y + (endTarget.y - startTarget.y) * lookT,
        startTarget.z + (endTarget.z - startTarget.z) * lookT
      );
      camera.lookAt(controls.target);
    },
    onComplete: () => {
      camera.position.copy(endPos);
      controls.target.copy(endTarget);
      introTween = null;
      currentCanvasIndex = 0;
      showArtworkCaption(0);
      startNightModeHintTimer();
      unlockOrbitAfterTween();
    },
  });
}

function moveToCanvas(index) {
  // Interrupt intro if user navigates early
  if (introTween) {
    introTween.kill();
    introTween = null;
  }

  // Leave detail without restoring the saved camera — this tween takes over
  if (isDetailView) {
    isDetailView = false;
    savedCameraPosition = null;
    savedControlsTarget = null;
    setDetailCloseVisible(false);
  }
  currentCanvasIndex = (index + numberOfCanvases) % numberOfCanvases;
  showArtworkCaption(currentCanvasIndex);
  lockOrbitDuringTween();
  gsap.killTweensOf(camera.position);
  gsap.killTweensOf(controls.target);

  const pos = getCanvasFocusPosition(currentCanvasIndex);
  gsap.to(camera.position, {
    x: pos.x,
    y: pos.y,
    z: pos.z,
    duration: 1.69,
    ease: "power2.inOut",
    onUpdate: () => {
      camera.lookAt(controls.target);
    },
  });
  gsap.to(controls.target, {
    x: GALLERY_LOOK_TARGET.x,
    y: GALLERY_LOOK_TARGET.y,
    z: GALLERY_LOOK_TARGET.z,
    duration: 1.69,
    ease: "power2.inOut",
    onComplete: unlockOrbitAfterTween,
  });
}

function onCanvasClick(event) {
  // Prevent clicks during orientation changes
  if (isOrientationChanging) {
    return;
  }

  // Ensure we have current window dimensions
  const currentWidth = window.innerWidth;
  const currentHeight = window.innerHeight;

  mouse.x = (event.clientX / currentWidth) * 2 - 1;
  mouse.y = -(event.clientY / currentHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster
    .intersectObjects(scene.children)
    .filter((intersect) => canvases.includes(intersect.object));

  if (intersects.length > 0) {
    intersects.sort((a, b) => a.distance - b.distance);
    const closestCanvas = intersects[0].object;
    const canvasIndex = canvases.indexOf(closestCanvas);
    selectSound.play();
    moveToCanvas(canvasIndex);
  }

  const sunIntersects = sunMesh ? raycaster.intersectObject(sunMesh) : [];
  if (sunIntersects.length > 0) {
    selectSound.play();
    toggleNightMode();
  }
}

function showArtworkCaption(index) {
  const info = artworkInfo[index];
  if (!info || !artworkCaption) return;
  if (artworkTitleEl) artworkTitleEl.textContent = info.title;
  if (artworkArtistEl) {
    artworkArtistEl.textContent = info.artist || "";
    artworkArtistEl.hidden = !info.artist;
  }
  if (hasEnteredGallery) {
    artworkCaption.style.display = "block";
    artworkCaption.classList.add("visible");
  }
}

function setDetailCloseVisible(show) {
  if (!detailCloseBtn) return;
  detailCloseBtn.classList.toggle("visible", show);
  detailCloseBtn.style.display = show ? "block" : "none";
}

/** Apply the sky at progress p (0 golden hour … 1 night) of the evening. */
function applyTimeOfDay(p, refreshEnvironment = false) {
  if (!sun || !skyUniforms) return;
  // The clock runs slower near golden hour so the sunset itself (~12% of the
  // evening) gets ~30% of the transition; every frame is still a true sky
  const jd = DAY_JD + (NIGHT_JD - DAY_JD) * Math.pow(p, 1.7);
  const ephemeris = skyAt(jd, OBSERVER);
  const sunAlt = ephemeris.sun.altitude;
  const moonAlt = ephemeris.moon.altitude;
  const k = sampleSkyKeyframes(sunAlt, skyLook);

  // Sun and moon where they appear (refraction lifts them near the horizon)
  horizontalToWorld(apparentAltitude(sunAlt), ephemeris.sun.azimuth, sun);
  horizontalToWorld(
    apparentAltitude(moonAlt),
    ephemeris.moon.azimuth,
    moonDirection
  );

  // Moonlight scales with phase and with how high the moon stands
  const moonUp =
    ephemeris.moon.illumination *
    THREE.MathUtils.smoothstep(moonAlt, -1, 12);
  // A bright moon brightens the night sky, hiding faint stars and the Milky Way
  const moonGlare = moonUp * ephemeris.moon.illumination * (1 - k.skyDay);
  k.limitMag -= 1.3 * moonGlare;
  k.milkyWay *= 1 - 0.5 * moonGlare;
  k.zenith.lerp(MOONLIT_ZENITH, 0.35 * moonGlare);
  k.horizon.lerp(MOONLIT_HORIZON, 0.25 * moonGlare);

  // Stars and Milky Way: J2000 sky turned to this sidereal time and latitude
  const { lst } = ephemeris;
  equatorialToWorldMatrix.makeBasis(
    equatorialToWorld(0, 0, lst, basisX),
    equatorialToWorld(90, 0, lst, basisY),
    equatorialToWorld(0, 90, lst, basisZ)
  );
  celestialNorth.copy(basisZ);
  skyMatrix.multiplyMatrices(equatorialToWorldMatrix, GALACTIC_TO_EQUATORIAL);
  stars.matrix.copy(skyMatrix);
  stars.matrixWorldNeedsUpdate = true;
  skyUniforms["uWorldToGalactic"].value.setFromMatrix4(skyMatrix).transpose();

  // Planets
  const planetPositions = planets.geometry.attributes.position;
  const planetMags = planets.geometry.attributes.aMag;
  planets.userData.names.forEach((name, i) => {
    const planet = planetPosition(name, jd);
    equatorialToWorld(planet.ra, planet.dec, lst, basisX).multiplyScalar(8200);
    planetPositions.setXYZ(i, basisX.x, basisX.y, basisX.z);
    planetMags.setX(i, planet.magnitude);
  });
  planetPositions.needsUpdate = true;
  planetMags.needsUpdate = true;

  // Sky atmosphere + twilight / night layers
  skyUniforms["sunPosition"].value.copy(sun);
  skyUniforms["turbidity"].value = k.turbidity;
  skyUniforms["rayleigh"].value = k.rayleigh;
  skyUniforms["mieCoefficient"].value = k.mieCoefficient;
  skyUniforms["mieDirectionalG"].value = k.mieDirectionalG;
  skyUniforms["uDayMix"].value = k.skyDay;
  skyUniforms["uZenithColor"].value.copy(k.zenith);
  skyUniforms["uHorizonColor"].value.copy(k.horizon);
  skyUniforms["uGlowColor"].value.copy(k.glowColor);
  skyUniforms["uGlowStrength"].value = k.glow;
  skyUniforms["uBeltColor"].value.copy(k.beltColor);
  skyUniforms["uBeltStrength"].value = k.belt;
  skyUniforms["uMilkyWay"].value = k.milkyWay;

  // Scene lights
  ambientLight.color.copy(k.ambientColor);
  ambientLight.intensity = k.ambientIntensity;
  sunLight.position.copy(sun).multiplyScalar(10000);
  sunLight.color.copy(k.sunColor);
  sunLight.intensity = k.sunIntensity;
  moonLight.position.copy(moonDirection).multiplyScalar(10000);
  moonLight.color.copy(k.moonColor);
  moonLight.intensity = k.moonIntensity * moonUp;
  k.waterMoonColor.multiplyScalar(moonUp);
  for (const light of rectLights) light.color.copy(k.rectColor);

  // Water lights from whichever body is brighter; both are ~0 at the handover
  const u = water.material.uniforms;
  const sunLum = k.waterSunColor.r + k.waterSunColor.g + k.waterSunColor.b;
  const moonLum = k.waterMoonColor.r + k.waterMoonColor.g + k.waterMoonColor.b;
  const waterFromSun = sunLum >= moonLum;
  u["sunDirection"].value.copy(waterFromSun ? sun : moonDirection).normalize();
  u["sunColor"].value.copy(waterFromSun ? k.waterSunColor : k.waterMoonColor);
  u["waterColor"].value.copy(k.waterColor);
  u["size"].value = k.waterSize;
  u["distortionScale"].value = k.waterDistortion;
  u["reflectFloor"].value = k.reflectFloor;
  u["glitter"].value = k.glitter;
  waterMotion.timeScale = k.waterTimeScale;

  // Sun: true angular size; refraction lifts the lower limb less than the
  // upper, flattening the disc as it meets the horizon
  const sunRadius = ephemeris.sun.angularDiameter / 2;
  const sunGlowSize =
    (2 * CELESTIAL_DISTANCE * Math.tan(THREE.MathUtils.degToRad(sunRadius))) /
    SUN_GLOW_DISC_FRACTION;
  sunDisc.position.copy(sun).multiplyScalar(CELESTIAL_DISTANCE);
  const sunUniforms = sunDisc.material.uniforms;
  sunUniforms.uSize.value.setScalar(sunGlowSize);
  sunUniforms.uSquash.value = THREE.MathUtils.clamp(
    (apparentAltitude(sunAlt + sunRadius) - apparentAltitude(sunAlt - sunRadius)) /
      (2 * sunRadius),
    0.75,
    1
  );
  sunUniforms.uColor.value.copy(k.sunGlowColor);
  sunUniforms.uOpacity.value = k.sunGlow;

  // Moon: true size, phase lit from the real sun direction, north-up texture
  // turned to the sky's celestial north
  const moonSize =
    2 *
    CELESTIAL_DISTANCE *
    Math.tan(THREE.MathUtils.degToRad(ephemeris.moon.angularDiameter / 2));
  moonMesh.position.copy(moonDirection).multiplyScalar(CELESTIAL_DISTANCE);
  moonHalo.position.copy(moonMesh.position);
  // Sun is ~390× farther than the moon, so moon→sun ≈ the sun's direction
  moonToSun
    .copy(sun)
    .multiplyScalar(ephemeris.sun.distance * 149597870.7)
    .addScaledVector(moonDirection, -ephemeris.moon.distance)
    .normalize();
  const moonUniforms = moonMesh.material.uniforms;
  moonUniforms.uSize.value.setScalar(moonSize);
  moonUniforms.uLightDirection.value.copy(moonToSun);
  moonUniforms.uNorth.value.copy(celestialNorth);
  moonUniforms.uColor.value.setRGB(1.25, 1.25, 1.3);
  // Earthshine: sunlight off a "full Earth" — strong for a crescent, gone by gibbous
  moonUniforms.uEarthshine.value =
    0.05 * Math.pow(1 - ephemeris.moon.illumination, 2);
  moonUniforms.uOpacity.value = k.moon;
  moonUniforms.uOcclusion.value = k.moon * (1 - k.skyDay);
  moonHalo.material.uniforms.uOpacity.value =
    k.moon * 0.5 * ephemeris.moon.illumination;

  stars.material.uniforms.uLimitMag.value = k.limitMag;
  stars.visible = k.limitMag > -5;
  planets.visible = stars.visible;

  // Click target sits on whichever body toggles next
  sunMesh.position
    .copy(isNightMode ? moonDirection : sun)
    .multiplyScalar(CELESTIAL_DISTANCE + 6000);

  renderer.toneMappingExposure = k.exposure;
  if (bloomPass) {
    bloomPass.strength = k.bloomStrength;
    bloomPass.threshold = k.bloomThreshold;
  }

  // Re-bake sky IBL for the marble frames as the light changes
  if (
    pmremGenerator &&
    (refreshEnvironment || Math.abs(p - lastEnvironmentBake) > 0.05)
  ) {
    lastEnvironmentBake = p;
    const envMap = pmremGenerator.fromScene(skyMesh).texture;
    if (dayEnvironmentMap) dayEnvironmentMap.dispose();
    dayEnvironmentMap = envMap;
    scene.environment = envMap;
  }
}

function onCanvasHover(event) {
  // Prevent hover effects during orientation changes
  if (isOrientationChanging) {
    return;
  }

  // P3: Throttle hover raycasting to 50ms
  const now = Date.now();
  if (now - lastHoverTime < HOVER_THROTTLE_MS) return;
  lastHoverTime = now;

  // Ensure we have current window dimensions
  const currentWidth = window.innerWidth;
  const currentHeight = window.innerHeight;

  mouse.x = (event.clientX / currentWidth) * 2 - 1;
  mouse.y = -(event.clientY / currentHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const celestialTargets = sunMesh ? [sunMesh] : [];
  const intersects = raycaster.intersectObjects(
    canvases.concat(celestialTargets)
  );

  if (
    intersects.length > 0 &&
    (canvases.includes(intersects[0].object) ||
      celestialTargets.includes(intersects[0].object))
  ) {
    renderer.domElement.style.cursor = "pointer";

    // I3: Hover — slight brighten via color multiply (BasicMaterial has no emissive)
    const hitObj = intersects[0].object;
    if (canvases.includes(hitObj) && hitObj !== hoveredCanvas) {
      if (hoveredCanvas?.material?.color) {
        gsap.to(hoveredCanvas.material.color, {
          r: 1,
          g: 1,
          b: 1,
          duration: 0.25,
        });
      }
      hoveredCanvas = hitObj;
      gsap.to(hoveredCanvas.material.color, {
        r: 1.08,
        g: 1.08,
        b: 1.08,
        duration: 0.25,
      });
    }
  } else {
    renderer.domElement.style.cursor = "default";

    if (hoveredCanvas?.material?.color) {
      gsap.to(hoveredCanvas.material.color, {
        r: 1,
        g: 1,
        b: 1,
        duration: 0.25,
      });
      hoveredCanvas = null;
    }
  }
}

function toggleNightMode() {
  if (!skyUniforms) return;

  nightHintShown = true;
  const hint = document.getElementById("night-mode-hint");
  if (hint) hint.classList.remove("visible");

  // Reversible at any point: a mid-sunset click turns it back into a sunrise
  isNightMode = !isNightMode;
  if (skyTween) skyTween.kill();
  const target = isNightMode ? 1 : 0;
  const remaining = Math.abs(target - skyState.progress);

  skyTween = gsap.to(skyState, {
    progress: target,
    duration: Math.max(1.5, SKY_TRANSITION_SECONDS * remaining),
    ease: remaining > 0.95 ? "sine.inOut" : "sine.out",
    onUpdate: () => applyTimeOfDay(skyState.progress),
    onComplete: () => {
      skyTween = null;
      applyTimeOfDay(skyState.progress, true);
    },
  });
}

// Add this function near the other helper functions
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
    } else if (document.documentElement.mozRequestFullScreen) {
      // Firefox
      document.documentElement.mozRequestFullScreen();
    } else if (document.documentElement.webkitRequestFullscreen) {
      // Chrome, Safari and Opera
      document.documentElement.webkitRequestFullscreen();
    } else if (document.documentElement.msRequestFullscreen) {
      // IE/Edge
      document.documentElement.msRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.mozCancelFullScreen) {
      // Firefox
      document.mozCancelFullScreen();
    } else if (document.webkitExitFullscreen) {
      // Chrome, Safari and Opera
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      // IE/Edge
      document.msExitFullscreen();
    }
  }
}

function getDetailCameraPose(index) {
  const canvasPos = canvasPositions[index];
  const isEven = index % 2 === 0;
  const canvasWidth = isEven ? 20 : 30;
  const canvasHeight = isEven ? 30 : 20;
  const radial = new THREE.Vector3(canvasPos.x, 0, canvasPos.z).normalize();

  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const fill = 0.56;
  const distH = canvasHeight / 2 / Math.tan(vFov / 2) / fill;
  const distW = canvasWidth / 2 / Math.tan(hFov / 2) / fill;
  const dist = Math.max(distH, distW, 32);

  return {
    eye: new THREE.Vector3(
      canvasPos.x + radial.x * dist,
      canvasPos.y,
      canvasPos.z + radial.z * dist
    ),
    target: canvasPos.clone(),
  };
}

function onCanvasDoubleClick(event) {
  if (isOrientationChanging) return;

  const currentWidth = window.innerWidth;
  const currentHeight = window.innerHeight;
  mouse.x = (event.clientX / currentWidth) * 2 - 1;
  mouse.y = -(event.clientY / currentHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster
    .intersectObjects(canvases)
    .filter((intersect) => canvases.includes(intersect.object));

  if (intersects.length === 0) {
    if (isDetailView) exitDetailView();
    return;
  }

  intersects.sort((a, b) => a.distance - b.distance);
  enterDetailView(canvases.indexOf(intersects[0].object));
}

function enterDetailView(canvasIndex) {
  if (canvasIndex < 0) return;

  if (introTween) {
    introTween.kill();
    introTween = null;
  }

  currentCanvasIndex = canvasIndex;
  showArtworkCaption(canvasIndex);

  if (!isDetailView) {
    savedCameraPosition = camera.position.clone();
    savedControlsTarget = controls.target.clone();
  }

  isDetailView = true;
  orbitLocked = true;
  controls.enabled = false;
  setDetailCloseVisible(true);

  const { eye, target } = getDetailCameraPose(canvasIndex);
  gsap.killTweensOf(camera.position);
  gsap.killTweensOf(controls.target);

  gsap.to(camera.position, {
    x: eye.x,
    y: eye.y,
    z: eye.z,
    duration: 1.15,
    ease: "power2.inOut",
    onUpdate: () => {
      camera.lookAt(controls.target);
    },
  });
  gsap.to(controls.target, {
    x: target.x,
    y: target.y,
    z: target.z,
    duration: 1.15,
    ease: "power2.inOut",
  });
}

function exitDetailView() {
  if (!isDetailView) return;
  isDetailView = false;
  setDetailCloseVisible(false);

  gsap.killTweensOf(camera.position);
  gsap.killTweensOf(controls.target);

  if (savedCameraPosition && savedControlsTarget) {
    const restorePos = savedCameraPosition.clone();
    const restoreTarget = savedControlsTarget.clone();
    savedCameraPosition = null;
    savedControlsTarget = null;
    gsap.to(camera.position, {
      x: restorePos.x,
      y: restorePos.y,
      z: restorePos.z,
      duration: 1.15,
      ease: "power2.inOut",
      onUpdate: () => {
        camera.lookAt(controls.target);
      },
    });
    gsap.to(controls.target, {
      x: restoreTarget.x,
      y: restoreTarget.y,
      z: restoreTarget.z,
      duration: 1.15,
      ease: "power2.inOut",
      onComplete: () => {
        orbitLocked = false;
        controls.enabled = true;
        controls.update();
      },
    });
  } else {
    orbitLocked = false;
    controls.enabled = true;
    controls.update();
  }
}

// V4: Night Mode Discovery Hint
function startNightModeHintTimer() {
  if (nightHintShown) return;
  setTimeout(() => {
    if (nightHintShown) return;
    nightHintShown = true;
    const hint = document.getElementById("night-mode-hint");
    if (hint) {
      hint.classList.add("visible");
      setTimeout(() => {
        hint.classList.remove("visible");
      }, 5000);
    }
  }, 30000);
}

// Initialize the application
init().catch(() => {
  const loadingText = document.getElementById("loading-text");
  if (loadingText) {
    loadingText.textContent =
      "Failed to load the gallery. Please refresh the page.";
    loadingText.style.color = "#ff6b6b";
  }
  // Still surface Enter so the UI is not stuck on a dead loading ring
  if (!assetsLoaded) {
    revealEnterUI();
  }
});

window.__toggleNightMode = toggleNightMode;

// Dev-only hooks for inspecting the sky at a given time of day
if (import.meta.env.DEV) {
  window.__gallery = {
    get camera() {
      return camera;
    },
    get controls() {
      return controls;
    },
    keyframes: SKY_KEYFRAMES,
    moonDirection,
    setTimeOfDay(p) {
      if (skyTween) skyTween.kill();
      skyState.progress = p;
      isNightMode = p > 0.5;
      applyTimeOfDay(p, true);
    },
  };
}
