/**
 * Illustrations for each sales setting, drawn as inline SVG (no image files, no inline styles).
 * Hero scenes are 190×290 and animate within the hero's 16-second loop; channel icons are 44×44
 * and pop in when their section appears. All motion is CSS and stops under prefers-reduced-motion.
 */
export type SceneKind = 'phone' | 'meeting' | 'store' | 'door';

export function SceneArt({ kind, number }: { kind: SceneKind; number: string }) {
  if (kind === 'door') return <DoorArt number={number} />;
  if (kind === 'phone') return <PhoneArt />;
  if (kind === 'meeting') return <MeetingArt />;
  return <StoreArt />;
}

function DoorArt({ number }: { number: string }) {
  return (
    <div className="lp-house" aria-hidden="true">
      <div className="lp-fanlight" />
      <div className="lp-frame">
        <div className="lp-hall" />
        <div className="lp-door">
          <span className="lp-door-number">{number}</span>
          <span className="lp-panel lp-panel-a" />
          <span className="lp-panel lp-panel-b" />
          <span className="lp-knob" />
        </div>
      </div>
      <div className="lp-step" />
    </div>
  );
}

const PANEL = 'M0 20 Q0 0 20 0 H170 Q190 0 190 20 V290 H0 Z';

function PhoneArt() {
  return (
    <svg className="lp-art lp-art-phone" viewBox="0 0 190 290" aria-hidden="true">
      <path d={PANEL} className="art-panel-teal" />
      <g className="art-rings">
        <path d="M150 52 a18 18 0 0 1 14 18" /><path d="M156 40 a32 32 0 0 1 22 30" />
        <path d="M40 52 a18 18 0 0 0 -14 18" /><path d="M34 40 a32 32 0 0 0 -22 30" />
      </g>
      <g className="art-phone-body">
        <rect x="45" y="40" width="100" height="200" rx="18" className="art-ink" />
        <rect x="52" y="56" width="86" height="168" rx="10" className="art-screen" />
        <rect x="80" y="46" width="30" height="5" rx="2.5" className="art-notch" />
        <circle cx="95" cy="100" r="19" className="art-mustard" />
        <text x="95" y="106" className="art-initial">C</text>
        <text x="95" y="138" className="art-caption">Customer</text>
        <text x="95" y="154" className="art-status art-status-calling">Calling…</text>
        <text x="95" y="154" className="art-status art-status-live">On call</text>
        <g className="art-wave">
          <rect x="70" y="170" width="6" height="22" rx="3" /><rect x="80" y="170" width="6" height="22" rx="3" />
          <rect x="90" y="170" width="6" height="22" rx="3" /><rect x="100" y="170" width="6" height="22" rx="3" />
          <rect x="110" y="170" width="6" height="22" rx="3" />
        </g>
        <circle cx="95" cy="208" r="9" className="art-red" />
        <rect x="90" y="206.5" width="10" height="3" rx="1.5" className="art-white" />
      </g>
      <rect x="0" y="272" width="190" height="18" className="art-ground" />
    </svg>
  );
}

function MeetingArt() {
  return (
    <svg className="lp-art lp-art-meeting" viewBox="0 0 190 290" aria-hidden="true">
      <path d={PANEL} className="art-panel-cobalt" />
      <rect x="22" y="34" width="62" height="78" rx="4" className="art-window" />
      <path d="M53 34 V112 M22 73 H84" className="art-window-bars" />
      <rect x="112" y="46" width="52" height="40" rx="3" className="art-white" />
      <path d="M120 76 L132 64 L142 70 L156 54" className="art-trend" />
      <g className="art-laptop">
        <rect x="52" y="140" width="86" height="58" rx="5" className="art-ink" />
        <rect x="58" y="146" width="74" height="46" rx="2" className="art-screen" />
        <g className="art-bars">
          <rect x="68" y="168" width="10" height="18" className="art-bar art-bar-1" />
          <rect x="84" y="160" width="10" height="26" className="art-bar art-bar-2" />
          <rect x="100" y="152" width="10" height="34" className="art-bar art-bar-3" />
          <rect x="116" y="164" width="10" height="22" className="art-bar art-bar-4" />
        </g>
        <path d="M40 198 H150 L144 206 H46 Z" className="art-ink" />
      </g>
      <g className="art-cup">
        <path d="M150 182 h22 v18 a8 8 0 0 1 -8 8 h-6 a8 8 0 0 1 -8 -8 Z" className="art-white-stroke" />
        <path d="M172 186 a6 6 0 0 1 0 12" className="art-stroke" />
        <path className="art-steam art-steam-1" d="M156 176 q-4 -6 0 -12 q4 -6 0 -12" />
        <path className="art-steam art-steam-2" d="M166 176 q-4 -6 0 -12 q4 -6 0 -12" />
      </g>
      <rect x="0" y="208" width="190" height="14" className="art-table" />
      <rect x="18" y="222" width="10" height="68" className="art-table-leg" />
      <rect x="162" y="222" width="10" height="68" className="art-table-leg" />
    </svg>
  );
}

