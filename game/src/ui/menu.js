// ===========================================================================
// AETHER RIFT — front end (title screen + how-to-play)
//
// Self-contained UI module: it builds its own DOM, appends it to <body> and
// needs no markup in index.html. Pure CSS/SVG, system fonts, no network calls
// beyond its own stylesheet.
//
//   import { createMenu } from './ui/menu.js';
//   const menu = createMenu({ onPlay: () => { ...start the match... } });
//   menu.show();            // title screen
//   menu.showRules();       // straight to how-to-play
//   menu.hide();            // tear the overlay down (keeps the DOM alive)
//
// Every number quoted on the rules screen is read off src/game/sim.js,
// src/game/controls.js and src/entities/units.js — if the sim is retuned, the
// copy in PAGES is what has to follow it.
// ===========================================================================

const CSS_URL = new URL('../../css/menu.css', import.meta.url).href;

// The stylesheet is normally linked from index.html (no flash of unstyled
// markup). If the host page did not link it, pull it in ourselves so the
// module still works standalone.
function ensureStyles() {
  const links = document.querySelectorAll('link[rel="stylesheet"]');
  for (let i = 0; i < links.length; i++) {
    if ((links[i].getAttribute('href') || '').indexOf('menu.css') >= 0) return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_URL;
  link.setAttribute('data-ar-menu', '');
  document.head.appendChild(link);
}

// --------------------------------------------------------------- iconography
// The ability glyphs are the same artwork the in-game cluster uses (index.html)
// — re-declared here with namespaced gradient/clip ids so the two copies can
// live on the same page without stealing each other's paint servers.
const glyph = (k, body) => `<svg viewBox="0 0 24 24" aria-hidden="true"><defs>` +
  `<linearGradient id="armG${k}" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="currentColor"/>` +
  `<stop offset="1" stop-color="currentColor" stop-opacity=".78"/></linearGradient>` +
  `<g id="armA${k}">${body}</g>` +
  `<clipPath id="armC${k}"><path d="M0 0H24L0 24Z"/></clipPath></defs>` +
  `<use href="#armA${k}" fill="none" stroke="#2a1a10" stroke-width="1.2" stroke-linejoin="round"/>` +
  `<use href="#armA${k}" fill="url(#armG${k})"/>` +
  `<g clip-path="url(#armC${k})"><use href="#armA${k}" transform="translate(-.45 -.45)" ` +
  `fill="none" stroke="#fff" stroke-opacity=".3" stroke-width=".9" stroke-linejoin="round"/></g></svg>`;

const ICON = {
  // Q · crescent slash: one heavy sweep with two trailing echoes
  Q: glyph('Q',
    '<path d="M2.6 19.9A15 15 0 0 1 20.4 4A44 44 0 0 0 2.6 19.9Z"/>' +
    '<path opacity=".5" d="M7.6 22.4A13.6 13.6 0 0 1 22.7 9A22.6 22.6 0 0 0 7.6 22.4Z"/>' +
    '<path opacity=".28" d="M13.4 23.4A10.6 10.6 0 0 1 23.4 14.4A17.7 17.7 0 0 0 13.4 23.4Z"/>'),
  // W · dash-strike: blade lunging up-right, motion streaks behind
  W: glyph('W',
    '<path d="M19.24 4.76L17.49 8.7L11.76 14.25L9.75 12.24L15.3 6.51ZM13.73 15.22L12.39 15.87L8.13 11.61' +
    'L8.78 10.27ZM10.77 14.25L8.22 16.65L7.35 15.78L9.75 13.23ZM8.54 16.71a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 1 1 2.5 0Z"/>' +
    '<path opacity=".85" d="M6.63 7.37L2 13.2L0.8 12Z"/>' +
    '<path opacity=".62" d="M5.24 14.16L1.49 18.89L0.51 17.91Z"/>' +
    '<path opacity=".62" d="M11.04 18.56L7.29 23.29L6.31 22.31Z"/>'),
  // E · blade-storm: three curved blades whirling off a hub
  E: glyph('E',
    '<path d="M11.1 9.77Q11.32 2.22 20.73 4.67Q15.1 6.17 12.75 9.93Z"/>' +
    '<path d="M14.38 12.33Q20.81 16.3 13.98 23.23Q15.5 17.6 13.41 13.69Z"/>' +
    '<path d="M10.52 13.89Q3.88 17.48 1.29 8.1Q5.4 12.23 9.83 12.38Z"/>' +
    '<path opacity=".4" d="M21.92 5.8Q23.41 8.29 23.67 11.18L22.27 11.28Q22.08 8.72 20.73 6.54Z"/>' +
    '<path opacity=".4" d="M12.41 23.69Q9.51 23.74 6.87 22.52L7.48 21.26Q9.8 22.37 12.36 22.29Z"/>' +
    '<path opacity=".4" d="M1.67 6.51Q3.08 3.97 5.46 2.3L6.24 3.46Q4.12 4.91 2.91 7.16Z"/>' +
    '<path d="M12 8.4 15.6 12 12 15.6 8.4 12Z"/>'),
  // R · Dawnfall: point-down blade driven into a shock ring
  R: glyph('R',
    '<path d="M12 18L9.9 6.3L14.1 6.3Z"/><path d="M8.4 4.2H15.6V6.3H8.4Z"/>' +
    '<path d="M11.2 1.7h1.6v2.7h-1.6Z"/><path d="M13.35 1.7 12 3.1 10.65 1.7 12 .5Z"/>' +
    '<path d="M12 15.9c4.53 0 8.2 1.39 8.2 3.1s-3.67 3.1-8.2 3.1-8.2-1.39-8.2-3.1 3.67-3.1 8.2-3.1Zm0 1.7' +
    'c-3.36 0-6.1.83-6.1 1.4s2.74 1.4 6.1 1.4 6.1-.83 6.1-1.4-2.74-1.4-6.1-1.4Z"/>' +
    '<path opacity=".82" d="M0.7 11.2L5.6 14.6L4.2 15.9Z"/>' +
    '<path opacity=".82" d="M23.3 11.2L18.4 14.6L19.8 15.9Z"/>' +
    '<path opacity=".82" d="M8.2 23.6L10.9 20.4L13.1 20.4L15.8 23.6Z"/>'),
  // A · basic attack: upright blade over a swing arc
  A: glyph('A',
    '<path opacity=".42" d="M2.6 20.6A12.5 12.5 0 0 1 9.4 1.6A26 26 0 0 0 2.6 20.6Z"/>' +
    '<path d="M13.6 3.4L15.4 8.08L15.26 17.8L11.94 17.8L11.8 8.08ZM17.5 17.1L16.95 18.5L10.25 18.5L9.7 17.1Z' +
    'M14.45 18.5L14.33 22L12.87 22L12.75 18.5ZM14.85 22.7a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 1 1 2.5 0Z"/>'),
};

// ------------------------------------------------------------------ filigree
// Mirrored scrollwork divider: fading hairline → curl → leaf → centre diamond.
const FLOURISH = `<svg class="arFlourish" viewBox="0 0 340 20" aria-hidden="true" fill="none">
  <defs>
    <linearGradient id="armFade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="currentColor" stop-opacity="0"/>
      <stop offset="1" stop-color="currentColor" stop-opacity=".9"/>
    </linearGradient>
    <g id="armHalf">
      <path d="M4 10.5H112" stroke="url(#armFade)" stroke-width="1.15"/>
      <path d="M112 10.5c10.5 0 13.5-6.4 24-6.4 6.6 0 10.4 3.6 10.4 7 0 3.2-2.6 5.4-5.6 5.4-2.9 0-5-2.1-5-4.7 0-2.2 1.5-3.9 3.4-4.3"
            stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".92"/>
      <path d="M116 10.5c6.2 2.7 11.4 3.3 17.6 2.2-4.8 3.6-12.6 2.9-17.6-2.2Z" fill="currentColor" opacity=".55"/>
      <circle cx="112" cy="10.5" r="1.5" fill="currentColor" opacity=".9"/>
    </g>
  </defs>
  <use href="#armHalf"/>
  <use href="#armHalf" transform="translate(340,0) scale(-1,1)"/>
  <path d="M170 2.4 176.6 10.5 170 18.6 163.4 10.5Z" fill="currentColor"/>
  <path d="M170 5.6 174 10.5 170 15.4 166 10.5Z" fill="#0a0f1c" opacity=".55"/>
  <path d="M158 10.5 161 7.9V13.1ZM182 10.5 179 7.9V13.1Z" fill="currentColor" opacity=".8"/>
</svg>`;

// corner bracket ornament (top-left orientation; the other three are flipped)
const CORNER = `<svg viewBox="0 0 74 74" fill="none" aria-hidden="true">
  <path d="M2 26V6.5C2 4 4 2 6.5 2H26" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M8 34V12.5C8 10.6 9.6 9 11.5 9H33" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity=".55"/>
  <path d="M8.5 8.5 12 5 15.5 8.5 12 12Z" fill="currentColor"/>
  <path d="M26 2c8 0 11.5 3.4 17.5 3.4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity=".7"/>
  <path d="M2 26c0 8 3.4 11.5 3.4 17.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity=".7"/>
  <path d="M20 9.5c4.4 0 7 2.4 7 5.6 0 2.2-1.6 3.7-3.5 3.7-1.7 0-3-1.2-3-2.8"
        stroke="currentColor" stroke-width=".9" stroke-linecap="round" opacity=".5"/>
</svg>`;

const SCROLL_ICO = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M5.4 3.2h10.2a2.4 2.4 0 0 1 2.4 2.4v13a2.2 2.2 0 0 0 2.2 2.2H7.6a2.2 2.2 0 0 1-2.2-2.2Z"
        stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M8.4 7.4h6.6M8.4 10.6h6.6M8.4 13.8h4.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
</svg>`;

const BACK_ICO = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M14.5 5 8 12l6.5 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// ---------------------------------------------------------------- lane chart
// Single lane, 114 units end to end. Positions are the arena's real x values
// (arena.js: NEXUS_X 46.5, TOWER_INNER_X 33, TOWER_OUTER_X 18) mapped to %.
const lanePct = (x) => (50 + (x / 114) * 100).toFixed(1) + '%';
const laneNode = (x, cls, label) =>
  `<span class="arLaneNode ${cls}" style="left:${lanePct(x)}"><i></i><b>${label}</b></span>`;

const LANE = `<div class="arLane" aria-hidden="true">
  <div class="arLaneEnds"><span class="blue">DAWN — YOU</span><span class="red">EMBER — BOT</span></div>
  <div class="arLaneTrack">
    <div class="arLaneBand"></div>
    <div class="arLaneRiver"></div>
    ${laneNode(-46.5, 'nx blue', 'NEXUS')}
    ${laneNode(-33, 'tw blue', 'INNER')}
    ${laneNode(-18, 'tw blue', 'OUTER')}
    ${laneNode(0, 'rv', 'RIVER')}
    ${laneNode(18, 'tw red', 'OUTER')}
    ${laneNode(33, 'tw red', 'INNER')}
    ${laneNode(46.5, 'nx red', 'NEXUS')}
  </div>
</div>`;

// ===================================================================== pages
// Card helpers keep the copy readable: <b> emphasis, <u> a number worth
// remembering, <em> a control/keyboard tell.
const card = (title, body, cls) =>
  `<article class="arCard${cls ? ' ' + cls : ''}"><h3 class="arCardT"><i></i>${title}</h3>${body}</article>`;

const abilityCard = (key, name, tag, chips, body) => `
  <article class="arCard arAb arAb${key}">
    <div class="arAbTop">
      <span class="arAbIcon">
        <span class="arAbRim"></span>
        <span class="arAbFace">${ICON[key]}</span>
        <span class="arAbKeyBadge">${key}</span>
      </span>
      <div class="arAbId">
        <div class="arAbName">${name}<small>${tag}</small></div>
        <div class="arChips">${chips.map((c) => `<span class="arChip${c[2] ? ' lock' : ''}"><i>${c[0]}</i>${c[1]}</span>`).join('')}</div>
      </div>
    </div>
    ${body}
  </article>`;

const PAGES = [
  {
    id: 'basics',
    tab: 'CONTROLS',
    cols: '',
    html:
      card('MOVE — LEFT THUMB',
        `<p>Press anywhere on the <b>left half of the screen</b> and the stick spawns under your thumb and follows it. ` +
        `It reads <b>direction, not distance</b>: past a small dead zone Sera is already at <u>82%</u> of her <u>7.0 u/s</u> run, ` +
        `and flat out by <u>42%</u> of the throw. Lift off to stop — she decelerates over about <u>0.07 s</u>, so she drifts, she never snaps.</p>` +
        `<div class="arKeys"><span class="arKey"><b>W A S D</b> move</span><span class="arKey"><b>↑ ← ↓ →</b> move</span></div>`) +
      card('ATTACK — RIGHT THUMB',
        `<p>Hold the big blade button. Sera walks into range (<u>3 u</u>) and swings at the smartest target: first a minion the swing ` +
        `would <b>execute</b>, then the enemy champion if they are the one hitting you, otherwise whatever is nearest within <u>8 u</u>. ` +
        `Holding re-swings every <u>0.25 s</u>.</p>` +
        `<div class="arKeys"><span class="arKey"><b>SPACE</b> attack</span><span class="arKey"><b>J</b> attack</span></div>`) +
      card('THE 3-HIT CHAIN',
        `<p>Every <b>third</b> swing is a finisher: <u>×1.4</u> damage, a gold crit number and a kick of screen shake. ` +
        `The chain resets if you go <u>3 s</u> without connecting. Base attack damage is <u>60 + 7</u> per level, at <u>0.93</u> swings/s rising with level.</p>` +
        `<p><b>Cancel the follow-through.</b> Moving or casting cuts the recovery frames — attack, step, attack loses nothing.</p>`) +
      card('CASTING',
        `<p>Tap an ability to <b>smart-cast</b>: it fires along the stick if you are holding one, otherwise at the nearest enemy in range, ` +
        `otherwise straight ahead. A press up to <u>0.35 s</u> early is <b>buffered</b>, not eaten — tapping as the cooldown closes still works.</p>` +
        `<div class="arKeys"><span class="arKey"><b>Q</b></span><span class="arKey"><b>F</b> / <b>⇧W</b> dash</span><span class="arKey"><b>E</b></span><span class="arKey"><b>R</b></span><span class="arKey"><b>1–4</b></span></div>`),
  },
  {
    id: 'abilities',
    tab: 'ABILITIES',
    cols: '',
    html:
      abilityCard('Q', 'Crescent Slash', 'CONE · MAGIC',
        [['CD', '5.5s'], ['MANA', '20'], ['RANGE', '5.4u']],
        `<p>A <u>0.24 s</u> wind-up paints a ring the enemy can read, then a wide cone sweep. It lands in two bands — inside <u>3 u</u> ` +
        `on the swing, the rest a beat later. <b>50 + 30/rank + 60% AD.</b> Ranks 3 / 6 / 9 / 12.</p>`) +
      abilityCard('W', 'Dash Strike', 'DASH · MAGIC',
        [['CD', '9.5s'], ['MANA', '25'], ['DASH', '7.6u']],
        `<p><u>0.28 s</u> at <u>27 u/s</u>, cutting everything she passes <b>once each</b> for <b>40 + 22/rank + 50% AD</b>. ` +
        `Through fights, not buildings — your gap-closer and your one fast way <b>out</b> of a tower. Ranks 4 / 7 / 10 / 13.</p>`) +
      abilityCard('E', 'Blade Storm', 'AOE · MAGIC',
        [['CD', '11s'], ['MANA', '30'], ['RADIUS', '4.0u']],
        `<p>She spins <u>0.95 s</u> and pulses <b>three times</b> in a <u>4 u</u> ring for <b>12 + 8/rank + 18% AD</b> each, and you keep ` +
        `walking at <u>75%</u> speed while it runs. The wave-clear button. Ranks 5 / 8 / 11 / 14.</p>`) +
      abilityCard('R', 'Dawnfall', 'ULTIMATE · LEAP',
        [['CD', '46s'], ['MANA', '60'], ['LEAP', '7.2u'], ['UNLOCK', 'LV 5', 1]],
        `<p>Crouch, leap onto the telegraphed circle, drive the blade home: <b>180 + 120/rank + 100% AD</b> inside <u>5.8 u</u>, with a ` +
        `shockwave, a crater and a hard shake. Locked until <b>level 5</b>; upgrades at <b>9</b> and <b>13</b>.</p>`) +
      `<div class="arNote"><b>MANA</b> — pool <u>120 (+14/level)</u>, regen <u>2.2 + 0.25/level</u> per second. A full Q+W+E+R rotation costs <u>135</u>: ` +
      `at level 1 you cannot pay for it, so laning is autos first, Q second.</div>`,
  },
  {
    id: 'lane',
    tab: 'THE LANE',
    cols: '',
    html:
      card('WAVES',
        `<p>Both bases send <b>3 melee + 2 casters</b> down the single lane. First wave at <u>0:08</u>, then one every <u>24 s</u> — ` +
        `every <u>20 s</u> past 6 minutes, <u>17 s</u> past 11, so a lead can be cashed in. Minions harden with the clock: melee ` +
        `<u>190 HP</u> (+16/min), casters <u>125 HP</u> (+12/min) with a <u>6.4 u</u> bolt.</p>`) +
      card('LAST HITS ARE THE GOLD',
        `<p>Gold only drops for the <b>killing blow</b> — that is the whole game of laning.</p>` +
        `<div class="arStats">` +
        `<div class="arStat"><b>24</b><span>MELEE</span></div>` +
        `<div class="arStat"><b>32</b><span>CASTER</span></div>` +
        `<div class="arStat"><b>62</b><span>SIEGE</span></div>` +
        `<div class="arStat"><b>250</b><span>TOWER</span></div>` +
        `</div>` +
        `<p>The helm counter top-right is your <b>CS</b>. A champion kill pays <u>180 + 26</u> per victim level.</p>`) +
      card('XP & LEVELS',
        `<p>XP is shared by <b>presence</b>, not by last hit: stand within <u>9.5 u</u> of a dying minion and you bank it ` +
        `(<u>42</u> melee / <u>38</u> caster / <u>110</u> siege). Levels run <b>1 → 15</b>; each one adds <u>105 HP</u>, <u>14</u> mana, ` +
        `<u>7</u> attack damage and an ability rank. Leaving lane to heal is how you fall behind.</p>`) +
      card('STAYING IN LANE',
        `<p>Out of combat for <u>5 s</u> you regenerate <u>3%</u> of max HP per second — backing off behind your tower beats walking home. ` +
        `<b>Mend</b> restores <u>25%</u> instantly (<u>100 s</u>); <b>Recall</b> channels <u>5 s</u> and breaks if you move or take a hit.</p>` +
        `<p>Your fountain heals <u>15%</u>/s; the enemy's <b>executes</b> intruders for <u>220 + 6%</u> max HP twice a second. Dying costs ` +
        `<u>5 + 2</u> per level seconds, up to <u>40</u>.</p>`),
  },
  {
    id: 'objectives',
    tab: 'OBJECTIVES',
    cols: 'arCols3',
    html:
      card('ONE LANE, SIX BUILDINGS',
        `<p>Push right: <b>outer</b> tower, <b>inner</b> tower, then the crystal. The lane is <u>114 u</u> end to end with the river at the middle.</p>` + LANE) +
      card('WIN CONDITION',
        `<p>Break an <b>inner tower</b> and two things happen: that nexus loses its immunity, and the attacker's waves gain a <b>siege minion</b>.</p>` +
        `<p>Then take the crystal — <u>2800 HP</u>. <b>Shatter the Ember nexus to win;</b> if the Dawn nexus falls, the match is lost.</p>`) +
      card('TOWERS & AGGRO',
        `<p>Range <u>9.6 u</u>. Outer <u>1950 HP</u>, inner <u>2400 HP</u>, and toppling one pays your side <u>250</u> gold.</p>` +
        `<p>They shoot <b>minions first</b> — but hit an enemy champion inside a tower's reach and that tower, plus every enemy minion nearby, comes for <b>you</b> for <u>4 s</u>.</p>`) +
      card('THE ANTI-DIVE RAMP',
        `<p>Every consecutive shot a tower lands on a champion hits <u>25%</u> harder, about one a second:</p>` +
        `<div class="arRamp"><b>100</b><i></i><b>125</b><i></i><b>156</b><i></i><b>195</b><i></i><b>244</b><i></i><b>305</b></div>` +
        `<p>Diving is fine. <b>Staying</b> is what kills you.</p>`) +
      card('FORTIFICATION',
        `<p>Buildings are fortified against champions: your autos and abilities land for <u>48%</u> of their damage, while <b>minions hit for 140%</b>. ` +
        `You cannot meaningfully solo a tower — siege behind your wave or you are just feeding the gun.</p>`),
  },
];

