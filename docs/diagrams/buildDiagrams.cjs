/**
 * Builds the capstone paper's diagrams as draw.io files, in the same style as the originals.
 *
 * The flowcharts, use cases and data flow diagrams are laid out from the specs below; the ERD is
 * read from the live database, so it cannot drift from the schema. Run from anywhere:
 *
 *   node docs/diagrams/build-diagrams.cjs
 *
 * Output: one .drawio file per group, each with a tab per figure. Open in draw.io to adjust the
 * placement by hand — the layout here is deliberately roomy so boxes can be dragged without
 * crossing lines. Export with export-png.cmd beside this file.
 */
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const BACKEND = path.join(__dirname, '..', '..', 'backend');

// ── draw.io plumbing ────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Black ink on white, like a printed figure. Nothing in these diagrams uses colour to mean
// anything, so colour only costs the reader contrast on a photocopy or a projector.
const FONT = 'fontFamily=Helvetica;fontSize=14;fontColor=#000000;strokeColor=#000000;';
const SMALL = 'fontFamily=Helvetica;fontSize=12;fontColor=#000000;strokeColor=#000000;';
const S = {
  actor: 'shape=actor;fillColor=none;strokeColor=#000000;html=1;verticalLabelPosition=top;verticalAlign=bottom;fontFamily=Helvetica;fontSize=14;fontColor=#000000;fontStyle=1',
  umlActor: 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;fontFamily=Helvetica;fontSize=12;fontStyle=1',
  term: 'ellipse;whiteSpace=wrap;html=1;' + FONT,
  proc: 'rounded=0;whiteSpace=wrap;html=1;' + FONT,
  dec: 'rhombus;whiteSpace=wrap;html=1;' + SMALL,
  io: 'shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;' + FONT,
  entity: 'rounded=0;whiteSpace=wrap;html=1;' + FONT,
  system: 'rounded=0;whiteSpace=wrap;html=1;verticalAlign=middle;' + FONT,
  ellipse: 'ellipse;whiteSpace=wrap;html=1;' + FONT,
  procHead: 'swimlane;whiteSpace=wrap;html=1;startSize=24;horizontal=1;fontStyle=0;' + FONT,
  procBody: 'text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;' + FONT,
  storeTag: 'rounded=0;whiteSpace=wrap;html=1;align=center;' + FONT,
  storeName: 'rounded=0;whiteSpace=wrap;html=1;align=left;spacingLeft=8;' + FONT,
  edge: 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;jettySize=auto;orthogonalLoop=1;' + SMALL,
  edgeStraight: 'edgeStyle=none;rounded=0;html=1;endArrow=none;' + SMALL,
  edgeFlow: 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;verticalAlign=bottom;' + SMALL,
  edgeDashed: 'endArrow=open;endSize=12;dashed=1;html=1;' + SMALL,
  table: 'shape=table;startSize=30;container=1;collapsible=0;childLayout=tableLayout;fixedRows=1;rowLines=0;fontStyle=1;align=center;resizeLast=1;html=1;fillColor=none;strokeColor=#000000;fontColor=#000000;fontFamily=Helvetica;fontSize=14;',
  tableGhost: 'shape=table;startSize=30;container=1;collapsible=0;childLayout=tableLayout;fixedRows=1;rowLines=0;fontStyle=2;align=center;resizeLast=1;html=1;fillColor=none;strokeColor=#000000;dashed=1;fontColor=#000000;fontFamily=Helvetica;fontSize=14;',
  tableRow: 'shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;fillColor=none;collapsible=0;dropTarget=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;top=0;left=0;right=0;bottom=0;',
  tableCell: 'shape=partialRectangle;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=0;align=left;spacingLeft=6;overflow=hidden;html=1;fontFamily=Helvetica;fontSize=12;fontColor=#000000;',
  erEdge: 'edgeStyle=entityRelationEdgeStyle;fontSize=12;html=1;endArrow=ERmandOne;startArrow=ERmany;rounded=0;strokeColor=#000000;',
  note: 'shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;fillColor=none;strokeColor=#000000;align=left;spacingLeft=6;' + SMALL,
};

class Page {
  constructor(name) { this.name = name; this.cells = []; this.n = 0; }
  id(prefix = 'n') { this.n += 1; return `${prefix}${this.n}`; }
  node(value, x, y, w, h, style, parent = '1') {
    const id = this.id();
    this.cells.push(`<mxCell id="${id}" value="${esc(value)}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry" /></mxCell>`);
    return { id, x, y, w, h };
  }
  // labelX slides the label along the edge (-1 at the source, 1 at the target), which is what keeps
  // two flows between the same pair of boxes from printing their labels on top of each other.
  edge(from, to, label = '', style = S.edge, points = [], labelX = null) {
    const id = this.id('e');
    // A number slides the label along the path. An {at, dx, dy} pins it to one END of the path and
    // offsets it in pixels, which is the only way to put a label in the same place on every flow
    // when the paths are wildly different lengths — see dfd1.
    const pinned = labelX !== null && typeof labelX === 'object';
    const pos = labelX === null ? 'relative="1"' : `relative="1" x="${pinned ? labelX.at : labelX}"`;
    const inner = (points.length ? `<Array as="points">${points.map((p) => `<mxPoint x="${p[0]}" y="${p[1]}" />`).join('')}</Array>` : '')
      + (pinned ? `<mxPoint x="${labelX.dx}" y="${labelX.dy}" as="offset" />` : '');
    const geo = inner
      ? `<mxGeometry ${pos} as="geometry">${inner}</mxGeometry>`
      : `<mxGeometry ${pos} as="geometry" />`;
    this.cells.push(`<mxCell id="${id}" value="${esc(label)}" style="${style}" edge="1" parent="1" source="${from.id}" target="${to.id}">${geo}</mxCell>`);
  }
  xml() {
    return `  <diagram id="${this.name.replace(/[^A-Za-z0-9]/g, '')}" name="${esc(this.name)}">\n`
      + '    <mxGraphModel dx="1200" dy="800" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1100" math="0" shadow="0">\n'
      + '      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n        '
      + this.cells.join('\n        ')
      + '\n      </root>\n    </mxGraphModel>\n  </diagram>\n';
  }
}

function writeFile(file, pages) {
  const xml = '<mxfile host="Electron" agent="build-diagrams.cjs" type="device">\n'
    + pages.map((p) => p.xml()).join('')
    + '</mxfile>\n';
  fs.writeFileSync(path.join(OUT, file), xml);
  console.log(`${file}: ${pages.length} page(s)`);
}

