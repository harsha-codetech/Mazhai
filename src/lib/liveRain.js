/** Current rain intensity in mm per hour at a point, from Open-Meteo (no key needed). */
export async function fetchLiveRain(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=precipitation&timezone=auto';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Rain service returned ${res.status}`);
  const { current } = await res.json();
  // `precipitation` is the total for the reporting interval, so scale it to one hour.
  return (current.precipitation * 3600) / current.interval;
}
