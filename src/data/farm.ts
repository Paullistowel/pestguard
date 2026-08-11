import { Farm } from '@/types';

/**
 * The farm record before any hardware is paired.
 *
 * Zones are not predefined — each node reports the zone its firmware was
 * flashed with, and the store adds it here as nodes appear. That keeps the
 * zone list a reflection of what actually exists rather than a menu of places
 * the user has to map their real deployment onto.
 */
export const EMPTY_FARM: Farm = {
  id: 'local',
  name: 'My Farm',
  zones: [],
  areaHectares: 0,
  crop: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  centerLat: 0,
  centerLon: 0,
};

const FARM_KEY = '@pestguard/farm';

export { FARM_KEY };
