// Wraps rendered SVG bodies in a root element that carries its own theme
// variables, so the exported .svg looks the same outside the viewer.
import { esc } from './utils.mjs';

export const SVG_STYLE = `
svg.vibex{font-family:var(--font-sans);font-size:12px}
svg.vibex{--font-sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;--font-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
svg.vibex[data-theme="light"]{--bg:#faf9f5;--surface:#ffffff;--surface-2:#f2efe7;--border:#ddd8cd;--border-soft:#e8e3d8;--text:#1c1a17;--text-2:#4e4a44;--text-3:#6b6459;--edge:#5f594f;--edge-soft:#a8a296;--label-bg:#ffffff;--accent:#2b6cb0;--pk:#975a16;--fk:#2b6cb0;--group:#8a8276;--person:#0a4372;--system:#1168bd;--container:#2f7ac6;--component:#8fc0ee;--component-text:#0f2f56;--database:#227a8c;--queue:#5b62b5;--external:#77818f;--boundary:#a09a8e;--boundary-fill:#f2efe7;--boundary-tag:#ffffff;--dashed:#6f685c;--get:#2f855a;--post:#2b6cb0;--put:#975a16;--patch:#805ad5;--delete:#c53030;--other:#6b6459;--query:#2b6cb0;--mutation:#975a16;--subscription:#805ad5;--event:#2c7a7b;--badge-text:#ffffff;--muted-fill:#f2efe7;--lc-waiting:#b7791f;--lc-waiting-bg:#fff8e6;--lc-terminal:#2f855a;--lc-terminal-bg:#e9f7ef;--lc-failure:#c53030;--lc-failure-bg:#fdecec;--c-proposed:#7c3aed}
svg.vibex[data-theme="dark"]{--bg:#121316;--surface:#1f2125;--surface-2:#282b31;--border:#3d414a;--border-soft:#282b31;--text:#f0f0f2;--text-2:#b9bcc2;--text-3:#8a8e95;--edge:#9a9da4;--edge-soft:#64686f;--label-bg:#1f2125;--accent:#63b3ed;--pk:#ecc94b;--fk:#63b3ed;--group:#74787f;--person:#1b5285;--system:#2a7ad1;--container:#3d86cc;--component:#7fb5ec;--component-text:#0d2440;--database:#2a8fa3;--queue:#6a71c9;--external:#5a6674;--boundary:#63676e;--boundary-fill:#191a1e;--boundary-tag:#232529;--dashed:#8d9097;--get:#48bb78;--post:#63b3ed;--put:#ecc94b;--patch:#b794f4;--delete:#fc8181;--other:#a0aec0;--query:#63b3ed;--mutation:#ecc94b;--subscription:#b794f4;--event:#4fd1c5;--badge-text:#121316;--muted-fill:#282b31;--lc-waiting:#ecc94b;--lc-waiting-bg:#2a2410;--lc-terminal:#48bb78;--lc-terminal-bg:#12281c;--lc-failure:#fc8181;--lc-failure-bg:#3a1c1c;--c-proposed:#a78bfa}
.node{cursor:pointer}
.node rect.box{fill:var(--surface);stroke:var(--border);stroke-width:1.2}
.node .title{fill:var(--text);font-weight:600;font-size:13px}
.node .sub{fill:var(--text-3);font-size:10.5px}
.node .row-text{fill:var(--text);font-size:12px;font-family:var(--font-mono)}
.node .row-type{fill:var(--text-3);font-size:10.5px;font-family:var(--font-mono)}
.node .row-sep{stroke:var(--border-soft);stroke-width:1}
.node .head{fill:var(--surface-2)}
.badge{font-size:9px;font-weight:700;font-family:var(--font-mono)}
.badge.pk{fill:var(--pk)}
.badge.fk{fill:var(--fk)}
.badge.uq{fill:var(--text-3)}
.group-frame{fill:var(--muted-fill);fill-opacity:.35;stroke:var(--group);stroke-width:1;stroke-dasharray:6 4;rx:10}
.group-label{fill:var(--text-2);font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.edge{cursor:pointer}
.edge path.line{fill:none;stroke:var(--edge);stroke-width:1.4}
.edge path.hit{fill:none;stroke:transparent;stroke-width:14}
.edge.dashed path.line{stroke-dasharray:6 4}
.edge-label{cursor:pointer}
.edge .label-bg,.edge-label .label-bg{fill:var(--label-bg);stroke:var(--border-soft);stroke-width:.8;rx:4}
.edge .label,.edge-label .label{fill:var(--text-2);font-size:10.5px}
.vibex-c4 .edge .label,.vibex-c4 .edge-label .label{font-size:11.5px}
.vibex-c4 .edge .label.tech,.vibex-c4 .edge-label .label.tech{font-size:10.5px}
.edge .label.tech,.edge-label .label.tech{fill:var(--text-3);font-size:9.5px}
.edge .label.mono,.edge-label .label.mono{font-family:var(--font-mono)}
marker path,marker circle,marker line{stroke:var(--edge);fill:none;stroke-width:1.4}
marker.arrow path{fill:var(--edge)}
.c4 rect.box{stroke:none}
.c4.person rect.box,.c4.person circle,.c4.person path.fill{fill:var(--person)}
.c4.system rect.box,.c4.system path.fill{fill:var(--system)}
.c4.container rect.box,.c4.container path.fill{fill:var(--container)}
.c4.component rect.box,.c4.component path.fill{fill:var(--component)}
.c4.database rect.box,.c4.database ellipse,.c4.database path.fill{fill:var(--database)}
.c4.queue rect.box,.c4.queue path.fill{fill:var(--queue)}
.c4.external rect.box,.c4.external circle,.c4.external ellipse,.c4.external path.fill{fill:var(--external)}
.c4 .title,.c4 .desc{fill:#fff}
.c4 .sub{fill:rgba(255,255,255,.78)}
.c4 .desc{fill:rgba(255,255,255,.92)}
.c4 .title{font-size:15px;font-weight:650}
.c4 .sub{font-size:10.5px;letter-spacing:.02em}
.c4 .desc{font-size:11.5px}
.c4.component .title,.c4.component .desc{fill:var(--component-text)}
.c4.component .sub{fill:var(--component-text);fill-opacity:.75}
.c4 .db-line{stroke:rgba(255,255,255,.45);fill:none;stroke-width:1.2}
.c4 .drill{fill:#fff;fill-opacity:.92;font-size:10.5px;font-weight:600}
.c4 .drill-rule{stroke:#fff;stroke-opacity:.45;stroke-width:1}
.c4.component .drill{fill:var(--component-text)}
.c4.component .drill-rule{stroke:var(--component-text);stroke-opacity:.45}
.node.c4:hover rect.box,.node.c4:hover ellipse,.node.c4:hover circle,.node.c4:hover path.fill{filter:brightness(1.07)}
.vibex-c4 .edge path.line{stroke-width:1.6}
.vibex-c4 .edge .label-bg,.vibex-c4 .edge-label .label-bg{rx:5}
.vibex-c4 .leader{stroke:var(--edge-soft);stroke-width:1;fill:none;stroke-dasharray:2 2}
.lc-state rect.box{fill:var(--surface);stroke:var(--border);stroke-width:1.5}
.lc-state.initial rect.box{stroke:var(--accent);stroke-width:2}
.lc-state.waiting rect.box{fill:var(--lc-waiting-bg);stroke:var(--lc-waiting);stroke-dasharray:6 4}
.lc-state.terminal rect.box{fill:var(--lc-terminal-bg);stroke:var(--lc-terminal);stroke-width:1.5}
.lc-state.terminal rect.box-inner{fill:none;stroke:var(--lc-terminal);stroke-width:1.2}
.lc-state.failure rect.box{fill:var(--lc-failure-bg);stroke:var(--lc-failure);stroke-width:1.5}
.lc-state .title{font-size:14px;font-weight:650;fill:var(--text)}
.lc-state .desc{font-size:11px;fill:var(--text-2)}
.lc-state .actor{font-size:10px;fill:var(--text-3);font-family:var(--font-mono)}
.lc-state .start{fill:var(--accent);stroke:none}
.lc-state .start-line{fill:none;stroke:var(--edge);stroke-width:1.4}
.lc-transition.failure path.line{stroke:var(--lc-failure)}
.edge-label.failure .label{fill:var(--lc-failure)}
.edge .label,.edge-label .label{font-size:11.5px}
.boundary rect.frame{fill:var(--boundary-fill);fill-opacity:.55;stroke:var(--boundary);stroke-width:1.3;stroke-dasharray:9 6;rx:14}
.boundary.depth-1 rect.frame{fill-opacity:.8;stroke-dasharray:6 4}
.boundary.depth-2 rect.frame{fill-opacity:.95;stroke-dasharray:4 3}
.boundary rect.tag{fill:var(--boundary-tag);stroke:var(--boundary);stroke-width:1;rx:7}
.boundary text{fill:var(--text-2);font-size:12px;font-weight:650}
.boundary text.kind{font-weight:500;fill:var(--text-3);font-size:10.5px;letter-spacing:.04em}
.ep-card rect.box{fill:var(--surface);stroke:var(--border);stroke-width:1.2;rx:8}
.ep-card .head{fill:var(--surface-2)}
.ep-card .title{fill:var(--text);font-weight:600;font-size:13px}
.ep-card .count{fill:var(--text-3);font-size:10px}
.ep-row .path{fill:var(--text);font-size:11px;font-family:var(--font-mono)}
.ep-row .summary{fill:var(--text-3);font-size:9.5px}
.ep-row .sep{stroke:var(--border-soft)}
.ep-row .chip{fill:var(--muted-fill);stroke:var(--border-soft);rx:3}
.ep-row .chip-text{fill:var(--text-2);font-size:8.5px;font-family:var(--font-mono)}
.ep-row.deprecated .path{text-decoration:line-through;fill:var(--text-3)}
.method rect{rx:3}
.method text{fill:var(--badge-text);font-size:9.5px;font-weight:700;font-family:var(--font-mono)}
.method.GET rect{fill:var(--get)}.method.POST rect{fill:var(--post)}.method.PUT rect{fill:var(--put)}.method.PATCH rect{fill:var(--patch)}.method.DELETE rect{fill:var(--delete)}
.method.HEAD rect,.method.OPTIONS rect{fill:var(--other)}
.method.QUERY rect{fill:var(--query)}.method.MUTATION rect{fill:var(--mutation)}.method.SUBSCRIPTION rect{fill:var(--subscription)}.method.EVENT rect{fill:var(--event)}
.section-title{fill:var(--text-2);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.type-card rect.box{fill:var(--surface);stroke:var(--border);stroke-width:1.2;rx:8}
.type-card .head{fill:var(--surface-2)}
.watermark{fill:var(--text-3);font-size:9px}
.proposed-stamp text{fill:var(--c-proposed);font-size:12px;font-weight:700;letter-spacing:.12em;opacity:.65}
`;

