import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildHeritageRoofs} from '../public/heritage-roofs.js';
test('pilot follows two existing footprints with finite closed roof geometry', () => {
  const data = JSON.parse(readFileSync(new URL('../public/bkk-heritage-detail.geojson', import.meta.url)));
  const before = JSON.stringify(data);
  const roofs = buildHeritageRoofs(data);
  assert.equal(roofs.features.length, 288);
  assert.equal(new Set(roofs.features.map(f => f.properties.name)).size, 2);
  for (const f of roofs.features) {
    assert.ok(f.geometry.coordinates.flat(2).every(Number.isFinite));
    assert.deepEqual(f.geometry.coordinates[0][0], f.geometry.coordinates[0].at(-1));
    assert.ok(f.properties.top >= f.properties.base && f.properties.top <= f.properties.base + 6);
    assert.match(f.properties.footprintSource,/^https:\/\/www.openstreetmap.org\/way\/\d+$/);
    assert.match(f.properties.accuracy, /not for flood/);
  }
  assert.equal(JSON.stringify(data), before);
});
test('missing geometry produces no invented landmarks', () => {
  assert.deepEqual(buildHeritageRoofs({features: []}).features, []);
});
test('basemap cleanup preserves heritage roof extrusions and still hides foreign buildings', () => {
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const start=app.indexOf('function hideBaseBuildingFills('), end=app.indexOf('function findOpenMapTilesSource(',start);
  const hidden=[];
  const hide=vm.runInNewContext(app.slice(start,end)+'\nhideBaseBuildingFills',{
    BKKX_BUILDINGS_LAYER:'metro',BKKX_BUILDINGS_HI_LAYER:'hi',RATTANAKOSIN_BUILDINGS_LAYER:'detail',
    LANDMARKS_LAYER:'landmarks',ROOF_LAYER:'bkkx-heritage-roofs-3d',
  });
  hide({getStyle:()=>({layers:[{id:'bkkx-heritage-roofs-3d',type:'fill-extrusion'},
    {id:'foreign-building',type:'fill-extrusion'}]}),setLayoutProperty:id=>hidden.push(id)});
  assert.deepEqual(hidden,['foreign-building']);
});
