import { useId, useMemo, useState } from 'react';

function matches(places, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts = [];
  const contains = [];
  for (const place of places) {
    const name = place.name.toLowerCase();
    if (name.startsWith(q)) starts.push(place);
    else if (name.includes(q)) contains.push(place);
    if (starts.length >= 8) break;
  }
  return [...starts, ...contains].slice(0, 8);
}

export default function PlaceSearch({ label, value, places, picking, onSelect, onPickOnMap, children }) {
  const [query, setQuery] = useState(null); // null while the field shows the chosen place
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = useMemo(() => matches(places, query ?? ''), [places, query]);
  const open = query !== null && results.length > 0;

  function choose(place) {
    setQuery(null);
    setActive(0);
    onSelect(place);
  }

  function handleKey(event) {
    if (event.key === 'Escape') setQuery(null);
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[active]);
    }
  }

  return (
    <div className="field">
      <label className="meta" htmlFor={`${listId}-input`}>
        {label}
      </label>
      <div className="field-row">
        <input
          id={`${listId}-input`}
          className="input"
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder="Search area, station, hospital"
          value={query ?? value.name}
          onFocus={(event) => event.target.select()}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onBlur={() => setQuery(null)}
          onKeyDown={handleKey}
        />
        <button type="button" className="menu-tag" aria-pressed={picking} onClick={onPickOnMap}>
          {picking ? 'Tap map' : 'Pick on map'}
        </button>
        {children}
      </div>
      {open && (
        <ul className="results card pop-in" id={listId} role="listbox">
          {results.map((place, i) => (
            <li
              key={`${place.name}-${place.kind}-${place.lat}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(event) => {
                event.preventDefault(); // keep focus so blur doesn't close the list first
                choose(place);
              }}
            >
              <span>{place.name}</span>
              <span className="meta dim">{place.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
