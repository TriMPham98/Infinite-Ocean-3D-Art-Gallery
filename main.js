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
import { gsap } from "gsap";

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
let isNightTransitioning = false;
let nightHintShown = false;
let skyUniforms;
let skyMesh;
let skyParameters = { elevation: 1.2, azimuth: -150 };
let pmremGenerator;
let ambientLight;
let sunLight;
let moonMesh;
let stars;
let rectLights = [];
let dayEnvironmentMap = null;
let assetsLoaded = false;
let hasEnteredGallery = false;
let isOrientationChanging = false;

// Resolve public asset URLs against Vite base (works on Vercel root hosting)
const assetUrl = (path) => {
  const clean = path.startsWith("/") ? path.slice(1) : path;
  const base = import.meta.env.BASE_URL || "/";
  return base.endsWith("/") ? `${base}${clean}` : `${base}/${clean}`;
};

// Day / night lighting presets (coordinated sky + scene lights)
// Night keeps the sun disk above the horizon as a "moon" (same click target).
const DAY_LIGHTING = {
  turbidity: 8,
  rayleigh: 2.2,
  mieCoefficient: 0.004,
  mieDirectionalG: 0.85,
  elevation: 1.2,
  ambientIntensity: 0.42,
  ambientColor: 0xfff6e8,
  sunIntensity: 1.35,
  sunColor: 0xfff2d6,
  waterSunColor: 0xffffff,
  waterColor: 0x001e0f,
  rectMin: 1.4,
  rectMax: 2.2,
  rectColor: 0xffa366,
  bloomStrength: 0.22,
  bloomThreshold: 0.88,
  exposure: 1.05,
  useEnvironment: true,
  moonOpacity: 0,
  starOpacity: 0,
};

const NIGHT_LIGHTING = {
  // Dark sky, bright celestial disk still visible (moon stand-in)
  turbidity: 0,
  rayleigh: 0.02,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.95,
  elevation: 1.2, // keep disk in sky — do not sink below horizon
  // Hard, local gallery light only (frames/marble); art is unlit so stays daylight
  ambientIntensity: 0.04,
  ambientColor: 0x0a1020,
  sunIntensity: 0.02,
  sunColor: 0xc8d4ef,
  waterSunColor: 0x8899aa,
  waterColor: 0x00060c,
  rectMin: 1.8,
  rectMax: 2.8,
  rectColor: 0xffb070,
  bloomStrength: 0.28,
  bloomThreshold: 0.82, // bloom lights, not soft art glow
  exposure: 1.0,
  useEnvironment: false, // IBL soft-fill only affects lit materials (frames)
  moonOpacity: 1,
  starOpacity: 0.82,
};

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
      if (controls) {
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
  renderer.toneMappingExposure = DAY_LIGHTING.exposure;
  if ("outputColorSpace" in renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  sceneContainer.appendChild(renderer.domElement);
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  scene = new THREE.Scene();

  // Base fill light — intensity/color driven by day/night presets
  ambientLight = new THREE.AmbientLight(
    DAY_LIGHTING.ambientColor,
    DAY_LIGHTING.ambientIntensity
  );
  scene.add(ambientLight);

  // Key light follows the sun / moon direction
  sunLight = new THREE.DirectionalLight(
    DAY_LIGHTING.sunColor,
    DAY_LIGHTING.sunIntensity
  );
  sunLight.position.set(100, 200, -100);
  scene.add(sunLight);

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

  water = new Water(waterGeometry, {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals: waterNormals,
    sunDirection: new THREE.Vector3(),
    sunColor: DAY_LIGHTING.waterSunColor,
    waterColor: DAY_LIGHTING.waterColor,
    distortionScale: 3.7,
    fog: scene.fog !== undefined,
  });

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

    createPulseAnimation(
      rectLight,
      DAY_LIGHTING.rectMin,
      DAY_LIGHTING.rectMax,
      3.0
    );

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

  setProgress(96);

  skyMesh = new Sky();
  skyMesh.scale.setScalar(10000);
  scene.add(skyMesh);

  skyUniforms = skyMesh.material.uniforms;
  skyUniforms["turbidity"].value = DAY_LIGHTING.turbidity;
  skyUniforms["rayleigh"].value = DAY_LIGHTING.rayleigh;
  skyUniforms["mieCoefficient"].value = DAY_LIGHTING.mieCoefficient;
  skyUniforms["mieDirectionalG"].value = DAY_LIGHTING.mieDirectionalG;

  // Keep PMREM alive so day can use sky IBL; night clears it to protect art
  pmremGenerator = new THREE.PMREMGenerator(renderer);
  updateSunLighting(true);

  // Invisible wide hit target for sun/moon click (covers the bloom, not just the disk)
  const sunGeometry = new THREE.SphereGeometry(5600, 32, 32);
  const sunMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
  scene.add(sunMesh);

  // Visible moon disc at night (soft sprite — sky shader disk alone is easy to lose)
  const moonMaterial = new THREE.SpriteMaterial({
    map: createMoonTexture(),
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  moonMesh = new THREE.Sprite(moonMaterial);
  moonMesh.scale.set(1100, 1100, 1);
  moonMesh.renderOrder = 2;
  scene.add(moonMesh);
  createStars();
  updateSunLighting(false);

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
    0.3, // strength
    0.4, // radius
    0.85 // threshold
  );
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

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
  water.material.uniforms["time"].value += 0.69 / 60.0;
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
    sceneContainer.style.opacity = "1";

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
      selectSound.play();
      moveToCanvas(currentCanvasIndex - 1);
      break;
    case "ArrowLeft":
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
  controls.update();
  render();

  // Use the new orientation handler
  handleOrientationChange();
}

// V3: Single continuous intro spiral (no multi-phase stop/reverse)
let introTween = null;

function panToCenter() {
  if (!camera || !controls || !canvasPositions.length) return;

  // Cancel any prior intro / camera tweens so nothing fights the path
  if (introTween) introTween.kill();
  gsap.killTweensOf(camera.position);
  gsap.killTweensOf(controls.target);

  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const firstPos = canvasPositions[0];
  const endPos = new THREE.Vector3(firstPos.x, firstPos.y - 2.3, firstPos.z);
  const endTarget = new THREE.Vector3(0, 10, 0);

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
  const wasEnabled = controls.enabled;
  controls.enabled = false;

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
      controls.update();
    },
    onComplete: () => {
      camera.position.copy(endPos);
      controls.target.copy(endTarget);
      controls.update();
      controls.enabled = wasEnabled;
      introTween = null;
      currentCanvasIndex = 0;
      showArtworkCaption(0);
      startNightModeHintTimer();
    },
  });
}

