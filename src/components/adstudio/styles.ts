export const STYLES = `
.studio-screen{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;background:#f8fafc;color:var(--ink);font-size:14px;letter-spacing:0;
  --st-sh-1:0 1px 2px rgba(15,23,42,.05),0 0 0 1px rgba(15,23,42,.03);
  --st-sh-2:0 8px 28px rgba(15,23,42,.12),0 2px 6px rgba(15,23,42,.06);
  --st-sh-lift:0 10px 30px rgba(15,23,42,.14);
  --st-stage:#001b3d;
  --st-good:#006d38;--st-good-tint:#ecfdf5;--st-warn:#8a5a00;
  --st-faint:#94a3b8}
.studio-screen *{box-sizing:border-box}
.studio-screen button,.studio-screen input,.studio-screen select,.studio-screen textarea{font:inherit}
.studio-screen select{appearance:none;-webkit-appearance:none;min-height:44px;border:1px solid var(--line);border-radius:10px;background-color:#fff;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23545a66' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:18px;color:var(--ink);padding:0 42px 0 12px;font-size:13.5px;font-weight:600;line-height:1;cursor:pointer;box-shadow:0 1px 2px rgba(16,18,23,.04);transition:border-color .16s ease,box-shadow .16s ease,background-color .16s ease}
.studio-screen select:hover:not(:disabled){border-color:var(--line-heavy,#d3d7df);background-color:var(--surface-subtle,#f6f7f9)}
.studio-screen select:focus-visible{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(22,24,29,.14)}
.studio-screen select:disabled{cursor:not-allowed;color:var(--st-faint);background-color:var(--surface-subtle,#f6f7f9);opacity:.72}
@media(prefers-reduced-motion:reduce){.studio-screen select{transition:none}}
.studio-screen button{cursor:pointer}
.studio-topbar{position:relative;z-index:4;height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line-soft);background:#fff;padding:0 22px}
.studio-titlebar,.studio-mobile-title,.studio-actions{display:flex;align-items:center;gap:13px;min-width:0}
.studio-home-link{display:inline-flex;align-items:center;color:inherit;text-decoration:none;border-radius:8px}
.studio-home-link:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.studio-titlebar .blockwise-symbol{width:27px;height:27px}
.studio-titlebar .blockwise-wordmark{font-size:19px}
.studio-mobile-title{display:none}
.studio-divider{width:1px;height:24px;background:var(--line)}
.studio-breadcrumb{font-size:14.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-btn,.studio-icon-btn{height:38px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 15px;font-weight:600;font-size:13.5px;white-space:nowrap;box-shadow:var(--st-sh-1)}
.studio-btn.secondary:hover,.studio-icon-btn:hover{background:var(--surface-subtle)}
.studio-btn.publish{height:40px;background:var(--accent);color:#fff;border-color:var(--accent);box-shadow:0 2px 8px rgba(18,62,117,.28)}
.studio-btn.publish:hover{background:var(--accent-strong);border-color:var(--accent-strong)}
.studio-btn.block{width:100%}
.studio-btn:disabled{opacity:.55;cursor:not-allowed}
.studio-icon-btn{width:38px;padding:0}
.studio-more-menu{position:absolute;right:18px;top:56px;width:260px;display:grid;gap:4px;border:1px solid var(--line-soft);border-radius:12px;background:#fff;padding:12px;box-shadow:var(--st-sh-2);z-index:10}
.studio-more-menu button{min-height:40px;border:0;background:transparent;border-radius:8px;color:var(--ink);display:grid;grid-template-columns:22px 1fr 18px;align-items:center;gap:10px;padding:0 8px;text-align:left;font-weight:550}
.studio-more-menu button:hover{background:var(--surface-subtle)}
.studio-more-menu .studio-mobile-menu-save{display:none}
.studio-more-menu .danger{color:#ba1a1a}
.studio-menu-line{height:1px;background:var(--line-soft);margin:5px 0}
.studio-desktop-body{flex:1;min-height:0;display:grid;grid-template-columns:216px minmax(300px,372px) minmax(520px,1fr);background:#f8fafc}
.studio-rail{border-right:1px solid var(--line-soft);background:#fff;padding:14px 10px;display:grid;align-content:start;gap:2px}
.studio-rail-label{font-size:11px;font-weight:700;letter-spacing:.7px;color:var(--st-faint);text-transform:uppercase;padding:12px 12px 6px}
.studio-rail button{position:relative;height:42px;border:0;border-radius:9px;background:transparent;color:var(--muted);display:flex;align-items:center;gap:11px;padding:0 12px;font-weight:600;font-size:13.5px;text-align:left}
.studio-rail button:hover{background:var(--surface-subtle);color:var(--ink)}
.studio-rail button.active{background:var(--accent-tint);color:var(--accent);font-weight:650}
.studio-left-panel{min-width:0;min-height:0;overflow:auto;border-right:1px solid var(--line-soft);background:#f8fafc;padding:24px 22px;display:flex;flex-direction:column;gap:16px}
.studio-home-shell{grid-column:2/-1;min-width:0;min-height:0;overflow:auto;background:#fff;padding:34px clamp(24px,4vw,54px) 48px;display:grid;align-content:start;gap:18px}
.studio-home-panel{width:min(1180px,100%);margin:0 auto;display:grid;gap:28px}
.studio-home-head{display:flex;align-items:center;justify-content:space-between;gap:18px}
.studio-home-head span{display:block;color:var(--muted);font-size:12px;font-weight:750;text-transform:uppercase;letter-spacing:.7px;margin-bottom:4px}
.studio-home-head h1{margin:0;font-size:30px;line-height:1.08;letter-spacing:-.3px}
.studio-home-create{height:46px;border:0;border-radius:999px;background:#05080f;color:#fff;display:inline-flex;align-items:center;gap:10px;padding:0 22px;font-size:14px;font-weight:750;box-shadow:var(--st-sh-2)}
.studio-home-create:hover{background:#172033}
.studio-home-hero{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:28px;border:1px solid var(--line-soft);border-radius:18px;background:#fff;padding:28px;box-shadow:var(--st-sh-1)}
.studio-home-start h2,.studio-home-tools h2{margin:0 0 18px;font-size:20px;line-height:1.2;font-weight:750;letter-spacing:-.15px}
.studio-home-start h2 span{color:var(--st-faint);font-weight:650}
.studio-home-steps{display:grid;gap:0}
.studio-home-steps button{min-height:72px;border:0;border-top:1px solid var(--line-soft);background:transparent;color:var(--ink);display:grid;grid-template-columns:28px 1fr auto;align-items:center;gap:14px;padding:14px 0;text-align:left}
.studio-home-steps button:first-child{border-top:0}
.studio-home-steps button:hover strong,.studio-home-tools button:hover strong{color:var(--accent)}
.studio-home-steps button>span:first-child{width:24px;height:24px;border-radius:8px;display:grid;place-items:center;font-size:12px;font-weight:750}
.studio-home-steps .done{background:#05080f;color:#fff}
.studio-home-steps .todo{border:1px dashed #9aa5b5;color:var(--muted);background:#fff}
.studio-home-steps strong,.studio-home-steps small,.studio-home-preview strong,.studio-home-preview small,.studio-home-tools strong,.studio-home-tools small{display:block}
.studio-home-steps strong{font-size:14px;font-weight:750}
.studio-home-steps small{color:var(--muted);font-size:12.5px;line-height:1.4;margin-top:3px}
.studio-home-steps em,.studio-home-tools em{font-style:normal;color:var(--accent);font-size:12.5px;font-weight:750;display:inline-flex;align-items:center;gap:5px}
.studio-home-preview{align-self:stretch;border:1px solid var(--line-soft);border-radius:16px;background:#f8fafc;padding:16px;display:grid;align-content:start;gap:12px}
.studio-home-preview-media{aspect-ratio:4/5;border-radius:13px;background:linear-gradient(145deg,#e9eef5,#f8fafc);overflow:hidden;display:grid;place-items:center;color:var(--accent);font-size:32px;font-weight:800}
.studio-home-preview-media img{width:100%;height:100%;object-fit:cover;display:block}
.studio-home-preview strong{font-size:15px;font-weight:750;line-height:1.25}
.studio-home-preview small{color:var(--muted);font-size:12.5px;line-height:1.45}
.studio-home-preview button{height:38px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--ink);display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 12px;font-weight:700;box-shadow:var(--st-sh-1)}
.studio-home-preview button:hover{background:var(--accent-tint);color:var(--accent)}
.studio-home-tools>div{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.studio-home-tools button{min-height:176px;border:1px solid var(--line-soft);border-radius:16px;background:#fff;color:var(--ink);box-shadow:var(--st-sh-1);display:grid;align-content:start;gap:10px;padding:18px;text-align:left}
.studio-home-tools button:hover{box-shadow:var(--st-sh-lift);transform:translateY(-1px)}
.studio-home-tools button>span:first-child{width:42px;height:42px;border-radius:12px;background:var(--accent-tint);color:var(--accent);display:grid;place-items:center}
.studio-home-tools strong{font-size:15px;font-weight:750}
.studio-home-tools small{min-height:48px;color:var(--muted);font-size:12.5px;line-height:1.45}
.studio-home-tools em{margin-top:auto}
.studio-panel-header h2{margin:0 0 4px;font-size:18px;line-height:1.15;font-weight:650;letter-spacing:-.2px}
.studio-panel-header p{margin:0;color:var(--muted);font-size:13px}
.studio-card{background:#fff;border-radius:12px;box-shadow:var(--st-sh-1);padding:16px;display:grid;gap:14px}
.studio-field{display:grid;gap:6px}
.studio-field>span{font-size:12.5px;font-weight:600;color:var(--ink)}
.studio-field>div{min-height:44px;border:1px solid var(--line);border-radius:10px;background:#fff;display:flex;align-items:center;gap:9px;padding:0 12px}
.studio-field>div:focus-within{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-tint)}
.studio-field svg{color:var(--st-faint);flex:0 0 auto}
.studio-field input,.studio-field select{width:100%;min-width:0;border:0;background-color:transparent;color:var(--ink);outline:none;box-shadow:none}
.studio-field select{min-height:42px;padding-left:0;background-position:right center}
.studio-campaign-select{max-width:240px;min-height:40px!important}
.studio-link-btn{width:max-content;border:0;background:transparent;color:var(--accent);display:inline-flex;align-items:center;gap:8px;font-weight:600;padding:0}
.studio-empty{background:#fff;border-radius:12px;box-shadow:var(--st-sh-1);padding:30px 22px;display:grid;justify-items:center;gap:12px;text-align:center}
.studio-empty-ic{width:58px;height:58px;border-radius:999px;background:var(--accent-tint);display:grid;place-items:center;color:var(--accent)}
.studio-empty strong{font-size:17px;font-weight:650;letter-spacing:-.2px}
.studio-empty p{margin:0;color:var(--muted);font-size:13.5px;line-height:1.55}
.studio-empty-row{display:flex;gap:8px;margin-top:2px}
.studio-mini-tpls{display:flex;gap:8px;margin-top:10px}
.studio-mini-tpls button{width:66px;aspect-ratio:4/5;border:0;border-radius:9px;position:relative;overflow:hidden;box-shadow:var(--st-sh-1);transition:transform .15s;padding:0}
.studio-mini-tpls button:hover{transform:translateY(-2px)}
.studio-mini-tpls button::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 35%,rgba(8,12,20,.7))}
.studio-mini-tpls span{position:absolute;left:6px;right:6px;bottom:5px;color:#fff;font-size:8.5px;font-weight:700;text-align:left;line-height:1.25;z-index:1}
.studio-empty small{color:var(--st-faint);font-size:12px}
.studio-brand-preview,.studio-note-card{background:#fff;border-radius:12px;box-shadow:var(--st-sh-1);padding:14px;display:flex;gap:12px;align-items:center}
.studio-brand-preview span{width:46px;height:46px;border-radius:999px;color:#fff;display:grid;place-items:center;font-weight:750}
.studio-brand-preview small,.studio-note-card{color:var(--muted)}
.studio-swatches{display:flex;gap:9px}
.studio-swatches span{width:36px;height:36px;border:1px solid var(--line);border-radius:8px}
.studio-draft-brand-chip{display:flex;align-items:flex-start;gap:9px;border:1px solid #f0e2bd;border-radius:10px;background:#fdf8ee;color:#8a5a00;padding:10px 12px;font-size:12.5px;line-height:1.45;text-decoration:none}
.studio-draft-brand-chip b{font-weight:750}
.studio-draft-brand-chip svg{flex:0 0 auto;margin-top:1px}
.studio-draft-brand-chip:hover{background:#faf0d7}
.studio-advanced{background:#fff;border-radius:12px;box-shadow:var(--st-sh-1);padding:12px 14px}
.studio-advanced summary{cursor:pointer;font-weight:600}
.studio-advanced p{color:var(--muted);margin:10px 0 0}
.studio-upload-card{display:flex;align-items:center;gap:11px;background:#fff;border-radius:12px;box-shadow:var(--st-sh-1);border:0;padding:13px 14px;text-align:left;width:100%}
.studio-upload-card:hover{box-shadow:var(--st-sh-lift)}
.studio-upload-ic{width:38px;height:38px;flex:0 0 auto;border-radius:10px;background:var(--accent-tint);display:grid;place-items:center;color:var(--accent)}
.studio-upload-card strong{font-size:13.5px;font-weight:650;display:block}
.studio-upload-card small{font-size:12px;color:var(--muted)}
.studio-current-media{display:grid;grid-template-columns:76px 1fr auto;align-items:center;gap:12px;background:#fff;border-radius:12px;box-shadow:var(--st-sh-1);padding:10px 12px}
.studio-current-media img{width:76px;aspect-ratio:1.25/1;object-fit:cover;border-radius:8px;display:block}
.studio-current-media strong,.studio-current-media small{display:block}
.studio-current-media strong{font-size:13.5px;font-weight:650}
.studio-current-media small{font-size:12px;color:var(--muted);margin-top:2px}
.studio-current-media .studio-current-media-state{justify-self:end;margin:0;padding:5px 9px;border-radius:999px;background:var(--accent-tint);color:var(--accent);font-size:11px;font-weight:700}
.studio-current-media button:focus-visible,.studio-library-tabs button:focus-visible,.studio-library-filters button:focus-visible,.studio-media-grid button:focus-visible,.studio-media-replacement button:focus-visible,.studio-media-confirm button:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 18%,transparent);outline-offset:2px}
.studio-dropzone{min-height:112px;border:1.5px dashed var(--line);border-radius:12px;background:#fff;display:grid;place-items:center;gap:4px;color:var(--muted)}
.studio-dropzone span{font-weight:600;color:var(--ink)}
.studio-library-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border:1px solid var(--line);border-radius:12px;background:var(--surface-subtle)}
.studio-library-tabs button{min-height:44px;display:flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:8px;background:transparent;color:var(--muted);font-size:12.5px;font-weight:650}
.studio-library-tabs button:hover{color:var(--ink)}
.studio-library-tabs button.active{background:#fff;color:var(--ink);box-shadow:var(--st-sh-1)}
.studio-library-tabs button span,.studio-library-filters button span{color:var(--st-faint);font-size:11px;font-weight:750}
.studio-library-tabs button.active span{color:var(--muted)}
.studio-library-panel{display:grid;gap:12px}
.studio-library-filters{display:flex;flex-wrap:wrap;gap:6px}
.studio-library-filters button{min-height:44px;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--muted);padding:0 13px;font-size:12px;font-weight:650}
.studio-library-filters button:hover{border-color:var(--line-heavy);color:var(--ink)}
.studio-library-filters button.active{border-color:var(--accent);background:var(--accent);color:#fff}
.studio-library-filters button.active span{color:rgba(255,255,255,.78)}
.studio-media-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.studio-media-grid button{position:relative;border:0;border-radius:12px;background:#fff;box-shadow:var(--st-sh-1);padding:8px;text-align:left;transition:transform .15s,box-shadow .15s}
.studio-media-grid button:hover{transform:translateY(-1px);box-shadow:var(--st-sh-lift)}
.studio-media-grid button.active{outline:2px solid var(--accent);outline-offset:1px}
.studio-media-grid button.selected{outline:3px solid var(--accent);outline-offset:1px;background:var(--accent-tint)}
.studio-media-grid img{display:block;width:100%;aspect-ratio:1.25/1;object-fit:cover;border-radius:8px;margin-bottom:8px}
.studio-media-grid span,.studio-media-grid small{display:block;padding:0 4px}
.studio-media-grid span{font-size:12.5px;font-weight:650}
.studio-media-grid small{color:var(--muted);font-size:11.5px;padding-bottom:4px}
.studio-media-grid .studio-media-role{position:absolute;top:15px;left:15px;z-index:2;width:max-content;padding:3px 7px;border-radius:999px;background:rgba(22,24,29,.88);color:#fff;font-size:10px;font-weight:700;line-height:1}
.studio-generated-ad-grid img{aspect-ratio:4/5;object-position:top}
.studio-library-empty{min-height:176px;display:grid;place-items:center;align-content:center;gap:7px;border:1px dashed var(--line-heavy);border-radius:12px;background:#fff;padding:24px;text-align:center;color:var(--muted)}
.studio-library-empty svg{color:var(--st-faint)}
.studio-library-empty strong{color:var(--ink);font-size:13.5px}
.studio-library-empty p{max-width:28ch;margin:0;font-size:12.5px;line-height:1.45}
.studio-media-replacement{position:sticky;bottom:12px;z-index:5;display:grid;grid-template-columns:52px minmax(0,1fr) 36px;align-items:center;gap:10px;margin-top:16px;padding:10px;border:1px solid var(--line);border-radius:14px;background:#fff;box-shadow:0 12px 30px rgba(16,18,23,.14)}
.studio-media-replacement>img{width:52px;height:52px;object-fit:cover;border-radius:9px}
.studio-media-replacement>span{min-width:0;display:grid;gap:2px}
.studio-media-replacement small{color:var(--muted);font-size:11.5px}
.studio-media-replacement strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.studio-media-replacement>.studio-btn{grid-column:1/-1;width:100%}
.studio-media-selection-clear{width:36px;height:36px;display:grid;place-items:center;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--muted)}
.studio-media-confirm-backdrop{position:fixed;inset:0;z-index:240;display:grid;place-items:center;padding:20px;background:rgba(15,23,42,.58)}
.studio-media-confirm{width:min(480px,100%);display:grid;grid-template-columns:44px minmax(0,1fr);gap:16px;padding:22px;border-radius:16px;background:#fff;box-shadow:0 24px 80px rgba(10,15,30,.35)}
.studio-media-confirm-icon{width:44px;height:44px;display:grid;place-items:center;border-radius:12px;background:var(--accent-tint);color:var(--accent)}
.studio-media-confirm h3{margin:1px 0 6px;font-size:19px;line-height:1.25;letter-spacing:-.01em}
.studio-media-confirm p{max-width:60ch;margin:0;color:var(--muted);font-size:13px;line-height:1.5}
.studio-media-confirm-preview{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.studio-media-confirm-preview span{display:grid;gap:6px}
.studio-media-confirm-preview small{font-size:12px;font-weight:650;color:var(--muted)}
.studio-media-confirm-preview img{display:block;width:100%;aspect-ratio:1.25/1;object-fit:cover;border:1px solid var(--line);border-radius:10px}
.studio-media-confirm-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:10px;padding-top:2px}
.studio-copy-fields{display:grid;gap:12px}
.studio-copy-fields label{display:grid;gap:6px}
.studio-copy-fields span{display:flex;justify-content:space-between;gap:12px;font-weight:600;font-size:12.5px}
.studio-copy-fields small{color:var(--st-faint);font-weight:550;font-size:11.5px}
.studio-copy-fields textarea{width:100%;resize:vertical;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:10px 11px;outline:none;font-size:13.5px;line-height:1.45}
.studio-copy-fields textarea:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-tint)}
.studio-selected-text-field{display:grid;gap:8px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:12px;box-shadow:var(--st-sh-1)}
.studio-selected-text-field>span{display:flex;justify-content:space-between;gap:12px;font-weight:700;font-size:12.5px}
.studio-selected-text-field small{color:var(--st-faint);font-weight:650}
.studio-selected-text-field small[data-over="true"],.studio-field-error{color:var(--rose,#ba1a1a)!important}
.studio-selected-text-field textarea{width:100%;resize:vertical;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:10px 11px;outline:none;font-size:13.5px;line-height:1.45}
.studio-selected-text-field textarea:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-tint)}
.studio-mode-seg{display:grid;grid-template-columns:1fr 1fr 1fr;background:var(--line-soft);border-radius:10px;padding:3px;gap:3px}
.studio-mode-seg button{padding:9px 4px;border:0;border-radius:8px;font-size:12.5px;font-weight:600;color:var(--muted);background:transparent;display:flex;align-items:center;justify-content:center;gap:6px}
.studio-mode-seg button.active{background:#fff;color:var(--accent);box-shadow:var(--st-sh-1);font-weight:650}
.studio-ctx{display:flex;flex-wrap:wrap;gap:6px}
.studio-ctx span{font-size:11.5px;font-weight:600;color:var(--accent);background:var(--accent-tint);border-radius:999px;padding:5px 10px}
.studio-alts{display:flex;gap:6px;flex-wrap:wrap}
.studio-alts button{font-size:11.5px;font-weight:600;color:var(--muted);background:#fff;box-shadow:var(--st-sh-1);border:0;border-radius:999px;padding:6px 11px;text-align:left}
.studio-alts button:hover{color:var(--accent);background:var(--accent-tint)}
.studio-copy-result{display:grid;gap:10px}
.studio-copy-result>strong{font-size:12.5px;font-weight:650;color:var(--ink)}
.studio-inline-feedback{display:grid;grid-template-columns:18px 1fr;align-items:start;gap:8px;border-radius:10px;padding:10px 12px;font-size:12.5px;font-weight:600;line-height:1.4;background:#fff;box-shadow:var(--st-sh-1)}
.studio-inline-feedback svg{margin-top:1px}
.studio-inline-feedback.info{color:var(--accent)}
.studio-inline-feedback.success{color:var(--st-good);background:var(--st-good-tint)}
.studio-inline-feedback.error{color:#ba1a1a;background:#fdf3f2}
.studio-assist-row{display:flex;flex-wrap:wrap;gap:7px}
.studio-assist-row button{border:0;border-radius:999px;background:var(--accent-tint);color:var(--accent);min-height:32px;padding:0 13px;font-size:12px;font-weight:600}
.studio-assist-row button:hover{background:var(--accent-mid,#d6e3ff)}
.studio-assist-row button:disabled{opacity:.55;cursor:wait}
.studio-card-actions button{border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);min-height:32px;padding:0 10px;font-size:12px;font-weight:600}
.studio-hint{font-size:12px;color:var(--muted);line-height:1.5;background:#fff;border-radius:10px;box-shadow:var(--st-sh-1);padding:11px 13px;display:flex;gap:9px}
.studio-hint svg{flex:0 0 auto;color:var(--accent);margin-top:1px}
.studio-hint b{color:var(--ink);font-weight:650}
.studio-brief-box{width:100%;min-height:130px;resize:vertical;border:1px solid var(--line);border-radius:10px;background:#fff;padding:12px;font-size:13.5px;line-height:1.5;color:var(--ink);outline:none}
.studio-brief-box:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-tint)}
.studio-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line-soft);padding:11px 0;font-weight:600}
.studio-preview-column{min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--st-stage);overflow:hidden}
.studio-preview-controls{position:relative;z-index:3;flex:0 0 58px;min-height:58px;display:flex;align-items:center;justify-content:center;gap:14px;padding:10px 22px;background:linear-gradient(180deg,rgba(16,20,28,1),rgba(16,20,28,.92))}
.studio-segment,.studio-mini-segment{display:inline-flex;align-items:center;gap:2px;border:0;border-radius:10px;background:rgba(255,255,255,.08);padding:3px}
.studio-segment button,.studio-mini-segment button{border:0;border-radius:8px;background:transparent;color:#94a3b8;min-height:32px;padding:4px 16px;font-weight:600;font-size:12.5px}
.studio-segment button{display:grid;gap:0;text-align:center;min-width:84px}
.studio-segment button small{font-size:10px;color:#64748b}
.studio-segment button.active,.studio-mini-segment button.active{background:#fff;color:var(--ink)}
.studio-segment button.active small{color:var(--muted)}
.studio-control-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.studio-stage{position:relative;flex:1 1 auto;min-height:0;display:grid;place-items:center;overflow:hidden;padding:18px}
.studio-fabric-editor{width:min(740px,100%);display:grid;justify-items:center;gap:12px}
.studio-fabric-toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(255,255,255,.08);padding:6px;box-shadow:0 12px 30px rgba(0,0,0,.24)}
.studio-fabric-toolbar button{height:36px;border:0;border-radius:8px;background:rgba(255,255,255,.12);color:#e6edf6;display:inline-flex;align-items:center;gap:6px;padding:0 12px;font-size:12.5px;font-weight:650;white-space:nowrap}
.studio-fabric-toolbar button.icon{width:36px;padding:0;justify-content:center}
.studio-fabric-toolbar button:hover:not(:disabled){background:#fff;color:var(--accent)}
.studio-fabric-toolbar button:disabled{opacity:.42;cursor:not-allowed}
.studio-fabric-toolbar-divider{width:1px;height:22px;background:rgba(255,255,255,.18);margin:0 2px}
.studio-fabric-shell{width:min(560px,88%);max-height:calc(100vh - 250px);display:grid;place-items:center}
.studio-fabric-shell .canvas-container{max-width:100%;max-height:calc(100vh - 250px)}
.studio-fabric-shell canvas{display:block;max-width:100%;width:100%;height:auto;max-height:calc(100vh - 250px);object-fit:contain;box-shadow:0 30px 70px rgba(0,0,0,.42)}
.studio-fabric-shell[data-format="9:16"]{width:min(350px,74%)}
.studio-fabric-shell[data-format="4:5"]{width:min(475px,82%)}
.studio-fabric-shell[data-format="1:1"]{width:min(520px,84%)}
.studio-editor-loading{min-width:260px;min-height:420px;display:grid;place-items:center;color:#d6e3ff;font-weight:650}
.studio-clone-editor-wrap{width:100%;height:100%;min-height:0;display:grid;grid-template-rows:minmax(0,1fr) auto auto;justify-items:center;gap:14px;max-width:100%}
.studio-preview-fit{position:relative;width:100%;height:100%;min-height:0;overflow:hidden}
.studio-preview-fit-content{position:absolute;top:50%;left:50%;transform-origin:center;will-change:transform}
.studio-preview-fit-content>.studio-metachrome{width:500px}
.studio-clone-stage{position:relative;display:grid;justify-items:center;gap:10px}
.studio-clone-stage img{display:block;max-width:min(475px,82%);max-height:calc(100vh - 250px);width:auto;height:auto;border-radius:12px;box-shadow:0 30px 70px rgba(0,0,0,.42)}
.studio-clone-warning-strip{width:min(520px,92vw);display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:start;border:1px solid rgba(245,158,11,.35);border-radius:8px;background:#fff8eb;color:#563407;padding:10px 12px;box-shadow:0 12px 28px rgba(30,41,59,.16)}
.studio-clone-warning-strip p{margin:0;font-size:12.5px;line-height:1.35;font-weight:650}
.studio-clone-warning-strip p+p{margin-top:5px}
.studio-clone-warning-strip button{width:28px;height:28px;border:0;border-radius:7px;background:rgba(86,52,7,.08);color:#563407;display:grid;place-items:center}
.studio-preview-device{transform:scale(var(--preview-scale));transform-origin:center;transition:transform .16s ease}
.studio-story-card{position:relative;width:332px;aspect-ratio:9/16;overflow:hidden;border-radius:24px;background:#111;color:#fff;box-shadow:0 30px 70px rgba(0,0,0,.5)}
.studio-story-card img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.studio-story-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.38) 0%,rgba(0,0,0,.08) 38%,rgba(0,0,0,.66) 100%)}
.studio-story-brand{position:absolute;top:18px;left:18px;right:18px;z-index:3;display:flex;align-items:center;gap:10px}
.studio-story-brand span{width:42px;height:42px;border-radius:999px;background:#123e75;color:#fff;display:grid;place-items:center;font-size:21px;font-weight:800}
.studio-story-brand strong,.studio-story-brand small{display:block;text-shadow:0 1px 5px rgba(0,0,0,.4)}
.studio-story-brand small{font-size:12px;opacity:.9}
.studio-hit.image{position:absolute;inset:0;z-index:2;border:0;background:transparent}
.studio-story-headline,.studio-story-body,.studio-story-cta{position:absolute;z-index:4;border:0;background:transparent;color:#fff;text-align:left;padding:0}
.studio-story-headline{left:24px;right:24px;bottom:158px;font-family:Georgia,serif;font-size:35px;line-height:1.03;font-weight:750;text-shadow:0 2px 12px rgba(0,0,0,.55)}
.studio-story-body{left:24px;right:58px;bottom:104px;font-size:22px;line-height:1.18;text-shadow:0 2px 9px rgba(0,0,0,.55)}
.studio-story-cta{left:24px;right:24px;bottom:24px;min-height:54px;border-radius:9px;background:#fff;color:#111;display:flex;align-items:center;justify-content:space-between;padding:0 20px;font-size:16px;font-weight:800;box-shadow:0 8px 22px rgba(0,0,0,.26)}
.studio-story-card.creative .studio-story-brand{display:none}
.selected{outline:2px solid #fff;outline-offset:3px}
.studio-creative-card{position:relative;width:392px;aspect-ratio:1/1;overflow:hidden;border-radius:12px;background:#111;color:#fff;box-shadow:0 30px 70px rgba(0,0,0,.45)}
.studio-creative-card.landscape{width:560px;aspect-ratio:1.91/1}
.studio-creative-card img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.studio-creative-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.12),rgba(0,0,0,.68))}
.studio-creative-headline,.studio-creative-body,.studio-creative-cta{position:absolute;z-index:4;border:0;background:transparent;color:#fff;text-align:left;padding:0}
.studio-creative-headline{left:24px;right:24px;bottom:104px;font-family:Georgia,serif;font-size:30px;line-height:1.05;font-weight:750;text-shadow:0 2px 12px rgba(0,0,0,.5)}
.studio-creative-body{left:24px;right:24px;bottom:66px;font-size:17px;line-height:1.25;text-shadow:0 2px 9px rgba(0,0,0,.48)}
.studio-creative-cta{left:24px;bottom:22px;min-height:36px;border-radius:8px;background:#fff;color:#111;padding:0 14px;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px rgba(0,0,0,.22)}
.studio-creative-card.landscape .studio-creative-headline{right:190px;bottom:86px}
.studio-creative-card.landscape .studio-creative-body{right:190px;bottom:50px}
.studio-creative-card.landscape .studio-creative-cta{bottom:18px}
.studio-feed-card{width:392px;overflow:hidden;border:0;border-radius:18px;background:#fff;box-shadow:0 30px 70px rgba(0,0,0,.45)}
.studio-feed-card.landscape{width:560px}
.studio-feed-card header{height:70px;display:flex;align-items:center;justify-content:space-between;padding:0 18px}
.studio-feed-id{display:flex;align-items:center;gap:11px}
.studio-feed-id>span,.studio-meta-avatar{width:42px;height:42px;border-radius:999px;background:#123e75;color:#fff;display:grid;place-items:center;font-weight:850;overflow:hidden;flex:0 0 auto}
.studio-meta-avatar img{display:block;width:100%;height:100%;object-fit:cover}
.studio-feed-id strong,.studio-feed-id small{display:block}
.studio-feed-id small{color:var(--muted);font-size:12px}
.studio-feed-primary,.studio-feed-headline,.studio-feed-desc{display:block;width:100%;border:0;background:transparent;color:var(--ink);text-align:left}
.studio-feed-primary{padding:0 18px 16px;line-height:1.38}
.studio-feed-image{display:block;width:100%;border:0;background:#eee;padding:0}
.studio-feed-image img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover}
.studio-feed-card.landscape .studio-feed-image img{aspect-ratio:1.91/1}
.studio-feed-card footer{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;background:#f1f5f9;padding:15px 18px}
.studio-feed-card footer small{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;font-weight:700}
.studio-feed-headline{font-size:17px;font-weight:800;line-height:1.18;margin-top:4px}
.studio-feed-desc{color:var(--muted);font-size:13px;line-height:1.3;margin-top:3px}
.studio-feed-cta{border:0;border-radius:8px;background:#123e75;color:#fff;min-height:38px;padding:0 14px;font-weight:800}
.studio-busy{position:absolute;inset:0;z-index:5;background:rgba(16,20,28,.72);display:grid;place-items:center}
.studio-busy-card{width:280px;border:0;border-radius:14px;background:#fff;display:grid;gap:9px;justify-items:center;padding:22px;text-align:center;box-shadow:var(--st-sh-2)}
.studio-busy-card svg{animation:studio-spin 1s linear infinite;color:var(--accent)}
@keyframes studio-spin{to{transform:rotate(360deg)}}
.studio-busy-card span{color:var(--muted);font-size:12px}

/* Inline stage progress line — sits inside a panel and tells the user
   which stage of a multi-step generation is running. */
.studio-progress{display:inline-flex;align-items:center;gap:8px;color:var(--accent);font-size:12.5px;font-weight:650;padding:8px 10px;border-radius:var(--r-ctl);background:var(--accent-tint)}
.studio-progress svg{animation:studio-spin 1s linear infinite;flex:0 0 auto}
.studio-variant-strip{flex:0 0 198px;min-height:0;overflow:hidden;border-top:1px solid rgba(255,255,255,.08);background:transparent;padding:12px 20px 14px}
.studio-variant-strip-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.studio-variant-strip-head strong{color:#d6e3ff;font-weight:600;font-size:13px}
.studio-variant-strip-head button{border:0;border-radius:8px;background:rgba(255,255,255,.1);color:#d6e3ff;display:inline-flex;align-items:center;gap:7px;min-height:32px;padding:0 12px;font-weight:600;font-size:12.5px}
.studio-variant-strip-head button:hover{background:rgba(255,255,255,.18)}
.studio-variant-row{display:flex;gap:12px;overflow-x:auto;overflow-y:hidden;padding-bottom:2px}
.studio-variant-tile{width:168px;flex:0 0 auto;border:0;border-radius:12px;background:#0e2a4d;padding:7px;text-align:left}
.studio-variant-tile.active{outline:2px solid #fff;outline-offset:1px}
.studio-variant-preview{width:100%;border:0;background:transparent;color:#fff;padding:0;text-align:left}
.studio-variant-image{position:relative;display:block}
.studio-variant-image img{display:block;width:100%;height:74px;object-fit:cover;border-radius:8px}
.studio-variant-image svg{position:absolute;top:8px;left:8px;width:28px;height:28px;border-radius:999px;background:rgba(16,20,28,.85);color:#fff;padding:6px}
.studio-variant-tile strong,.studio-variant-tile small{display:block}
.studio-variant-tile strong{margin-top:6px;color:#fff;font-size:12.5px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-variant-tile small{color:#94a3b8;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-variant-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-top:8px}
.studio-variant-actions button{border:0;border-radius:7px;background:rgba(255,255,255,.08);color:#d6e3ff;min-height:28px;padding:0 5px;font-size:11px;font-weight:600;text-align:center}
.studio-variant-actions button:hover{background:rgba(255,255,255,.16)}
.studio-variant-strip-head button:disabled{opacity:.5;cursor:wait}
.studio-variant-head-actions{display:inline-flex;gap:8px}
.studio-variant-head-actions button{border:0;border-radius:8px;background:rgba(255,255,255,.1);color:#d6e3ff;min-height:32px;padding:0 12px;font-weight:600;font-size:12.5px}
.studio-variant-head-actions button:hover{background:rgba(255,255,255,.18)}
.studio-variant-skeleton{display:grid;gap:7px;padding-bottom:4px}
.studio-variant-skeleton i{display:block;border-radius:8px;background:linear-gradient(90deg,rgba(255,255,255,.07) 25%,rgba(255,255,255,.18) 50%,rgba(255,255,255,.07) 75%);background-size:200% 100%;animation:studio-shimmer 1.3s ease-in-out infinite}
.studio-variant-skeleton-image{height:74px}
.studio-variant-skeleton-line{height:11px;width:72%}
.studio-variant-skeleton-line.short{width:46%}
@keyframes studio-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.studio-variant-tile.error{outline:1px solid rgba(255,138,128,.5)}
.studio-variant-error-box{display:grid;gap:4px;min-height:108px;align-content:center;padding:6px 8px}
.studio-variant-error-box strong{color:#ffb4ab;font-size:12.5px;font-weight:650}
.studio-variant-error-box small{color:#cbb6b3;font-size:11px;line-height:1.35;display:block;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
.studio-readiness{background:#fff;border-radius:12px;box-shadow:var(--st-sh-1);padding:20px}
.studio-readiness header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
.studio-readiness h3{font-size:16px;font-weight:650;margin:0}
.studio-readiness-main{display:flex;align-items:center;gap:18px;margin-bottom:18px}
.studio-readiness-main p{margin:0;line-height:1.45;color:var(--muted);font-size:13px}
.studio-score{width:84px;height:84px;border-radius:999px;display:grid;place-items:center;background:conic-gradient(var(--st-good) var(--score),#dfe6f0 0)}
.studio-score span{width:62px;height:62px;border-radius:999px;background:#fff;display:grid;place-items:center;font-size:17px;font-weight:750}
.studio-checklist{display:grid;gap:13px}
.studio-checklist>div{display:grid;grid-template-columns:22px 1fr;gap:10px;align-items:start}
.studio-check-icon{width:19px;height:19px;border-radius:999px;display:grid;place-items:center;margin-top:1px}
.studio-checklist .done .studio-check-icon{background:var(--st-good);color:#fff}
.studio-checklist .warn .studio-check-icon{background:#ffb020;color:#fff}
.studio-checklist .todo .studio-check-icon{border:1px solid #aab3c1;color:#6b7280}
.studio-checklist strong,.studio-checklist small{display:block}
.studio-checklist strong{font-size:13px;font-weight:650}
.studio-checklist small{color:var(--muted);line-height:1.35;font-size:12px}
.studio-recommendations{width:100%;min-height:42px;border:0;border-radius:10px;background:#fff;box-shadow:var(--st-sh-1);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 14px;margin-top:18px;font-weight:600;font-size:13px}
.studio-recommendations-list{margin:10px 0 0;padding:0 0 0 18px;font-size:12px;color:var(--muted)}
.studio-recommendations-list li{margin-bottom:4px}
.studio-edit-panel,.studio-publish-panel{display:grid;gap:14px}
.studio-publish-blocker,.studio-publish-ready{border-radius:10px;padding:12px 14px;font-weight:600;font-size:13px}
.studio-publish-blocker{background:#fdf3f2;color:#ba1a1a;border:1px solid #ffdad6}
.studio-publish-ready{background:var(--st-good-tint);color:var(--st-good);border:1px solid #cdebd4}
.studio-publish-row{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line-soft);padding:10px 0;font-size:13px}
.studio-publish-row span{color:var(--muted)}
.studio-publish-list{display:grid;gap:10px}
.studio-publish-list label{display:flex;align-items:center;gap:10px;font-weight:600;font-size:13px}
.studio-statusbar{height:36px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid var(--line-soft);background:#fff;color:var(--muted);padding:0 22px;font-size:12px;font-weight:550}
.studio-statusbar .error{color:#ba1a1a}
.studio-statusbar [data-state="saved"]{color:var(--st-good)}
.studio-statusbar [data-state="saving"]{color:var(--muted)}
.studio-statusbar [data-state="error"]{color:#ba1a1a}
.studio-toast{position:fixed;left:50%;bottom:54px;z-index:200;transform:translateX(-50%);border-radius:10px;background:#001b3d;color:#fff;padding:11px 16px;font-weight:600;font-size:13px;box-shadow:var(--st-sh-2)}
.studio-brand-prompt-overlay{position:fixed;inset:0;z-index:220;background:rgba(15,23,42,.5);display:grid;place-items:center;padding:24px}
.studio-brand-prompt{position:relative;width:min(420px,100%);border-radius:14px;background:#fff;box-shadow:var(--st-sh-2);padding:24px;display:grid;gap:12px}
.studio-brand-prompt>button:first-child{position:absolute;right:12px;top:12px;width:34px;height:34px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--muted);display:grid;place-items:center}
.studio-brand-prompt>svg{color:var(--accent)}
.studio-brand-prompt h2{font-size:20px;line-height:1.15;letter-spacing:-.2px;margin:0;padding-right:34px}
.studio-brand-prompt p{margin:0;color:var(--muted);line-height:1.5}
.studio-brand-prompt div{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}
.studio-brand-prompt a{text-decoration:none}
.studio-mobile-body,.studio-mobile-bottom,.studio-mobile-status,.studio-mobile-busy{display:none}

/* Sample gallery and clone-input dialog */
.studio-tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px}
.studio-tpl{display:grid;border:0;border-radius:12px;background:#fff;box-shadow:var(--st-sh-1);overflow:hidden;text-align:left;padding:0;transition:transform .15s,box-shadow .15s;position:relative}
.studio-tpl:hover{transform:translateY(-2px);box-shadow:var(--st-sh-lift)}
.studio-tpl.active{outline:2px solid var(--accent);outline-offset:2px}
.studio-tpl-thumb{aspect-ratio:4/5;position:relative;overflow:hidden;color:#fff;display:block}
.studio-tpl-thumb::before{content:"";position:absolute;inset:0;background:radial-gradient(130% 80% at 85% 0%,rgba(255,210,150,.25),transparent 50%),linear-gradient(180deg,transparent 30%,rgba(8,12,20,.75) 80%)}
.studio-tpl-thumb--img::before{content:none}
.studio-tpl-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;background:#fff}
.studio-tpl-thumb .tag{position:absolute;top:9px;left:9px;z-index:1;font-size:9px;font-weight:750;letter-spacing:.8px;text-transform:uppercase;background:rgba(255,255,255,.92);color:var(--accent-strong);border-radius:999px;padding:4px 8px}
.studio-tpl-thumb .t-copy{position:absolute;left:11px;right:11px;bottom:28px;z-index:1;font-size:13px;line-height:1.25;font-weight:750;letter-spacing:-.1px}
.studio-tpl-thumb .t-cta{position:absolute;left:11px;right:11px;bottom:8px;z-index:1;height:17px;border-radius:5px;background:#fff;color:var(--accent-strong);display:grid;place-items:center;font-size:8.5px;font-weight:750}
.studio-tpl-meta{padding:11px 13px 13px;display:block}
.studio-tpl-meta strong{font-size:13.5px;font-weight:650;display:block}
.studio-tpl-meta span{font-size:11.5px;color:var(--muted);margin-top:2px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.studio-tpl-meta .studio-tpl-tags{display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:6px;margin-bottom:5px;-webkit-line-clamp:unset;overflow:visible}
.studio-tpl-meta .studio-tpl-tags span{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:2px 7px;margin:0;font-size:9.5px;font-weight:750;line-height:1.25;color:var(--muted);background:#fff;-webkit-line-clamp:unset;overflow:visible}
.studio-tpl-meta .studio-tpl-tags span:first-child{color:var(--accent-strong);background:var(--accent-tint);border-color:rgba(176,111,44,.28)}
.studio-tpl-g0{background:linear-gradient(165deg,#34557a,#152740)}
.studio-tpl-g1{background:linear-gradient(165deg,#7a5a34,#3f2c14)}
.studio-tpl-g2{background:linear-gradient(165deg,#2e6b5e,#143229)}
.studio-tpl-g3{background:linear-gradient(165deg,#5a4a7c,#241c3a)}
.studio-tpl-g4{background:linear-gradient(165deg,#7c4a55,#3a1c24)}
.studio-tpl-g5{background:linear-gradient(165deg,#3a6a8a,#13283a)}
.studio-tpl-g6{background:linear-gradient(165deg,#56683a,#222e14)}
.studio-tpl.blank .studio-tpl-thumb{background:var(--accent-tint);display:grid;place-items:center;color:var(--accent)}
.studio-tpl.blank .studio-tpl-thumb::before{display:none}
.studio-tpl.blank .plus{width:44px;height:44px;border-radius:999px;background:#fff;box-shadow:var(--st-sh-1);display:grid;place-items:center}

/* New Ad dialog */
.studio-btn.accent{background:var(--accent);color:#fff;border-color:var(--accent)}
.studio-btn.accent:hover{background:var(--accent-strong);border-color:var(--accent-strong)}
.studio-btn.accent:disabled{opacity:.5}
.studio-newad-overlay{position:fixed;inset:0;z-index:230;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:24px}
.studio-newad{width:min(1160px,calc(100vw - 48px));max-height:min(880px,calc(100vh - 48px));display:flex;flex-direction:column;overflow:hidden;border:0;border-radius:16px;background:#f8fafc;box-shadow:0 24px 80px rgba(10,15,30,.4)}
.studio-newad-head{display:flex;align-items:center;gap:14px;padding:20px 26px 16px;background:#fff;border-bottom:1px solid var(--line-soft)}
.studio-newad-titleblock{display:grid;gap:6px;min-width:0}
.studio-newad-titleblock>span{font-size:11px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;color:var(--accent)}
.studio-newad-titleblock p{margin:0;color:var(--muted);font-size:15px;line-height:1.45}
.studio-newad-head h2{margin:0;font-size:24px;font-weight:720;line-height:1.05;letter-spacing:-.3px}
.studio-newad-x{margin-left:auto;width:36px;height:36px;flex:0 0 auto;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);display:grid;place-items:center}
.studio-newad-head>.studio-newad-x:first-child{margin-left:0}
.studio-newad-x:hover{background:var(--surface-subtle)}
.studio-newad-steps{display:flex;align-items:center;gap:8px;margin-left:6px}
.studio-newad-steps .st{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--st-faint)}
.studio-newad-steps .st i{width:22px;height:22px;border-radius:999px;display:grid;place-items:center;font-style:normal;font-size:11px;font-weight:700;background:var(--line-soft);color:var(--muted)}
.studio-newad-steps .st.on{color:var(--accent)}
.studio-newad-steps .st.on i{background:var(--accent);color:#fff}
.studio-newad-steps .ln{width:26px;height:1.5px;background:var(--line)}
.studio-newad-body{padding:22px 26px;overflow-y:auto}
.studio-newad-sources{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:stretch}
.studio-newad-source{min-height:148px;border:0;border-radius:12px;background:#fff;color:var(--ink);box-shadow:var(--st-sh-1);padding:16px;text-align:left;display:grid;align-content:start;gap:10px;transition:transform .15s,box-shadow .15s}
.studio-newad-source:hover{transform:translateY(-2px);box-shadow:var(--st-sh-lift)}
.studio-newad-source .ic{width:38px;height:38px;border-radius:10px;background:var(--accent-tint);color:var(--accent);display:grid;place-items:center}
.studio-newad-source strong{font-size:14px;font-weight:700;line-height:1.2}
.studio-newad-source span:last-child{color:var(--muted);font-size:12.5px;line-height:1.45}
.studio-newad-blanklink{grid-column:1/-1;justify-self:start;border:0;background:transparent;color:var(--accent);font-weight:650;padding:2px 0}
.studio-newad-list{display:grid;gap:10px}
.studio-newad-listmsg{margin:0;border-radius:12px;background:#fff;box-shadow:var(--st-sh-1);padding:18px;color:var(--muted);font-size:13.5px;line-height:1.5}
.studio-newad-listmsg a{color:var(--accent);font-weight:650}
.studio-newad-item{width:100%;min-height:72px;border:0;border-radius:12px;background:#fff;color:var(--ink);box-shadow:var(--st-sh-1);display:grid;grid-template-columns:54px 1fr 20px;align-items:center;gap:12px;padding:10px 12px;text-align:left}
.studio-newad-item:hover{box-shadow:var(--st-sh-lift)}
.studio-newad-item-thumb{width:54px;height:54px;border-radius:10px;background:var(--accent-tint);color:var(--accent);display:grid;place-items:center;overflow:hidden}
.studio-newad-item-thumb.reuse{background:#eef6ff}
.studio-newad-item-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.studio-newad-item-main{min-width:0;display:grid;gap:3px}
.studio-newad-item-main strong{font-size:13.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-newad-item-main small{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-newad-own{display:grid;gap:14px}
.studio-newad-drop{display:grid;gap:6px;justify-items:center;border:0;border-radius:12px;background:#fff;box-shadow:var(--st-sh-1);padding:26px;text-align:center;color:var(--ink)}
.studio-newad-drop:hover{box-shadow:var(--st-sh-lift)}
.studio-newad-drop svg{color:var(--accent)}
.studio-newad-drop strong{font-size:14px;font-weight:650}
.studio-newad-drop span{font-size:12.5px;color:var(--muted)}
.studio-newad-note{display:flex;align-items:center;gap:8px;margin:0;font-size:12.5px;color:var(--accent);background:var(--accent-tint);border-radius:9px;padding:10px 12px}
.studio-newad-field{display:grid;gap:7px}
.studio-newad-field span{font-size:12.5px;font-weight:600;color:var(--ink)}
.studio-newad-field textarea{width:100%;resize:vertical;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);font:inherit;font-size:13.5px;line-height:1.5;padding:12px}
.studio-newad-field textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-tint)}
.studio-newad-field textarea[aria-invalid="true"]{border-color:#ba1a1a;box-shadow:0 0 0 2px #ffdad6}
.studio-newad-field small{justify-self:end;color:var(--muted);font-size:12px}
.studio-newad-field .studio-newad-field-help{justify-self:start;line-height:1.45}
.studio-newad-foot{display:flex;align-items:center;gap:12px;padding:15px 26px;background:#fff;border-top:1px solid var(--line-soft)}
.studio-newad-foot.has-alert{align-items:flex-end}
.studio-newad-foot.has-alert .studio-btn{align-self:flex-end}
.studio-newad-sel{flex:1;font-size:13px;color:var(--muted)}
.studio-newad-error{flex:1;font-size:13px;color:#ba1a1a;font-weight:600}
.studio-newad-requirements{flex:1;min-width:0;display:grid;gap:8px;border:1px solid #f4b4a5;border-radius:10px;background:#fff7f2;color:#7f1d1d;box-shadow:0 8px 24px rgba(127,29,29,.08);padding:12px 14px}
.studio-newad-requirements-head{display:flex;align-items:center;gap:8px}
.studio-newad-requirements-head svg{flex:0 0 auto;color:#ba1a1a}
.studio-newad-requirements strong{font-size:13.5px;font-weight:760;line-height:1.25}
.studio-newad-requirements p,.studio-newad-requirements ul{margin:0;color:#7f1d1d;font-size:12.8px;line-height:1.45}
.studio-newad-requirements ul{display:grid;gap:5px;padding-left:18px}

@media(max-width:1180px){
  .studio-desktop-body{grid-template-columns:182px 286px minmax(360px,1fr)}
  .studio-home-hero{grid-template-columns:minmax(0,1fr) 280px}
  .studio-home-tools>div{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:900px){
  .studio-screen{background:#fff;padding-bottom:88px;overflow:hidden}
  .studio-topbar{height:72px;padding:0 18px}
  .studio-titlebar,.studio-actions .secondary,.studio-actions .publish{display:none}
  .studio-mobile-title{display:flex}
  .studio-mobile-title .blockwise-symbol{width:25px;height:25px}
  .studio-mobile-title .blockwise-wordmark{font-size:19px}
  .studio-desktop-body,.studio-statusbar{display:none}
  .studio-mobile-body{display:block;flex:1;min-height:0;overflow:auto;padding:0 20px 24px;background:#fff}
  .studio-mobile-campaign{border-top:1px solid var(--line-soft);border-bottom:1px solid var(--line-soft);margin:0 -20px;padding:14px 20px}
  .studio-mobile-campaign-btn{width:100%;height:46px;border:1px solid var(--line);border-radius:10px;background:#fff;display:flex;align-items:center;gap:12px;padding:0 12px;font-weight:600;box-shadow:var(--st-sh-1);text-align:left}
  .studio-mobile-campaign-btn svg:last-child{margin-left:auto}
  .studio-more-menu .studio-mobile-menu-save{display:grid}
  .studio-mobile-sheet-backdrop{position:fixed;inset:0;z-index:180;background:rgba(15,23,42,.42);display:grid;align-items:end}
  .studio-mobile-sheet{width:100%;max-height:88vh;overflow:hidden;border-radius:16px 16px 0 0;background:#f8fafc;box-shadow:0 -16px 50px rgba(15,23,42,.22);display:flex;flex-direction:column}
  .studio-mobile-sheet-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 18px;background:#fff;border-bottom:1px solid var(--line-soft)}
  .studio-mobile-sheet-head strong,.studio-mobile-sheet-head span{display:block}
  .studio-mobile-sheet-head strong{font-size:15px;font-weight:700}
  .studio-mobile-sheet-head span{font-size:12px;color:var(--muted);margin-top:2px;max-width:72vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .studio-mobile-sheet-head button{width:36px;height:36px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);display:grid;place-items:center}
  .studio-mobile-sheet-body{display:grid;gap:16px;overflow:auto;padding:18px}
  .studio-mobile-format-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;background:var(--line-soft);border-radius:10px;padding:3px;margin:24px 0 22px}
  .studio-mobile-format-tabs button{height:40px;border:0;border-radius:8px;background:transparent;font-weight:600;color:var(--muted)}
  .studio-mobile-format-tabs button.active{background:#fff;color:var(--accent);box-shadow:var(--st-sh-1)}
  .studio-mobile-preview-wrap{display:grid;place-items:center;background:var(--st-stage);border-radius:16px;padding:22px 0;margin:0 -8px}
  .studio-mobile-preview-wrap .studio-preview-device{transform:none}
  .studio-mobile-preview-wrap .studio-story-card{width:min(320px,84vw)}
  .studio-mobile-preview-wrap .studio-feed-card,.studio-mobile-preview-wrap .studio-creative-card{width:min(320px,84vw);border-radius:18px}
  .studio-mobile-preview-wrap .studio-feed-card.landscape,.studio-mobile-preview-wrap .studio-creative-card.landscape{width:min(320px,84vw)}
  .studio-mobile-preview-wrap .studio-fabric-editor{width:100%;gap:10px}
  .studio-mobile-preview-wrap .studio-fabric-toolbar{max-width:100%;justify-content:flex-start;flex-wrap:nowrap;overflow-x:auto;border-color:var(--line-soft);background:#fff;box-shadow:var(--st-sh-1)}
  .studio-mobile-preview-wrap .studio-fabric-toolbar button{flex:0 0 auto;background:var(--surface-subtle);color:var(--ink)}
  .studio-mobile-preview-wrap .studio-fabric-toolbar button:hover:not(:disabled){background:var(--accent-tint);color:var(--accent)}
  .studio-mobile-preview-wrap .studio-fabric-toolbar-divider{flex:0 0 auto;background:var(--line)}
  .studio-mobile-preview-wrap .studio-fabric-shell{width:100%;max-height:none}
  .studio-mobile-preview-wrap .studio-fabric-shell[data-format="9:16"]{width:min(350px,100%)}
  .studio-mobile-preview-wrap .studio-fabric-shell[data-format="4:5"]{width:min(475px,100%)}
  .studio-mobile-preview-wrap .studio-fabric-shell[data-format="1:1"]{width:min(520px,100%)}
  .studio-mobile-preview-wrap .studio-fabric-shell .canvas-container,.studio-mobile-preview-wrap .studio-fabric-shell canvas{max-height:none}
  .studio-mobile-variants{margin-top:24px}
  .studio-mobile-variants .studio-variant-strip{border:0;padding:0;background:transparent}
  .studio-mobile-variants .studio-variant-tile{background:#fff;box-shadow:var(--st-sh-1)}
  .studio-mobile-variants .studio-variant-tile strong{color:var(--ink)}
  .studio-mobile-variants .studio-variant-tile small{color:var(--muted)}
  .studio-mobile-variants .studio-variant-strip-head strong{color:var(--ink)}
  .studio-mobile-variants .studio-variant-strip-head button{background:var(--accent-tint);color:var(--accent)}
  .studio-mobile-variants .studio-variant-actions button{background:var(--line-soft);color:var(--ink)}
  .studio-variant-strip.compact .studio-variant-tile{width:132px}
  .studio-variant-strip.compact .studio-variant-image img{height:96px}
  .studio-readiness.compact{margin:28px 0 0;padding:18px}
  .studio-readiness.compact .studio-readiness-main{margin-bottom:0}
  .studio-readiness.compact .studio-checklist{display:none}
  .studio-mobile-panel{display:grid;gap:18px;padding-top:22px}
  .studio-mobile-panel .studio-home-panel{width:100%;gap:20px}
  .studio-mobile-panel .studio-home-head{align-items:flex-start}
  .studio-mobile-panel .studio-home-head h1{font-size:26px}
  .studio-mobile-panel .studio-home-create{height:40px;padding:0 15px;font-size:13px}
  .studio-mobile-panel .studio-home-hero{grid-template-columns:1fr;border-radius:14px;padding:18px}
  .studio-mobile-panel .studio-home-preview{display:none}
  .studio-mobile-panel .studio-home-steps button{grid-template-columns:28px 1fr;min-height:76px}
  .studio-mobile-panel .studio-home-steps em{grid-column:2;justify-self:start}
  .studio-mobile-panel .studio-home-tools>div{grid-template-columns:1fr}
  .studio-mobile-panel .studio-home-tools button{min-height:132px}
  .studio-media-confirm{grid-template-columns:40px minmax(0,1fr);gap:14px;padding:18px}
  .studio-media-confirm-icon{width:40px;height:40px}
  .studio-media-confirm-preview{gap:8px}
  .studio-media-confirm-actions{display:grid;grid-template-columns:1fr 1fr}
  .studio-media-confirm-actions .studio-btn{width:100%;padding:0 12px}
  .studio-mobile-bottom{position:fixed;left:0;right:0;bottom:0;z-index:150;height:78px;border-top:1px solid var(--line-soft);background:#fff;display:grid;grid-template-columns:repeat(7,minmax(44px,1fr));overflow-x:auto;padding:8px 6px 10px}
  .studio-mobile-bottom button{border:0;border-radius:10px;background:transparent;color:var(--muted);display:grid;place-items:center;gap:2px;font-size:9.5px;font-weight:600;min-width:0}
  .studio-mobile-bottom button.active{background:var(--accent-tint);color:var(--accent)}
  .studio-mobile-status{position:fixed;left:12px;right:12px;bottom:84px;z-index:151;min-height:34px;border:1px solid var(--line-soft);border-radius:10px;background:#fff;box-shadow:var(--st-sh-1);display:flex;align-items:center;justify-content:center;padding:7px 12px;color:var(--muted);font-size:12.5px;font-weight:650;text-align:center}
  .studio-mobile-status[data-state="saved"]{color:var(--st-good)}
  .studio-mobile-status[data-state="error"]{color:#ba1a1a;border-color:#ffdad6;background:#fff7f6}
  .studio-mobile-busy{position:fixed;left:12px;right:12px;top:82px;z-index:181;min-height:44px;border-radius:12px;background:#001b3d;color:#fff;box-shadow:var(--st-sh-2);display:flex;align-items:center;justify-content:center;gap:9px;padding:10px 14px;font-size:13px}
  .studio-mobile-busy svg{animation:studio-spin 1s linear infinite}
  .studio-more-menu{right:12px;top:66px;width:min(286px,calc(100vw - 24px))}
  .studio-newad{width:100%;border-radius:14px}
  .studio-newad-sources{grid-template-columns:1fr}
  .studio-newad-source{min-height:112px}
  .studio-tpl-grid{grid-template-columns:repeat(2,1fr)}
  .studio-newad-foot.has-alert{flex-wrap:wrap}
  .studio-newad-foot.has-alert .studio-newad-requirements{flex-basis:100%}
}
@media(max-width:380px){
  .studio-story-headline{font-size:31px}
  .studio-story-body{font-size:19px}
  .studio-mobile-body{padding-left:14px;padding-right:14px}
}

/* Finished-ad editor: selectable QA regions, persistent history controls, and
   one inspector shared by pointer, keyboard, and touch users. */
.studio-inplace-stage{position:relative;display:grid;justify-items:center;gap:10px}
.studio-inplace-frame{position:relative;display:inline-block;line-height:0}
.studio-inplace-frame img{display:block;max-width:min(475px,82vw);max-height:calc(100vh - 250px);width:auto;height:auto;border-radius:12px;box-shadow:0 30px 70px rgba(0,0,0,.42)}
.studio-inplace-region{position:absolute;min-width:44px;min-height:44px;margin:0;padding:0;display:grid;place-items:center;border:1.5px dashed rgba(255,255,255,.28);border-radius:8px;background:transparent;cursor:pointer;transition:border-color .18s ease,background .18s ease,box-shadow .18s ease}
.studio-inplace-region.image{border-color:transparent}
.studio-inplace-region:hover:not(:disabled),.studio-inplace-region:focus-visible,.studio-inplace-region[data-selected]{border-color:rgba(255,255,255,.92);background:rgba(255,255,255,.05);box-shadow:0 0 0 2px rgba(22,24,29,.7)}
.studio-inplace-region:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(255,255,255,.95),0 0 0 5px rgba(22,24,29,.72)}
.studio-inplace-region:disabled{cursor:not-allowed}
.studio-inplace-region[data-pending]{border-color:#fff;cursor:progress;background:linear-gradient(100deg,rgba(255,255,255,.06) 30%,rgba(255,255,255,.24) 50%,rgba(255,255,255,.06) 70%);background-size:200% 100%;animation:studio-inplace-shimmer 1.2s ease infinite}
@keyframes studio-inplace-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
.studio-inplace-status{display:inline-flex;align-items:center;padding:5px 10px;border-radius:9999px;background:rgba(15,23,42,.88);color:#fff;font-size:11px;font-weight:700;line-height:1.4;white-space:nowrap}
.studio-inplace-toolbar{position:absolute;z-index:5;left:50%;bottom:12px;transform:translateX(-50%);display:flex;gap:4px;padding:4px;border-radius:12px;background:rgba(11,12,16,.9);box-shadow:0 8px 24px rgba(0,0,0,.3)}
.studio-inplace-toolbar button{min-width:44px;min-height:44px;border:0;border-radius:9px;background:transparent;color:#fff;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 11px;font-size:12px;font-weight:650;white-space:nowrap}
.studio-inplace-toolbar button:hover:not(:disabled){background:rgba(255,255,255,.12)}
.studio-inplace-toolbar button:disabled{opacity:.38;cursor:not-allowed}
.studio-inplace-toolbar button:focus-visible,.studio-inplace-inspector button:focus-visible,.studio-inplace-inspector textarea:focus-visible{outline:2px solid #16181d;outline-offset:2px}
.studio-inplace-inspector{position:fixed;z-index:190;top:78px;left:612px;bottom:24px;width:320px;overflow:auto;border:1px solid var(--line-heavy);border-radius:18px;background:#fff;color:var(--ink);box-shadow:0 18px 48px rgba(16,18,23,.18);padding:18px;line-height:1.45}
.studio-inplace-inspector header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding-bottom:16px;border-bottom:1px solid var(--line)}
.studio-inplace-inspector header div{display:grid;gap:3px}
.studio-inplace-inspector header span{font-size:12px;color:var(--muted)}
.studio-inplace-inspector header strong{font-size:19px;line-height:1.2;text-transform:capitalize}
.studio-inplace-inspector header button{width:44px;height:44px;border:1px solid var(--line-heavy);border-radius:10px;background:#fff;color:var(--ink);display:grid;place-items:center}
.studio-inplace-element-picker{display:grid;grid-template-columns:44px minmax(0,1fr) 44px;align-items:center;gap:6px;padding:12px 0}
.studio-inplace-element-nav{width:44px;height:44px;border:1px solid var(--line-heavy);border-radius:9999px;background:#fff;color:var(--ink);display:grid;place-items:center;transition:background-color .18s cubic-bezier(.22,1,.36,1),border-color .18s cubic-bezier(.22,1,.36,1)}
.studio-inplace-element-nav:hover:not(:disabled){border-color:var(--ink);background:var(--canvas)}
.studio-inplace-element-nav:disabled{opacity:.28;cursor:not-allowed}
.studio-inplace-element-list{position:relative;display:flex;min-width:0;gap:7px;overflow-x:auto;overscroll-behavior-inline:contain;padding:4px 1px;scrollbar-width:thin}
.studio-inplace-element-list button{flex:0 0 auto;min-height:44px;border:1px solid var(--line-heavy);border-radius:9999px;background:#fff;color:var(--ink);display:inline-flex;align-items:center;gap:7px;padding:0 13px;font-size:12.5px;font-weight:650;text-transform:capitalize}
.studio-inplace-element-list button[aria-pressed="true"]{border-color:#16181d;background:#16181d;color:#fff}
.studio-inplace-field{display:grid;gap:10px;padding-top:4px}
.studio-inplace-field label{font-size:13px;font-weight:700}
.studio-inplace-field textarea{width:100%;min-height:112px;resize:vertical;border:1px solid var(--line-heavy);border-radius:10px;background:#fff;padding:11px 12px;color:var(--ink);font:inherit;font-size:14px;line-height:1.5}
.studio-inplace-field textarea::placeholder{color:#545a66}
.studio-inplace-field small{color:var(--muted);font-size:12px;line-height:1.45}
.studio-inplace-field button{min-height:44px;border:1px solid var(--line-heavy);border-radius:9999px;background:#fff;color:var(--ink);display:flex;align-items:center;justify-content:center;gap:8px;padding:0 16px;font-size:13px;font-weight:700}
.studio-inplace-field button.primary{border-color:#16181d;background:#16181d;color:#fff}
.studio-inplace-field button:disabled{opacity:.42;cursor:not-allowed}
.studio-inplace-preserve-note{margin:18px 0 0;padding:13px 14px;border-radius:12px;background:#f1f2f4;color:#3f444e;font-size:12.5px;line-height:1.5}
.studio-inplace-progress{margin-top:12px;min-height:44px;border-radius:10px;background:#16181d;color:#fff;display:flex;align-items:center;gap:9px;padding:9px 12px;font-size:12.5px;font-weight:650}
@media(max-width:1280px){
  .studio-inplace-inspector{top:auto;right:8px;bottom:86px;left:8px;width:auto;max-height:min(68vh,620px);border-radius:18px;padding:16px}
}
@media(max-width:760px){
  .studio-inplace-toolbar{bottom:8px}
  .studio-inplace-toolbar button{font-size:0;padding:0;width:44px}
  .studio-inplace-toolbar button:last-child{width:auto;padding:0 12px;font-size:12px}
}
@media(prefers-reduced-motion:reduce){.studio-media-grid button,.studio-inplace-region,.studio-inplace-element-nav{transition:none}.studio-media-grid button:hover{transform:none}.studio-inplace-region[data-pending]{animation:none}}

/* Meta chrome: the stage shows the clone creative exactly as Meta renders it.
   Reuses the .studio-feed-card / .studio-story-card visual language; the creative
   itself is the embedded in-place editor, never a second static render. */
.studio-metachrome{overflow:visible;border-radius:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.studio-metachrome-card{width:min(500px,92vw);max-width:100%;overflow:visible;border-radius:0;background:#fff;color:#050505}
.studio-metachrome-card header{height:64px;padding:12px 16px}
.studio-metachrome-card .studio-feed-id{gap:8px}
.studio-metachrome-card .studio-meta-avatar{width:40px;height:40px;font-size:19px}
.studio-metachrome-card .studio-feed-id strong{font-size:15px;line-height:1.2;font-weight:700;color:#050505}
.studio-metachrome-card .studio-feed-id small{font-size:13px;line-height:1.2;color:#65676b}
.studio-metachrome-card footer{min-height:76px;border-top:1px solid #dadde1;border-radius:0;background:#f0f2f5;padding:10px 16px;grid-template-columns:minmax(0,1fr) auto;gap:12px}
.studio-metachrome-card footer small{color:#65676b;font-size:12px;line-height:1.2;font-weight:600;letter-spacing:0;text-transform:uppercase}
.studio-metachrome-card .studio-feed-headline{font-size:16px;line-height:1.22;font-weight:650;color:#050505;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-metachrome-card .studio-feed-desc{font-size:13px;line-height:1.25;color:#65676b;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-metachrome-card .studio-feed-cta{min-height:36px;border-radius:6px;background:#e4e6eb;color:#050505;padding:0 14px;font-size:15px;font-weight:650;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap}
.studio-metachrome-copy{cursor:pointer}
.studio-metachrome-copy:hover{color:var(--accent)}
.studio-metachrome-card .studio-feed-primary{padding:0 16px 12px;color:#050505;font-size:15px;line-height:1.333;white-space:pre-line}
.studio-metachrome-media{position:relative;background:#eee;min-height:120px}
.studio-metachrome-media .studio-inplace-stage{width:100%;gap:0}
.studio-metachrome-media .studio-inplace-frame,.studio-metachrome-media .studio-clone-stage{width:100%;aspect-ratio:4/5;overflow:hidden}
.studio-metachrome-media .studio-inplace-frame img,.studio-metachrome-media .studio-clone-stage img{width:100%;height:100%;max-width:100%;max-height:none;object-fit:cover;border-radius:0;box-shadow:none}
.studio-metachrome-media .studio-inplace-hint,.studio-metachrome-media .studio-inplace-undo{display:none}
.studio-metachrome-media .studio-editor-loading{min-height:320px;color:var(--muted)}
.studio-metachrome-nudge,.studio-metachrome-edit-hint{margin:10px auto 0;width:min(500px,92vw);color:#d7deea;font-size:12px;font-weight:650;line-height:1.35;text-align:left}
.studio-metachrome-story{position:relative;width:min(360px,82vw);aspect-ratio:9/16;overflow:hidden;background:#000}
.studio-metachrome-story .studio-inplace-stage{width:100%;height:100%;gap:0}
.studio-metachrome-story .studio-inplace-frame,.studio-metachrome-story .studio-clone-stage{width:100%;height:100%;overflow:hidden}
.studio-metachrome-story .studio-inplace-frame img,.studio-metachrome-story .studio-clone-stage img{width:100%;height:100%;max-width:none;max-height:none;object-fit:cover;border-radius:0;box-shadow:none}
.studio-metachrome-story .studio-inplace-hint,.studio-metachrome-story .studio-inplace-undo{display:none}
.studio-metachrome-story-chrome{position:absolute;inset:0;z-index:4;pointer-events:none;border-radius:0;overflow:hidden;color:#fff;background:linear-gradient(180deg,rgba(0,0,0,.42) 0%,rgba(0,0,0,0) 20%,rgba(0,0,0,0) 78%,rgba(0,0,0,.45) 100%)}
.studio-metachrome-story-progress{position:absolute;top:10px;left:12px;right:12px;display:flex;gap:4px}
.studio-metachrome-story-progress i{flex:1;height:2.5px;border-radius:999px;background:rgba(255,255,255,.45)}
.studio-metachrome-story-progress i:first-child{background:#fff}
.studio-metachrome-story-brand{top:24px;left:14px;right:14px;gap:8px}
.studio-metachrome-story-brand .studio-meta-avatar{width:32px;height:32px;font-size:16px;background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.4)}
.studio-metachrome-story-brand strong{font-size:13px;font-weight:700}
.studio-metachrome-story-brand small{font-size:11px}
.studio-metachrome-story-cta{left:50%;right:auto;bottom:28px;min-height:34px;transform:translateX(-50%);border-radius:999px;background:rgba(255,255,255,.92);color:#050505;padding:0 16px;font-size:13px;font-weight:700;pointer-events:none}
`;
