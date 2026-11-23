import { useCallback, useEffect, useState } from 'react';
import { api, DEFAULT_FILTERS, type FilterOption, type FilterOptions, type Filters, type Platform } from '../api';
import { Icon, Toggle } from './shared';

// The user's saved filters, loaded once and saved when they apply new ones
export function useFilters(): { filters: Filters | null; apply: (f: Filters) => Promise<void> } {
  const [filters, setFilters] = useState<Filters | null>(null);
  useEffect(() => {
    api
      .filters()
      .then((r) => setFilters(r.filters))
      .catch(() => setFilters({ ...DEFAULT_FILTERS }));
  }, []);
  const apply = useCallback(async (next: Filters) => {
    setFilters(next);
    try {
      setFilters((await api.saveFilters(next)).filters);
    } catch {
      /* still applied for this visit */
    }
  }, []);
  return { filters, apply };
}

// How many filters are set, for the button's badge (adult games on counts as one)
export function activeCount(f: Filters): number {
  return (
    [f.platformIds, f.genreIds, f.themeIds, f.gameModeIds].filter((a) => a.length > 0).length +
    [f.yearFrom ?? f.yearTo, f.minRating, f.minRatingCount].filter((v) => v !== null && v !== undefined).length +
    (f.includeAdult ? 1 : 0)
  );
}

export function FilterButton({ filters, onClick }: { filters: Filters | null; onClick: () => void }) {
  const n = filters ? activeCount(filters) : 0;
  return (
    <button type="button" className="btn" onClick={onClick} disabled={!filters}>
      <Icon name="funnel" /> Filters
      {n > 0 && <span className="pill">{n}</span>}
    </button>
  );
}

function Chips({ options, selected, onChange, label }: { options: FilterOption[]; selected: number[]; onChange: (ids: number[]) => void; label: string }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button key={o.id} type="button" className={on ? 'chip on' : 'chip'} aria-pressed={on} onClick={() => onChange(on ? selected.filter((i) => i !== o.id) : [...selected, o.id])}>
            {o.name}
          </button>
        );
      })}
    </div>
  );
}

const num = (v: string): number | null => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

// Seerr's filter slide-over: everything that narrows a list, applied (and saved) together
export function FilterPanel({ filters, platforms, onApply, onClose }: { filters: Filters; platforms: Platform[]; onApply: (f: Filters) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Filters>(filters);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setDraft((d) => ({ ...d, [key]: value }));

  useEffect(() => {
    api
      .filterOptions()
      .then(setOptions)
      .catch((err: Error) => setError(err.message));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // The adult theme has its own switch
  const themes = (options?.themes ?? []).filter((t) => !/^erotic$/i.test(t.name));
  const platformOptions = platforms.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="panel-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="panel" role="dialog" aria-modal="true" aria-labelledby="filters-title">
        <header className="panel-head">
          <h2 id="filters-title">Filters</h2>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="panel-body">
          {error && <p className="err small">{error}</p>}

          <section>
            <h3>Platforms</h3>
            <p className="muted small">None picked: every platform you can request.</p>
            <Chips label="Platforms" options={platformOptions} selected={draft.platformIds} onChange={(v) => set('platformIds', v)} />
          </section>

          <section>
            <h3>Release year</h3>
            <div className="range">
              <input className="input" type="number" min={1950} max={2100} placeholder="From" aria-label="Released from year" value={draft.yearFrom ?? ''} onChange={(e) => set('yearFrom', num(e.target.value))} />
              <span aria-hidden="true">–</span>
              <input className="input" type="number" min={1950} max={2100} placeholder="To" aria-label="Released up to year" value={draft.yearTo ?? ''} onChange={(e) => set('yearTo', num(e.target.value))} />
            </div>
          </section>

          <section>
            <h3>Rating</h3>
            <label className="slider-field">
              <span>
                At least <strong>{draft.minRating ?? 0}</strong> / 100
              </span>
              <input type="range" min={0} max={100} step={5} value={draft.minRating ?? 0} aria-label="Minimum rating" onChange={(e) => set('minRating', Number(e.target.value) || null)} />
            </label>
            <label className="field">
              Rated by at least
              <input className="input" type="number" min={0} placeholder="Any number of people" value={draft.minRatingCount ?? ''} onChange={(e) => set('minRatingCount', num(e.target.value))} />
            </label>
          </section>

          <p className="muted small">Each genre, game mode or theme you pick narrows the list to games that have all of them.</p>
          <section>
            <h3>Genres</h3>
            {options ? <Chips label="Genres" options={options.genres} selected={draft.genreIds} onChange={(v) => set('genreIds', v)} /> : <p className="muted small">Loading…</p>}
          </section>

          <section>
            <h3>Game modes</h3>
            {options ? <Chips label="Game modes" options={options.gameModes} selected={draft.gameModeIds} onChange={(v) => set('gameModeIds', v)} /> : <p className="muted small">Loading…</p>}
          </section>

          <section>
            <h3>Themes</h3>
            {options ? <Chips label="Themes" options={themes} selected={draft.themeIds} onChange={(v) => set('themeIds', v)} /> : <p className="muted small">Loading…</p>}
          </section>

          <section className="adult">
            <div>
              <h3>Adult games</h3>
              <p className="muted small">Erotic games (IGDB’s adult theme). Off by default.</p>
            </div>
            <Toggle label="Show adult games" checked={draft.includeAdult} onChange={(v) => set('includeAdult', v)} />
          </section>
        </div>
        <footer className="panel-foot">
          <button type="button" className="btn" onClick={() => setDraft({ ...DEFAULT_FILTERS })}>
            Reset
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            Apply filters
          </button>
        </footer>
      </aside>
    </div>
  );
}
