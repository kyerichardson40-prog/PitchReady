import { ImageResponse } from 'next/og';
import { BRAND_MARK_HEIGHT, BRAND_MARK_PNG, BRAND_MARK_WIDTH } from '../lib/content/brand-mark.ts';

/** The picture shown when a PitchReady link is shared (WhatsApp, LinkedIn, iMessage…). Brand colours: navy #011F45, mint #00C79C. */
export const alt = 'PitchReady: practise the pitch before the real one';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const dynamic = 'force-dynamic';

const NAVY = '#011F45';
const MINT = '#00C79C';

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: NAVY, color: '#fff', padding: 72 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {/* The mark is navy, so it sits on a white tile to stay visible on the navy background. */}
          <div style={{ display: 'flex', width: 96, height: 96, borderRadius: 22, background: '#fff', alignItems: 'center', justifyContent: 'center' }}>
            <img src={BRAND_MARK_PNG} width={Math.round(BRAND_MARK_WIDTH * 0.55)} height={Math.round(BRAND_MARK_HEIGHT * 0.55)} alt="" />
          </div>
          <div style={{ display: 'flex', fontSize: 52, fontWeight: 800, letterSpacing: -1 }}>
            <span>Pitch</span><span style={{ color: MINT, marginLeft: -12 }}>Ready</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', fontSize: 84, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>Practise the pitch before the real one.</div>
          <div style={{ display: 'flex', fontSize: 34, color: '#cfd8e6', lineHeight: 1.3 }}>An AI customer for every kind of sales conversation, with feedback that quotes your own words.</div>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          {['Doorstep', 'Phone', 'Shop floor', 'Meetings'].map((t) => (
            <div key={t} style={{ display: 'flex', padding: '10px 24px', borderRadius: 999, fontSize: 26, fontWeight: 700, color: NAVY, background: MINT }}>{t}</div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
