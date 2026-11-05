const MAX_RAIN = 80;
const TICKS = [80, 60, 40, 20, 0];

export function rainWord(rain) {
  if (rain < 1) return 'No rain';
  if (rain < 10) return 'Light rain';
  if (rain < 25) return 'Steady rain';
  if (rain < 50) return 'Heavy rain';
  return 'Extreme rain';
}

export default function RainGauge({ rain, onChange, onLive, loadingLive }) {
  return (
    <section className="card gauge" aria-label="Rain">
      <div className="gauge-tube">
        <div className="gauge-water" style={{ height: `${(Math.min(rain, MAX_RAIN) / MAX_RAIN) * 100}%` }} />
        <ol className="gauge-ticks meta" aria-hidden="true">
          {TICKS.map((tick) => (
            <li key={tick}>{tick}</li>
          ))}
        </ol>
        <input
          className="gauge-input"
          type="range"
          min="0"
          max={MAX_RAIN}
          step="1"
          value={Math.min(rain, MAX_RAIN)}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label="Rain in millimetres per hour"
          aria-valuetext={`${Math.round(rain)} millimetres per hour, ${rainWord(rain)}`}
        />
      </div>
      <div className="gauge-reading">
        <p className="meta dim">Drag the gauge</p>
        <output className="gauge-number">{Math.round(rain)}</output>
        <p className="meta">mm per hour</p>
        <p className="gauge-word">{rainWord(rain)}</p>
        <button type="button" className="menu-tag" onClick={onLive} disabled={loadingLive}>
          {loadingLive ? 'Checking rain' : 'Use live rain'}
        </button>
      </div>
    </section>
  );
}
