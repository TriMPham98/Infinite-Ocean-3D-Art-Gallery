import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Water } from "three/examples/jsm/objects/Water.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { gsap } from "gsap";

// Global error handler
window.addEventListener("error", function (event) {
  console.error("Global error caught:", event.error || event.message);

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
  console.error("Unhandled promise rejection:", event.reason);
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

// DOM Elements
const startButton = document.getElementById("start-button");
const loadingScreen = document.getElementById("loading-screen");
const sceneContainer = document.getElementById("scene-container");
const progressRing = document.querySelector(".progress-ring__circle");
const progressText = document.getElementById("progress-text");
const backgroundMusic = document.getElementById("background-music");
const volumeToggleBtn = document.getElementById("volume-toggle");
const selectSound = new Audio("/modernSelect.wav");
const orientationMessage = document.getElementById("orientation-message");

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
startButton.addEventListener("click", onStartButtonClick);
volumeToggleBtn.addEventListener("click", toggleMusic);
window.addEventListener("keydown", handleKeyPress);
window.addEventListener("resize", onWindowResize, false);

// Function to preload audio with fallback
function preloadAudio(audioElement, fallbackSrc) {
  audioElement.addEventListener("error", function (e) {
    console.error(`Error loading audio from ${audioElement.src}:`, e);
    if (audioElement.src.startsWith(window.location.origin + "/")) {
      const newSrc = audioElement.src.replace(
        window.location.origin + "/",
        window.location.origin + "/"
      );
      console.log(`Trying fallback audio source: ${newSrc}`);
      audioElement.src = fallbackSrc || newSrc;
    }
  });
}

// Preload audio files
preloadAudio(backgroundMusic, "zenPiano.mp3");
preloadAudio(selectSound, "modernSelect.wav");

function checkOrientation() {
  if (!assetsLoaded) {
    return; // Don't check orientation if assets aren't loaded
  }

  const isLandscape = window.innerWidth > window.innerHeight;
  const isMobile = window.innerWidth <= 1024;

  if (isMobile) {
    if (isLandscape) {
      orientationMessage.style.display = "none";
      loadingScreen.style.display = "flex";
      sceneContainer.style.display = "block";
      app.style.display = "block";
      volumeToggleBtn.style.display = "block";
    } else {
      orientationMessage.style.display = "flex";
      loadingScreen.style.display = "none";
      sceneContainer.style.display = "none";
      app.style.display = "none";
      volumeToggleBtn.style.display = "none";
    }
  } else {
    orientationMessage.style.display = "none";
    loadingScreen.style.display = "flex";
    sceneContainer.style.display = "block";
    app.style.display = "block";
    volumeToggleBtn.style.display = "block";
  }
}

// Main Functions
async function init() {
  console.log("Initializing application...");
  const manager = new THREE.LoadingManager();
  let imagesLoaded = 0;

  manager.onProgress = function (url, itemsLoaded, itemsTotal) {
    console.log(`Loading: ${url} (${itemsLoaded}/${itemsTotal})`);
    const progress = (itemsLoaded / itemsTotal) * 100;
    setProgress(progress);
  };

  let onLoadExecuted = false;

  manager.onLoad = function () {
    if (onLoadExecuted) return;
    onLoadExecuted = true;

    console.log("Loading complete");

    const loadingContainer = document.getElementById("loading-container");
    const startButton = document.getElementById("start-button");
    const controlPanel = document.getElementById("control-panel");
    const controlButtons = document.querySelectorAll(".control-button");
    const keyboardControlsHeader = document.getElementById(
      "keyboard-controls-header"
    );
    const loadingText = document.getElementById("loading-text");

    loadingText.textContent = "Loading Complete";

    setTimeout(() => {
      loadingContainer.style.opacity = "0";

      setTimeout(() => {
        loadingContainer.style.display = "none";
        startButton.style.display = "block";
        startButton.offsetHeight;
        startButton.classList.add("visible");

        setTimeout(() => {
          controlPanel.style.opacity = "1";
          keyboardControlsHeader.style.opacity = "1";
          controlButtons.forEach((button) => {
            button.style.opacity = "1";
          });

          assetsLoaded = true;
          checkOrientation(); // Check orientation after assets are loaded
        }, 100);
      }, 1690);
    }, 1500);
  };

  manager.onError = function (url) {
    console.error("There was an error loading " + url);
    // Display error message to user
    const loadingText = document.getElementById("loading-text");
    if (loadingText) {
      loadingText.textContent =
        "Error loading assets. Please refresh the page.";
      loadingText.style.color = "red";
    }
  };

  const loader = new THREE.TextureLoader(manager);

  function loadTexture(url) {
    return new Promise((resolve, reject) => {
      // Try to load with the provided URL
      loader.load(
        url,
        function (texture) {
          imagesLoaded++;
          console.log(`Successfully loaded texture: ${url}`);
          resolve(texture);
        },
        undefined,
        function (err) {
          console.error(`Error loading ${url}:`, err);

          // If the URL starts with a slash, try without it (fallback for path resolution issues)
          if (url.startsWith("/")) {
            console.log(
              `Attempting to load without leading slash: ${url.substring(1)}`
            );
            loader.load(
              url.substring(1),
              function (texture) {
                imagesLoaded++;
                console.log(
                  `Successfully loaded texture with fallback: ${url.substring(
                    1
                  )}`
                );
                resolve(texture);
              },
              undefined,
              function (fallbackErr) {
                console.error(
                  `Fallback loading also failed for ${url.substring(1)}:`,
                  fallbackErr
                );
                reject(fallbackErr);
              }
            );
          } else {
            reject(err);
          }
        }
      );
    });
  }

  renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
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

  const waterGeometry = new THREE.PlaneGeometry(50000, 50000);
  const waterNormals = await loadTexture("/waternormals.jpg");
  waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;

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
  const marbleTexture = await loadTexture("/whiteMarble.jpg");
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
    const frameMaterial = new THREE.MeshStandardMaterial({
      map: marbleTexture,
    });
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

    const texture = await loadTexture("/image" + i + ".jpg");
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

  await new Promise((resolve) => {
    backgroundMusic.addEventListener("canplaythrough", resolve, { once: true });
    backgroundMusic.load();
  });

  renderer.render(scene, camera);
  createArtworkText();

  // Call checkOrientation on page load and whenever the orientation changes
  window.addEventListener("load", checkOrientation);
  window.addEventListener("orientationchange", checkOrientation);
  window.addEventListener("resize", checkOrientation);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  render();
}

function render() {
  water.material.uniforms["time"].value += 0.69 / 60.0;
  renderer.render(scene, camera);
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
  console.log("Start button clicked");
  if (!assetsLoaded) {
    console.log("Assets not fully loaded yet. Please wait.");
    return;
  }

  try {
    selectSound
      .play()
      .catch((e) => console.error("Error playing select sound:", e));
    loadingScreen.style.opacity = "0";
    sceneContainer.style.opacity = "1";

    setTimeout(() => {
      loadingScreen.style.display = "none";
    }, 2000);

    try {
      animate();
      console.log("Animation started");
    } catch (error) {
      console.error("Error starting animation:", error);
    }

    backgroundMusic.play().catch((e) => console.error("Audio play failed:", e));

    try {
      panToCenter();
      console.log("Camera panned to center");
    } catch (error) {
      console.error("Error panning camera:", error);
    }
  } catch (error) {
    console.error("Error in start button click handler:", error);
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
  controls.update();
  render();
  checkOrientation();
}

function panToCenter() {
  const finalPosition = new THREE.Vector3(138.9, 27.5, 0.0);
  gsap.to(camera.position, {
    x: finalPosition.x,
    y: finalPosition.y,
    z: finalPosition.z,
    duration: 6.9,
    ease: "power2.inOut",
    onUpdate: function () {
      controls.update();
    },
  });
}

function moveToCanvas(index) {
  currentCanvasIndex = (index + numberOfCanvases) % numberOfCanvases;
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
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
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
    console.log("(Before click) Night mode: " + isNightMode);
    console.log("Sun is clicked");
    toggleNightMode();
  }
}

function createArtworkText() {
  console.log("createArtworkText function called");
  const loader = new FontLoader();
  loader.load(
    "/helvetiker_regular.typeface.json",
    function (font) {
      console.log("Font loaded successfully");
      artworkInfo.forEach((artwork, index) => {
        console.log(`Creating text for artwork ${index}: ${artwork.title}`);
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
          console.log(`Title mesh added for ${artwork.title}`);

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
            console.log(`Artist mesh added for ${artwork.artist}`);
          }
        } catch (error) {
          console.error(`Error creating text for artwork ${index}:`, error);
        }
      });
    },
    undefined,
    function (error) {
      console.error("An error happened while loading the font:", error);
    }
  );

  // Ensure there's enough light in the scene
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);
  console.log("Ambient light added to the scene");
}

