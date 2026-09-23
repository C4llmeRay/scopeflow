/**
 * Illustrations standing in for photos in the sample job.
 *
 * Drawn, not photographed, and stamped SAMPLE — a demo must never pass off a
 * stock image as evidence from a real loss. They are SVG data URIs so they work
 * on a phone and in a browser with no bundled assets and no file system.
 */

const W = 800;
const H = 600;

function frame(body: string, label: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    body +
    `<rect x="16" y="16" width="118" height="34" rx="6" fill="#000" fill-opacity="0.55"/>` +
    `<text x="75" y="39" font-family="Arial,sans-serif" font-size="16" font-weight="700" fill="#fff" text-anchor="middle" letter-spacing="2">SAMPLE</text>` +
    `<text x="${W - 20}" y="${H - 20}" font-family="Arial,sans-serif" font-size="18" fill="#fff" fill-opacity="0.85" text-anchor="end">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Drywall with a tide line and wicking, over wet carpet. */
function wallWaterLine(tideY: number, wall: string, stain: string, floor: string, label: string) {
  return frame(
    `<rect width="${W}" height="${H}" fill="${wall}"/>` +
      `<path d="M0 ${tideY} Q 120 ${tideY - 14} 240 ${tideY + 4} T 480 ${tideY - 6} T ${W} ${tideY + 2} L ${W} 470 L 0 470 Z" fill="${stain}" fill-opacity="0.55"/>` +
      `<path d="M0 ${tideY} Q 120 ${tideY - 14} 240 ${tideY + 4} T 480 ${tideY - 6} T ${W} ${tideY + 2}" stroke="#6b4f2a" stroke-width="5" fill="none" stroke-opacity="0.7"/>` +
      `<rect x="0" y="448" width="${W}" height="22" fill="#e9e4da"/>` +
      `<rect x="0" y="448" width="${W}" height="22" fill="${stain}" fill-opacity="0.45"/>` +
      `<rect x="0" y="470" width="${W}" height="${H - 470}" fill="${floor}"/>` +
      `<ellipse cx="420" cy="540" rx="260" ry="40" fill="#1f2d3a" fill-opacity="0.35"/>`,
    label,
  );
}

function carpetPulled(label: string) {
  return frame(
    `<rect width="${W}" height="${H}" fill="#8a7f72"/>` +
      `<rect x="0" y="0" width="${W}" height="190" fill="#d9d2c4"/>` +
      `<rect x="0" y="170" width="${W}" height="20" fill="#efeae0"/>` +
      `<path d="M0 260 L520 260 Q 600 260 640 330 L 700 600 L 0 600 Z" fill="#5d6d7e"/>` +
      `<path d="M520 260 Q 600 260 640 330 L 700 600 L 800 600 L 800 260 Z" fill="#b6a48c"/>` +
      `<path d="M 610 300 Q 700 280 760 330 Q 720 380 660 400 Z" fill="#c7b89f"/>` +
      `<ellipse cx="260" cy="430" rx="200" ry="70" fill="#2c3e50" fill-opacity="0.45"/>` +
      `<ellipse cx="560" cy="500" rx="120" ry="40" fill="#2c3e50" fill-opacity="0.35"/>`,
    label,
  );
}

function moistureMeter(reading: string, label: string) {
  return frame(
    `<rect width="${W}" height="${H}" fill="#cfc7b8"/>` +
      `<path d="M0 330 Q 200 316 400 334 T ${W} 326 L ${W} ${H} L 0 ${H} Z" fill="#9c8561" fill-opacity="0.5"/>` +
      `<rect x="300" y="150" width="200" height="320" rx="28" fill="#f2b705"/>` +
      `<rect x="325" y="185" width="150" height="90" rx="8" fill="#1d2b1f"/>` +
      `<text x="400" y="248" font-family="Courier New,monospace" font-size="52" font-weight="700" fill="#7CFC8A" text-anchor="middle">${reading}</text>` +
      `<circle cx="400" cy="340" r="26" fill="#2f2f2f"/>` +
      `<rect x="370" y="470" width="14" height="60" fill="#777"/>` +
      `<rect x="416" y="470" width="14" height="60" fill="#777"/>`,
    label,
  );
}

function supplyLine(label: string) {
  return frame(
    `<rect width="${W}" height="${H}" fill="#dfe3e6"/>` +
      `<rect x="120" y="120" width="360" height="400" rx="18" fill="#f7f7f7" stroke="#b9c0c6" stroke-width="4"/>` +
      `<circle cx="300" cy="320" r="120" fill="#cfd8dc" stroke="#9aa5ad" stroke-width="6"/>` +
      `<path d="M 560 60 L 560 250 Q 560 300 510 300 L 480 300" stroke="#8a8f94" stroke-width="18" fill="none"/>` +
      `<circle cx="560" cy="240" r="16" fill="#c0392b"/>` +
      `<path d="M 548 262 Q 540 330 552 400 Q 560 460 540 560" stroke="#3a7bd5" stroke-width="6" fill="none" stroke-opacity="0.8"/>` +
      `<ellipse cx="520" cy="560" rx="200" ry="30" fill="#3a7bd5" fill-opacity="0.35"/>`,
    label,
  );
}

function hallway(label: string) {
  return frame(
    `<rect width="${W}" height="${H}" fill="#e8e2d6"/>` +
      `<path d="M0 0 L260 160 L260 440 L0 600 Z" fill="#d6cfc1"/>` +
      `<path d="M${W} 0 L540 160 L540 440 L${W} 600 Z" fill="#d6cfc1"/>` +
      `<rect x="260" y="160" width="280" height="280" fill="#cfc6b6"/>` +
      `<rect x="345" y="230" width="110" height="210" fill="#a88b64"/>` +
      `<path d="M0 600 L260 440 L540 440 L${W} 600 Z" fill="#8c7b66"/>`,
    label,
  );
}

export const SAMPLE_PHOTOS = {
  familyWall: wallWaterLine(300, '#e6e0d4', '#a8895c', '#5d6d7e', 'Family room · north wall'),
  familyCarpet: carpetPulled('Family room · carpet pulled back'),
  familyMeter: moistureMeter('38%', 'Family room · drywall at 12"'),
  bedroomWall: wallWaterLine(360, '#dfe6ea', '#9a8057', '#6b7b69', 'Bedroom · closet wall'),
  laundrySource: supplyLine('Laundry · failed supply line'),
  untagged: hallway('Hallway toward the laundry'),
} as const;
