// Wraps rendered SVG bodies in a root element that carries its own theme
// variables, so the exported .svg looks the same outside the viewer.
import { esc } from './utils.mjs';

export const SVG_STYLE = `
svg.vibex{font-family:var(--font-sans);font-size:12px}
svg.vibex{--font-sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;--font-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
svg.vibex[data-theme="light"]{--bg:#f7f8fa;--surface:#ffffff;--surface-2:#f1f3f6;--border:#c9d0da;--border-soft:#e1e6ec;--text:#1a202c;--text-2:#4a5568;--text-3:#718096;--edge:#5a6472;--edge-soft:#a0aab6;--label-bg:#ffffff;--accent:#2b6cb0;--pk:#975a16;--fk:#2b6cb0;--group:#8a94a3;--person:#0b4a86;--system:#1168bd;--container:#2f7ac6;--component:#85bbf0;--component-text:#0f2f56;--external:#6b7683;--dashed:#6b7684;--get:#2f855a;--post:#2b6cb0;--put:#975a16;--patch:#805ad5;--delete:#c53030;--other:#718096;--query:#2b6cb0;--mutation:#975a16;--subscription:#805ad5;--event:#2c7a7b;--badge-text:#ffffff;--muted-fill:#eef1f5;--lc-waiting:#b7791f;--lc-waiting-bg:#fff8e6;--lc-terminal:#2f855a;--lc-terminal-bg:#e9f7ef;--lc-failure:#c53030;--lc-failure-bg:#fdecec}
svg.vibex[data-theme="dark"]{--bg:#0f1420;--surface:#171e2c;--surface-2:#1f2838;--border:#3a4557;--border-soft:#2a3444;--text:#e6ebf2;--text-2:#b4bfcd;--text-3:#8592a3;--edge:#9aa7b8;--edge-soft:#5d6a7c;--label-bg:#171e2c;--accent:#63b3ed;--pk:#ecc94b;--fk:#63b3ed;--group:#6f7c8e;--person:#1f5f9e;--system:#2a7ad1;--container:#3d86cc;--component:#7fb5ec;--component-text:#0d2440;--external:#5f6b79;--dashed:#8b97a8;--get:#48bb78;--post:#63b3ed;--put:#ecc94b;--patch:#b794f4;--delete:#fc8181;--other:#a0aec0;--query:#63b3ed;--mutation:#ecc94b;--subscription:#b794f4;--event:#4fd1c5;--badge-text:#0f1420;--muted-fill:#1f2838;--lc-waiting:#ecc94b;--lc-waiting-bg:#2a2410;--lc-terminal:#48bb78;--lc-terminal-bg:#12281c;--lc-failure:#fc8181;--lc-failure-bg:#3a1c1c}
.node{cursor:pointer}
.node rect.box{fill:var(--surface);stroke:var(--border);stroke-width:1.2}
.node rect.box,.ep-card rect.box,.type-card rect.box{filter:url(#m-shadow)}
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
.vibex-c4 .edge .label,.vibex-c4 .edge-label .label{font-size:12.5px}
.vibex-c4 .edge .label.tech,.vibex-c4 .edge-label .label.tech{font-size:11px}
.edge .label.tech,.edge-label .label.tech{fill:var(--text-3);font-size:9.5px}
.edge .label.mono,.edge-label .label.mono{font-family:var(--font-mono)}
marker path,marker circle,marker line{stroke:var(--edge);fill:none;stroke-width:1.4}
marker.arrow path{fill:var(--edge)}
.c4 rect.box{stroke:none}
.c4.person rect.box,.c4.person circle{fill:var(--person)}
.c4.system rect.box{fill:var(--system)}
.c4.container rect.box{fill:var(--container)}
.c4.component rect.box{fill:var(--component)}
.c4.database rect.box,.c4.database ellipse{fill:var(--container)}
.c4.database rect.box{fill:var(--container)}
.c4.queue rect.box{fill:var(--container)}
.c4.external rect.box,.c4.external circle,.c4.external ellipse{fill:var(--external)}
.c4 .title,.c4 .sub,.c4 .desc{fill:#fff}
.c4 .sub{fill:rgba(255,255,255,.8)}
.c4 .title{font-size:16px}
.c4 .sub{font-size:12px}
.c4 .desc{font-size:12.5px}
.c4.component .title,.c4.component .sub,.c4.component .desc{fill:var(--component-text)}
.c4.component .sub{fill:var(--component-text);fill-opacity:.8}
.c4 .db-line{stroke:rgba(255,255,255,.55);fill:none;stroke-width:1.2}
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
.boundary rect{fill:none;stroke:var(--group);stroke-width:1.2;stroke-dasharray:8 5;rx:8}
.boundary text{fill:var(--text-2);font-size:13px;font-weight:600}
.boundary text.kind{font-weight:400;fill:var(--text-3);font-size:11.5px}
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
`;

export const MARKERS = `
<filter id="m-shadow" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#0b1220" flood-opacity="0.10"/></filter>
<marker id="m-arrow" class="arrow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M1 1 L11 6 L1 11 Z"/></marker>
<marker id="m-arrow-failure" class="arrow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M1 1 L11 6 L1 11 Z" style="fill:var(--lc-failure);stroke:var(--lc-failure)"/></marker>
<marker id="m-one" viewBox="0 0 24 20" refX="24" refY="10" markerWidth="24" markerHeight="20" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><line x1="0" y1="10" x2="24" y2="10"/><line x1="14" y1="3" x2="14" y2="17"/></marker>
<marker id="m-zero-or-one" viewBox="0 0 24 20" refX="24" refY="10" markerWidth="24" markerHeight="20" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><line x1="0" y1="10" x2="24" y2="10"/><circle cx="7" cy="10" r="3.5" style="fill:var(--label-bg)"/><line x1="16" y1="3" x2="16" y2="17"/></marker>
<marker id="m-many" viewBox="0 0 24 20" refX="24" refY="10" markerWidth="24" markerHeight="20" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><line x1="0" y1="10" x2="12" y2="10"/><circle cx="7" cy="10" r="3.5" style="fill:var(--label-bg)"/><path d="M12 10 L24 2 M12 10 L24 10 M12 10 L24 18"/></marker>
<marker id="m-one-or-many" viewBox="0 0 24 20" refX="24" refY="10" markerWidth="24" markerHeight="20" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><line x1="0" y1="10" x2="12" y2="10"/><line x1="9" y1="3" x2="9" y2="17"/><path d="M12 10 L24 2 M12 10 L24 10 M12 10 L24 18"/></marker>
`;

export function wrapSvg({ body, width, height, title, theme = 'light', diagramType }) {
  const w = Math.ceil(width); const h = Math.ceil(height);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" class="vibex vibex-${diagramType}" data-theme="${theme}" data-diagram-type="${diagramType}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="group" aria-label="${esc(title)}">
<style>${SVG_STYLE}</style>
<defs>${MARKERS}</defs>
<rect class="bg" x="0" y="0" width="${w}" height="${h}" style="fill:var(--bg)"/>
${body}
</svg>`;
}
