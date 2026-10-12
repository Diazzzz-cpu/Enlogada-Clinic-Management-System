/**
 * Reads the generated .drawio files back and reports what a reader would trip over.
 *
 *   node docs/diagrams/checkDiagrams.cjs
 *
 * Checks, in the order they matter:
 *   DECISION      a diamond with fewer than two ways out, or a way out with no yes/no on it.
 *                 A decision with one exit is not a decision.
 *   DEAD END      a step with no outgoing edge that is not the End terminator.
 *   CROSSING      a line that passes through a box it is not attached to. Only edges whose
 *                 waypoints this script writes can be checked, which is the set that matters.
 *   OVERLAP       two boxes whose rectangles intersect, which is how labels end up on top of
 *                 each other.
 *   LONG LABEL    a label too long to read at a glance in a printed figure.
 *
 * Exits non-zero if anything is found, so it can gate a rebuild.
 */
const fs = require('fs');
const path = require('path');

const FILES = ['flowcharts.drawio', 'usecases.drawio', 'dfd-level0.drawio', 'dfd-level1.drawio', 'erd.drawio'];
const MAX_LABEL = 34;

const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// Attributes are read one at a time off the opening tag. A single regex with optional groups and
// lazy gaps silently returns undefined for whatever it skipped, which is how an earlier version of
// this checker reported every decision as having no way out.
function parsePage(xml) {
  const vertices = [], edges = [];
  const blocks = xml.match(/<mxCell\b[\s\S]*?(?:\/>|<\/mxCell>)/g) || [];
  for (const block of blocks) {
    const tag = block.slice(0, block.indexOf('>') + 1);
    const attr = (name) => {
      const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
      return m ? m[1] : undefined;
    };
    const id = attr('id');
    const value = unescapeXml(attr('value') || '');
    const style = attr('style') || '';
    const parent = attr('parent') || '1';
    if (attr('edge') === '1') {
      const pts = [...block.matchAll(/<mxPoint x="([-\d.]+)" y="([-\d.]+)"(?![^>]*as="offset")/g)]
        .map((m) => [Number(m[1]), Number(m[2])]);
      edges.push({ id, value, style, source: attr('source'), target: attr('target'), points: pts });
      continue;
    }
    if (attr('vertex') !== '1') continue;
    const geo = /<mxGeometry\b[^>]*>/.exec(block);
    const num = (name) => {
      if (!geo) return 0;
      const m = new RegExp(`\\b${name}="([-\\d.]+)"`).exec(geo[0]);
      return m ? Number(m[1]) : 0;
    };
    vertices.push({ id, value, style, parent, x: num('x'), y: num('y'), w: num('width'), h: num('height') });
  }
  return { vertices, edges };
}

const problems = [];
const add = (kind, page, detail) => problems.push({ kind, page, detail });

