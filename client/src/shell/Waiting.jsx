/** A page that is not ready yet - its screen still loading, or its account: its shape, and no words. */
export default function Waiting() {
  return (
    <div className="app" aria-busy="true">
      <aside className="rail" aria-hidden="true">
        <div className="rail-top"><span className="mark-tile" /></div>
        <div className="rail-scroll stack stack-2">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} style={{ height: 30, borderRadius: 7, background: 'rgba(255,255,255,0.05)' }} />)}
        </div>
      </aside>
      <div className="main">
        <div className="top" aria-hidden="true"><div className="skel" style={{ height: 36, width: 360, maxWidth: '60%', borderRadius: 10 }} /></div>
        <div className="scroll">
          <div className="page">
            <div className="stack stack-2">
              <div className="skel" style={{ height: 12, width: 160 }} />
              <div className="skel" style={{ height: 30, width: 300, maxWidth: '100%' }} />
              <div className="skel" style={{ height: 14, width: 420, maxWidth: '100%' }} />
            </div>
            <div className="skel" style={{ height: 240, borderRadius: 16 }} />
            <div className="grid-2">
              <div className="skel" style={{ height: 280, borderRadius: 14 }} />
              <div className="skel" style={{ height: 280, borderRadius: 14 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