function moveToCanvas(index) {
  // Interrupt intro if user navigates early
  if (introTween) {
    introTween.kill();
    introTween = null;
    if (controls) controls.enabled = true;
  }

  // Leave detail without restoring the saved camera — this tween takes over
  if (isDetailView) {
    isDetailView = false;
    orbitLocked = false;
    savedCameraPosition = null;
    savedControlsTarget = null;
    setDetailCloseVisible(false);
    if (controls) controls.enabled = true;
  }
  currentCanvasIndex = (index + numberOfCanvases) % numberOfCanvases;
  showArtworkCaption(currentCanvasIndex);
  gsap.killTweensOf(camera.position);
  gsap.killTweensOf(controls.target);
  gsap.to(camera.position, {
    x: canvasPositions[currentCanvasIndex].x,
    y: canvasPositions[currentCanvasIndex].y - 2.3,
    z: canvasPositions[currentCanvasIndex].z,
    duration: 1.69,
    ease: "power2.inOut",
    onUpdate: function () {
      controls.update();
    },
  });
}

function createPulseAnimation(light, minIntensity, maxIntensity, duration) {
  light.intensity = minIntensity;
  gsap.to(light, {
    intensity: maxIntensity,
    duration: duration,
    repeat: -1,
    yoyo: true,
    ease: "power1.inOut",
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

  const celestial = [sunMesh, moonMesh].filter(Boolean);
  const sunIntersects = raycaster.intersectObjects(celestial);
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

function createMoonTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(
    size * 0.5,
    size * 0.5,
    size * 0.08,
    size * 0.5,
    size * 0.5,
    size * 0.5
  );
  g.addColorStop(0, "rgba(255, 255, 252, 1)");
  g.addColorStop(0.32, "rgba(238, 242, 248, 1)");
  g.addColorStop(0.4, "rgba(210, 218, 232, 0.35)");
  g.addColorStop(0.55, "rgba(170, 185, 210, 0.08)");
  g.addColorStop(1, "rgba(170, 185, 210, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createStars() {
  const count = 850;
  const radius = 7800;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    // Hemisphere, kept off the water line
    const phi = Math.acos(0.08 + Math.random() * 0.9);
    const r = radius * (0.88 + Math.random() * 0.12);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    const brightness = 0.42 + Math.random() * 0.58;
    const cool = Math.random() * 0.08;
    colors[i * 3] = brightness * (0.92 + cool);
    colors[i * 3 + 1] = brightness * (0.94 + cool * 0.5);
    colors[i * 3 + 2] = Math.min(1, brightness * (1.02 + cool));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 1.5,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  stars = new THREE.Points(geometry, material);
  stars.frustumCulled = false;
  stars.renderOrder = 0;
  stars.visible = false;
  scene.add(stars);
}

/** Sync sun/moon direction, key light, water, and optional env map from sky elevation. */
function updateSunLighting(refreshEnvironment = false) {
  if (!sun || !skyUniforms) return;

  const phi = THREE.MathUtils.degToRad(90 - skyParameters.elevation);
  const theta = THREE.MathUtils.degToRad(skyParameters.azimuth);
  sun.setFromSphericalCoords(1, phi, theta);

  skyUniforms["sunPosition"].value.copy(sun);

  if (water?.material?.uniforms?.sunDirection) {
    water.material.uniforms["sunDirection"].value.copy(sun).normalize();
  }

  if (sunLight) {
    sunLight.position.copy(sun).multiplyScalar(10000);
  }

  // Click proxy + visible moon sit on the celestial direction
  const celestialPos = sun.clone().multiplyScalar(48000);
  if (sunMesh) {
    sunMesh.position.copy(celestialPos);
  }
  if (moonMesh) {
    // Slightly closer so the disc reads larger against the sky dome
    moonMesh.position.copy(sun).multiplyScalar(42000);
  }

  if (refreshEnvironment && pmremGenerator && skyMesh) {
    // Only bake day IBL — night uses null env so soft fill doesn't wash art
    if (isNightMode) {
      if (scene.environment && scene.environment !== dayEnvironmentMap) {
        scene.environment.dispose();
      }
      scene.environment = null;
    } else {
      const envMap = pmremGenerator.fromScene(skyMesh).texture;
      if (dayEnvironmentMap && dayEnvironmentMap !== envMap) {
        dayEnvironmentMap.dispose();
      }
      dayEnvironmentMap = envMap;
      scene.environment = dayEnvironmentMap;
    }
  }
}

function setGalleryLightPulse(minIntensity, maxIntensity) {
  rectLights.forEach((light) => {
    gsap.killTweensOf(light);
    createPulseAnimation(light, minIntensity, maxIntensity, 3.2);
  });
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

  const celestialTargets = [sunMesh, moonMesh].filter(Boolean);
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
  if (!skyUniforms || isNightTransitioning) return;

  nightHintShown = true;
  const hint = document.getElementById("night-mode-hint");
  if (hint) hint.classList.remove("visible");

  const goingNight = !isNightMode;
  const to = goingNight ? NIGHT_LIGHTING : DAY_LIGHTING;
  const duration = 3.8;
  const ease = "power2.inOut";

  isNightTransitioning = true;
  isNightMode = goingNight;

  // Kill any in-flight lighting tweens so rapid toggles stay smooth
  gsap.killTweensOf(skyUniforms["turbidity"]);
  gsap.killTweensOf(skyUniforms["rayleigh"]);
  gsap.killTweensOf(skyUniforms["mieCoefficient"]);
  gsap.killTweensOf(skyUniforms["mieDirectionalG"]);
  gsap.killTweensOf(skyParameters);
  gsap.killTweensOf(ambientLight);
  gsap.killTweensOf(sunLight);
  gsap.killTweensOf(renderer);
  if (bloomPass) gsap.killTweensOf(bloomPass);
  if (moonMesh?.material) gsap.killTweensOf(moonMesh.material);
  if (stars?.material) gsap.killTweensOf(stars.material);

  // Color proxies for GSAP
  const ambientCol = ambientLight.color.clone();
  const sunCol = sunLight.color.clone();
  const targetAmbient = new THREE.Color(to.ambientColor);
  const targetSun = new THREE.Color(to.sunColor);
  const waterSunFrom = water.material.uniforms["sunColor"].value.clone();
  const waterSunTo = new THREE.Color(to.waterSunColor);
  const waterColFrom = water.material.uniforms["waterColor"].value.clone();
  const waterColTo = new THREE.Color(to.waterColor);
  const rectColTo = new THREE.Color(to.rectColor);

  // Sky atmosphere (dark night sky; sun disk stays as celestial body)
  gsap.to(skyUniforms["turbidity"], { value: to.turbidity, duration, ease });
  gsap.to(skyUniforms["rayleigh"], { value: to.rayleigh, duration, ease });
  gsap.to(skyUniforms["mieCoefficient"], {
    value: to.mieCoefficient,
    duration,
    ease,
  });
  gsap.to(skyUniforms["mieDirectionalG"], {
    value: to.mieDirectionalG,
    duration,
    ease,
  });

  // Keep elevation above horizon so the sun/moon disk never disappears
  gsap.to(skyParameters, {
    elevation: to.elevation,
    duration,
    ease,
    onUpdate: () => {
      updateSunLighting(false);
    },
  });

  // Minimal ambient at night — photos stay color-true under rect lights
  gsap.to(ambientLight, { intensity: to.ambientIntensity, duration, ease });
  gsap.to(ambientCol, {
    r: targetAmbient.r,
    g: targetAmbient.g,
    b: targetAmbient.b,
    duration,
    ease,
    onUpdate: () => ambientLight.color.copy(ambientCol),
  });

  // Near-off directional at night so it doesn't softly recolor the art
  gsap.to(sunLight, { intensity: to.sunIntensity, duration, ease });
  gsap.to(sunCol, {
    r: targetSun.r,
    g: targetSun.g,
    b: targetSun.b,
    duration,
    ease,
    onUpdate: () => sunLight.color.copy(sunCol),
  });

  // Water palette
  gsap.to(waterSunFrom, {
    r: waterSunTo.r,
    g: waterSunTo.g,
    b: waterSunTo.b,
    duration,
    ease,
    onUpdate: () => {
      water.material.uniforms["sunColor"].value.copy(waterSunFrom);
    },
  });
  gsap.to(waterColFrom, {
    r: waterColTo.r,
    g: waterColTo.g,
    b: waterColTo.b,
    duration,
    ease,
    onUpdate: () => {
      water.material.uniforms["waterColor"].value.copy(waterColFrom);
    },
  });

  // Gallery frame lights only — hard local light, no soft fill on paintings
  rectLights.forEach((light) => {
    gsap.to(light.color, {
      r: rectColTo.r,
      g: rectColTo.g,
      b: rectColTo.b,
      duration,
      ease,
    });
  });
  gsap.delayedCall(duration * 0.3, () => {
    setGalleryLightPulse(to.rectMin, to.rectMax);
  });

  // Artworks are unlit (MeshBasicMaterial) — no day/night material tweaks needed

  // Visible moon disc (sky disk + explicit sprite so it always reads)
  if (moonMesh?.material) {
    gsap.to(moonMesh.material, {
      opacity: to.moonOpacity,
      duration: duration * 0.85,
      ease,
    });
  }

  if (stars?.material) {
    if (goingNight) stars.visible = true;
    gsap.to(stars.material, {
      opacity: to.starOpacity,
      duration: duration * 0.9,
      ease,
      onComplete: () => {
        if (!goingNight && stars) stars.visible = false;
      },
    });
  }

  gsap.to(renderer, {
    toneMappingExposure: to.exposure,
    duration,
    ease,
  });
  if (bloomPass) {
    gsap.to(bloomPass, {
      strength: to.bloomStrength,
      threshold: to.bloomThreshold,
      duration,
      ease,
    });
  }

  // Night: drop soft IBL immediately so paintings stay crisp
  // Day: rebuild sky environment a few times as the sky brightens
  if (goingNight) {
    if (scene.environment && scene.environment !== dayEnvironmentMap) {
      scene.environment.dispose();
    }
    scene.environment = null;
    gsap.delayedCall(duration, () => {
      updateSunLighting(false);
      isNightTransitioning = false;
    });
  } else {
    const envTimes = [0.25, 0.55, 1.0];
    envTimes.forEach((t) => {
      gsap.delayedCall(duration * t, () => {
        updateSunLighting(true);
        if (t === 1.0) isNightTransitioning = false;
      });
    });
  }
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
