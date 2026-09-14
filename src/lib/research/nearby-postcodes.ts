import { AU_POSTCODE_COORDINATES } from "./data/nearby-postcodes-au.ts";

export type NearbyPostcodeOptions = {
  /** Maximum straight-line distance from the selected postcode, in kilometres. */
  maxDistanceKm?: number;
  /** Maximum number of nearby postcodes, excluding the selected postcode. */
  maxResults?: number;
};

const DEFAULT_MAX_DISTANCE_KM = 10;
const DEFAULT_MAX_RESULTS = 8;
const EARTH_RADIUS_KM = 6371.0088;

type Coordinate = { latitude: number; longitude: number };

const coordinates = new Map<string, Coordinate>(
  AU_POSTCODE_COORDINATES.map(([postcode, latitude, longitude]) => [postcode, { latitude, longitude }]),
);

/**
 * Gives an exact postcode plus a small, distance-bound set of nearby postcode
 * areas. Coordinates are deliberately absent for broad or ambiguous postcode
 * areas; those inputs remain exact-only instead of guessing a centroid.
 */
export function resolveNearbyPostcodes(value: string, options: NearbyPostcodeOptions = {}): string[] {
  const postcode = value.trim();
  if (!/^\d{4}$/u.test(postcode)) return [];

  const origin = coordinates.get(postcode);
  if (!origin) return [postcode];

  const maxDistanceKm = positiveFinite(options.maxDistanceKm, DEFAULT_MAX_DISTANCE_KM);
  const maxResults = nonNegativeInteger(options.maxResults, DEFAULT_MAX_RESULTS);
  if (maxResults === 0) return [postcode];

  const nearby = AU_POSTCODE_COORDINATES
    .filter(([candidate]) => candidate !== postcode)
    .map(([candidate, latitude, longitude]) => ({
      postcode: candidate,
      distanceKm: haversineKm(origin.latitude, origin.longitude, latitude, longitude),
    }))
    // A shared GeoNames point commonly means a delivery-only postcode at the
    // same post office, not a surrounding suburb.
    .filter((candidate) => candidate.distanceKm > 0 && candidate.distanceKm <= maxDistanceKm)
    .sort((left, right) => left.distanceKm - right.distanceKm || left.postcode.localeCompare(right.postcode))
    .slice(0, maxResults)
    .map((candidate) => candidate.postcode);

  return [postcode, ...nearby];
}

function positiveFinite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function haversineKm(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number): number {
  const latitudeDelta = degreesToRadians(latitudeB - latitudeA);
  const longitudeDelta = degreesToRadians(longitudeB - longitudeA);
  const sinLatitude = Math.sin(latitudeDelta / 2);
  const sinLongitude = Math.sin(longitudeDelta / 2);
  const value = sinLatitude * sinLatitude
    + Math.cos(degreesToRadians(latitudeA)) * Math.cos(degreesToRadians(latitudeB)) * sinLongitude * sinLongitude;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}
