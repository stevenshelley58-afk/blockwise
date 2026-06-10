export const BRAND_STYLES = `
.bs-screen{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;background:#f8fafc;color:var(--ink);font-size:14px}
.bs-screen *{box-sizing:border-box}
.bs-screen button,.bs-screen input,.bs-screen textarea{font:inherit}
.bs-screen button{cursor:pointer;border:0;background:none;color:inherit}
.bs-screen .asset-upload-trigger{border:1.5px dashed var(--line);background:#fff;color:var(--ink)}
.bs-screen .asset-upload-clear{border:1px solid var(--line);background:#fff;color:var(--muted)}
.bs-screen .btn{height:38px;padding:0 16px;border-radius:9px;display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:13.5px}
.bs-screen .btn.pri{background:var(--accent);color:#fff;box-shadow:0 2px 8px rgba(31,58,110,.28)}
.bs-screen .btn.pri:hover{background:var(--accent-strong)}
.bs-screen .btn.sec{background:#fff;border:1px solid var(--line);box-shadow:0 1px 2px rgba(15,23,41,.05)}
.bs-screen .btn:disabled{opacity:.55;cursor:not-allowed}
.bs-screen .chip{font-size:11.5px;font-weight:650;border-radius:999px;padding:5px 11px}
.bs-screen .chip.good{background:#ecfdf5;color:#006d38}
.bs-screen .chip.warn{background:#fdf8ee;color:#8a5a00}
.bs-top{height:58px;background:#fff;border-bottom:1px solid var(--line-soft);display:flex;align-items:center;gap:14px;padding:0 20px;flex:0 0 auto}
.bs-top .back{color:var(--muted);font-weight:600;font-size:13px;text-decoration:none}
.bs-top h1{font-size:15.5px;font-weight:680;margin:0}
.bs-top .grow{margin-left:auto;display:flex;gap:9px;align-items:center}
.bs-top .notice{font-size:12.5px;font-weight:600}
.bs-top .notice.ok{color:#006d38}
.bs-top .notice.err{color:#ba1a1a}
.bs-scroll{flex:1;min-height:0;overflow:auto}
.bs-hero{background:linear-gradient(170deg,#001b3d 0%,#0d3263 90%);color:#fff;padding:30px 28px 78px}
.bs-hero .kick{font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#9aaac3}
.bs-hero h2{margin:8px 0 0}
.bs-hero h2 input{font-family:Georgia,serif;font-size:38px;letter-spacing:-.5px;line-height:1.05;background:transparent;border:0;outline:0;color:#fff;width:100%;border-bottom:1.5px dashed transparent}
.bs-hero h2 input:hover{border-bottom-color:rgba(255,255,255,.25)}
.bs-hero h2 input:focus{border-bottom-color:#31c46f}
.bs-hero .scanline{margin-top:18px;display:flex;gap:9px;max-width:560px}
.bs-hero .url{flex:1;height:42px;border-radius:10px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);display:flex;align-items:center;gap:10px;padding:0 14px;color:#d6e3ff;font-size:13.5px}
.bs-hero .url svg{color:#9aaac3;flex:0 0 auto}
.bs-hero .url input{flex:1;background:transparent;border:0;outline:0;color:#d6e3ff;min-width:0}
.bs-hero .go{height:42px;padding:0 18px;border-radius:10px;background:#fff;color:var(--ink);font-weight:650;white-space:nowrap}
.bs-hero .go:disabled{opacity:.6}
.bs-logo-proof{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;max-width:740px;margin:-50px 28px 0;position:relative;z-index:2}
.bs-logo-proof .lp{border-radius:14px;box-shadow:0 12px 34px rgba(15,23,41,.16);overflow:hidden;background:#fff}
.bs-logo-proof .face{height:90px;display:grid;place-items:center;font-weight:800;font-size:21px;letter-spacing:-.3px}
.bs-logo-proof .face img{display:block;max-width:78%;max-height:58px;object-fit:contain}
.bs-logo-proof .face.photo{background:linear-gradient(160deg,#3a608f,#0d3263);color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.4)}
.bs-logo-proof small{display:flex;justify-content:space-between;padding:8px 12px;font-size:11px;color:var(--muted);background:#fff}
.bs-logo-proof small b{font-weight:650;color:var(--ink)}
.bs-logo-proof small em{font-style:normal;color:var(--faint,#94a3b8)}
.bs-body{display:grid;grid-template-columns:1fr 320px;gap:22px;padding:24px 28px 40px}
.bs-main{display:grid;gap:18px;align-content:start;min-width:0}
.bs-card{background:#fff;border-radius:14px;box-shadow:0 1px 2px rgba(15,23,41,.05),0 0 0 1px rgba(15,23,41,.03);padding:20px;display:grid;gap:14px}
.bs-card h3{font-size:15.5px;font-weight:680;letter-spacing:-.2px;margin:0}
.bs-card .subtle{font-size:12.5px;color:var(--muted)}
.bs-swrow{display:flex;gap:14px;flex-wrap:wrap}
.bs-swatch{display:grid;gap:7px;justify-items:center;position:relative}
.bs-swatch .well{width:64px;height:64px;border-radius:16px;border:1px solid rgba(15,23,41,.08);box-shadow:0 1px 2px rgba(15,23,41,.05);transition:transform .12s;padding:0}
.bs-swatch .well:hover{transform:translateY(-2px)}
.bs-swatch.open .well{outline:2.5px solid var(--accent);outline-offset:2px}
.bs-swatch b{font-size:12px;font-weight:650}
.bs-swatch small{font-size:10.5px;color:var(--faint,#94a3b8);letter-spacing:.4px}
.bs-picker{position:absolute;top:76px;left:50%;transform:translateX(-50%);z-index:40;width:248px;background:#fff;border-radius:14px;box-shadow:0 10px 32px rgba(15,23,41,.16),0 2px 6px rgba(15,23,41,.07);padding:14px;display:grid;gap:11px}
.bs-picker::before{content:"";position:absolute;top:-6px;left:50%;transform:translateX(-50%) rotate(45deg);width:12px;height:12px;background:#fff;border-radius:2px}
.bs-picker .sv{position:relative;width:100%;aspect-ratio:5/3.4;border-radius:10px;cursor:crosshair;touch-action:none;background:linear-gradient(0deg,#000,transparent),linear-gradient(90deg,#fff,transparent),var(--h,#888)}
.bs-picker .sv .cur{position:absolute;width:14px;height:14px;border-radius:99px;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);transform:translate(-7px,-7px);pointer-events:none}
.bs-picker .hue{appearance:none;-webkit-appearance:none;width:100%;height:12px;border-radius:99px;outline:0;cursor:pointer;background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)}
.bs-picker .hue::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:99px;background:#fff;border:1.5px solid rgba(0,0,0,.15);box-shadow:0 1px 4px rgba(0,0,0,.3)}
.bs-picker .from-site{display:grid;gap:6px}
.bs-picker .from-site small{font-size:10.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--faint,#94a3b8)}
.bs-picker .from-site .dots{display:flex;gap:7px}
.bs-picker .from-site .dots button{width:22px;height:22px;border-radius:7px;border:1px solid rgba(15,23,41,.1);padding:0}
.bs-picker .pick-foot{display:flex;align-items:center;gap:8px}
.bs-picker .hexwrap{flex:1;height:34px;border:1px solid var(--line);border-radius:8px;display:flex;align-items:center;padding:0 10px;gap:6px;font-weight:600;font-size:12.5px}
.bs-picker .hexwrap input{border:0;outline:0;width:100%;text-transform:uppercase;letter-spacing:.5px;background:transparent}
.bs-picker .ok{height:34px;padding:0 13px;border-radius:8px;background:var(--accent);color:#fff;font-weight:650;font-size:12.5px}
.bs-spec{display:grid;grid-template-columns:106px 1fr;gap:18px;align-items:center}
.bs-spec .aa{font-family:Georgia,serif;font-size:54px;font-weight:750;letter-spacing:-2px;background:var(--accent-tint);color:var(--accent-strong);border-radius:12px;display:grid;place-items:center;height:100px}
.bs-spec .rows{display:grid;gap:12px;min-width:0}
.bs-spec small{display:block;color:var(--faint,#94a3b8);font-size:11px;text-transform:uppercase;letter-spacing:.6px;font-weight:700;margin-bottom:3px}
.bs-spec .font-name{border:0;background:var(--line-soft);border-radius:7px;padding:3px 8px;font-weight:650;font-size:11px;width:120px;outline:0;text-transform:none;letter-spacing:0}
.bs-spec .h-sample{font-family:Georgia,serif;font-size:19px;font-weight:750;letter-spacing:-.2px;display:block}
.bs-spec .b-sample{font-size:13px;color:var(--muted);display:block}
.bs-card .f{display:grid;gap:7px}
.bs-card .f>label{font-size:12.5px;font-weight:650;display:flex;justify-content:space-between;align-items:center}
.bs-card .f>label small{color:var(--faint,#94a3b8);font-weight:550;font-size:11.5px}
.bs-card .f textarea{width:100%;border:1px solid var(--line);border-radius:10px;background:#fff;padding:12px 13px;font-size:13.5px;line-height:1.55;resize:vertical;outline:0;min-height:74px;color:var(--ink)}
.bs-card .f textarea:focus{border-color:var(--accent);box-shadow:0 0 0 2.5px var(--accent-tint)}
.bs-card .presets{display:flex;flex-wrap:wrap;gap:6px}
.bs-card .presets button{font-size:12px;font-weight:600;color:var(--muted);background:var(--line-soft);border-radius:999px;padding:6px 12px}
.bs-card .presets button:hover{background:var(--accent-tint);color:var(--accent)}
.bs-tagrow{display:flex;flex-wrap:wrap;gap:6px}
.bs-tagrow span{display:inline-flex;align-items:center;gap:7px;background:var(--accent-tint);color:var(--accent);border-radius:999px;padding:7px 12px;font-size:12.5px;font-weight:600}
.bs-tagrow span.no{background:#fdf3f2;color:#ba1a1a}
.bs-tagrow span b{cursor:pointer;opacity:.55;font-weight:700}
.bs-tagrow span b:hover{opacity:1}
.bs-tagrow .addbtn{display:inline-flex;align-items:center;gap:6px;border:1.5px dashed var(--line);color:var(--muted);border-radius:999px;padding:6px 13px;font-size:12.5px;font-weight:600;background:transparent}
.bs-tagrow .addbtn:hover{color:var(--accent);border-color:var(--accent)}
.bs-tagrow input{border:1.5px solid var(--accent);border-radius:999px;padding:6px 13px;font-size:12.5px;font-weight:600;outline:0;width:160px;background:#fff;color:var(--ink)}
.bs-two{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.bs-kv{display:grid;gap:4px;font-size:13px}
.bs-kv .r{display:grid;grid-template-columns:84px 1fr;align-items:center;gap:12px;border-bottom:1px solid var(--line-soft);min-height:38px}
.bs-kv .r:last-child{border:0}
.bs-kv .r span{color:var(--muted)}
.bs-kv .r input{border:0;outline:0;background:transparent;font-weight:600;width:100%;border-bottom:1.5px dashed transparent;padding:2px 0;color:var(--ink)}
.bs-kv .r input:hover{border-bottom-color:var(--line)}
.bs-kv .r input:focus{border-bottom-color:var(--accent)}
.bs-disc{display:grid;gap:7px}
.bs-disc textarea{font-size:12.5px;line-height:1.5;color:var(--muted);background:#f8fafc;border-radius:9px;padding:10px 12px;border:0;outline:0;resize:none;width:100%}
.bs-disc textarea:focus{outline:2px solid var(--accent-tint)}
.bs-disc .add{border:1.5px dashed var(--line);color:var(--faint,#94a3b8);border-radius:9px;padding:9px;font-size:12px;font-weight:600;background:transparent}
.bs-rail{display:grid;gap:14px;align-content:start;position:sticky;top:20px;height:max-content}
.bs-rail .rail-stage{background:#001b3d;border-radius:14px;padding:18px 16px;display:grid;gap:12px;justify-items:center}
.bs-rail .lbl{color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase}
.bs-rail .minis{display:flex;gap:12px}
.bs-rail .mini-story{width:126px;aspect-ratio:9/16;border-radius:14px;position:relative;overflow:hidden;background:linear-gradient(168deg,#3a608f,#0d3263);color:#fff;box-shadow:0 14px 34px rgba(0,0,0,.45)}
.bs-rail .mini-story::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 35%,rgba(8,12,20,.85) 82%)}
.bs-rail .mini-story .bc{position:absolute;top:7px;left:7px;background:rgba(255,255,255,.94);border-radius:99px;padding:3px 7px;font-size:6.5px;font-weight:750}
.bs-rail .mini-story h5{position:absolute;left:8px;right:8px;bottom:24px;font-family:Georgia,serif;font-size:10px;line-height:1.25;font-weight:750;z-index:1;margin:0}
.bs-rail .mini-story .cta{position:absolute;left:8px;right:8px;bottom:6px;height:15px;border-radius:4px;background:#fff;font-size:6.5px;font-weight:750;display:grid;place-items:center;z-index:1}
.bs-rail .mini-feed{width:126px;border-radius:12px;background:#fff;overflow:hidden;box-shadow:0 14px 34px rgba(0,0,0,.45)}
.bs-rail .mini-feed .fh{display:flex;align-items:center;gap:4px;padding:6px 7px}
.bs-rail .mini-feed .fh i{width:11px;height:11px;border-radius:99px;color:#fff;display:grid;place-items:center;font-style:normal;font-size:6px;font-weight:800}
.bs-rail .mini-feed .fh b{font-size:7px;color:var(--ink)}
.bs-rail .mini-feed .img{height:72px;background:linear-gradient(160deg,#3a608f,#0d3263)}
.bs-rail .mini-feed .ft{display:flex;justify-content:space-between;align-items:center;background:#f1f5f9;padding:5px 7px}
.bs-rail .mini-feed .ft b{font-size:6.5px;color:var(--ink)}
.bs-rail .mini-feed .ft span{color:#fff;border-radius:3px;padding:2px 5px;font-size:6px;font-weight:700}
.bs-rail .rail-stage small{color:#94a3b8;font-size:11px;text-align:center;line-height:1.5}
.bs-rail .rail-stage small b{color:#d6e3ff}
@media(max-width:1000px){
  .bs-body{grid-template-columns:1fr}
  .bs-rail{position:static}
  .bs-logo-proof{grid-template-columns:1fr;margin:-50px 16px 0}
  .bs-hero h2 input{font-size:28px}
  .bs-two{grid-template-columns:1fr}
}
`;
