// What colour a building is.
//
// The atlas paints its extrusions by OpenStreetMap building type: gold for
// a temple, blue for a school, orange for a block of flats, warm grey for
// everything tagged only `building=yes`. That table is a MapLibre match
// expression, and it lives here so that the map and the three.js massing
// layer cannot disagree about a building's colour.
//
// The two copies — the expression the map uses and the JavaScript twin the
// mesh builder uses — have to agree, because the facade meshes are drawn
// over the map's own extrusions. A building that is orange on the map and
// grey in the mesh would show a grey patch on an orange wall. So the table
// is written once, as data, and both copies are generated from it.

export const BUILDING_COLOR_TABLE = {
  // cultural / religious — gold + warm bronze
  temple: '#f5b800',
  pagoda: '#f5b800',
  shrine: '#e9a91a',
  wayside_shrine: '#e9a91a',
  monastery: '#b08c1f',
  mosque: '#a8c84a',
  church: '#c89b3c',
  cathedral: '#c89b3c',
  chapel: '#c89b3c',
  synagogue: '#5b9cb8',
  // civic / public
  civic: '#b8b8b8',
  public: '#b8b8b8',
  government: '#888888',
  fire_station: '#ef4444',
  police: '#3b5cdb',
  townhall: '#b8b8b8',
  // hospitality / tourism
  hotel: '#ec4899',
  motel: '#ec4899',
  guest_house: '#d946a0',
  hostel: '#d946a0',
  museum: '#a855f7',
  // education — clear blues
  school: '#3d74c4',
  kindergarten: '#60a5fa',
  university: '#1e40af',
  college: '#1e40af',
  // healthcare
  hospital: '#10b981',
  clinic: '#10b981',
  // commercial / retail — warm paper
  commercial: '#fef3c7',
  retail: '#fef3c7',
  office: '#e5e5e5',
  supermarket: '#e5e5e5',
  mall: '#e5e5e5',
  marketplace: '#e5e5e5',
  market: '#e5e5e5',
  shophouse: '#e5e5e5',
  kiosk: '#e5e5e5',
  // industrial
  industrial: '#6b7280',
  warehouse: '#6b7280',
  factory: '#6b7280',
  manufacture: '#6b7280',
  data_center: '#52525b',
  // residential variants
  house: '#a8a89e',
  residential: '#a8a89e',
  detached: '#a8a89e',
  terrace: '#a8a89e',
  semidetached_house: '#a8a89e',
  townhouse: '#a8a89e',
  bungalow: '#a8a89e',
  hut: '#a8a89e',
  apartments: '#fb923c',
  dormitory: '#fb923c',
  condominium: '#fb923c',
  // transport
  train_station: '#f1efe8',
  transportation: '#f5b800',
  parking: '#525252',
  garage: '#525252',
  garages: '#525252',
  carport: '#525252',
  fuel: '#a3a3a3',
  // storage / outbuildings
  shed: '#9a9a90',
  roof: '#9a9a90',
  stilt_house: '#a8a89e',
  construction: '#9a9a90',
};

// The colour of a building that is tagged only `building=yes`, and the
// colour of anything the table does not name.
export const BUILDING_COLOR_DEFAULT = '#9a9a90';

// The MapLibre expression the map paints its extrusions with.
export const BUILDING_COLOR_BY_TYPE = [
  'match',
  ['get', 'building'],
  ...Object.entries(BUILDING_COLOR_TABLE).flatMap(([key, value]) => [key, value]),
  BUILDING_COLOR_DEFAULT,
];

// The JavaScript twin, for the code that cannot run a MapLibre expression.
export function buildingColorFor(props) {
  const type = String(props?.building ?? props?.building_type ?? '');
  return BUILDING_COLOR_TABLE[type] ?? BUILDING_COLOR_DEFAULT;
}