// ── 1. Flowcharts ───────────────────────────────────────────────────────────────────────────────
// A chart is an actor, a preamble (login / access check / landing screen) and columns of steps that
// all meet at one End, which is how the originals in the paper are drawn.
const NODE_W = 240, NODE_H = 66, DEC_H = 88, V_GAP = 50, SIDE_W = 215, COL_GAP = 52;

function kindStyle(k) {
  return k === 'dec' ? S.dec : k === 'io' ? S.io : k === 'term' ? S.term : S.proc;
}

function flowchart(spec) {
  const p = new Page(spec.name);
  const columns = spec.columns;
  // Column x positions: a column is wider when one of its steps has a side branch.
  const widths = columns.map((col) => NODE_W + (col.some((s) => s.side) ? SIDE_W + 36 : 0));
  const xs = [];
  let x = 60;
  widths.forEach((w) => { xs.push(x); x += w + COL_GAP; });
  const totalW = x - COL_GAP - 60;

  // The paper's own header, which Steven asked for: the actor, Login, the access check and the
  // landing screen in ONE centred stack above the columns, with the no branch looping back up the
  // left side into Login. The columns then fan out from the landing screen below it.
  //
  // Centred over the whole block, except on a chained chart, where the sequence starts at the
  // first column and the header belongs over that one — a fan that reached left across the other
  // columns would cross the link corridor that carries the chain.
  const headX = spec.chain ? xs[0] + NODE_W / 2 : 60 + totalW / 2;
  p.node(spec.actor, headX - 15, 44, 30, 50, S.actor);
  const start = p.node(spec.start || 'Login', headX - 75, 118, 150, 44, S.term);
  let landing;
  if (spec.gate === false) {
    landing = p.node(spec.landing, headX - NODE_W / 2, 196, NODE_W, NODE_H, S.proc);
    p.edge(start, landing);
  } else {
    const gate = p.node('Access Granted?', headX - 85, 194, 170, 80, S.dec);
    landing = p.node(spec.landing, headX - NODE_W / 2, 310, NODE_W, NODE_H, S.proc);
    p.edge(start, gate);
    p.edge(gate, landing, 'yes');
    // Out of the diamond's left point, up the outside of the stack, and back into Login's left.
    p.edge(gate, start, 'no', S.edge + 'exitX=0;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;',
      [[headX - 155, 234], [headX - 155, 140]]);
  }

  const topY = 440;
  let lowest = topY;
  const lastOfColumn = [];
  const firstOfColumn = [];
  const merges = [];
  columns.forEach((col, ci) => {
    const cx = xs[ci];
    let y = topY;
    // Place every step in the column first, so a side branch knows the step it rejoins.
    const main = col.map((step) => {
      const h = step.k === 'dec' ? DEC_H : NODE_H;
      const cell = p.node(step.l, cx, y, NODE_W, h, kindStyle(step.k));
      const at = { cell, y, h };
      y += h + V_GAP;
      lowest = Math.max(lowest, y);
      return at;
    });
    main.forEach((at, si) => {
      const step = col[si];
      // `chain` means the columns are one sequence wrapped into columns, not a menu of parallel
      // branches: the client's story runs book, confirm, pay, collect, and drawing those four as
      // independent branches off the landing screen says the patient does them all at once.
      if (si === 0) {
        if (spec.chain && ci > 0) firstOfColumn[ci] = at.cell;   // linked below, over the top
        else {
          // Down out of the landing screen onto one shared bus, then across and down into each
          // column — the comb the paper's figures draw. Left to its own devices draw.io takes the
          // nearest edge of the landing box, so one branch left its left side, one its bottom and
          // one its right, which reads as three different kinds of thing.
          const busY = landing.y + landing.h + 34;
          p.edge(landing, at.cell, '', S.edge + 'exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;',
            [[landing.x + landing.w / 2, busY], [cx + NODE_W / 2, busY]]);
        }
      } else p.edge(main[si - 1].cell, at.cell, col[si - 1].k === 'dec' ? (col[si - 1].mainLabel || 'yes') : '');
      if (step.side) {
        const side = p.node(step.side.l, cx + NODE_W + 36, at.y + (at.h - NODE_H) / 2, SIDE_W, NODE_H, kindStyle(step.side.k || 'proc'));
        p.edge(at.cell, side, step.side.label || 'yes');
        const rejoin = main[si + (step.side.mergeTo || 1)];
        if (step.side.back) {
          p.edge(side, at.cell, '', S.edge, [[cx + NODE_W + 36 + SIDE_W / 2, at.y - 26], [cx + NODE_W / 2, at.y - 26]]);
        } else if (step.side.toEnd || !rejoin) {
          merges.push(side);               // a branch that finishes here, e.g. a refusal
        } else {
          // Down the side column, across the gap above the step it rejoins, and into its TOP —
          // the same point the main path arrives at, which is what a merge looks like.
          //
          // Entering from the RIGHT instead, which is the obvious way to draw it, put the line on
          // top of two other things: it cut through the box between the branch and its target, and
          // where the target was a decision it arrived at the very vertex that decision's own
          // branch leaves from, so one arrowhead appeared to point into the diamond and out of it.
          const laneY = rejoin.y - 26;
          p.edge(side, rejoin.cell, '', S.edge + 'exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;',
            [[cx + NODE_W + 36 + SIDE_W / 2, laneY], [cx + NODE_W / 2, laneY]]);
        }
      }
    });
    lastOfColumn.push(main[main.length - 1].cell);
  });

  // Every column ends at the one End. Drop straight down to a clear corridor below the columns
  // first, then run across: routed along their own row instead, the lines cut through the boxes
  // of every column to their right.
  // A chained chart snakes: leave the last step sideways into the gap between columns, climb to a
  // corridor above the column tops, then drop into the next column. Routed directly, the link
  // climbs straight through every box of the column it is heading for.
  if (spec.chain) {
    const linkY = topY - 34;
    for (let ci = 1; ci < columns.length; ci += 1) {
      const prev = lastOfColumn[ci - 1];
      const next = firstOfColumn[ci];
      if (!prev || !next) continue;
      const gapX = xs[ci] - COL_GAP / 2;
      p.edge(prev, next, '', S.edge + 'exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;',
        [[gapX, prev.y + prev.h / 2], [gapX, linkY], [next.x + next.w / 2, linkY]]);
    }
  }

  const corridor = lowest + 14;
  const end = p.node('End', 60 + totalW / 2 - 60, corridor + 46, 120, 44, S.term);
  // In a chained chart only the final column reaches End; the others continue into the next column.
  const finishers = spec.chain ? [lastOfColumn[lastOfColumn.length - 1]] : lastOfColumn;
  finishers.concat(merges).forEach((cell) => {
    p.edge(cell, end, '', S.edge + 'exitX=0.5;exitY=1;exitDx=0;exitDy=0;', [[cell.x + cell.w / 2, corridor]]);
  });
  return p;
}

