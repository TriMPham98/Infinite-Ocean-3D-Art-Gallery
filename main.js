import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Water } from "three/examples/jsm/objects/Water.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
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
let skyUniforms;
let assetsLoaded = false;
let hasEnteredGallery = false;
let isOrientationChanging = false;

// Resolve public asset URLs against Vite base (works on Vercel root hosting)
const assetUrl = (path) => {
  const clean = path.startsWith("/") ? path.slice(1) : path;
  const base = import.meta.env.BASE_URL || "/";
  return base.endsWith("/") ? `${base}${clean}` : `${base}/${clean}`;
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
let savedCameraPosition = null;
let savedControlsTarget = null;
let detailOverlay;

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

// I5: Detail overlay DOM
detailOverlay = document.getElementById("detail-overlay");

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
    artist: "",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "At the Gate", // image1
    artist: "Liz Burkhart",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Sun Star", // image2
    artist: "",
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
    artist: "",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Arrival", // image7
    artist: "Liz Burkhart",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Sleepy by the Sea", // image8
    artist: "",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Lunar Eclipse", // image9
    artist: "Valentina Piraneque Ortiz",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "The City", // image10
    artist: "",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Patriot's Parachute", // image11
    artist: "",
    position: new THREE.Vector3(0, 0, 0),
  },
  {
    title: "Aerial Acrobat", // image12
    artist: "",
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
  if ("outputColorSpace" in renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  sceneContainer.appendChild(renderer.domElement);
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    1,
    69000
  );
  camera.position.set(300, 300, 690);

  sun = new THREE.Vector3();

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
    sunColor: 0xffffff,
    waterColor: 0x001e0f,
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

    createPulseAnimation(rectLight, 1.5, 2.5, 3.0);

    const texture = imageTextures[i];
    const canvasGeometry = new THREE.BoxGeometry(canvasWidth, 0, canvasHeight);
    const canvasMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      side: THREE.FrontSide,
    });
    const canvas = new THREE.Mesh(canvasGeometry, canvasMaterial);
    canvas.rotation.x = Math.PI / 2;
    canvas.rotation.z = angle - Math.PI / 2;
    const position = new THREE.Vector3(
      circleRadius * Math.cos(angle),
      canvasYPosition,
      circleRadius * Math.sin(angle)
    );
    canvas.position.copy(position);
    canvasPositions.push(position);
    scene.add(canvas);
    canvases.push(canvas);
  }

  setProgress(96);

  const sky = new Sky();
  sky.scale.setScalar(10000);
  scene.add(sky);

  skyUniforms = sky.material.uniforms;

  skyUniforms["turbidity"].value = 10;
  skyUniforms["rayleigh"].value = 2;
  skyUniforms["mieCoefficient"].value = 0.005;
  skyUniforms["mieDirectionalG"].value = 0.8;

  const parameters = { elevation: 0.69, azimuth: -150 };
  const pmremGenerator = new THREE.PMREMGenerator(renderer);

  function updateSun() {
    const phi = THREE.MathUtils.degToRad(90 - parameters.elevation);
    const theta = THREE.MathUtils.degToRad(parameters.azimuth);
    sun.setFromSphericalCoords(1, phi, theta);
    sky.material.uniforms["sunPosition"].value.copy(sun);
    water.material.uniforms["sunDirection"].value.copy(sun).normalize();
    scene.environment = pmremGenerator.fromScene(sky).texture;
  }

  updateSun();

  // P4: Dispose pmremGenerator after use
  pmremGenerator.dispose();

  const sunGeometry = new THREE.SphereGeometry(1000, 32, 32);
  const sunMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
  });
  sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
  sunMesh.position.set(-31200, 1000, -54000);
  scene.add(sunMesh);

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
  createArtworkText();

  await waitForAudio(backgroundMusic, 3000);

  // I5: Detail overlay click to exit
  if (detailOverlay) {
    detailOverlay.addEventListener("click", exitDetailView);
  }

  // I5: Escape key to exit detail view
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isDetailView) {
      exitDetailView();
    }
  });

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
  controls.update();
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

  // I5: Exit detail view if active
  if (isDetailView) {
    exitDetailView();
  }
  currentCanvasIndex = (index + numberOfCanvases) % numberOfCanvases;
  gsap.killTweensOf(camera.position);
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

  const sunIntersects = raycaster.intersectObject(sunMesh);
  if (sunIntersects.length > 0) {
    selectSound.play();
    toggleNightMode();
  }
}

