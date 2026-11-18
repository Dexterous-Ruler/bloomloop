/** A page that is not ready yet - its screen still loading, or its account: its shape, and no words. */
export default function Waiting() {
  return (
    <div className="app" aria-busy="true">
      <aside className="rail" aria-hidden="true">
        <div className="cluster cluster-3" style={{ padding: '0 8px' }}>
          <span className="mark-tile" />
          <div className="skel" style={{ height: 16, width: 110, background: 'var(--side-cur)' }} />
        </div>
        <div className="stack stack-2" style={{ padding: '0 4px' }}>
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel" style={{ height: 38, borderRadius: 12, background: 'var(--side-hover)' }} />)}
        </div>
      </aside>
      <div className="main">
        <div className="bar" aria-hidden="true"><span className="mark-tile" /></div>
        <div className="page">
          <div className="stack stack-2">
            <div className="skel" style={{ height: 14, width: 140 }} />
            <div className="skel" style={{ height: 32, width: 320, maxWidth: '100%' }} />
          </div>
          <div className="skel" style={{ height: 200, borderRadius: 'var(--r-5)' }} />
          <div className="grid-2">
            <div className="skel" style={{ height: 260, borderRadius: 'var(--r-4)' }} />
            <div className="skel" style={{ height: 260, borderRadius: 'var(--r-4)' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