const SUPER_ADMIN_FLOW = {
  name: 'Super Admin', actor: 'Super Admin', landing: 'Today',
  columns: [
    [{ k: 'proc', l: 'Who Sees What' }, { k: 'proc', l: 'Edit role access' }, { k: 'proc', l: 'Review changes and save' }],
    [{ k: 'proc', l: 'One Person' }, { k: 'proc', l: 'Grant or revoke access' }, { k: 'proc', l: 'Change is audited' }],
    [{ k: 'proc', l: 'Staff Accounts' }, { k: 'proc', l: 'Add or deactivate staff' }],
    [{ k: 'proc', l: 'Services Catalog' }, { k: 'proc', l: 'Edit tests and prices' }],
    [{ k: 'proc', l: 'Payment Methods' }, { k: 'proc', l: 'Publish GCash and QR' }],
    [{ k: 'proc', l: 'Clinic Schedule' }, { k: 'proc', l: 'Set hours and closures' }],
    [{ k: 'proc', l: 'Reports' }, { k: 'proc', l: 'View analytics' }, { k: 'io', l: 'Export CSV' }],
    [{ k: 'proc', l: 'Activity Log' }, { k: 'proc', l: 'Review audit trail' }],
  ],
};

const ADMIN_FLOW = {
  name: 'Admin', actor: 'Admin', landing: 'Today',
  columns: [
    [{ k: 'proc', l: 'Service Requests' }, { k: 'proc', l: 'Open the HMO claim' },
      { k: 'dec', l: 'Approve the claim?', mainLabel: 'yes',
        side: { l: 'Record the reason', label: 'no', mergeTo: 2 } },
      { k: 'proc', l: 'Record approval code' }, { k: 'proc', l: 'Cashier is notified' }],
    [{ k: 'proc', l: 'Appointments' }, { k: 'proc', l: 'View or update booking' }],
    [{ k: 'proc', l: 'Patient Records' }, { k: 'proc', l: 'Search and correct' }, { k: 'io', l: 'Print record' }],
    [{ k: 'proc', l: 'Cashier Monitoring' }, { k: 'proc', l: 'Review takings and refunds' }],
    [{ k: 'proc', l: 'Staff Accounts' }, { k: 'proc', l: 'Add or update staff' }],
    [{ k: 'proc', l: 'Reports' }, { k: 'proc', l: 'Generate report' }, { k: 'io', l: 'Print or export' }],
    [{ k: 'proc', l: 'Activity Log' }, { k: 'proc', l: 'Review audit trail' }],
  ],
};

// One pass through the desk, not three.
//
// The first version drew the walk-in path three times — "Booking today? no -> Register as walk-in",
// then a column for a patient on file and another for a new patient — and issued a queue ticket at
// the end of each. The Desk is ONE screen: a box that takes a name, a reference or a scan, and the
// answer decides whether the next click is Check in or Register. So the ticket is issued once, on
// the one path, and registering is the no branch that rejoins it.
const RECEPTIONIST_FLOW = {
  name: 'Receptionist', actor: 'Receptionist', landing: 'Desk',
  columns: [
    [{ k: 'proc', l: 'Search name, reference or QR' },
      { k: 'dec', l: 'Booking for today?', mainLabel: 'yes',
        side: { l: 'Register walk-in', label: 'no', mergeTo: 2 } },
      { k: 'proc', l: 'Check in the booking' },
      { k: 'io', l: 'Issue queue ticket' },
      { k: 'proc', l: 'Attach or confirm tests' },
      { k: 'dec', l: 'HMO patient?', mainLabel: 'no',
        side: { l: 'Record card, send to Admin', label: 'yes' } },
      { k: 'dec', l: 'Already paid online?', mainLabel: 'no',
        side: { l: 'Visit goes to department', label: 'yes', toEnd: true } },
      { k: 'proc', l: 'Send patient to the cashier' }],
    [{ k: 'proc', l: 'Booking did not arrive' }, { k: 'proc', l: 'Mark no-show' }],
    [{ k: 'proc', l: 'Visit History' }, { k: 'proc', l: 'Review past visits' }],
  ],
};

// The till: one bill, one receipt, and the two other things the cashier does with a receipt.
// Reversing one belongs under Transaction History, where the receipt is found, rather than
// hanging off the landing screen as though a refund started from nowhere.
const CASHIER_FLOW = {
  name: 'Cashier', actor: 'Cashier', landing: 'Billing Queue',
  columns: [
    [{ k: 'proc', l: 'Select patient to bill' },
      { k: 'proc', l: 'System computes the bill' },
      { k: 'dec', l: 'Senior or PWD ID?', mainLabel: 'no',
        side: { l: 'Apply 20% discount', label: 'yes' } },
      { k: 'proc', l: 'Take payment and change' },
      { k: 'io', l: 'Issue and print receipt' },
      { k: 'proc', l: 'Visit goes to department' }],
    [{ k: 'proc', l: 'Online Payments' },
      { k: 'proc', l: 'Open proof of payment' },
      { k: 'dec', l: 'Proof matches the bill?', mainLabel: 'yes',
        side: { l: 'Reject and email patient', label: 'no', toEnd: true } },
      { k: 'proc', l: 'Approve: receipt issued' }],
    [{ k: 'proc', l: 'Transaction History' },
      { k: 'proc', l: 'Pick date range' },
      { k: 'proc', l: 'View takings and receipts' },
      { k: 'dec', l: 'Reverse a receipt?', mainLabel: 'no',
        side: { l: 'Record the refund', label: 'yes', toEnd: true } },
      { k: 'io', l: 'Print receipt copy' }],
  ],
};