for (const file of FILES) {
  const full = fs.readFileSync(path.join(__dirname, file), 'utf8');
  for (const chunk of full.split('<diagram ').slice(1)) {
    const page = `${file.replace('.drawio', '')} / ${/name="([^"]+)"/.exec(chunk)[1]}`;
    const { vertices, edges } = parsePage(chunk);
    const byId = new Map(vertices.map((v) => [v.id, v]));
    const out = new Map();
    edges.forEach((e) => { if (!out.has(e.source)) out.set(e.source, []); out.get(e.source).push(e); });

    vertices.forEach((v) => {
      const isDecision = /rhombus/.test(v.style);
      const outgoing = out.get(v.id) || [];
      if (isDecision) {
        if (outgoing.length < 2) add('DECISION', page, `"${v.value}" has ${outgoing.length} way(s) out`);
        else {
          const unlabelled = outgoing.filter((e) => !e.value.trim());
          if (unlabelled.length) add('DECISION', page, `"${v.value}" has ${unlabelled.length} unlabelled branch(es)`);
        }
      }
      const isTerminator = /ellipse/.test(v.style) && /^(End|Logout)$/i.test(v.value.trim());
      const isActor = /shape=(actor|umlActor)/.test(v.style);
      const isStructural = /shape=(table|tableRow|partialRectangle|note)/.test(v.style) || v.parent !== '1';
      // Only a flowchart promises that every step leads somewhere. A data store on a DFD is an
      // endpoint by definition, and a use case ellipse has no flow at all.
      if (!outgoing.length && !isTerminator && !isActor && !isStructural && v.value.trim() && /flowcharts/.test(file)) {
        add('DEAD END', page, `"${v.value}" leads nowhere`);
      }
      // The system box carries the clinic's full name on purpose; use case names may run longer
      // than a flowchart step because they are read one at a time.
      const limit = /usecases/.test(file) ? 42 : MAX_LABEL;
      const exempt = isStructural || isActor || /Enlogada/.test(v.value);
      if (v.value.trim().length > limit && !exempt) {
        add('LONG LABEL', page, `"${v.value}" (${v.value.trim().length} chars)`);
      }
    });

    // A LINE THROUGH A BOX. The overlap check below only compares boxes with boxes, so it never
    // saw the Desk's no-show branch drop straight down through three side boxes on its way to
    // End. Only edges whose waypoints are written out can be checked — one draw.io routes itself
    // has no path here — which is exactly the set this script writes.
    const boxesForLines = vertices.filter((v) => v.parent === '1' && v.w > 0 && v.h > 0
      && !/shape=(tableRow|partialRectangle|note)/.test(v.style));
    const port = (v, fx, fy) => [v.x + fx * v.w, v.y + fy * v.h];
    const num = (st, name) => {
      const m = new RegExp(name + '=([-' + String.fromCharCode(92) + 'd.]+)').exec(st);
      return m ? Number(m[1]) : null;
    };
    edges.forEach((e) => {
      if (!e.points || !e.points.length) return;
      const src = byId.get(e.source), tgt = byId.get(e.target);
      if (!src || !tgt) return;
      const ex = num(e.style, 'exitX'), ey = num(e.style, 'exitY');
      const nx = num(e.style, 'entryX'), ny = num(e.style, 'entryY');
      const path = [
        ex === null || ey === null ? port(src, 0.5, 0.5) : port(src, ex, ey),
        ...e.points,
        nx === null || ny === null ? port(tgt, 0.5, 0.5) : port(tgt, nx, ny),
      ];
      for (let i = 0; i + 1 < path.length; i += 1) {
        const [x1, y1] = path[i], [x2, y2] = path[i + 1];
        // Only a segment this script actually fixed can be judged. A diagonal here means the two
        // ends do not line up and draw.io is routing that stub itself, so its real path is not in
        // the file; testing its bounding box instead reports every box in a wide sweep.
        if (x1 !== x2 && y1 !== y2) continue;
        const lo = (a, b) => Math.min(a, b), hi = (a, b) => Math.max(a, b);
        boxesForLines.forEach((v) => {
          if (v.id === e.source || v.id === e.target) return;
          // 3px inset, so a line that merely runs along an edge is not a crossing.
          const bx1 = v.x + 3, by1 = v.y + 3, bx2 = v.x + v.w - 3, by2 = v.y + v.h - 3;
          if (hi(x1, x2) <= bx1 || lo(x1, x2) >= bx2 || hi(y1, y2) <= by1 || lo(y1, y2) >= by2) return;
          // Only axis-aligned segments are produced here, so an overlap of both spans is a hit.
          add('CROSSING', page, `"${e.value || e.id}" passes through "${v.value || v.id}"`);
        });
      }
    });

    // Boxes that physically overlap. Only top-level shapes; ERD rows live inside their table.
    const boxes = vertices.filter((v) => v.parent === '1' && v.w > 0 && v.h > 0 && !/shape=tableRow|partialRectangle/.test(v.style));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i], b = boxes[j];
        const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (dx > 1 && dy > 1) add('OVERLAP', page, `"${a.value || a.id}" over "${b.value || b.id}" (${Math.round(dx)}x${Math.round(dy)}px)`);
      }
    }
  }
}

const order = ['DECISION', 'DEAD END', 'CROSSING', 'OVERLAP', 'LONG LABEL'];
order.forEach((kind) => {
  const found = problems.filter((p) => p.kind === kind);
  console.log(`${kind}: ${found.length}`);
  found.slice(0, 12).forEach((p) => console.log(`   ${p.page} — ${p.detail}`));
  if (found.length > 12) console.log(`   … and ${found.length - 12} more`);
});
console.log(problems.length ? `\nTOTAL ${problems.length} problem(s)` : '\nClean.');
process.exit(problems.length ? 1 : 0);