// ======================================================================== DOM
function buildMarkup() {
  const petals = [];
  // deterministic scatter: no RNG, so two boots look identical (screenshots)
  const P = [
    [4, 17.5, -3.2, 9, 62, 0.62], [13, 21, -9.4, 7, -48, 0.5], [22, 15.5, -14.6, 11, 84, 0.7],
    [31, 24, -6.1, 8, -70, 0.44], [39, 19, -17.9, 12, 40, 0.66], [48, 22.5, -11.3, 7, -92, 0.52],
    [56, 16.5, -1.4, 10, 74, 0.6], [64, 25, -20.5, 9, -36, 0.42], [72, 18.5, -8.8, 13, 96, 0.68],
    [81, 20.5, -15.2, 8, -58, 0.5], [89, 23.5, -4.7, 10, 52, 0.58], [96, 17, -12.6, 7, -80, 0.46],
    [8, 26, -22.4, 6, 30, 0.34], [45, 28, -25.1, 6, -26, 0.3], [77, 27, -19.7, 6, 44, 0.32],
  ];
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    petals.push(`<span class="arPetal" style="--x:${p[0]}%;--t:${p[1]}s;--d:${p[2]}s;--w:${p[3]}px;--dx:${p[4]}px;--o:${p[5]};--r:${(4 + (i % 5) * 0.9).toFixed(1)}s"><b></b></span>`);
  }
  const M = [
    [11, 14, -5.5, 4, -26, 0.7], [27, 18, -12.1, 3, 18, 0.55], [43, 16, -2.4, 5, -34, 0.75],
    [59, 20, -15.8, 3, 22, 0.5], [69, 15, -8.2, 4, -18, 0.68], [86, 19, -11.4, 3, 30, 0.52],
    [94, 17, -6.6, 4, -24, 0.6],
  ];
  for (let i = 0; i < M.length; i++) {
    const m = M[i];
    petals.push(`<span class="arMote" style="--x:${m[0]}%;--t:${m[1]}s;--d:${m[2]}s;--w:${m[3]}px;--dx:${m[4]}px;--o:${m[5]};--r:${(5 + (i % 4)).toFixed(1)}s"><b></b></span>`);
  }

  const tabs = PAGES.map((p, i) =>
    `<button class="arTab${i === 0 ? ' on' : ''}" type="button" data-tab="${i}" role="tab" aria-selected="${i === 0}">` +
    `<span class="arTabDot"></span>${p.tab}</button>`).join('');

  const pages = PAGES.map((p, i) =>
    `<section class="arPage${i === 0 ? ' on' : ''} ${p.cols}" data-page="${i}" role="tabpanel">${p.html}</section>`).join('');

  return `
<div class="arFx">
  <div class="arVig"></div>
  <div class="arGrade"></div>
  <div class="arRays"><i></i><i></i><i></i></div>
  <div class="arDrift">${petals.join('')}</div>
  <div class="arCnr tl">${CORNER}</div><div class="arCnr tr">${CORNER}</div>
  <div class="arCnr bl">${CORNER}</div><div class="arCnr br">${CORNER}</div>
</div>

<section class="arScreen arHome" aria-label="Aether Rift">
  <div class="arHomeInner">
    <div class="arBrow"><i></i>SUNKEN ELVEN SANCTUM<i></i></div>
    <h1 class="arTitle">
      <span class="arTL arTitleInk" aria-hidden="true">AETHER RIFT</span>
      <span class="arTL arTitleFill" aria-hidden="true">AETHER RIFT</span>
      <span class="arTL arTitleShine" aria-hidden="true">AETHER RIFT</span>
      <span class="arTitleA11y">AETHER RIFT</span>
    </h1>
    ${FLOURISH}
    <p class="arSub"><span>Farm the lane<i>·</i></span><span>Break the towers<i>·</i></span><em>Shatter the nexus</em></p>
    <div class="arActions">
      <button class="arPlay" type="button" data-act="play" aria-label="Play">
        <span class="arPlayGlow"></span>
        <span class="arPlayRim"></span>
        <span class="arPlayFace">
          <span class="arPlayDia"></span>
          <span class="arPlayLabel">PLAY</span>
          <span class="arPlayDia"></span>
        </span>
      </button>
      <button class="arGhost" type="button" data-act="rules">${SCROLL_ICO}HOW TO PLAY</button>
    </div>
  </div>
  <div class="arFoot">
    <span class="arCredit"><i></i>SERA · <b>BLADE OF DAWN</b></span>
    <span class="arCredit">1 v 1<i></i>SOLO LANE</span>
  </div>
</section>

<section class="arScreen arRules arOff" aria-label="How to play">
  <div class="arSheet">
    <span class="arStud tl"></span><span class="arStud tr"></span>
    <span class="arStud bl"></span><span class="arStud br"></span>
    <header class="arRHead">
      <button class="arBack" type="button" data-act="home">${BACK_ICO}BACK</button>
      <div class="arRTitle"><i></i><span>HOW TO PLAY</span><i></i></div>
      <div class="arPageNo numeral"><b class="arPageCur">01</b> / 0${PAGES.length}</div>
    </header>
    <nav class="arTabs" role="tablist">${tabs}</nav>
    <div class="arBody">${pages}</div>
  </div>
</section>`;
}

