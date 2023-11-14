// Style import
import "./style.css";

// Three.js core and additional components
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Water } from "three/examples/jsm/objects/Water.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { gsap } from "gsap";

// Scene, camera, and renderer declarations
let camera, scene, renderer;
let controls, water, sun;

// Initialization function to set up the scene
init();

// DOM elements for UI controls
const startButton = document.getElementById("start-button");
const loadingScreen = document.getElementById("loading-screen");
const canvas = renderer.domElement;
const backgroundMusic = document.getElementById("background-music"); // Get the audio element
const volumeToggleBtn = document.getElementById("volume-toggle"); // Add a reference to the volume toggle button

// UI initial states
canvas.style.opacity = 0;
canvas.style.transition = "opacity 2s ease";
backgroundMusic.volume = 0.69;
backgroundMusic.loop = true;

// Event listeners for UI interactions
startButton.addEventListener("click", function () {
  // Start fading out the loading screen and fading in the scene
  loadingScreen.classList.add("hidden");
  canvas.style.opacity = 1;

  // Start the animation loop
  animate();

  // Play the background music
  backgroundMusic.play();
});

volumeToggleBtn.addEventListener("click", function () {
  if (backgroundMusic.volume > 0) {
    backgroundMusic.volume = 0; // Mute the music
    volumeToggleBtn.textContent = "Unmute Music"; // Update the button text
  } else {
    backgroundMusic.volume = 0.69; // Restore the volume
    volumeToggleBtn.textContent = "Mute Music"; // Update the button text
  }
});

// Initialize the scene, camera, and objects
async function init() {
  renderer = new THREE.WebGLRenderer();
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);

  document
    .getElementById("start-button")
    .addEventListener("click", panToCenter);

  // Scene setup
  scene = new THREE.Scene();

  // Camera setup
  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    1,
    20000
  );
  camera.position.set(0, 0, 0);

  // Sun vector for lighting
  sun = new THREE.Vector3();

  // Water object creation
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

  // Constants for circle arrangement
  const numberOfCanvases = 12;
  const circleRadius = 69;
  const canvasYPosition = 18;

  for (let i = 0; i < numberOfCanvases; i++) {
    const angle = (i / numberOfCanvases) * Math.PI * 2; // Angle for each canvas

    const canvasGeometry = new THREE.BoxGeometry(20, 1, 30);
    const canvasMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });

    const canvas = new THREE.Mesh(canvasGeometry, canvasMaterial);
    canvas.rotation.x = Math.PI / 2;
    canvas.rotation.z = angle + Math.PI / 2;

    // Positioning canvas in a circle
    canvas.position.set(
      circleRadius * Math.cos(angle), // x position
      canvasYPosition, // y position
      circleRadius * Math.sin(angle) // z position
    );

    scene.add(canvas);
  }

  // Skybox creation
  const sky = new Sky();
  sky.scale.setScalar(10000);
  scene.add(sky);

  const skyUniforms = sky.material.uniforms;

  skyUniforms["turbidity"].value = 10;
  skyUniforms["rayleigh"].value = 2;
  skyUniforms["mieCoefficient"].value = 0.005;
  skyUniforms["mieDirectionalG"].value = 0.8;

  const parameters = {
    elevation: 0.69,
    azimuth: -150,
  };

  const pmremGenerator = new THREE.PMREMGenerator(renderer);

  function updateSun() {
    const phi = THREE.MathUtils.degToRad(90 - parameters.elevation);
    const theta = THREE.MathUtils.degToRad(parameters.azimuth);

    sun.setFromSphericalCoords(1, phi, theta);

    sky.material.uniforms["sunPosition"].value.copy(sun);
    water.material.uniforms["sunDirection"].value.copy(sun).normalize();

    scene.environment = pmremGenerator.fromScene(sky).texture;
  }

  // Sun update function call
  updateSun();

  // Controls for user interaction
  controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.target.set(0, 10, 0);
  controls.minDistance = 40.0;
  controls.maxDistance = 300.0;
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.update();

  // Event listener for window resize
  window.addEventListener("resize", onWindowResize);
}

// Window resize handler
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  render();
}

// Render function
function render() {
  water.material.uniforms["time"].value += 0.69 / 60.0;

  renderer.render(scene, camera);
}

function panToCenter() {
  const targetPosition = controls.target.clone();
  const initialPosition = new THREE.Vector3(690, 1000, 0);
  camera.position.copy(initialPosition);
  controls.update();

  const finalPosition = new THREE.Vector3(
    targetPosition.x,
    targetPosition.y + 10,
    targetPosition.z + 50
  );

  gsap.to(camera.position, {
    x: finalPosition.x,
    y: finalPosition.y,
    z: finalPosition.z,
    duration: 6.9, // Duration in seconds
    ease: "power2.inOut",
    onUpdate: function () {
      controls.update(); // Update the controls during the animation
    },
  });
}