// A department ticket is recorded and then released, which are two separate acts in the system —
// saving parks it in 'Waiting for Release' and nothing has left the department yet. The decision
// says so. Releasing is what emails the patient, so that is drawn as its consequence rather than
// as another thing the technologist does.
function departmentFlow(dept, formStep) {
  return {
    name: dept, actor: `${dept} Staff`, landing: `${dept} Worklist`,
    columns: [
      [{ k: 'proc', l: 'Open a released ticket' },
        { k: 'proc', l: 'Perform the test' },
        { k: 'io', l: formStep },
        { k: 'proc', l: 'Save findings' },
        { k: 'dec', l: 'Ready to release?', mainLabel: 'yes',
          side: { l: 'Leave for release later', label: 'no', toEnd: true } },
        { k: 'proc', l: 'Release the result' },
        { k: 'proc', l: 'Patient emailed the report' }],
      [{ k: 'proc', l: 'Open a released result' },
        { k: 'proc', l: 'Amend the findings' },
        { k: 'proc', l: 'Save as a new version' },
        { k: 'proc', l: 'Earlier version kept' }],
      [{ k: 'proc', l: `${dept} History` },
        { k: 'proc', l: 'Search past reports' },
        { k: 'io', l: 'Print or resend report' }],
    ],
  };
}

const CLIENT_FLOW = {
  name: 'Client Patient', actor: 'Client / Patient', landing: 'View services', gate: false,
  start: 'Open website', chain: true,
  columns: [
    [{ k: 'proc', l: 'Book a visit' },
      { k: 'dec', l: 'Have an account?', mainLabel: 'yes', side: { l: 'Register and verify code', label: 'no' } },
      { k: 'proc', l: 'Choose patient profile' },
      { k: 'proc', l: 'Pick date and time' },
      { k: 'proc', l: 'Pick tests' }],
    [{ k: 'dec', l: 'HMO patient?', mainLabel: 'no', side: { l: 'Enter member and card', label: 'yes' } },
      { k: 'proc', l: 'Confirm booking' },
      { k: 'proc', l: 'Get reference and QR' },
      { k: 'proc', l: 'Email with instructions' }],
    [{ k: 'dec', l: 'Pay now?', mainLabel: 'no', side: { l: 'Pay GCash, upload proof', label: 'yes' } },
      { k: 'proc', l: 'Arrive at clinic' },
      { k: 'proc', l: 'Desk scans QR' },
      { k: 'proc', l: 'Get queue ticket' }],
    [{ k: 'proc', l: 'Test performed' },
      { k: 'proc', l: 'Result released' },
      { k: 'io', l: 'View or print result' }],
  ],
};

// ── 2. Use case diagrams ────────────────────────────────────────────────────────────────────────
function useCase(spec) {
  const p = new Page(spec.name);
  const gap = 16, h = 50, w = 250;
  const total = spec.cases.length * (h + gap) - gap;
  p.node(spec.actor, 60, 80 + total / 2 - 50, 50, 100, S.umlActor);
  const placed = {};
  spec.cases.forEach((label, i) => {
    const y = 80 + i * (h + gap);
    const cell = p.node(label, 320, y, w, h, S.ellipse);
    placed[label] = cell;
    p.edge({ id: p.cells[0].match(/id="(n\d+)"/)[1] }, cell, '', S.edgeStraight);
  });
  (spec.relations || []).forEach((rel) => {
    const from = placed[rel.from];
    if (!from) return;
    const cell = p.node(rel.to, 680, from.y, w, h, S.ellipse);
    p.edge(from, cell, rel.kind === 'include' ? '«include»' : '«extend»', S.edgeDashed);
  });
  return p;
}

const USE_CASES = [
  { name: 'Super Admin', actor: 'Super Admin',
    cases: ['Login', 'Manage Roles and Permissions', 'Manage Per-Account Access', 'Manage Staff and Admin Accounts', 'Manage Services, Packages and Pricing', 'Publish Payment Channels', 'Manage Clinic Schedule', 'View System Analytics', 'View Activity Log', 'Archive and Restore Patient Records', 'Logout'],
    relations: [{ from: 'Manage Roles and Permissions', to: 'Record Change in Activity Log', kind: 'include' }] },
  { name: 'Admin', actor: 'Admin',
    cases: ['Login', 'View Today', 'Decide HMO Claims', 'Manage Staff Accounts', 'Manage Appointments', 'Manage Patient Records', 'Monitor Cashier Transactions', 'Generate Reports', 'View Activity Log', 'Logout'],
    relations: [{ from: 'Manage Patient Records', to: 'Print Records and Results', kind: 'extend' }, { from: 'Generate Reports', to: 'Export CSV', kind: 'extend' }] },
  { name: 'Receptionist', actor: 'Receptionist',
    cases: ['Login', 'View Today', 'Find Patient or Booking', 'Verify QR Code', 'Check In Patient', 'Register Walk-In', 'Assign Tests to a Visit', 'Raise HMO Claim', 'Mark No-Show', 'View Visit History', 'Logout'],
    relations: [{ from: 'Check In Patient', to: 'Issue Queue Ticket', kind: 'include' }, { from: 'Register Walk-In', to: 'Create Patient Record', kind: 'include' }] },
  { name: 'Cashier', actor: 'Cashier',
    cases: ['Login', 'View Today', 'Process Billing and Payment', 'Apply Statutory Discount', 'Review Online Payment Proof', 'Reverse a Payment', 'View Transaction History', 'Logout'],
    relations: [{ from: 'Process Billing and Payment', to: 'Issue Receipt', kind: 'include' }, { from: 'View Transaction History', to: 'Print Receipt Copy', kind: 'extend' }] },
  { name: 'Laboratory Staff', actor: 'Laboratory Staff',
    cases: ['Login', 'View Laboratory Worklist', 'Upload Laboratory Report', 'Release Result', 'Email Result to Patient', 'Replace Released Report', 'Search Result History', 'Logout'],
    relations: [{ from: 'Search Result History', to: 'Print Laboratory Result', kind: 'extend' }, { from: 'Release Result', to: 'Record Delivery', kind: 'include' }] },
  { name: 'Ultrasound Staff', actor: 'Ultrasound Staff',
    cases: ['Login', 'View Ultrasound Worklist', 'Upload Ultrasound Report', 'Release Result', 'Email Result to Patient', 'Replace Released Report', 'Search Result History', 'Logout'],
    relations: [{ from: 'Search Result History', to: 'Print Ultrasound Result', kind: 'extend' }, { from: 'Release Result', to: 'Record Delivery', kind: 'include' }] },
  { name: 'Xray Staff', actor: 'X-Ray Staff',
    cases: ['Login', 'View X-Ray Worklist', 'Upload X-Ray Report', 'Release Result', 'Email Result to Patient', 'Replace Released Report', 'Search Result History', 'Logout'],
    relations: [{ from: 'Search Result History', to: 'Print X-Ray Result', kind: 'extend' }, { from: 'Release Result', to: 'Record Delivery', kind: 'include' }] },
  { name: 'Client Patient', actor: 'Client / Patient',
    cases: ['Register Account', 'Login', 'View Available Services', 'Manage Patient Profiles', 'Book Appointment', 'Reschedule or Cancel Booking', 'Pay Online and Upload Proof', 'View Diagnostic Results', 'View Receipt', 'Manage Account Profile', 'Logout'],
    relations: [{ from: 'Register Account', to: 'Verify Emailed Code', kind: 'include' }, { from: 'Book Appointment', to: 'Generate QR Booking Pass', kind: 'include' }, { from: 'Login', to: 'Sign In with Google', kind: 'extend' }] },
];