function createArtworkText() {
  const loader = new FontLoader();
  loader.load(
    assetUrl("helvetiker_regular.typeface.json"),
    function (font) {
      artworkInfo.forEach((artwork, index) => {
        try {
          // Create separate geometries for title and artist
          const titleGeometry = new TextGeometry(artwork.title, {
            font: font,
            size: 1.5,
            height: 0.1,
            curveSegments: 12,
            bevelEnabled: false,
          });
          titleGeometry.center();

          const textMaterial = new THREE.MeshBasicMaterial({ color: 0xf0f0f0 });
          const titleMesh = new THREE.Mesh(titleGeometry, textMaterial);

          // Calculate the position to center the text below the artwork
          const angle = (index / numberOfCanvases) * Math.PI * 2;
          const textRadius = circleRadius + 3;
          const textHeight = canvasYPosition - 20;

          titleMesh.position.set(
            textRadius * Math.cos(angle),
            textHeight + 1,
            textRadius * Math.sin(angle)
          );

          titleMesh.lookAt(new THREE.Vector3(0, textHeight, 0));
          titleMesh.rotateY(Math.PI);

          scene.add(titleMesh);

          if (artwork.artist) {
            const artistGeometry = new TextGeometry(artwork.artist, {
              font: font,
              size: 1,
              height: 0.1,
              curveSegments: 12,
              bevelEnabled: false,
            });
            artistGeometry.center();

            const artistMesh = new THREE.Mesh(artistGeometry, textMaterial);

            artistMesh.position.set(
              textRadius * Math.cos(angle),
              textHeight - 1,
              textRadius * Math.sin(angle)
            );

            artistMesh.lookAt(new THREE.Vector3(0, textHeight, 0));
            artistMesh.rotateY(Math.PI);

            scene.add(artistMesh);
          }
        } catch (error) {
          // Error handling for text creation
        }
      });
    },
    undefined,
    function (error) {
      // Font loading error handling
    }
  );

  // Ensure there's enough light in the scene
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);
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

  const intersects = raycaster.intersectObjects(canvases.concat(sunMesh));

  if (
    intersects.length > 0 &&
    (canvases.includes(intersects[0].object) ||
      intersects[0].object === sunMesh)
  ) {
    renderer.domElement.style.cursor = "pointer";

    // I3: Hover visual feedback
    const hitObj = intersects[0].object;
    if (canvases.includes(hitObj) && hitObj !== hoveredCanvas) {
      // Unhover previous
      if (hoveredCanvas) {
        gsap.to(hoveredCanvas.material, {
          emissiveIntensity: 0,
          duration: 0.3,
        });
      }
      hoveredCanvas = hitObj;
      hoveredCanvas.material.emissive = new THREE.Color(0x222222);
      gsap.to(hoveredCanvas.material, {
        emissiveIntensity: 0.3,
        duration: 0.3,
      });
    }
  } else {
    renderer.domElement.style.cursor = "default";

    // I3: Unhover
    if (hoveredCanvas) {
      gsap.to(hoveredCanvas.material, {
        emissiveIntensity: 0,
        duration: 0.3,
      });
      hoveredCanvas = null;
    }
  }
}

function toggleNightMode() {
  if (isNightMode) {
    // Transition to day mode
    gsap.to(skyUniforms["turbidity"], { value: 10, duration: 3.69 });
    gsap.to(skyUniforms["rayleigh"], { value: 2, duration: 3.69 });
    gsap.to(skyUniforms["mieCoefficient"], { value: 0.005, duration: 3.69 });
    gsap.to(skyUniforms["mieDirectionalG"], { value: 0.8, duration: 3.69 });
    // V4: Reduce bloom back to default
    if (bloomPass) {
      gsap.to(bloomPass, { strength: 0.3, duration: 3.69 });
    }
  } else {
    // Transition to night mode
    gsap.to(skyUniforms["turbidity"], { value: 0, duration: 3.69 });
    gsap.to(skyUniforms["rayleigh"], { value: 0.01, duration: 3.69 });
    gsap.to(skyUniforms["mieCoefficient"], { value: 1.01, duration: 3.69 });
    gsap.to(skyUniforms["mieDirectionalG"], { value: -1.01, duration: 3.69 });
    // V4: Enhance bloom glow during night
    if (bloomPass) {
      gsap.to(bloomPass, { strength: 0.5, duration: 3.69 });
    }
  }
  isNightMode = !isNightMode;
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

// I5: Detail View / Zoom
function onCanvasDoubleClick(event) {
  if (isOrientationChanging) return;

  if (isDetailView) {
    exitDetailView();
    return;
  }

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

    // Save current camera state
    savedCameraPosition = camera.position.clone();
    savedControlsTarget = controls.target.clone();

    // Calculate zoom position (60% closer to artwork)
    const canvasPos = canvasPositions[canvasIndex];
    const zoomPos = new THREE.Vector3().lerpVectors(
      camera.position,
      canvasPos,
      0.6
    );

    isDetailView = true;
    controls.enabled = false;

    // Show overlay
    if (detailOverlay) {
      detailOverlay.classList.add("visible");
    }

    gsap.to(camera.position, {
      x: zoomPos.x,
      y: zoomPos.y,
      z: zoomPos.z,
      duration: 1.2,
      ease: "power2.inOut",
      onUpdate: () => {
        camera.lookAt(canvasPos);
      },
    });
  }
}

function exitDetailView() {
  if (!isDetailView) return;
  isDetailView = false;

  // Hide overlay
  if (detailOverlay) {
    detailOverlay.classList.remove("visible");
  }

  if (savedCameraPosition && savedControlsTarget) {
    gsap.to(camera.position, {
      x: savedCameraPosition.x,
      y: savedCameraPosition.y,
      z: savedCameraPosition.z,
      duration: 1.2,
      ease: "power2.inOut",
      onUpdate: () => controls.update(),
      onComplete: () => {
        controls.target.copy(savedControlsTarget);
        controls.enabled = true;
        controls.update();
      },
    });
  } else {
    controls.enabled = true;
    controls.update();
  }
}

// V4: Night Mode Discovery Hint
let nightHintShown = false;
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
