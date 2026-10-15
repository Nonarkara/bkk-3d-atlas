// A place is not a verdict. Nearby evidence never certifies a route.
export function placeBriefing(point, live, now = Date.now(), weather = null) {
  const rows = [];
  const district = point?.district;
  rows.push(['Place · พื้นที่', district?.nameEn || district?.nameTh || live?.district || 'District unavailable']);
  const generated = Date.parse(live?.city?.updated || '');
  const cityCurrent = live?.cityFreshness?.current === true && Number.isFinite(generated)
    && now >= generated && now - generated <= 30 * 60000;
  rows.push(['City context · ภาพรวม', cityCurrent
    ? `${live.city.headEn} · generated ${live.city.updated} · FloodDash; not a street assessment`
    : 'Current city assessment unavailable. This is not an all-clear.']);
  const g = live?.nearestGauge;
  const observed = Date.parse(g?.observedAt || '');
  const age = Number.isFinite(observed) && now >= observed ? Math.floor((now - observed) / 60000) : null;
  rows.push(['Nearby water · ระดับน้ำใกล้เคียง', g
    ? `${g.name} · ${g.distanceKm} km · ${age !== null && age <= 120 && g.confidence !== 'stale' ? g.bandEn : 'Reading stale or time unknown'} · observed ${g.observedAt || 'time unknown'} · FloodDash / upstream gauge. Not water depth at this point.`
    : 'No nearby gauge evidence available. Water conditions here are unknown.']);
  for (const [label, value] of [['Rail nearby · รถไฟ', point?.nearestTransit], ['Boat network · เรือ', point?.nearestWaterTransit]]) {
    rows.push([label, value ? `${value.name || value.ref || value.mode || 'Mapped network'} · ${value.distanceM} m geometric distance · Atlas reference map (see Credits); not walking distance or a service-status check`
      : 'Mapped connection unavailable. No service-status assessment.']);
  }
  rows.push(['Travel · การเดินทาง', 'Road passability unknown. No safe route has been verified. Check dated road reports and official advice; do not enter floodwater.']);
  const modelTime = Date.parse(weather?.observationTimeUtc || '');
  const next = now >= modelTime && now-modelTime <= 2*3600000
    ? weather?.hourlyNowcast?.find(h => Date.parse(h.validAtUtc) >= now && Date.parse(h.validAtUtc)-now <= 6*3600000) : null;
  rows.push(['Rain forecast · คาดการณ์ฝน', next
    ? `${next.precipitationMm == null ? 'Rain amount unknown' : `${next.precipitationMm} mm`} · valid ${next.validAtUtc} · Open-Meteo model, not observed flooding`
    : 'Forecast unavailable or expired. Missing rain data does not mean dry weather.']);
  return rows;
}

export function nearbyRoadReports(collection, lng, lat, now = Date.now()) {
  return (collection?.features || []).filter(f => {
    const age = now-Date.parse(f.properties?.latest || '');
    return age >= 0 && age <= 24*3600000 && f.geometry?.type === 'LineString';
  }).map(f => {
    const kx=108150, ky=110540;
    let distanceM=Infinity;
    const c=f.geometry.coordinates;
    for(let i=1;i<c.length;i++) {
      const ax=(c[i-1][0]-lng)*kx, ay=(c[i-1][1]-lat)*ky;
      const dx=(c[i][0]-c[i-1][0])*kx, dy=(c[i][1]-c[i-1][1])*ky;
      const t=dx*dx+dy*dy ? Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy))) : 0;
      distanceM=Math.min(distanceM,Math.hypot(ax+t*dx,ay+t*dy));
    }
    return {feature:f,distanceM:Math.round(distanceM)};
  }).filter(r=>r.distanceM<=500).sort((a,b)=>a.distanceM-b.distanceM).slice(0,3);
}

export function nearestCameras(collection, lng, lat) {
  return (collection?.features || []).filter(f => f.geometry?.type === 'Point')
    .map(f => {
      const [x,y] = f.geometry.coordinates;
      return { feature:f, distanceM:Math.round(Math.hypot((x-lng)*108150,(y-lat)*110540)) };
    }).filter(c => Number.isFinite(c.distanceM) && c.distanceM <= 1500)
    .sort((a,b) => a.distanceM-b.distanceM).slice(0,3);
}
