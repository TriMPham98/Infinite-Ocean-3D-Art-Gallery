import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Water } from "three/examples/jsm/objects/Water.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { gsap } from "gsap";

let camera, scene, renderer;
let controls, water, sun;
let canvasPositions = [];
const numberOfCanvases = 12;
let currentCanvasIndex = 0;

init();

const startButton = document.getElementById("start-button");
const loadingScreen = document.getElementById("loading-screen");
const canvasElement = renderer.domElement;
const backgroundMusic = document.getElementById("background-music");
const volumeToggleBtn = document.getElementById("volume-toggle");

canvasElement.style.opacity = 0;
canvasElement.style.transition = "opacity 2s ease";
backgroundMusic.volume = 0.0;
backgroundMusic.loop = true;

startButton.addEventListener("click", function () {
  loadingScreen.classList.add("hidden");
  canvasElement.style.opacity = 1;
  animate();
  backgroundMusic.play();
});

function toggleMusic() {
  if (backgroundMusic.volume > 0) {
    backgroundMusic.volume = 0;
    volumeToggleBtn.textContent = "Unmute Music";
  } else {
    backgroundMusic.volume = 0.69;
    volumeToggleBtn.textContent = "Mute Music";
  }
}

volumeToggleBtn.addEventListener("click", toggleMusic);

window.addEventListener("keydown", function (event) {
  if (event.key === "m" || event.key === "M") {
    toggleMusic();
  } else if (event.key === "ArrowRight") {
    moveToCanvas(currentCanvasIndex - 1);
  } else if (event.key === "ArrowLeft") {
    moveToCanvas(currentCanvasIndex + 1);
  }
});

async function init() {
  renderer = new THREE.WebGLRenderer();
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);

  document
    .getElementById("start-button")
    .addEventListener("click", panToCenter);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    1,
    20000
  );
  camera.position.set(0, 0, 0);

  sun = new THREE.Vector3();

  const waterGeometry = new THREE.PlaneGeometry(10000, 10000);
  water = new Water(waterGeometry, {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals: new THREE.TextureLoader().load(
      "/assets/waternormals.jpg",
      function (texture) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      }
    ),
    sunDirection: new THREE.Vector3(),
    sunColor: 0xffffff,
    waterColor: 0x001e0f,
    distortionScale: 3.7,
    fog: scene.fog !== undefined,
  });

  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  const circleRadius = 69;
  const canvasYPosition = 20;
  const loader = new THREE.TextureLoader();
  const marbleTexture = loader.load("/assets/whiteMarble.jpg");
  const frameDepth = 1.0;
  const frameOffset = 1.5;
  const frameRadius = circleRadius - 0.51;

  for (let i = 0; i < numberOfCanvases; i++) {
    const angle = (i / numberOfCanvases) * Math.PI * 2;
    const frameGeometry = new THREE.BoxGeometry(
      20 + frameOffset * 2,
      frameDepth,
      30 + frameOffset * 2
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
  }

  for (let i = 0; i < numberOfCanvases; i++) {
    const angle = (i / numberOfCanvases) * Math.PI * 2;
    const texture = loader.load("/assets/image" + i + ".jpg");
    const canvasGeometry = new THREE.BoxGeometry(20, 0, 30);
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
  }

  const sky = new Sky();
  sky.scale.setScalar(10000);
  scene.add(sky);

  const skyUniforms = sky.material.uniforms;

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

  controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.target.set(0, 10, 0);
  controls.minDistance = 102.0;
  controls.maxDistance = 300.0;
  controls.enableDamping = true;
  controls.zoomSpeed = 0.69;
  controls.rotateSpeed = 0.36;
  controls.dampingFactor = 0.05;
  controls.update();

  window.addEventListener("resize", onWindowResize);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  render();
  logCameraPosition();
}

function render() {
  water.material.uniforms["time"].value += 0.69 / 60.0;
  renderer.render(scene, camera);
}

function panToCenter() {
  const initialPosition = new THREE.Vector3(300, 300, -300);
  camera.position.copy(initialPosition);
  controls.update();
  const finalPosition = new THREE.Vector3(108.0, 27.8, 0.0);
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
    duration: 2.5,
    ease: "power2.inOut",
    onUpdate: function () {
      controls.update();
    },
  });
}