// ===================================================================== public
export function createMenu(opts = {}) {
  ensureStyles();

  const root = document.createElement('div');
  root.className = 'arMenu arOff';
  root.setAttribute('aria-hidden', 'true');
  // structural fallback so an un-styled first paint can never wreck the page
  root.style.cssText = 'position:fixed;inset:0;z-index:40;';
  root.innerHTML = buildMarkup();
  document.body.appendChild(root);

  const home = root.querySelector('.arHome');
  const rules = root.querySelector('.arRules');
  const body = root.querySelector('.arBody');
  const pageNo = root.querySelector('.arPageCur');
  const tabEls = Array.prototype.slice.call(root.querySelectorAll('.arTab'));
  const pageEls = Array.prototype.slice.call(root.querySelectorAll('.arPage'));

  let open = false;
  let onRules = false;
  let page = 0;

  // ---- pages ----
  function setPage(i) {
    const n = Math.max(0, Math.min(PAGES.length - 1, i));
    if (n === page && pageEls[n].classList.contains('on')) return;
    page = n;
    for (let k = 0; k < pageEls.length; k++) {
      const active = k === n;
      pageEls[k].classList.toggle('on', active);
      tabEls[k].classList.toggle('on', active);
      tabEls[k].setAttribute('aria-selected', active ? 'true' : 'false');
    }
    pageNo.textContent = '0' + (n + 1);
    body.scrollTop = 0;
  }

  // ---- screens ----
  function paint() {
    root.classList.toggle('arOff', !open);
    root.setAttribute('aria-hidden', open ? 'false' : 'true');
    home.classList.toggle('arOff', !open || onRules);
    rules.classList.toggle('arOff', !open || !onRules);
    document.body.classList.toggle('arMenuOpen', open);
  }
  function show() { open = true; onRules = false; paint(); }
  function showRules() { open = true; onRules = true; setPage(0); paint(); }
  function showHome() { open = true; onRules = false; paint(); }
  function hide() { open = false; onRules = false; paint(); }

  // ---- input ----
  root.addEventListener('click', (e) => {
    const tab = e.target.closest ? e.target.closest('.arTab') : null;
    if (tab) { setPage(+tab.getAttribute('data-tab')); return; }
    const btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'play') { hide(); if (typeof opts.onPlay === 'function') opts.onPlay(); }
    else if (act === 'rules') { showRules(); if (typeof opts.onRules === 'function') opts.onRules(); }
    else if (act === 'home') showHome();
  });

  // The game binds its joystick and its ability keys on document/window. While
  // the front end owns the screen, nothing behind it may see the input — a tap
  // on the left half must not spawn a joystick under the title card.
  const swallow = (e) => { if (open) e.stopPropagation(); };
  root.addEventListener('pointerdown', swallow);
  root.addEventListener('pointerup', swallow);
  root.addEventListener('pointermove', swallow);
  root.addEventListener('touchstart', swallow, { passive: true });
  root.addEventListener('touchmove', swallow, { passive: true });

  const GAME_KEYS = 'qweraszdfjhg1234 ';
  const onKey = (e) => {
    if (!open) return;
    const k = (e.key || '').toLowerCase();
    if (onRules && (k === 'arrowright' || k === 'arrowleft')) {
      setPage(page + (k === 'arrowright' ? 1 : -1));
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (k === 'escape') {
      if (onRules) showHome();
      e.stopPropagation();
      return;
    }
    // never let a stray WASD/QWER reach the sim behind the overlay
    if (k.length === 1 && GAME_KEYS.indexOf(k) >= 0) { e.stopPropagation(); e.preventDefault(); }
    else if (k.indexOf('arrow') === 0) e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);

  // horizontal swipe between rules pages (vertical scroll stays untouched)
  let sx = 0, sy = 0, sid = null;
  body.addEventListener('pointerdown', (e) => { sid = e.pointerId; sx = e.clientX; sy = e.clientY; });
  body.addEventListener('pointerup', (e) => {
    if (sid !== e.pointerId) return;
    sid = null;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy) * 1.7) setPage(page + (dx < 0 ? 1 : -1));
  });
  body.addEventListener('pointercancel', () => { sid = null; });

  function destroy() {
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('arMenuOpen');
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return {
    show, hide, showRules, showHome, destroy,
    setPage,
    get isOpen() { return open; },
    root,
  };
}

export default createMenu;
