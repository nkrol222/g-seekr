import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type CollectionCard, type GameRef, type ImportItem, type ImportJob, type ImportSource, type Platform, type SearchResult } from '../api';
import { Alert, ago, Icon, Poster } from './shared';

type SourceKind = ImportSource['kind'];

const SOURCES: { id: SourceKind; label: string; hint: string }[] = [
  { id: 'titles', label: 'A list of titles', hint: 'One game per line. ROM file names work too: regions, revisions and extensions are ignored.' },
  { id: 'dat', label: 'A No-Intro or Redump DAT', hint: 'The XML file from datomatic.no-intro.org or redump.org. Every game in it is matched; BIOS entries are left out.' },
  { id: 'archive', label: 'An Internet Archive item', hint: 'The item’s address (archive.org/details/…) or its id. Its file names are matched; images and metadata are left out.' },
];

const STATUS_TEXT: Record<ImportJob['status'], string> = { matching: 'Matching', review: 'Waiting for review', saved: 'Saved', failed: 'Stopped' };

// Import a list: pick a source and a platform, then review what IGDB found before it's saved
export function ImportStart({ listId, platformId }: { listId: number | null; platformId: number | null }) {
  const [kind, setKind] = useState<SourceKind>('titles');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [item, setItem] = useState('');
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [platform, setPlatform] = useState<number | ''>(platformId ?? '');
  const [lists, setLists] = useState<CollectionCard[]>([]);
  const [target, setTarget] = useState<number | 'new'>(listId ?? 'new');
  const [name, setName] = useState('');
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.platforms().then(setPlatforms).catch(() => undefined);
    api
      .collections()
      .then((r) => setLists(r.lists))
      .catch(() => undefined);
    api
      .imports()
      .then((r) => setJobs(r.imports))
      .catch(() => undefined);
  }, []);

  const readFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setError('That file is over 15 MB. Split the DAT, or import it in parts.');
      return;
    }
    setText(await file.text());
    setFileName(file.name);
    // A DAT's file name usually says the system: offer it as the list's name
    if (!name) setName(file.name.replace(/\.(dat|xml)$/i, '').replace(/\s*\(\d{8}[-\d]*\)\s*$/, ''));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (platform === '') return;
    setBusy(true);
    setError(null);
    try {
      const source: ImportSource = kind === 'archive' ? { kind, item } : { kind, text };
      const { import: job } = await api.startImport({ ...source, platformId: platform, ...(target === 'new' ? { listName: name } : { listId: target }) });
      window.location.hash = `#/collections/import/${job.id}`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const ready = platform !== '' && (target !== 'new' || name.trim()) && (kind === 'archive' ? item.trim() : text.trim());

  return (
    <>
      <div className="page-title">
        <h1>Import a list</h1>
        <div className="tools">
          <a className="btn" href="#/collections">
            Back to collections
          </a>
        </div>
      </div>
      <form className="import-form" onSubmit={submit}>
        {error && <Alert kind="error">{error}</Alert>}
        <fieldset className="kinds">
          <legend>What are you importing?</legend>
          {SOURCES.map((s) => (
            <label key={s.id} className={kind === s.id ? 'kind active' : 'kind'}>
              <input type="radio" name="source" checked={kind === s.id} onChange={() => (setKind(s.id), setText(''), setFileName(null))} />
              <span>
                {s.label}
                <span className="muted small block">{s.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {kind === 'titles' && (
          <label className="field">
            Titles
            <textarea className="input" rows={10} value={text} placeholder={'Chrono Trigger\nSecret of Mana\nLegend of Zelda, The - A Link to the Past (USA).sfc'} onChange={(e) => setText(e.target.value)} />
          </label>
        )}
        {kind === 'dat' && (
          <label className="field">
            DAT file
            <input className="input" type="file" accept=".dat,.xml,text/xml,application/xml" onChange={(e) => void readFile(e.target.files?.[0])} />
            {fileName && <span className="muted small">{fileName}: {(text.length / 1024).toFixed(0)} KB read</span>}
          </label>
        )}
        {kind === 'archive' && (
          <label className="field">
            Internet Archive item
            <input className="input" value={item} placeholder="https://archive.org/details/…" onChange={(e) => setItem(e.target.value)} />
          </label>
        )}

        <div className="field">
          <label htmlFor="import-platform">Platform</label>
          <select id="import-platform" className="select" value={platform} required aria-describedby="import-platform-hint" onChange={(e) => setPlatform(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Pick the platform the games are for</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span id="import-platform-hint" className="muted small">
            Titles are matched to games on this platform, and the list asks for them on it.
          </span>
        </div>

        <label className="field">
          Save into
          <select className="select" value={target} onChange={(e) => setTarget(e.target.value === 'new' ? 'new' : Number(e.target.value))}>
            <option value="new">A new list</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {target === 'new' && (
          <label className="field">
            Name of the new list
            <input className="input" value={name} maxLength={120} placeholder="e.g. Nintendo - Super Nintendo" onChange={(e) => setName(e.target.value)} />
          </label>
        )}

        <div className="dialog-actions">
          <button type="submit" className="btn primary" disabled={busy || !ready}>
            <Icon name="upload" /> {busy ? 'Reading…' : 'Match on IGDB'}
          </button>
        </div>
        <p className="muted small">
          Matching takes a while for big lists: IGDB answers about 4 titles a second. You can leave the page; the import carries on.
        </p>
      </form>

      {jobs.length > 0 && (
        <section className="slider">
          <div className="slider-head">
            <h2>Recent imports</h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>List</th>
                  <th>Status</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <a href={`#/collections/import/${j.id}`}>{j.source}</a>
                      <span className="muted small block">{j.total} titles</span>
                    </td>
                    <td>{j.listName}</td>
                    <td>
                      {STATUS_TEXT[j.status]}
                      {j.status === 'matching' && ` (${j.done}/${j.total})`}
                    </td>
                    <td>{ago(j.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

type Tab = 'check' | 'matched' | 'skipped' | 'all';
const PAGE = 100;

const needsCheck = (i: ImportItem) => !i.skip && (i.state === 'uncertain' || i.state === 'unmatched');

// What IGDB found for each title: confident matches are chosen; the rest are picked or skipped here
export function ImportReview({ id }: { id: number }) {
  const [job, setJob] = useState<ImportJob | null>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('check');
  const [shown, setShown] = useState(PAGE);
  const [saved, setSaved] = useState<{ listId: number; added: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [platforms, setPlatforms] = useState<Map<number, string>>(new Map());
  // Bumped to follow the matching again after a retry
  const [round, setRound] = useState(0);

  const load = async () => {
    try {
      const r = await api.importReview(id);
      setJob(r.import);
      setItems(r.items);
      return r.import;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  };

  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    const tick = async () => {
      const j = await load();
      if (!stopped && j?.status === 'matching') timer = window.setTimeout(() => void tick(), 2000);
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, round]);

  useEffect(() => {
    api
      .platforms()
      .then((list) => setPlatforms(new Map(list.map((p) => [p.id, p.name]))))
      .catch(() => undefined);
  }, []);

  const counts = useMemo(
    () => ({
      check: items.filter(needsCheck).length,
      matched: items.filter((i) => !i.skip && i.choice).length,
      skipped: items.filter((i) => i.skip).length,
      all: items.length,
    }),
    [items],
  );
  const visible = items.filter((i) => (tab === 'check' ? needsCheck(i) : tab === 'matched' ? !i.skip && i.choice : tab === 'skipped' ? i.skip : true));

  const update = async (idx: number, patch: { choice?: GameRef | null; skip?: boolean }) => {
    setError(null);
    try {
      const { item } = await api.chooseImportItem(id, idx, patch);
      setItems((prev) => prev.map((i) => (i.idx === idx ? item : i)));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (error && !job) return <Alert kind="error">{error}</Alert>;
  if (!job) return <p className="muted">Loading…</p>;

  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <>
      <div className="page-title">
        <h1>Review the import</h1>
        <div className="tools">
          <a className="btn" href="#/collections/import">
            All imports
          </a>
          {job.status !== 'matching' && job.status !== 'saved' && (
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                if (!window.confirm('Throw this import away? Nothing has been saved from it.')) return;
                await api.discardImport(id);
                window.location.hash = '#/collections/import';
              }}
            >
              <Icon name="trash" /> Discard
            </button>
          )}
        </div>
      </div>
      <p className="lead muted">
        {job.source} → <strong>{job.listName}</strong> for {platforms.get(job.platformId) ?? `platform ${job.platformId}`}, {job.total} titles
      </p>
      {error && <Alert kind="error">{error}</Alert>}

      {job.status === 'matching' && (
        <div className="import-progress" role="status">
          <span className="meter" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </span>
          Matching on IGDB: {job.done} of {job.total} ({pct}%). You can leave this page; it carries on.
        </div>
      )}
      {job.status === 'failed' && (
        <Alert kind="error">
          <div>
            Matching stopped at {job.done} of {job.total}: {job.error}{' '}
            <button
              type="button"
              className="btn"
              onClick={async () => {
                try {
                  setJob((await api.retryImport(id)).import);
                  setRound((r) => r + 1);
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              <Icon name="refresh" /> Carry on
            </button>
          </div>
        </Alert>
      )}
      {(job.status === 'saved' || saved) && (
        <Alert kind="success">
          <div>
            {saved ? `Saved ${saved.added} new ${saved.added === 1 ? 'game' : 'games'} to ${job.listName}. ` : 'This import was saved. '}
            {(saved?.listId ?? job.listId) && <a href={`#/collection/list/${saved?.listId ?? job.listId}?platform=${job.platformId}`}>Open the list →</a>}
          </div>
        </Alert>
      )}

      {job.status === 'review' && !saved && (
        <div className="import-summary">
          <span>
            <strong>{counts.matched}</strong> will be saved
          </span>
          <span>
            <strong>{counts.check}</strong> to check
          </span>
          <span>
            <strong>{counts.skipped}</strong> skipped
          </span>
          <button
            type="button"
            className="btn primary"
            disabled={busy || counts.matched === 0}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await api.saveImport(id);
                setSaved({ listId: r.list.id, added: r.added });
                setJob({ ...job, status: 'saved', listId: r.list.id });
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Icon name="check" /> Save {counts.matched} to the list
          </button>
          {counts.check > 0 && <span className="muted small">Titles left unchecked aren’t saved.</span>}
        </div>
      )}

      {job.status !== 'matching' && (
        <>
          <div className="chips import-tabs" role="tablist" aria-label="Show">
            {(
              [
                ['check', 'To check'],
                ['matched', 'Matched'],
                ['skipped', 'Skipped'],
                ['all', 'All'],
              ] as const
            ).map(([t, label]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'chip on' : 'chip'} onClick={() => (setTab(t), setShown(PAGE))}>
                {label} <span className="chip-count">{counts[t]}</span>
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="empty">{tab === 'check' ? 'Nothing left to check.' : 'Nothing here.'}</p>
          ) : (
            <ul className="import-items">
              {visible.slice(0, shown).map((i) => (
                <ImportRow key={i.idx} item={i} editable={job.status === 'review' && !saved} onChange={(patch) => void update(i.idx, patch)} />
              ))}
            </ul>
          )}
          {visible.length > shown && (
            <div className="more">
              <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE)}>
                Show more ({visible.length - shown} left)
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function ImportRow({ item, editable, onChange }: { item: ImportItem; editable: boolean; onChange: (patch: { choice?: GameRef | null; skip?: boolean }) => void }) {
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState(item.title);
  const [found, setFound] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setFound((await api.search(q.trim())).results);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const pick = (g: GameRef) => {
    onChange({ choice: { igdbId: g.igdbId, title: g.title, year: g.year, coverUrl: g.coverUrl } });
    setSearching(false);
    setFound(null);
  };

  const options: (GameRef & { similarity?: number })[] = [...item.candidates];
  if (item.choice && !options.some((c) => c.igdbId === item.choice!.igdbId)) options.unshift(item.choice);

  return (
    <li className={item.skip ? 'import-item skipped' : 'import-item'}>
      <div className="import-title">
        <strong>{item.title}</strong>
        {item.raw !== item.title && <span className="muted small">{item.raw}</span>}
        <span className={`badge ${item.skip ? 'neutral' : item.choice ? 'available' : item.state === 'unmatched' ? 'failed' : 'pending'}`}>
          {item.skip ? 'Skipped' : item.choice ? 'Chosen' : item.state === 'unmatched' ? 'Not found' : 'Check'}
        </span>
      </div>
      {options.length > 0 ? (
        <div className="candidates" role="radiogroup" aria-label={`IGDB games for ${item.title}`}>
          {options.map((c) => {
            const chosen = item.choice?.igdbId === c.igdbId;
            return (
              <button key={c.igdbId} type="button" role="radio" aria-checked={chosen} className={chosen ? 'candidate on' : 'candidate'} disabled={!editable} onClick={() => pick(c)}>
                <span className="thumb">
                  <Poster url={c.coverUrl} title={c.title} />
                </span>
                <span>
                  {c.title}
                  <span className="muted small block">
                    {c.year ?? 'Year unknown'}
                    {c.similarity !== undefined && ` · ${Math.round(c.similarity * 100)}% match`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted small">IGDB found nothing close for this platform.</p>
      )}
      {editable && (
        <div className="import-actions">
          <button type="button" className="btn ghost" onClick={() => setSearching((s) => !s)}>
            <Icon name="search" /> Search IGDB
          </button>
          <button type="button" className="btn ghost" onClick={() => onChange({ skip: !item.skip })}>
            <Icon name={item.skip ? 'refresh' : 'x'} /> {item.skip ? 'Don’t skip' : 'Skip'}
          </button>
        </div>
      )}
      {searching && (
        <div className="import-search">
          <form className="series-search" onSubmit={search}>
            <input className="input" type="search" aria-label="Game title" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="submit" className="btn" disabled={q.trim().length < 2}>
              Search
            </button>
          </form>
          {error && <Alert kind="error">{error}</Alert>}
          {found && found.length === 0 && <p className="muted small">No games found.</p>}
          {found && found.length > 0 && (
            <div className="candidates">
              {found.slice(0, 10).map((g) => (
                <button key={g.igdbId} type="button" className="candidate" onClick={() => pick(g)}>
                  <span className="thumb">
                    <Poster url={g.coverUrl} title={g.title} />
                  </span>
                  <span>
                    {g.title}
                    <span className="muted small block">{g.year ?? 'Year unknown'}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