// ── 3. DFD level 0 ──────────────────────────────────────────────────────────────────────────────
const SYSTEM_NAME = 'Enlogada Ultrasound and Diagnostic\nClinic Management System';
const SYSTEM_ONE_LINE = 'Enlogada Ultrasound and Diagnostic Clinic Management System';

// The paper's own Level 0 shape: a modest process box, a SMALL actor, and the flows routed
// around them. Steven's note — the actor must not be drawn as a tall slab.
//
// What makes it readable is the routing, not the box sizes. Every flow gets a corridor of its own,
// and the corridors are NESTED: the one furthest from the boxes starts furthest right on the actor
// and lands furthest left on the system, so no two flows in a group ever cross. Inputs run above
// the boxes and outputs below, so the direction is clear before the arrowhead is read, and each
// label sits alone on its own corridor.
function dfd0(spec) {
  const p = new Page(spec.name);
  const G = 44, TOP = 70, LEAD = 34;
  const SYS_X = 160, SYS_W = 420, SYS_H = 170;
  const ACT_X = 1120, ACT_W = 210, ACT_H = 90;
  const ins = spec.inputs, outs = spec.outputs;

  const sysY = TOP + LEAD + Math.max(0, ins.length - 1) * G;
  const sys = p.node(SYSTEM_ONE_LINE, SYS_X, sysY, SYS_W, SYS_H, S.system);
  const ent = p.node(spec.name, ACT_X, sysY + (SYS_H - ACT_H) / 2, ACT_W, ACT_H, S.entity);

  // Spread the attachment points along an edge, leaving the corners alone.
  const spread = (i, n, from, to) => (n < 2 ? (from + to) / 2 : from + (i * (to - from)) / (n - 1));

  ins.forEach((label, i) => {
    const y = sysY - LEAD - i * G;
    const fromX = spread(i, ins.length, 0.25, 0.8);          // further right the higher it climbs
    const toX = spread(i, ins.length, 0.85, 0.15);           // and further left where it comes down
    p.edge(ent, sys, label, S.edgeFlow + `exitX=${fromX.toFixed(3)};exitY=0;exitDx=0;exitDy=0;entryX=${toX.toFixed(3)};entryY=0;entryDx=0;entryDy=0;`,
      [[ACT_X + fromX * ACT_W, y], [SYS_X + toX * SYS_W, y]]);
  });
  outs.forEach((label, j) => {
    const y = sysY + SYS_H + LEAD + j * G;
    const fromX = spread(j, outs.length, 0.85, 0.15);
    const toX = spread(j, outs.length, 0.25, 0.8);
    p.edge(sys, ent, label, S.edgeFlow + `exitX=${fromX.toFixed(3)};exitY=1;exitDx=0;exitDy=0;entryX=${toX.toFixed(3)};entryY=1;entryDx=0;entryDy=0;`,
      [[SYS_X + fromX * SYS_W, y], [ACT_X + toX * ACT_W, y]]);
  });
  return p;
}

const DFD0 = [
  { name: 'Super Admin',
    inputs: ['Login details', 'Role access', 'Services and prices', 'Payment channel', 'Clinic hours', 'Report request'],
    outputs: ['Account confirmed', 'Updated access', 'Updated services', 'Analytics', 'Audit trail'] },
  { name: 'Admin',
    inputs: ['Login details', 'HMO decision', 'Staff account', 'Record correction', 'Report request'],
    outputs: ['Account confirmed', 'HMO claims', 'Patient records', 'Reports', 'Payment records'] },
  { name: 'Receptionist',
    inputs: ['Login details', 'Walk-in details', 'Scanned QR code', 'Test request', 'HMO claim', 'No-show'],
    outputs: ['Account confirmed', 'Booking details', 'Queue ticket', 'Billing request', 'HMO decision'] },
  { name: 'Cashier',
    inputs: ['Login details', 'Payment details', 'Discount claim', 'Proof decision', 'Refund details'],
    outputs: ['Account confirmed', 'Patients to bill', 'Receipt', 'Payment proofs', 'Takings'] },
  { name: 'Laboratory Staff',
    inputs: ['Login details', 'Laboratory report file', 'Status update', 'Report delivery'],
    outputs: ['Account confirmed', 'Laboratory requests', 'Patient details', 'Released result'] },
  { name: 'Ultrasound Staff',
    inputs: ['Login details', 'Ultrasound report file', 'Status update', 'Report delivery'],
    outputs: ['Account confirmed', 'Ultrasound requests', 'Patient details', 'Released result'] },
  { name: 'Xray Staff',
    inputs: ['Login details', 'X-ray report file', 'Status update', 'Report delivery'],
    outputs: ['Account confirmed', 'X-ray requests', 'Patient details', 'Released result'] },
  { name: 'Client Patient',
    inputs: ['Registration details', 'Verification code', 'Login details', 'Patient profile', 'Booking request', 'Proof of payment'],
    outputs: ['Account confirmed', 'QR booking pass', 'Preparation notes', 'Receipt', 'Results'] },
];

function dfd0Context() {
  const p = new Page('Context');
  const sys = p.node(SYSTEM_ONE_LINE, 560, 470, 360, 140, S.system);
  const left = ['Client / Patient', 'Receptionist', 'Cashier', 'Laboratory Staff'];
  const right = ['Ultrasound Staff', 'X-Ray Staff', 'Admin', 'Super Admin'];
  const labels = {
    'Client / Patient': 'bookings, payments, results',
    Receptionist: 'check-in, walk-ins, queue',
    Cashier: 'billing, receipts, takings',
    'Laboratory Staff': 'laboratory results',
    'Ultrasound Staff': 'ultrasound results',
    'X-Ray Staff': 'x-ray results',
    Admin: 'HMO decisions, reports',
    'Super Admin': 'access, services, schedule',
  };
  left.forEach((name, i) => {
    const e = p.node(name, 80, 120 + i * 220, 200, 80, S.entity);
    p.edge(e, sys, labels[name], S.edgeFlow + 'startArrow=classic;startFill=1;');
  });
  right.forEach((name, i) => {
    const e = p.node(name, 1200, 120 + i * 220, 200, 80, S.entity);
    p.edge(e, sys, labels[name], S.edgeFlow + 'startArrow=classic;startFill=1;');
  });
  return p;
}