export const MARKERS = `
<filter id="m-shadow" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#0b1220" flood-opacity="0.10"/></filter>
<marker id="m-arrow" class="arrow" viewBox="0 0 12 12" refX="10.5" refY="6" markerWidth="13" markerHeight="13" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M1 1 L11 6 L1 11 Z"/></marker>
<marker id="m-arrow-failure" class="arrow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M1 1 L11 6 L1 11 Z" style="fill:var(--lc-failure);stroke:var(--lc-failure)"/></marker>
<marker id="m-one" viewBox="0 0 24 20" refX="24" refY="10" markerWidth="24" markerHeight="20" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><line x1="0" y1="10" x2="24" y2="10"/><line x1="14" y1="3" x2="14" y2="17"/></marker>
<marker id="m-zero-or-one" viewBox="0 0 24 20" refX="24" refY="10" markerWidth="24" markerHeight="20" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><line x1="0" y1="10" x2="24" y2="10"/><circle cx="7" cy="10" r="3.5" style="fill:var(--label-bg)"/><line x1="16" y1="3" x2="16" y2="17"/></marker>
<marker id="m-many" viewBox="0 0 24 20" refX="24" refY="10" markerWidth="24" markerHeight="20" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><line x1="0" y1="10" x2="12" y2="10"/><circle cx="7" cy="10" r="3.5" style="fill:var(--label-bg)"/><path d="M12 10 L24 2 M12 10 L24 10 M12 10 L24 18"/></marker>
<marker id="m-one-or-many" viewBox="0 0 24 20" refX="24" refY="10" markerWidth="24" markerHeight="20" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><line x1="0" y1="10" x2="12" y2="10"/><line x1="9" y1="3" x2="9" y2="17"/><path d="M12 10 L24 2 M12 10 L24 10 M12 10 L24 18"/></marker>
`;

export function wrapSvg({ body, width, height, title, theme = 'light', diagramType, proposed = false }) {
  const w = Math.ceil(width); const h = Math.ceil(height);
  // Drawn into the SVG rather than the page, so an exported PNG dropped into a
  // slide deck still says what it is.
  const stamp = proposed
    ? `<g class="proposed-stamp" aria-hidden="true"><text x="${w - 18}" y="${h - 16}" text-anchor="end">PROPOSAL — DOES NOT EXIST</text></g>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" class="vibex vibex-${diagramType}" data-theme="${theme}" data-diagram-type="${diagramType}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="group" aria-label="${esc(title)}">
<style>${SVG_STYLE}</style>
<defs>${MARKERS}</defs>
<rect class="bg" x="0" y="0" width="${w}" height="${h}" style="fill:var(--bg)"/>
${body}
${stamp}
</svg>`;
}
