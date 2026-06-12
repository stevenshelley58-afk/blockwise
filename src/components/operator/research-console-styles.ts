export const CONSOLE_STYLES = `
.rops{--rops-good:#006d38;--rops-good-tint:#ecfdf5;--rops-warn:#8a5a00;--rops-warn-tint:#fdf8ee;--rops-bad:#ba1a1a;--rops-bad-tint:#fdf3f2;--rops-sh:0 1px 2px rgba(15,23,42,.05),0 0 0 1px rgba(15,23,42,.03);
  background:#f8fafc;border:1px solid var(--line);border-radius:16px;overflow:hidden;font-size:13px;color:var(--ink)}
.rops *{box-sizing:border-box}
.rops button{cursor:pointer;font:inherit}
.rops-topbar{min-height:60px;display:flex;align-items:center;gap:13px;background:#fff;border-bottom:1px solid var(--line-soft);padding:10px 18px;flex-wrap:wrap}
.rops-topbar .rops-mark{width:27px;height:27px;border-radius:8px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:700;font-size:14px;flex-shrink:0}
.rops-topbar h1{margin:0;font-size:16px;font-weight:650;letter-spacing:-.2px}
.rops-divider{width:1px;height:24px;background:var(--line);flex-shrink:0}
.rops-crumb{font-size:14px;font-weight:650;white-space:nowrap}
.rops-meta{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--muted);white-space:nowrap}
.rops-dot{width:8px;height:8px;border-radius:999px;background:var(--rops-good);display:inline-block}
.rops-dot.warn{background:var(--rops-warn)}
.rops-dot.bad{background:var(--rops-bad)}
.rops-spendbar{width:56px;height:6px;border-radius:3px;background:var(--line-soft);overflow:hidden}
.rops-spendbar>span{display:block;height:100%;border-radius:3px;background:var(--accent)}
.rops-topactions{display:flex;align-items:center;gap:7px;margin-left:auto;flex-wrap:wrap}
.rops-topactions form{display:flex;align-items:center;gap:7px;margin:0}
.rops-input,.rops-select{height:36px;font-size:12.5px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:0 9px;outline:none}
.rops-input:focus,.rops-select:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-tint)}
.rops-btn{height:36px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);display:inline-flex;align-items:center;gap:7px;padding:0 13px;font-weight:600;font-size:12.5px;white-space:nowrap;box-shadow:var(--rops-sh)}
.rops-btn:hover{background:var(--surface-subtle)}
.rops-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;box-shadow:0 2px 8px rgba(18,62,117,.28)}
.rops-btn.primary:hover{background:var(--accent-strong)}
.rops-btn.danger{color:var(--rops-bad);border-color:#ffdad6}
.rops-btn.danger:hover{background:var(--rops-bad-tint)}
.rops-btn.danger.on{background:var(--rops-bad-tint)}
.rops-banner{border-bottom:1px solid #ffdad6;background:var(--rops-bad-tint);color:var(--rops-bad);padding:10px 18px;font-size:12.5px;font-weight:650}
.rops-body{display:flex;align-items:stretch;min-height:520px}
.rops-rail{width:172px;flex-shrink:0;background:#fff;border-right:1px solid var(--line-soft);padding:10px 8px 14px}
.rops-rail-label{font-size:10.5px;font-weight:700;letter-spacing:.7px;color:#94a3b8;text-transform:uppercase;padding:12px 12px 5px;margin:0}
.rops-navb{display:flex;align-items:center;gap:10px;width:100%;font-size:13px;font-weight:600;padding:9px 12px;border-radius:9px;border:0;background:transparent;color:var(--muted);text-align:left}
.rops-navb:hover{background:var(--surface-subtle);color:var(--ink)}
.rops-navb.on{background:var(--accent-tint);color:var(--accent)}
.rops-navb .rops-cnt{margin-left:auto;font-size:11px;font-weight:650;color:#94a3b8}
.rops-navb .rops-cnt.bad{color:var(--rops-bad)}
.rops-main{flex:1;min-width:0;padding:16px;display:flex;flex-direction:column;gap:12px}
.rops-card{background:#fff;border-radius:12px;box-shadow:var(--rops-sh);padding:14px 16px;min-width:0}
.rops-card h3{font-size:14.5px;font-weight:650;margin:0 0 10px;letter-spacing:-.1px}
.rops-stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:10px}
.rops-stat{margin:0;font-size:11px;font-weight:650;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px}
.rops-stv{font-size:21px;font-weight:700;margin:3px 0 0;color:var(--ink)}
.rops-stv.warn{color:var(--rops-warn)}
.rops-stv.bad{color:var(--rops-bad)}
.rops-table{width:100%;border-collapse:collapse;font-size:12.5px;table-layout:fixed}
.rops-table th{text-align:left;color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;padding:5px 6px;border-bottom:1px solid var(--line-soft)}
.rops-table td{padding:7px 6px;border-bottom:1px solid var(--line-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
.rops-table td.wrap{white-space:normal}
.rops-table td.r{text-align:right}
.rops-table tr.click{cursor:pointer}
.rops-table tr.click:hover td{background:var(--surface-subtle)}
.rops-pill{font-size:11px;padding:2px 9px;border-radius:999px;font-weight:650;display:inline-block}
.rops-pill.ok{background:var(--rops-good-tint);color:var(--rops-good)}
.rops-pill.warn{background:var(--rops-warn-tint);color:var(--rops-warn)}
.rops-pill.bad{background:var(--rops-bad-tint);color:var(--rops-bad)}
.rops-pill.info{background:var(--accent-tint);color:var(--accent)}
.rops-act{font-size:12px;font-weight:600;padding:3px 10px;min-height:26px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);box-shadow:var(--rops-sh)}
.rops-act:hover{background:var(--surface-subtle)}
.rops-act:disabled{opacity:.5;cursor:not-allowed}
.rops-actform{display:inline;margin:0}
.rops-src{font-size:11px;color:#94a3b8;margin:9px 0 0}
.rops-bar{height:6px;border-radius:3px;background:var(--line-soft);overflow:hidden}
.rops-bar>span{display:block;height:100%;border-radius:3px;background:var(--accent)}
.rops-glance{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;text-align:center;font-size:11.5px;font-weight:600;color:var(--muted)}
.rops-glance>div{background:var(--surface-subtle);border-radius:10px;padding:10px 4px}
.rops-glance b{display:block;font-size:17px;font-weight:700;color:var(--ink)}
.rops-pipe-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.rops-pipe-grid p{margin:0;font-size:11.5px;color:var(--muted);line-height:1.6}
.rops-pipe-grid .ttl{font-weight:650;margin:0 0 5px;font-size:12.5px;color:var(--ink)}
.rops-qtabs{background:var(--surface-subtle);border-radius:999px;padding:3px;display:inline-flex;gap:2px;flex-wrap:wrap}
.rops-qtab{font-size:11.5px;font-weight:600;padding:3px 11px;border-radius:999px;border:0;background:transparent;color:var(--muted)}
.rops-qtab.on{background:#fff;color:var(--accent);box-shadow:var(--rops-sh)}
.rops-skill-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
.rops-skill-grid .ttl{font-weight:650;margin:0;font-size:12.5px;color:var(--ink)}
.rops-skill-grid p.desc{margin:5px 0 8px;font-size:11.5px;color:var(--muted);line-height:1.5}
.rops-statusbar{min-height:34px;display:flex;align-items:center;gap:14px;border-top:1px solid var(--line-soft);background:#fff;color:var(--muted);padding:6px 16px;font-size:12px;font-weight:550;flex-wrap:wrap}
.rops-statusbar a{color:var(--accent);font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:5px}
.rops-statusbar a:hover{text-decoration:underline}
.rops-cardhead{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.rops-cardhead h3{margin:0;margin-right:auto}
@media(max-width:860px){
  .rops-body{flex-direction:column}
  .rops-rail{width:100%;display:flex;flex-wrap:nowrap;gap:6px;overflow-x:auto;border-right:0;border-bottom:1px solid var(--line-soft);padding:8px}
  .rops-rail>div{display:flex;gap:6px;flex:0 0 auto}
  .rops-rail-label{display:none}
  .rops-navb{width:auto;flex:0 0 auto;white-space:nowrap}
  .rops-glance{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media(max-width:640px){
  .rops{border-radius:12px}
  .rops-topbar{align-items:flex-start}
  .rops-divider{display:none}
  .rops-meta{white-space:normal}
  .rops-topactions{width:100%;max-width:100%;margin-left:0;flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px}
  .rops-topactions form{flex:0 0 auto}
  .rops-input{min-width:84px}
  .rops-select{min-width:120px}
  .rops-btn{flex:0 0 auto}
  .rops-main{padding:12px}
  .rops-card{overflow-x:auto}
  .rops-table{min-width:560px}
  .rops-qtabs{max-width:100%;flex-wrap:nowrap;overflow-x:auto}
  .rops-qtab{flex:0 0 auto}
  .rops-glance{grid-template-columns:repeat(2,minmax(0,1fr))}
  .rops-statusbar{flex-wrap:nowrap;overflow-x:auto}
  .rops-statusbar>*{flex:0 0 auto}
}
`;