// ── 4. DFD level 1 ──────────────────────────────────────────────────────────────────────────────
const STORES = {
  D1: 'Users and Access', D2: 'Patients', D3: 'Appointments and Visits',
  D4: 'Payments', D5: 'Service Catalogue', D6: 'Diagnostic Results',
  D7: 'HMO Claims', D8: 'Clinic Schedule', D9: 'Logs and Notifications',
};

// The shape the paper's own Level 1 figures use, and Steven's reference: ONE small actor at the
// top left, the processes numbered down the middle, the data stores down the right.
//
// What has to be got right is the left margin, because that is where every flow to and from the
// actor runs. Each flow is given a TRACK of its own there — a vertical line at its own x — rather
// than a single shared trunk, which is what put ten labels on one line and left nothing to say
// which process each belonged to. The tracks are ordered so the lower the process, the further
// left its track, and a flow leaves the actor lower the further down it is going; with those two
// rules together no two flows ever cross. Each label sits on the horizontal run at the PROCESS
// end, where it is next to the thing it describes.
function dfd1(spec) {
  const p = new Page(spec.name);
  const PROC_H = 110, ROW_H = 190, TOP = 70;
  const ENT_X = 40, ENT_W = 200, ENT_H = 150;
  const PROC_X = 700, PROC_W = 280, STORE_X = 1180;
  // The tracks stop 170px short of the process, which leaves a clear band for the labels.
  const TRACK_GAP = 24, TRACK_FIRST = PROC_X - 170, LABEL = { dx: -80, dy: 0 };

  const ent = p.node(spec.name, ENT_X, TOP, ENT_W, ENT_H, S.entity);
  const entRight = ENT_X + ENT_W;
  const total = spec.processes.length * ROW_H - (ROW_H - PROC_H);

  // Every flow on the sheet, in the order it leaves the actor: top to bottom, process by process.
  const all = spec.processes.flatMap((proc, i) => [
    ...(proc.in || []).map((label) => ({ i, label, into: true })),
    ...(proc.out || []).map((label) => ({ i, label, into: false })),
  ]);
  const entY = (g) => TOP + ((g + 1) * ENT_H) / (all.length + 1);

  let g = 0;
  spec.processes.forEach((proc, i) => {
    const y = TOP + i * ROW_H;
    const lane = p.node(proc.n, PROC_X, y, PROC_W, PROC_H, S.procHead);
    p.node(proc.name, 0, 24, PROC_W, PROC_H - 24, S.procBody, lane.id);

    const ins = proc.in || [], outs = proc.out || [];
    const flows = ins.length + outs.length;
    const laneY = (j) => y + ((j + 1) * PROC_H) / (flows + 1);

    [...ins.map((l) => ({ l, into: true })), ...outs.map((l) => ({ l, into: false }))]
      .forEach(({ l, into }, j) => {
        const ay = entY(g), py = laneY(j), track = TRACK_FIRST - g * TRACK_GAP;
        g += 1;
        const at = `exitX=1;exitY=${(((ay - TOP) / ENT_H)).toFixed(4)};exitDx=0;exitDy=0;`;
        const on = `entryX=0;entryY=${(((py - y) / PROC_H)).toFixed(4)};entryDx=0;entryDy=0;`;
        if (into) {
          p.edge(ent, lane, l, S.edgeFlow + at + on, [[track, ay], [track, py]], { at: 1, ...LABEL });
        } else {
          p.edge(lane, ent, l, S.edgeFlow
            + `exitX=0;exitY=${(((py - y) / PROC_H)).toFixed(4)};exitDx=0;exitDy=0;`
            + `entryX=1;entryY=${(((ay - TOP) / ENT_H)).toFixed(4)};entryDx=0;entryDy=0;`,
            [[track, py], [track, ay]], { at: -1, ...LABEL });
        }
      });

    // Each store sits at its own height beside this process, with its read and its write on their
    // own lines. Two stores fit inside the row; a third would start crowding the row below.
    const stores = proc.stores || [];
    const ST_H = 62, ST_GAP = 12;
    stores.forEach((st, k) => {
      const sy = y - 4 + k * (ST_H + ST_GAP);
      const tag = p.node(st.id, STORE_X, sy, 44, ST_H, S.storeTag);
      p.node(STORES[st.id], STORE_X + 44, sy, 250, ST_H, S.storeName);
      const pair = (st.to ? 1 : 0) + (st.from ? 1 : 0);
      let n = 0;
      const nextY = () => { n += 1; return sy + (n * ST_H) / (pair + 1); };
      if (st.to) {
        const fy = nextY();
        p.edge(lane, tag, st.to, S.edgeFlow
          + `exitX=1;exitY=${(((fy - y) / PROC_H)).toFixed(4)};exitDx=0;exitDy=0;entryX=0;entryY=${(((fy - sy) / ST_H)).toFixed(4)};entryDx=0;entryDy=0;`);
      }
      if (st.from) {
        const fy = nextY();
        p.edge(tag, lane, st.from, S.edgeFlow
          + `exitX=0;exitY=${(((fy - sy) / ST_H)).toFixed(4)};exitDx=0;exitDy=0;entryX=1;entryY=${(((fy - y) / PROC_H)).toFixed(4)};entryDx=0;entryDy=0;`);
      }
    });
  });

  // Said once, at the foot, and only where a store really is drawn twice.
  const drawn = spec.processes.flatMap((proc) => (proc.stores || []).map((st) => st.id));
  if (drawn.length !== new Set(drawn).size) {
    p.node('A data store drawn more than once on this sheet is the same store.',
      ENT_X, TOP + total + 40, 520, 44, S.note);
  }
  return p;
}

