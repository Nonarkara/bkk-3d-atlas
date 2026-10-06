// Weather model output is not road inundation or a vehicle-clearance test.
export async function weatherSupport(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawLat = url.searchParams.get("lat"), rawLng = url.searchParams.get("lng");
  const lat = rawLat == null ? 13.7563 : Number(rawLat);
  const lng = rawLng == null ? 100.5018 : Number(rawLng);
  if (rawLat === "" || rawLng === "" || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 13.4 || lat > 14.2 || lng < 100.2 || lng > 101.1) {
    return Response.json({ error: "outside_bangkok_or_invalid_coordinates" }, { status: 400 });
  }
  const payload: Record<string, any> = {
    tool: "weather-support", configured: false, live: false, tier: "unavailable",
    source: "Open-Meteo weather model", status: "unavailable", coordinates: { lat, lng },
    observationTimeUtc: null, fetchedAt: new Date().toISOString(), weather: null, hourlyNowcast: [],
    lifeSafety: {
      framework: "General preparedness; no site-specific hazard assessment",
      electrocutionRisk: { level: "unknown", action: "Do not enter floodwater. Follow official emergency instructions." },
      manholeSuctionHazard: { level: "unknown", action: "Do not enter floodwater. Hidden openings cannot be assessed from rainfall." },
      vehiclePassability: {
        motorcycle: { status: "unknown", maxSafeWaterDepthCm: null },
        sedan: { status: "unknown", maxSafeWaterDepthCm: null },
        highClearancePickup: { status: "unknown", maxSafeWaterDepthCm: null },
      },
    },
    livelihood: { shophouseProtection: { leadTimeHours: null } },
    disclaimer: "Modelled weather, not a street sensor or flood forecast. Rainfall does not establish road depth, electrical safety, vehicle clearance or a protection deadline.",
    attribution: "https://open-meteo.com/en/docs",
  };
  try {
    const upstream = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m&hourly=precipitation,precipitation_probability&forecast_days=2&timezone=UTC`, { signal: AbortSignal.timeout(12000) });
    if (!upstream.ok) throw new Error(`upstream HTTP ${upstream.status}`);
    const data = await upstream.json() as any;
    const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
    const timestamp = (v: unknown): string | null => {
      if (typeof v !== "string") return null;
      const ms = Date.parse(v.endsWith("Z") ? v : `${v}Z`);
      return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    };
    const observed = timestamp(data.current?.time);
    const age = observed ? Date.now() - Date.parse(observed) : NaN;
    if (!Number.isFinite(age) || age < -300000 || age > 2 * 3600000) throw new Error("model time unavailable or stale");
    const rain = number(data.current?.precipitation);
    payload.weather = {
      temperatureC: number(data.current?.temperature_2m),
      relativeHumidityPct: number(data.current?.relative_humidity_2m),
      precipitationMm: rain != null && rain >= 0 ? rain : null,
      precipitationIntervalSeconds: number(data.current?.interval),
      windSpeedKmh: number(data.current?.wind_speed_10m),
    };
    for (let i = 0; i < (data.hourly?.time?.length ?? 0); i++) {
      const at = timestamp(data.hourly.time[i]);
      if (!at || Date.parse(at) < Date.now() || Date.parse(at) > Date.now() + 6 * 3600000) continue;
      const mm = number(data.hourly.precipitation?.[i]);
      const probability = number(data.hourly.precipitation_probability?.[i]);
      payload.hourlyNowcast.push({ validAtUtc: at, precipitationMm: mm != null && mm >= 0 ? mm : null, precipitationProbabilityPct: probability != null && probability >= 0 && probability <= 100 ? probability : null, source: "Open-Meteo model forecast", roadPassability: "unknown" });
    }
    payload.observationTimeUtc = observed;
    payload.status = "ok";
    payload.tier = "model";
    // `configured` refers to the legacy Google route, not a Google credential.
  } catch (error) {
    payload.reason = error instanceof Error && /^(upstream HTTP \d{3}|model time unavailable or stale)$/.test(error.message) ? error.message : "weather fetch or parsing failed";
  }
  return Response.json(payload, { headers: { "cache-control": "public, max-age=180", "access-control-allow-origin": "*" } });
}

export function unavailableHydroForecast(): Response {
  return Response.json({
    tool: "timesfm-predict", configured: false, status: "unavailable", tier: "unavailable", model: null,
    generatedAtUtc: null, stations: [], bangkokVerdictTimeline: [],
    livelihoodSummary: { shophouseProtectionWindowHours: null, criticalCommuterWindows: [], actionChecklist: [] },
    message: "No TimesFM inference service or validated hydrological model is connected. River arrival times, flood depths and safe roads have not been calculated.",
  }, { headers: { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
}
