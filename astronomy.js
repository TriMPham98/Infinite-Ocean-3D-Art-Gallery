// Low-precision ephemeris for the gallery sky (no dependencies).
//
// Sun: Meeus, Astronomical Algorithms ch. 25 (≈0.01°).
// Moon: Meeus ch. 47, main periodic terms (≈0.05°), topocentric parallax.
// Planets: JPL "Approximate Positions of the Planets", Table 1 (≈1′, 1800–2050).
// Refraction: Saemundsson. Angles are degrees unless noted.

const DEG = Math.PI / 180;
const sin = (d) => Math.sin(d * DEG);
const cos = (d) => Math.cos(d * DEG);
const norm360 = (d) => ((d % 360) + 360) % 360;

export function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

export function dateFromJulianDay(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}

const centuries = (jd) => (jd - 2451545.0) / 36525;

function obliquity(T) {
  const omega = 125.04452 - 1934.136261 * T;
  // Mean obliquity + nutation in obliquity
  return 23.439291 - 0.0130042 * T + 0.00256 * cos(omega);
}

function nutationInLongitude(T) {
  return -0.00478 * sin(125.04452 - 1934.136261 * T);
}

function eclipticToEquatorial(lambda, beta, eps) {
  const ra = Math.atan2(
    sin(lambda) * cos(eps) - Math.tan(beta * DEG) * sin(eps),
    cos(lambda)
  ) / DEG;
  const dec = Math.asin(
    sin(beta) * cos(eps) + cos(beta) * sin(eps) * sin(lambda)
  ) / DEG;
  return { ra: norm360(ra), dec };
}

/** Greenwich mean sidereal time (deg). */
export function gmst(jd) {
  const T = centuries(jd);
  return norm360(
    280.46061837 +
      360.98564736629 * (jd - 2451545.0) +
      0.000387933 * T * T -
      (T * T * T) / 38710000
  );
}

/** Local sidereal time (deg); longitude east-positive. */
export function localSiderealTime(jd, longitude) {
  return norm360(gmst(jd) + longitude);
}

/** Apparent geocentric sun: ecliptic longitude, RA/Dec, distance (AU). */
export function sunPosition(jd) {
  const T = centuries(jd);
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const e = 0.016708634 - 0.000042037 * T;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) +
    (0.019993 - 0.000101 * T) * sin(2 * M) +
    0.000289 * sin(3 * M);
  const trueLong = L0 + C;
  const nu = M + C;
  const distance = (1.000001018 * (1 - e * e)) / (1 + e * cos(nu));
  const lambda = norm360(trueLong - 0.00569 + nutationInLongitude(T));
  const { ra, dec } = eclipticToEquatorial(lambda, 0, obliquity(T));
  return { lambda, beta: 0, ra, dec, distance };
}

// Meeus table 47.A: D, M, M', F, Σl (1e-6°), Σr (1e-3 km)
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
];

// Meeus table 47.B: D, M, M', F, Σb (1e-6°)
const MOON_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
];

/** Apparent geocentric moon: ecliptic coords, RA/Dec, distance (km). */
export function moonPosition(jd) {
  const T = centuries(jd);
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const A1 = 119.75 + 131.849 * T;
  const A2 = 53.09 + 479264.29 * T;
  const A3 = 313.45 + 481266.484 * T;

  let sl = 0;
  let sr = 0;
  for (const [d, m, mp, f, l, r] of MOON_LR) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sl += l * e * sin(arg);
    sr += r * e * cos(arg);
  }
  let sb = 0;
  for (const [d, m, mp, f, b] of MOON_B) {
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sb += b * e * sin(d * D + m * M + mp * Mp + f * F);
  }
  sl += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
  sb +=
    -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F) +
    127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);

  const lambda = norm360(Lp + sl / 1e6 + nutationInLongitude(T));
  const beta = sb / 1e6;
  const distance = 385000.56 + sr / 1000;
  const { ra, dec } = eclipticToEquatorial(lambda, beta, obliquity(T));
  return { lambda, beta, ra, dec, distance };
}

// JPL approximate Keplerian elements (J2000 ecliptic), value + rate/century:
// a (AU), e, I, L, long. perihelion ϖ, long. ascending node Ω
const PLANET_ELEMENTS = {
  venus: [0.72333566, 0.0000039, 0.00677672, -0.00004107, 3.39467605, -0.0007889,
    181.9790995, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418],
  earth: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668,
    100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0, 0],
  mars: [1.52371034, 0.00001847, 0.0933941, 0.00007882, 1.84969142, -0.00813131,
    -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
  jupiter: [5.202887, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714,
    34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106],
  saturn: [9.53667594, -0.0012506, 0.05386179, -0.00050991, 2.48599187, 0.00193609,
    49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794],
};

// Absolute magnitude H and linear phase coefficient (mag/deg)
const PLANET_PHOTOMETRY = {
  venus: [-4.4, 0.013],
  mars: [-1.52, 0.016],
  jupiter: [-9.4, 0.005],
  saturn: [-8.88, 0.044],
};