const P = {
  login: { n: '1.0', name: 'Manage Login' },
  profiles: { n: '2.0', name: 'Manage Patient Profiles' },
  appts: { n: '3.0', name: 'Manage Appointments' },
  checkin: { n: '4.0', name: 'Check In and Issue Ticket' },
  requests: { n: '5.0', name: 'Manage Test Requests' },
  hmoRaise: { n: '6.0', name: 'Record HMO Claim' },
  hmoDecide: { n: '7.0', name: 'Decide HMO Claim' },
  billing: { n: '8.0', name: 'Process Payment' },
  proof: { n: '9.0', name: 'Review Payment Proof' },
  release: { n: '10.0', name: 'Release Visit' },
  results: { n: '11.0', name: 'Upload Results' },
  deliver: { n: '12.0', name: 'Release Results' },
  records: { n: '13.0', name: 'Manage Patient Records' },
  catalogue: { n: '14.0', name: 'Manage Services and Prices' },
  schedule: { n: '15.0', name: 'Manage Schedule' },
  staff: { n: '16.0', name: 'Manage Staff Accounts' },
  rbac: { n: '17.0', name: 'Manage Roles and Access' },
  reports: { n: '18.0', name: 'Generate Reports' },
  notify: { n: '19.0', name: 'Send Emails' },
  audit: { n: '20.0', name: 'Record Audit Trail' },
};
const login = () => ({ ...P.login, in: ['Login details'], out: ['Account confirmed'], stores: [{ id: 'D1', to: 'Check credentials', from: 'Account details' }] });

const DFD1 = [
  { name: 'Super Admin', processes: [
    login(), { ...P.rbac, in: ['Role access'], out: ['Updated access'], stores: [{ id: 'D1', to: 'Save access' }] },
    { ...P.catalogue, in: ['Services and prices'], out: ['Updated services'], stores: [{ id: 'D5', to: 'Save service', from: 'Service list' }] },
    { ...P.schedule, in: ['Clinic hours'], out: ['Published hours'], stores: [{ id: 'D8', to: 'Save hours' }] },
    { ...P.reports, in: ['Report request'], out: ['Analytics'], stores: [{ id: 'D4', from: 'Payments' }, { id: 'D3', from: 'Visits' }] },
    { ...P.audit, out: ['Audit trail'], stores: [{ id: 'D9', from: 'Audit entries' }] }] },
  { name: 'Admin', processes: [
    login(), { ...P.hmoDecide, in: ['HMO decision'], out: ['HMO claims'], stores: [{ id: 'D7', to: 'Save decision', from: 'Pending claims' }] },
    { ...P.staff, in: ['Staff account'], out: ['Account created'], stores: [{ id: 'D1', to: 'Save account' }] },
    { ...P.records, in: ['Record correction'], out: ['Patient records'], stores: [{ id: 'D2', to: 'Update record', from: 'Patient details' }] },
    { ...P.reports, in: ['Report request'], out: ['Reports'], stores: [{ id: 'D4', from: 'Payments' }, { id: 'D3', from: 'Visits and tests' }] }] },
  { name: 'Receptionist', processes: [
    login(), { ...P.profiles, in: ['Walk-in details'], out: ['Record created'], stores: [{ id: 'D2', to: 'Save patient', from: 'Patient details' }] },
    { ...P.checkin, in: ['Scanned QR code'], out: ['Queue ticket'], stores: [{ id: 'D3', to: 'Save arrival and ticket', from: "Today's bookings" }] },
    { ...P.requests, in: ['Test request'], out: ['Billing request'], stores: [{ id: 'D3', to: 'Save visit tests' }, { id: 'D5', from: 'Services and packages' }] },
    { ...P.hmoRaise, in: ['HMO claim'], out: ['Claim sent'], stores: [{ id: 'D7', to: 'Save claim and card' }] }] },
  { name: 'Cashier', processes: [
    login(), { ...P.billing, in: ['Payment details'], out: ['Receipt'], stores: [{ id: 'D4', to: 'Save payment', from: 'Discount types' }, { id: 'D3', from: 'Tests and prices' }] },
    { ...P.proof, in: ['Proof decision'], out: ['Payment proofs'], stores: [{ id: 'D4', to: 'Save outcome', from: 'Uploaded proofs' }] },
    { ...P.release, out: ['Sent to department'], stores: [{ id: 'D3', to: 'Set to processing' }] },
    { ...P.reports, in: ['Date range'], out: ['Takings'], stores: [{ id: 'D4', from: 'Payments and refunds' }] }] },
  ...['Laboratory', 'Ultrasound', 'Xray'].map((dept) => ({
    name: `${dept} Staff`, processes: [
      login(),
      { ...P.results, in: [`${dept === 'Xray' ? 'X-ray' : dept} report file`], out: ['Test requests'], stores: [{ id: 'D6', to: 'Save report and version' }, { id: 'D3', from: 'Released tests' }] },
      { ...P.deliver, in: ['Status update'], out: ['Released result'], stores: [{ id: 'D6', to: 'Save release' }] },
      { ...P.notify, out: ['Result emailed'], stores: [{ id: 'D9', to: 'Save notification' }] }],
  })),
  { name: 'Client Patient', processes: [
    { ...P.login, in: ['Registration details', 'Login details'], out: ['Verification code', 'Account confirmed'], stores: [{ id: 'D1', to: 'Save account and code', from: 'Account details' }] },
    { ...P.profiles, in: ['Patient profile'], out: ['Saved profiles'], stores: [{ id: 'D2', to: 'Save profile', from: 'Profile details' }] },
    { ...P.appts, in: ['Booking request'], out: ['QR booking pass'], stores: [{ id: 'D3', to: 'Save booking', from: 'Open slots' }, { id: 'D8', from: 'Clinic hours' }] },
    { ...P.proof, in: ['Proof of payment'], out: ['Receipt'], stores: [{ id: 'D4', to: 'Save submission' }] },
    { ...P.deliver, out: ['Results'], stores: [{ id: 'D6', from: 'Released results' }] }] },
];

// ── 5. ERD, read from the live database ─────────────────────────────────────────────────────────
const SHEETS = [
  { name: 'Clinical Core', tables: ['patients', 'patient_types', 'patient_visits', 'appointments', 'visit_tests', 'tests', 'test_categories', 'test_packages', 'test_package_items', 'test_results', 'result_field_sets', 'result_fields', 'result_field_set_tests', 'result_measurements', 'clinic_signatories'] },
  { name: 'Money and HMO', tables: ['payments', 'payment_methods', 'payment_submissions', 'discount_types', 'daily_counters', 'hmo_providers', 'hmo_requests', 'hmo_request_tests'] },
  { name: 'Access Schedule and System', tables: ['users', 'roles', 'permissions', 'role_permissions', 'user_roles', 'user_permissions', 'user_departments', 'auth_codes', 'clinic_operating_hours', 'clinic_schedule_overrides', 'audit_log', 'notification_events', 'notification_reads'] },
];

