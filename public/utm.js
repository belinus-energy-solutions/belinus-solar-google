// WGS84 lat/lng → UTM (easting, northing) in metres.
// Used by the roof viewer to place panels on the Solar API aerial image,
// which Google delivers as a GeoTIFF in UTM (EPSG:326zz / 327zz).
// Snyder, "Map Projections — A Working Manual", transverse Mercator series.
(function (root) {
  function utmFromLatLng(lat, lng, epsg) {
    const zone = epsg % 100;
    const south = Math.floor(epsg / 100) === 327;
    const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
    const e2 = f * (2 - f), e4 = e2 * e2, e6 = e4 * e2, ep2 = e2 / (1 - e2);
    const phi = (lat * Math.PI) / 180;
    const lam0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
    const lam = (lng * Math.PI) / 180;
    const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
    const N = a / Math.sqrt(1 - e2 * sin * sin);
    const T = tan * tan, C = ep2 * cos * cos, A = cos * (lam - lam0);
    const M = a * ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi
      - ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi)
      + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi)
      - ((35 * e6) / 3072) * Math.sin(6 * phi));
    const E = k0 * N * (A + ((1 - T + C) * A ** 3) / 6
      + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
    let Nn = k0 * (M + N * tan * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24
      + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
    if (south) Nn += 10000000;
    return [E, Nn];
  }
  root.utmFromLatLng = utmFromLatLng;
  if (typeof module !== "undefined") module.exports = { utmFromLatLng };
})(typeof globalThis !== "undefined" ? globalThis : this);
