import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Water } from "three/examples/jsm/objects/Water.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { gsap } from "gsap";

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

const startButton = document.getElementById("start-button");
const loadingScreen = document.getElementById("loading-screen");
const sceneContainer = document.getElementById("scene-container");
const progressRing = document.querySelector(".progress-ring__circle");
const progressText = document.getElementById("progress-text");
const backgroundMusic = document.getElementById("background-music");
const volumeToggleBtn = document.getElementById("volume-toggle");
const selectSound = new Audio("/modernSelect.wav");
selectSound.volume = 0.15;

const radius = progressRing.r.baseVal.value;
const circumference = radius * 2 * Math.PI;

progressRing.style.strokeDasharray = `${circumference} ${circumference}`;
progressRing.style.strokeDashoffset = circumference;

backgroundMusic.volume = 0.69;
backgroundMusic.loop = true;

// Ensure the start button is initially invisible
// startButton.style.opacity = "0";

function setProgress(percent) {
  const offset = circumference - (percent / 100) * circumference;
  progressRing.style.strokeDashoffset = offset;
  document.getElementById("progress-text").textContent = `${Math.round(
    percent
  )}%`;
}

startButton.addEventListener("click", function () {
  if (!assetsLoaded) {
    console.log("Assets not fully loaded yet. Please wait.");
    return;
  }
  selectSound.play();
  loadingScreen.style.opacity = "0";
  sceneContainer.style.opacity = "1";
  setTimeout(() => {
    loadingScreen.style.display = "none";
  }, 2000);
  animate();
  backgroundMusic.play().catch((e) => console.log("Audio play failed:", e));
  panToCenter();
});

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

volumeToggleBtn.addEventListener("click", toggleMusic);

window.addEventListener("keydown", function (event) {
  if (event.key === "Enter") {
    document.getElementById("start-button").click();
  } else if (event.key === "m" || event.key === "M") {
    toggleMusic();
  } else if (event.key === "ArrowRight") {
    selectSound.play();
    moveToCanvas(currentCanvasIndex - 1);
  } else if (event.key === "ArrowLeft") {
    selectSound.play();
    moveToCanvas(currentCanvasIndex + 1);
  }
});

async function init() {
  const manager = new THREE.LoadingManager();
  let imagesLoaded = 0;
  const totalImages = numberOfCanvases + 2; // +2 for waternormals.jpg and whiteMarble.jpg

  manager.onProgress = function (url, itemsLoaded, itemsTotal) {
    console.log(
      `Loading file: ${url}.\nLoaded ${itemsLoaded} of ${itemsTotal} files.`
    );
    const progress = (itemsLoaded / itemsTotal) * 100;
    setProgress(progress);
  };

  let onLoadExecuted = false;

  manager.onLoad = function () {
    if (onLoadExecuted) return;
    onLoadExecuted = true;

    console.log("Loading complete!");

    const loadingContainer = document.getElementById("loading-container");
    const galleryEntrance = document.getElementById("gallery-entrance");

    setTimeout(() => {
      loadingContainer.style.opacity = "0";

      setTimeout(() => {
        loadingContainer.style.display = "none";

        galleryEntrance.style.display = "flex";
        // Trigger reflow
        galleryEntrance.offsetHeight;
        galleryEntrance.classList.add("visible");

        assetsLoaded = true;
        console.log("Gallery entrance elements displayed");
      }, 1000);
    }, 1500);
  };

  manager.onError = function (url) {
    console.log("There was an error loading " + url);
  };

  const loader = new THREE.TextureLoader(manager);

  function loadTexture(url) {
    return new Promise((resolve, reject) => {
      loader.load(
        url,
        function (texture) {
          imagesLoaded++;
          console.log(
            `Loaded ${url}. ${imagesLoaded}/${totalImages} images loaded.`
          );
          resolve(texture);
        },
        undefined,
        function (err) {
          console.error(`Error loading ${url}:`, err);
          reject(err);
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
  const canvasYPosition = 20;
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

    // Frame
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

    // Light
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

    // Canvas
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
  controls.update();

  window.addEventListener("resize", onWindowResize, false);

  renderer.domElement.addEventListener("click", onCanvasClick);
  renderer.domElement.addEventListener("mousemove", onCanvasHover);

  // Ensure audio is loaded
  await new Promise((resolve) => {
    backgroundMusic.addEventListener("canplaythrough", resolve, { once: true });
    backgroundMusic.load();
  });

  // Ensure the scene is fully set up before allowing interaction
  renderer.render(scene, camera);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  controls.update();
  render();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  render();
  // logCameraPosition();
}

function render() {
  water.material.uniforms["time"].value += 0.69 / 60.0;
  renderer.render(scene, camera);
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
    onComplete: function () {
      console.log("Camera pan complete");
    },
  });
}

function logCameraPosition() {
  console.log(
    `Camera Position - x: ${camera.position.x.toFixed(
      1
    )}, y: ${camera.position.y.toFixed(1)}, z: ${camera.position.z.toFixed(1)}`
  );
}

function moveToCanvas(index) {
  currentCanvasIndex = (index + numberOfCanvases) % numberOfCanvases;
  gsap.to(camera.position, {
    x: canvasPositions[currentCanvasIndex].x,
    y: canvasPositions[currentCanvasIndex].y + 1.3,
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
    console.log("Canvas index clicked:", canvasIndex);
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
  console.log("(After click) Night mode: " + isNightMode);
  console.log("");
}

// Call init to start the application
init()
  .then(() => {
    console.log("Initialization complete");
  })
  .catch((error) => {
    console.error("Initialization failed:", error);
  });