function heliocentric(name, T) {
  const el = PLANET_ELEMENTS[name];
  const a = el[0] + el[1] * T;
  const e = el[2] + el[3] * T;
  const I = el[4] + el[5] * T;
  const L = el[6] + el[7] * T;
  const varpi = el[8] + el[9] * T;
  const Omega = el[10] + el[11] * T;
  const omega = varpi - Omega;
  const M = norm360(L - varpi);
  // Kepler's equation (degrees form)
  const eDeg = e / DEG;
  let Ecc = M + eDeg * sin(M);
  for (let i = 0; i < 8; i++) {
    const dM = M - (Ecc - eDeg * sin(Ecc));
    Ecc += dM / (1 - e * cos(Ecc));
  }
  const xp = a * (cos(Ecc) - e);
  const yp = a * Math.sqrt(1 - e * e) * sin(Ecc);
  return [
    (cos(omega) * cos(Omega) - sin(omega) * sin(Omega) * cos(I)) * xp +
      (-sin(omega) * cos(Omega) - cos(omega) * sin(Omega) * cos(I)) * yp,
    (cos(omega) * sin(Omega) + sin(omega) * cos(Omega) * cos(I)) * xp +
      (-sin(omega) * sin(Omega) + cos(omega) * cos(Omega) * cos(I)) * yp,
    sin(omega) * sin(I) * xp + cos(omega) * sin(I) * yp,
  ];
}

/** Geocentric RA/Dec (J2000-ish) and visual magnitude of a planet. */
export function planetPosition(name, jd) {
  const T = centuries(jd);
  const p = heliocentric(name, T);
  const earth = heliocentric("earth", T);
  const g = [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];
  const delta = Math.hypot(...g);
  const r = Math.hypot(...p);
  const lambda = norm360(Math.atan2(g[1], g[0]) / DEG);
  const beta = Math.asin(g[2] / delta) / DEG;
  const { ra, dec } = eclipticToEquatorial(lambda, beta, 23.43928);
  // Phase angle sun–planet–earth
  const re = Math.hypot(...earth);
  const phase = Math.acos(
    Math.min(1, Math.max(-1, (r * r + delta * delta - re * re) / (2 * r * delta)))
  ) / DEG;
  const [H, k] = PLANET_PHOTOMETRY[name];
  const magnitude = H + 5 * Math.log10(r * delta) + k * phase;
  return { ra, dec, distance: delta, magnitude };
}

/** Equatorial → horizontal. Azimuth from north, east-positive. */
export function equatorialToHorizontal(ra, dec, lst, latitude) {
  const H = lst - ra;
  const altitude = Math.asin(
    sin(latitude) * sin(dec) + cos(latitude) * cos(dec) * cos(H)
  ) / DEG;
  const azimuth = norm360(
    Math.atan2(
      -cos(dec) * sin(H),
      sin(dec) * cos(latitude) - cos(dec) * cos(H) * sin(latitude)
    ) / DEG
  );
  return { altitude, azimuth };
}

/** Atmospheric refraction (deg) for a true altitude (Saemundsson). */
export function refraction(trueAltitude) {
  if (trueAltitude < -1.5) return 0;
  const h = trueAltitude;
  return 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * DEG) / 60;
}

/** Topocentric horizontal coordinates of sun and moon for an observer. */
export function skyAt(jd, { latitude, longitude }) {
  const lst = localSiderealTime(jd, longitude);
  const sunEq = sunPosition(jd);
  const moonEq = moonPosition(jd);
  const sun = equatorialToHorizontal(sunEq.ra, sunEq.dec, lst, latitude);
  const moon = equatorialToHorizontal(moonEq.ra, moonEq.dec, lst, latitude);

  // Lunar parallax (≈1°) lowers the moon as seen from Earth's surface
  const parallax = Math.asin(6378.14 / moonEq.distance) / DEG;
  moon.altitude -= Math.asin(sin(parallax) * cos(moon.altitude)) / DEG;
  moon.distance = moonEq.distance;
  moon.angularDiameter = (2 * Math.asin(1737.4 / moonEq.distance)) / DEG;
  sun.distance = sunEq.distance;
  sun.angularDiameter = 0.5332 / sunEq.distance;

  // Illuminated fraction from the geocentric elongation
  const elongation = Math.acos(
    cos(moonEq.beta) * cos(moonEq.lambda - sunEq.lambda)
  ) / DEG;
  const sunKm = sunEq.distance * 149597870.7;
  const phaseAngle = Math.atan2(
    sunKm * sin(elongation),
    moonEq.distance - sunKm * cos(elongation)
  ) / DEG;
  moon.illumination = (1 + cos(phaseAngle)) / 2;

  return { lst, sun, moon, sunEq, moonEq };
}

/** Find the JD (within [jdStart, jdEnd]) where the sun's true altitude crosses `altitude` going down. */
export function findSunAltitude(jdStart, jdEnd, altitude, observer) {
  const alt = (jd) => skyAt(jd, observer).sun.altitude - altitude;
  const step = 5 / 1440;
  let a = jdStart;
  let fa = alt(a);
  for (let b = a + step; b <= jdEnd; b += step) {
    const fb = alt(b);
    if (fa > 0 && fb <= 0) {
      let lo = a;
      let hi = b;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (alt(mid) > 0) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }
    a = b;
    fa = fb;
  }
  return null;
}