function pgType(c) {
  const t = c.data_type;
  if (c.column_default && /nextval/.test(c.column_default)) return 'SERIAL';
  if (t === 'character varying') return `VARCHAR(${c.character_maximum_length || ''})`;
  if (t === 'numeric') return c.numeric_precision ? `NUMERIC(${c.numeric_precision},${c.numeric_scale})` : 'NUMERIC';
  if (t === 'timestamp without time zone') return 'TIMESTAMP';
  if (t === 'timestamp with time zone') return 'TIMESTAMPTZ';
  if (t === 'time without time zone') return 'TIME';
  if (t === 'character') return `CHAR(${c.character_maximum_length || ''})`;
  if (t === 'USER-DEFINED') return 'ENUM';
  return t.toUpperCase();
}

function erdSheet(sheet, schema) {
  const p = new Page(sheet.name);
  const { columns, pks, fks } = schema;
  const onSheet = new Set(sheet.tables);
  const placed = {};
  const COL_X = [60, 460, 860, 1260];
  const colBottom = [60, 60, 60, 60];
  const ROW_H = 26, HEAD = 30;

  const rowIds = {};
  const order = sheet.tables.slice().sort((a, b) => (columns[b] || []).length - (columns[a] || []).length);
  order.forEach((tbl) => {
    const cols = columns[tbl] || [];
    const h = HEAD + cols.length * ROW_H;
    let ci = 0;
    for (let i = 1; i < COL_X.length; i += 1) if (colBottom[i] < colBottom[ci]) ci = i;
    const x = COL_X[ci], y = colBottom[ci];
    colBottom[ci] = y + h + 40;
    const table = p.node(tbl, x, y, 360, h, S.table);
    placed[tbl] = table;
    rowIds[tbl] = {};
    cols.forEach((c, ri) => {
      const row = p.node('', 0, HEAD + ri * ROW_H, 360, ROW_H, S.tableRow, table.id);
      rowIds[tbl][c.column_name] = row;
      const isPk = (pks[tbl] || []).includes(c.column_name);
      const isFk = (fks[tbl] || []).some((f) => f.column === c.column_name);
      const key = isPk ? 'PK' : isFk ? 'FK' : '';
      p.node(key, 0, 0, 36, ROW_H, S.tableCell + 'align=center;fontStyle=1;', row.id);
      p.node(c.column_name, 36, 0, 196, ROW_H, S.tableCell + (isPk ? 'fontStyle=1;' : ''), row.id);
      p.node(pgType(c) + (c.is_nullable === 'NO' ? '' : ' ?'), 232, 0, 148, ROW_H, S.tableCell, row.id);
    });
  });

  // Foreign keys inside the sheet; a parent on another sheet is drawn as a faint ghost.
  const ghosts = {};
  sheet.tables.forEach((tbl) => {
    (fks[tbl] || []).forEach((f) => {
      let target = placed[f.parent];
      if (!target) {
        if (!ghosts[f.parent]) {
          let ci = 0;
          for (let i = 1; i < COL_X.length; i += 1) if (colBottom[i] < colBottom[ci]) ci = i;
          ghosts[f.parent] = p.node(`${f.parent}\n(see the other sheet)`, COL_X[ci], colBottom[ci], 360, 54, S.tableGhost);
          colBottom[ci] += 94;
        }
        target = ghosts[f.parent];
      } else {
        // Point at the parent's own key row, the way Workbench draws it.
        const pk = (pks[f.parent] || [])[0];
        if (pk && rowIds[f.parent] && rowIds[f.parent][pk]) target = rowIds[f.parent][pk];
      }
      // The line starts at the foreign-key row itself, so it needs no label.
      const source = (rowIds[tbl] && rowIds[tbl][f.column]) || placed[tbl];
      p.edge(source, target, '', S.erEdge);
    });
  });

  p.node(`${sheet.name}: ${sheet.tables.length} tables. PostgreSQL types. "?" = nullable. PK = primary key. FK = foreign key.`,
    60, Math.max(...colBottom) + 20, 640, 56, S.note);
  return p;
}

async function readSchema() {
  require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });
  const db = require(path.join(BACKEND, 'src', 'config', 'database'));
  const cols = await db.query(
    `SELECT table_name, column_name, data_type, character_maximum_length, numeric_precision, numeric_scale,
            is_nullable, column_default, ordinal_position
       FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`
  );
  const keys = await db.query(
    `SELECT con.contype, src.relname AS child, tgt.relname AS parent, a.attname AS column
       FROM pg_constraint con
       JOIN pg_class src ON src.oid = con.conrelid
       LEFT JOIN pg_class tgt ON tgt.oid = con.confrelid
       JOIN unnest(con.conkey) AS k(attnum) ON TRUE
       JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = k.attnum
       JOIN pg_namespace n ON n.oid = src.relnamespace
      WHERE n.nspname = 'public' AND con.contype IN ('p', 'f')`
  );
  const columns = {}, pks = {}, fks = {};
  cols.rows.forEach((c) => { (columns[c.table_name] ||= []).push(c); });
  keys.rows.forEach((k) => {
    if (k.contype === 'p') (pks[k.child] ||= []).push(k.column);
    else (fks[k.child] ||= []).push({ column: k.column, parent: k.parent });
  });
  return { columns, pks, fks };
}

// ── Build ───────────────────────────────────────────────────────────────────────────────────────
(async () => {
  writeFile('flowcharts.drawio', [
    flowchart(SUPER_ADMIN_FLOW), flowchart(ADMIN_FLOW), flowchart(RECEPTIONIST_FLOW), flowchart(CASHIER_FLOW),
    flowchart(departmentFlow('Laboratory', 'Upload report file')),
    flowchart(departmentFlow('Ultrasound', 'Upload report file')),
    flowchart(departmentFlow('X-Ray', 'Upload report file')),
    flowchart(CLIENT_FLOW),
  ]);
  writeFile('usecases.drawio', USE_CASES.map(useCase));
  writeFile('dfd-level0.drawio', [dfd0Context(), ...DFD0.map(dfd0)]);
  writeFile('dfd-level1.drawio', DFD1.map(dfd1));

  const schema = await readSchema();
  writeFile('erd.drawio', SHEETS.map((s) => erdSheet(s, schema)));
  const total = Object.keys(schema.columns).length;
  const drawn = SHEETS.reduce((n, s) => n + s.tables.length, 0);
  console.log(`ERD: ${drawn} of ${total} tables drawn across ${SHEETS.length} sheets`);
  if (drawn !== total) {
    const missing = Object.keys(schema.columns).filter((t) => !SHEETS.some((s) => s.tables.includes(t)));
    console.log(`MISSING from the sheets: ${missing.join(', ')}`);
  }
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