function onCanvasHover(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(canvases.concat(sunMesh));

  if (
    intersects.length > 0 &&
    (canvases.includes(intersects[0].object) ||
      intersects[0].object === sunMesh)
  ) {
    renderer.domElement.style.cursor = "pointer";
  } else {
    renderer.domElement.style.cursor = "default";
  }
}

function toggleNightMode() {
  if (isNightMode) {
    // Transition to day mode
    gsap.to(skyUniforms["turbidity"], { value: 10, duration: 3.69 });
    gsap.to(skyUniforms["rayleigh"], { value: 2, duration: 3.69 });
    gsap.to(skyUniforms["mieCoefficient"], { value: 0.005, duration: 3.69 });
    gsap.to(skyUniforms["mieDirectionalG"], { value: 0.8, duration: 3.69 });
  } else {
    // Transition to night mode
    gsap.to(skyUniforms["turbidity"], { value: 0, duration: 3.69 });
    gsap.to(skyUniforms["rayleigh"], { value: 0.01, duration: 3.69 });
    gsap.to(skyUniforms["mieCoefficient"], { value: 1.01, duration: 3.69 });
    gsap.to(skyUniforms["mieDirectionalG"], { value: -1.01, duration: 3.69 });
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

// Initialize the application
init()
  .then(() => {
    console.log("Initialization complete");
  })
  .catch((error) => {
    console.error("Initialization failed:", error);
  });
