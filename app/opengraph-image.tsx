import { ImageResponse } from 'next/og';

/** The picture shown when a PitchReady link is shared (WhatsApp, LinkedIn, iMessage…). */
export const alt = 'PitchReady: practise the pitch before the real one';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const dynamic = 'force-dynamic';

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#14213D', color: '#fff', padding: 72 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', width: 72, height: 72, borderRadius: 18, background: '#f2b705', color: '#14213D', fontSize: 48, fontWeight: 800, alignItems: 'center', justifyContent: 'center' }}>P</div>
          <div style={{ display: 'flex', fontSize: 44, fontWeight: 800 }}>PitchReady</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', fontSize: 84, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>Practise the pitch before the real one.</div>
          <div style={{ display: 'flex', fontSize: 34, color: '#d7deee', lineHeight: 1.3 }}>An AI customer for every kind of sales conversation, with feedback that quotes your own words.</div>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          {['Doorstep', 'Phone', 'Shop floor', 'Meetings'].map((t, i) => (
            <div key={t} style={{ display: 'flex', padding: '10px 22px', borderRadius: 999, fontSize: 26, fontWeight: 700, color: i === 3 ? '#14213D' : '#fff', background: ['#0f766e', '#d62839', '#2f5bea', '#f2b705'][i] }}>{t}</div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