function StoreArt() {
  return (
    <svg className="lp-art lp-art-store" viewBox="0 0 190 290" aria-hidden="true">
      <path d={PANEL} className="art-panel-red" />
      <rect x="14" y="22" width="162" height="22" rx="4" className="art-white" />
      <text x="95" y="38" className="art-sign">The Shop</text>
      <g className="art-awning">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <g key={n}>
            <rect x={8 + n * 29} y="50" width="29" height="26" className={n % 2 ? 'art-white' : 'art-mustard'} />
            <circle cx={22.5 + n * 29} cy="76" r="14.5" className={n % 2 ? 'art-white' : 'art-mustard'} />
          </g>
        ))}
      </g>
      <rect x="18" y="104" width="96" height="78" rx="3" className="art-window" />
      <rect x="28" y="146" width="22" height="28" rx="2" className="art-box-teal" />
      <rect x="56" y="132" width="26" height="42" rx="2" className="art-box-cobalt" />
      <rect x="88" y="152" width="18" height="22" rx="2" className="art-box-mustard" />
      <rect x="124" y="104" width="50" height="168" rx="3" className="art-ink" />
      <rect x="130" y="112" width="38" height="70" rx="2" className="art-window" />
      <circle cx="164" cy="200" r="3.5" className="art-brass" />
      <g className="art-open">
        <path d="M137 120 L149 108 L161 120" className="art-string" />
        <rect x="134" y="120" width="30" height="16" rx="2" className="art-white" />
        <text x="149" y="132" className="art-open-text">OPEN</text>
      </g>
      <g className="art-bag">
        <path d="M34 212 q0 -14 12 -14 q12 0 12 14" className="art-stroke-ink" />
        <rect x="26" y="210" width="40" height="44" rx="4" className="art-bag-body" />
      </g>
      <rect x="0" y="272" width="190" height="18" className="art-ground" />
    </svg>
  );
}

export type ChannelIconKind = 'door' | 'phone' | 'bag' | 'briefcase' | 'pin' | 'stand' | 'video';

export function ChannelIcon({ kind }: { kind: ChannelIconKind }) {
  return (
    <svg className={`lp-icon lp-icon-${kind}`} viewBox="0 0 44 44" aria-hidden="true">
      {kind === 'door' && (<><rect x="12" y="6" width="20" height="34" rx="2" className="ic-fill" /><circle cx="27" cy="24" r="1.8" className="ic-dot" /><path d="M8 40 H36" className="ic-line" /></>)}
      {kind === 'phone' && (<><rect x="13" y="5" width="18" height="34" rx="4" className="ic-fill" /><rect x="16" y="10" width="12" height="20" rx="1.5" className="ic-screen" /><path d="M34 12 a7 7 0 0 1 4 6 M36 7 a12 12 0 0 1 6 11" className="ic-line ic-ring" /></>)}
      {kind === 'bag' && (<><path d="M16 16 q0 -9 6 -9 q6 0 6 9" className="ic-line" /><path d="M9 15 H35 L33 39 H11 Z" className="ic-fill" /></>)}
      {kind === 'briefcase' && (<><path d="M17 13 v-4 h10 v4" className="ic-line" /><rect x="6" y="13" width="32" height="24" rx="3" className="ic-fill" /><path d="M6 23 H38" className="ic-line-light" /></>)}
      {kind === 'pin' && (<><path d="M22 40 C12 28 10 22 10 18 a12 12 0 0 1 24 0 c0 4 -2 10 -12 22 Z" className="ic-fill" /><path d="M17 21 l5 -5 l5 5 v5 h-10 Z" className="ic-screen" /></>)}
      {kind === 'stand' && (<><path d="M6 16 L22 6 L38 16 Z" className="ic-fill" /><rect x="9" y="16" width="26" height="18" className="ic-screen" /><path d="M6 16 H38 M9 38 V16 M35 38 V16" className="ic-line" /></>)}
      {kind === 'video' && (<><rect x="5" y="12" width="24" height="20" rx="3" className="ic-fill" /><path d="M29 19 L39 13 V31 L29 25 Z" className="ic-fill" /><circle cx="11" cy="17" r="2" className="ic-dot ic-rec" /></>)}
    </svg>
  );
}
