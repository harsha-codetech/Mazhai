function formatDistance(metres) {
  return metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`;
}

export function tripHeadline(routes) {
  if (!routes?.direct || !routes.safe) return 'No road route';
  if (routes.direct.floodedDistance === 0) return 'Usual route is clear';
  return routes.safe.floodedDistance === 0 ? 'Take the dry route' : 'No fully dry route';
}

// The trip result, printed like a WayLore token: TAKE and SKIP are the rubber stamps.
export default function TripToken({ routes }) {
  const headline = tripHeadline(routes);
  if (!routes?.direct || !routes.safe) {
    return (
      <article className="token">
        <h2 className="token-title">{headline}</h2>
        <p>No road connects these two places. Choose another start or destination.</p>
      </article>
    );
  }

  const { direct, safe } = routes;
  const clear = direct.floodedDistance === 0;
  const dry = safe.floodedDistance === 0;
  const roads = direct.floodedRoads.slice(0, 2).join(' and ');

  return (
    <article className="token token-enter">
      <p className="meta dim">Your trip</p>
      <h2 className="token-title" aria-live="polite">
        {headline}
      </h2>
      <div className="token-perf" />
      {clear ? (
        <div className="trip-row">
          <span className="stamp">Take</span>
          <p>
            <b>{formatDistance(direct.distance)}</b> with no flooded roads expected.
          </p>
        </div>
      ) : (
        <>
          <div className="trip-row">
            <span className="stamp">Take</span>
            <p>
              <b>{formatDistance(safe.distance)}</b>{' '}
              {dry
                ? `${formatDistance(Math.max(0, safe.distance - direct.distance))} longer, no flooded roads`
                : `${formatDistance(safe.floodedDistance)} through water`}
            </p>
          </div>
          <div className="trip-row">
            <span className="stamp stamp-skip">Skip</span>
            <p>
              <b>{formatDistance(direct.distance)}</b> usual route, {formatDistance(direct.floodedDistance)} through water
              {roads ? ` on ${roads}` : ''}
            </p>
          </div>
        </>
      )}
    </article>
  );
}
