export const STYLES = `
.studio-screen{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;background:#f7f8fa;color:var(--ink);font-size:14px;letter-spacing:0}
.studio-screen *{box-sizing:border-box}
.studio-screen button,.studio-screen input,.studio-screen select,.studio-screen textarea{font:inherit}
.studio-screen button{cursor:pointer}
.studio-topbar{position:relative;z-index:4;height:72px;display:flex;align-items:center;justify-content:space-between;gap:18px;border-bottom:1px solid var(--line);background:#fff;padding:0 28px}
.studio-titlebar,.studio-mobile-title,.studio-actions{display:flex;align-items:center;gap:14px;min-width:0}
.studio-titlebar .blockwise-symbol{width:30px;height:30px}
.studio-titlebar .blockwise-wordmark{font-size:22px}
.studio-mobile-title{display:none}
.studio-divider{width:1px;height:28px;background:var(--line)}
.studio-breadcrumb{font-size:16px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-btn,.studio-icon-btn{height:44px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);display:inline-flex;align-items:center;justify-content:center;gap:9px;padding:0 17px;font-weight:700;white-space:nowrap}
.studio-btn.secondary:hover,.studio-icon-btn:hover{background:var(--surface-subtle)}
.studio-btn.publish{background:#111;color:#fff;border-color:#111}
.studio-btn.publish:hover{background:#000}
.studio-btn.block{width:100%}
.studio-btn:disabled{opacity:.55;cursor:not-allowed}
.studio-icon-btn{width:44px;padding:0}
.studio-more-menu{position:absolute;right:18px;top:60px;width:260px;display:grid;gap:4px;border:1px solid var(--line);border-radius:8px;background:#fff;padding:14px;box-shadow:0 18px 50px rgba(15,23,41,.14);z-index:10}
.studio-more-menu button{min-height:40px;border:0;background:transparent;border-radius:8px;color:var(--ink);display:grid;grid-template-columns:22px 1fr 18px;align-items:center;gap:10px;padding:0 8px;text-align:left}
.studio-more-menu button:hover{background:var(--surface-subtle)}
.studio-more-menu .danger{color:#dc2626}
.studio-menu-line{height:1px;background:var(--line);margin:5px 0}
.studio-desktop-body{flex:1;min-height:0;display:grid;grid-template-columns:210px 310px minmax(430px,1fr) 350px;background:#fff}
.studio-rail{border-right:1px solid var(--line);background:#fff;padding:22px 16px;display:grid;align-content:start;gap:8px}
.studio-rail button{height:54px;border:0;border-radius:8px;background:transparent;color:var(--ink);display:flex;align-items:center;gap:14px;padding:0 18px;font-weight:750;text-align:left}
.studio-rail button:hover,.studio-rail button.active{background:#f3f4f6}
.studio-left-panel{min-width:0;overflow:auto;border-right:1px solid var(--line);padding:30px 28px;display:flex;flex-direction:column;gap:22px}
.studio-panel-header h2{margin:0 0 8px;font-size:22px;line-height:1.1;font-weight:750;letter-spacing:0}
.studio-panel-header p{margin:0;color:var(--muted);font-size:14px}
.studio-field{display:grid;gap:8px}
.studio-field>span{font-size:13px;font-weight:750;color:var(--ink)}
.studio-field>div{min-height:46px;border:1px solid var(--line);border-radius:8px;background:#fff;display:flex;align-items:center;gap:10px;padding:0 12px}
.studio-field svg{color:var(--ink);flex:0 0 auto}
.studio-field input,.studio-field select{width:100%;min-width:0;border:0;background:transparent;color:var(--ink);outline:none}
.studio-link-btn{width:max-content;border:0;background:transparent;color:var(--ink);display:inline-flex;align-items:center;gap:9px;font-weight:750;padding:0}
.studio-angle-list{display:grid;gap:10px}
.studio-angle-card{display:grid;grid-template-columns:62px 1fr;gap:12px;align-items:center;border:1px solid var(--line);border-radius:8px;background:#fff;padding:10px;text-align:left}
.studio-angle-card.active,.studio-angle-card:hover{border-color:#111;box-shadow:0 0 0 1px #111}
.studio-angle-thumb{width:62px;height:50px;border-radius:7px;background-size:cover;background-position:center}
.studio-angle-card strong,.studio-angle-card small,.studio-angle-card em{display:block}
.studio-angle-card strong{font-size:14px}
.studio-angle-card small{color:var(--muted);line-height:1.35;margin-top:2px}
.studio-angle-card em{font-style:normal;color:var(--muted);font-size:12px;margin-top:5px}
.studio-brand-preview,.studio-note-card{border:1px solid var(--line);border-radius:8px;background:#fff;padding:14px;display:flex;gap:12px;align-items:center}
.studio-brand-preview span{width:46px;height:46px;border-radius:999px;color:#fff;display:grid;place-items:center;font-weight:850}
.studio-brand-preview small,.studio-note-card{color:var(--muted)}
.studio-swatches{display:flex;gap:9px}
.studio-swatches span{width:36px;height:36px;border:1px solid var(--line);border-radius:8px}
.studio-advanced{border:1px solid var(--line);border-radius:8px;background:#fff;padding:12px}
.studio-advanced summary{cursor:pointer;font-weight:750}
.studio-advanced p{color:var(--muted);margin:10px 0 0}
.studio-dropzone{min-height:112px;border:1.5px dashed var(--line);border-radius:8px;background:#fff;display:grid;place-items:center;gap:4px;color:var(--muted)}
.studio-dropzone span{font-weight:750;color:var(--ink)}
.studio-media-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.studio-media-grid button{border:1px solid var(--line);border-radius:8px;background:#fff;padding:8px;text-align:left}
.studio-media-grid button.active{border-color:#111}
.studio-media-grid img{display:block;width:100%;aspect-ratio:1.25/1;object-fit:cover;border-radius:6px;margin-bottom:8px}
.studio-media-grid span,.studio-media-grid small{display:block}
.studio-media-grid small{color:var(--muted);font-size:11px}
.studio-copy-fields{display:grid;gap:12px}
.studio-copy-fields label{display:grid;gap:7px}
.studio-copy-fields span{display:flex;justify-content:space-between;gap:12px;font-weight:750}
.studio-copy-fields small{color:var(--muted);font-weight:650}
.studio-copy-fields textarea{width:100%;resize:vertical;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:10px 11px;outline:none}
.studio-copy-fields textarea:focus{border-color:#111;box-shadow:0 0 0 2px rgba(17,17,17,.08)}
.studio-assist-row{display:flex;flex-wrap:wrap;gap:8px}
.studio-assist-row button,.studio-card-actions button{border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);min-height:32px;padding:0 10px;font-size:12px;font-weight:750}
.studio-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding:11px 0;font-weight:700}
.studio-preview-column{min-width:0;display:flex;flex-direction:column;background:#fafafa}
.studio-preview-controls{min-height:68px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 22px;background:#fff}
.studio-segment,.studio-mini-segment{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:8px;background:#f6f6f6;padding:4px}
.studio-segment button,.studio-mini-segment button{border:0;border-radius:7px;background:transparent;color:var(--ink);min-height:34px;padding:4px 13px;font-weight:750}
.studio-segment button{display:grid;gap:1px;text-align:center;min-width:86px}
.studio-segment button small{font-size:10px;color:var(--muted)}
.studio-segment button.active,.studio-mini-segment button.active{background:#111;color:#fff}
.studio-segment button.active small{color:#fff}
.studio-control-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.studio-stage{position:relative;flex:1;min-height:0;display:grid;place-items:center;overflow:auto;padding:34px}
.studio-preview-device{transform:scale(var(--preview-scale));transform-origin:center;transition:transform .16s ease}
.studio-story-card{position:relative;width:332px;aspect-ratio:9/16;overflow:hidden;border-radius:22px;background:#111;color:#fff;box-shadow:0 26px 70px rgba(15,23,41,.2)}
.studio-story-card img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.studio-story-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.38) 0%,rgba(0,0,0,.08) 38%,rgba(0,0,0,.66) 100%)}
.studio-story-brand{position:absolute;top:18px;left:18px;right:18px;z-index:3;display:flex;align-items:center;gap:10px}
.studio-story-brand span{width:42px;height:42px;border-radius:999px;background:#172033;color:#fff;display:grid;place-items:center;font-size:21px;font-weight:800}
.studio-story-brand strong,.studio-story-brand small{display:block;text-shadow:0 1px 5px rgba(0,0,0,.4)}
.studio-story-brand small{font-size:12px;opacity:.9}
.studio-hit.image{position:absolute;inset:0;z-index:2;border:0;background:transparent}
.studio-story-headline,.studio-story-body,.studio-story-cta{position:absolute;z-index:4;border:0;background:transparent;color:#fff;text-align:left;padding:0}
.studio-story-headline{left:24px;right:24px;bottom:158px;font-family:Georgia,serif;font-size:35px;line-height:1.03;font-weight:750;text-shadow:0 2px 12px rgba(0,0,0,.55)}
.studio-story-body{left:24px;right:58px;bottom:104px;font-size:22px;line-height:1.18;text-shadow:0 2px 9px rgba(0,0,0,.55)}
.studio-story-cta{left:24px;right:24px;bottom:24px;min-height:54px;border-radius:8px;background:#fff;color:#111;display:flex;align-items:center;justify-content:space-between;padding:0 20px;font-size:16px;font-weight:800;box-shadow:0 8px 22px rgba(0,0,0,.26)}
.studio-story-card.creative .studio-story-brand{display:none}
.selected{outline:2px solid #fff;outline-offset:3px}
.studio-creative-card{position:relative;width:392px;aspect-ratio:1/1;overflow:hidden;border-radius:8px;background:#111;color:#fff;box-shadow:0 18px 55px rgba(15,23,41,.12)}
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
.studio-feed-card{width:392px;overflow:hidden;border:1px solid #e6e8ed;border-radius:24px;background:#fff;box-shadow:0 18px 55px rgba(15,23,41,.12)}
.studio-feed-card.landscape{width:560px}
.studio-feed-card header{height:70px;display:flex;align-items:center;justify-content:space-between;padding:0 18px}
.studio-feed-id{display:flex;align-items:center;gap:11px}
.studio-feed-id span{width:42px;height:42px;border-radius:999px;background:#172033;color:#fff;display:grid;place-items:center;font-weight:850}
.studio-feed-id strong,.studio-feed-id small{display:block}
.studio-feed-id small{color:var(--muted);font-size:12px}
.studio-feed-primary,.studio-feed-headline,.studio-feed-desc{display:block;width:100%;border:0;background:transparent;color:var(--ink);text-align:left}
.studio-feed-primary{padding:0 18px 16px;line-height:1.38}
.studio-feed-image{display:block;width:100%;border:0;background:#eee;padding:0}
.studio-feed-image img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover}
.studio-feed-card.landscape .studio-feed-image img{aspect-ratio:1.91/1}
.studio-feed-card footer{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;background:#f3f4f6;padding:15px 18px}
.studio-feed-card footer small{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;font-weight:750}
.studio-feed-headline{font-size:17px;font-weight:800;line-height:1.18;margin-top:4px}
.studio-feed-desc{color:var(--muted);font-size:13px;line-height:1.3;margin-top:3px}
.studio-feed-cta{border:0;border-radius:8px;background:#172033;color:#fff;min-height:38px;padding:0 14px;font-weight:800}
.studio-busy{position:absolute;inset:0;z-index:5;background:rgba(250,250,250,.78);display:grid;place-items:center}
.studio-busy-card{width:280px;border:1px solid var(--line);border-radius:8px;background:#fff;display:grid;gap:9px;justify-items:center;padding:22px;text-align:center;box-shadow:0 18px 50px rgba(15,23,41,.12)}
.studio-busy-card svg{animation:studio-spin 1s linear infinite}
@keyframes studio-spin{to{transform:rotate(360deg)}}
.studio-busy-card span{color:var(--muted);font-size:12px}
.studio-variant-strip{border-top:1px solid var(--line);background:#fff;padding:18px 24px}
.studio-variant-strip-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.studio-variant-strip-head button{border:0;background:transparent;font-weight:700}
.studio-variant-row{display:flex;gap:16px;overflow-x:auto;padding-bottom:2px}
.studio-variant-tile,.studio-add-variant{width:146px;flex:0 0 auto;border:1px solid var(--line);border-radius:8px;background:#fff;padding:8px;text-align:center}
.studio-variant-tile.active{border-color:#111;box-shadow:0 0 0 2px #111}
.studio-variant-image{position:relative;display:block}
.studio-variant-image img{display:block;width:100%;height:106px;object-fit:cover;border-radius:7px}
.studio-variant-image svg{position:absolute;top:8px;left:8px;width:28px;height:28px;border-radius:999px;background:#111;color:#fff;padding:6px}
.studio-variant-tile strong,.studio-variant-tile small{display:block}
.studio-variant-tile strong{margin-top:8px}
.studio-variant-tile small{color:var(--muted)}
.studio-add-variant{display:grid;place-items:center;align-content:center;gap:8px;border-style:dashed;color:var(--ink);min-height:164px}
.studio-inspector{border-left:1px solid var(--line);background:#fff;padding:22px 22px 26px;overflow:auto}
.studio-inspector-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;border:1px solid var(--line);border-radius:8px;background:#f6f6f6;padding:4px;margin-bottom:22px}
.studio-inspector-tabs button{border:0;border-radius:7px;background:transparent;color:var(--ink);min-height:36px;font-weight:750}
.studio-inspector-tabs button.active{background:#fff;box-shadow:0 1px 2px rgba(15,23,41,.05)}
.studio-readiness{border:1px solid var(--line);border-radius:8px;background:#fff;padding:22px}
.studio-readiness header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:22px}
.studio-readiness h3{font-size:18px;margin:0}
.studio-readiness-main{display:flex;align-items:center;gap:20px;margin-bottom:22px}
.studio-readiness-main p{margin:0;line-height:1.45}
.studio-score{width:86px;height:86px;border-radius:999px;display:grid;place-items:center;background:conic-gradient(#45b757 var(--score),#e8ecef 0)}
.studio-score span{width:62px;height:62px;border-radius:999px;background:#fff;display:grid;place-items:center;font-size:18px;font-weight:850}
.studio-checklist{display:grid;gap:14px}
.studio-checklist>div{display:grid;grid-template-columns:22px 1fr;gap:10px;align-items:start}
.studio-check-icon{width:19px;height:19px;border-radius:999px;display:grid;place-items:center;margin-top:1px}
.studio-checklist .done .studio-check-icon{background:#45b757;color:#fff}
.studio-checklist .warn .studio-check-icon{background:#ffb020;color:#fff}
.studio-checklist .todo .studio-check-icon{border:1px solid #aab3c1;color:#6b7280}
.studio-checklist strong,.studio-checklist small{display:block}
.studio-checklist small{color:var(--muted);line-height:1.35}
.studio-recommendations{width:100%;min-height:44px;border:1px solid var(--line);border-radius:8px;background:#fff;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 14px;margin-top:22px;font-weight:750}
.studio-inspector-list,.studio-edit-panel,.studio-publish-panel{display:grid;gap:14px}
.studio-inspector-list article{display:grid;grid-template-columns:86px 1fr;gap:12px;border:1px solid var(--line);border-radius:8px;background:#fff;padding:10px}
.studio-inspector-list article.active{border-color:#111}
.studio-inspector-list img{width:86px;height:78px;object-fit:cover;border-radius:7px}
.studio-inspector-list small{display:block;color:var(--muted);margin:3px 0 8px}
.studio-publish-blocker,.studio-publish-ready{border-radius:8px;padding:12px;font-weight:750}
.studio-publish-blocker{background:#fff2f2;color:#b91c1c;border:1px solid #ffd5d5}
.studio-publish-ready{background:#edf8f0;color:#126b35;border:1px solid #cdebd4}
.studio-publish-row{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding:10px 0}
.studio-publish-row span{color:var(--muted)}
.studio-publish-list{display:grid;gap:10px}
.studio-publish-list label{display:flex;align-items:center;gap:10px;font-weight:750}
.studio-statusbar{height:38px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid var(--line);background:#fff;color:var(--muted);padding:0 24px;font-size:12px;font-weight:700}
.studio-statusbar .error{color:#b91c1c}
.studio-toast{position:fixed;left:50%;bottom:54px;z-index:200;transform:translateX(-50%);border-radius:8px;background:#111;color:#fff;padding:11px 16px;font-weight:750;box-shadow:0 18px 45px rgba(15,23,41,.2)}
.studio-mobile-body,.studio-mobile-bottom{display:none}
@media(max-width:1180px){
  .studio-desktop-body{grid-template-columns:178px 286px minmax(360px,1fr)}
  .studio-inspector{display:none}
}
@media(max-width:900px){
  .studio-screen{background:#fff;padding-bottom:88px;overflow:hidden}
  .studio-topbar{height:78px;padding:0 18px}
  .studio-titlebar,.studio-actions .secondary,.studio-actions .publish{display:none}
  .studio-mobile-title{display:flex}
  .studio-mobile-title .blockwise-symbol{width:25px;height:25px}
  .studio-mobile-title .blockwise-wordmark{font-size:19px}
  .studio-desktop-body,.studio-statusbar{display:none}
  .studio-mobile-body{display:block;flex:1;min-height:0;overflow:auto;padding:0 20px 24px}
  .studio-mobile-campaign{border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin:0 -20px;padding:14px 20px}
  .studio-mobile-campaign-btn{height:48px;border:1px solid var(--line);border-radius:8px;background:#fff;display:flex;align-items:center;gap:12px;padding:0 12px;font-weight:750}
  .studio-mobile-format-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:0;background:#f2f2f2;border-radius:10px;padding:4px;margin:28px 0 24px}
  .studio-mobile-format-tabs button{height:44px;border:0;border-radius:8px;background:transparent;font-weight:750}
  .studio-mobile-format-tabs button.active{background:#111;color:#fff}
  .studio-mobile-preview-wrap{display:grid;place-items:center}
  .studio-mobile-preview-wrap .studio-preview-device{transform:none}
  .studio-mobile-preview-wrap .studio-story-card{width:min(340px,88vw)}
  .studio-mobile-preview-wrap .studio-feed-card,.studio-mobile-preview-wrap .studio-creative-card{width:min(340px,88vw);border-radius:18px}
  .studio-mobile-preview-wrap .studio-feed-card.landscape,.studio-mobile-preview-wrap .studio-creative-card.landscape{width:min(340px,88vw)}
  .studio-mobile-variants{margin-top:24px}
  .studio-mobile-variants .studio-variant-strip{border:0;padding:0;background:transparent}
  .studio-variant-strip.compact .studio-variant-tile{width:132px}
  .studio-variant-strip.compact .studio-variant-image img{height:96px}
  .studio-readiness.compact{margin:28px 0 0;padding:18px}
  .studio-readiness.compact .studio-readiness-main{margin-bottom:0}
  .studio-readiness.compact .studio-checklist{display:none}
  .studio-mobile-panel{display:grid;gap:18px;padding-top:22px}
  .studio-mobile-bottom{position:fixed;left:0;right:0;bottom:0;z-index:150;height:78px;border-top:1px solid var(--line);background:#fff;display:grid;grid-template-columns:repeat(4,1fr);padding:8px 12px 10px}
  .studio-mobile-bottom button{border:0;border-radius:8px;background:transparent;color:#111;display:grid;place-items:center;gap:2px;font-size:12px}
  .studio-mobile-bottom button.active{background:#f0f0f0}
  .studio-more-menu{right:12px;top:66px;width:min(286px,calc(100vw - 24px))}
}
@media(max-width:380px){
  .studio-story-headline{font-size:31px}
  .studio-story-body{font-size:19px}
  .studio-mobile-body{padding-left:14px;padding-right:14px}
}

/* D: actions — reserved for Wave 1-D additions */
`;
