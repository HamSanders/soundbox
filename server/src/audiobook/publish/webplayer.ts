/**
 * Self-contained web player export: a folder (and a zip of it) that plays the
 * book from disk with no server and no network.
 *
 *   index.html        player, read-along and schema.org Audiobook JSON-LD
 *   audio/NN-*.mp3    one file per chapter (WAV when ffmpeg is missing)
 *   cover.<ext>       the cover, when the book has one
 *   readalong.json    chapters and paragraph timings, for other players
 *   book.jsonld       the same JSON-LD as a file
 *
 * The book data is also inlined into index.html, because browsers refuse
 * `fetch()` of a sibling file from a `file://` page. `<audio src>` from disk
 * works everywhere, so the audio stays as separate files.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { ModelError } from "../../errors.js";
import type { MirliService } from "../../service.js";
import { audiobooks, type BookDetail } from "../service.js";
import {
  audiobookJsonLd,
  copyCover,
  gatherChapters,
  listFiles,
  newPublishDir,
  type AudioEncoding,
  type PublishedChapter,
  type PublishResult,
} from "./common.js";
import { writeZip } from "./zip.js";

export interface WebPlayerOptions {
  encoding?: AudioEncoding;
  zip?: boolean;
}

/** The read-along document: what index.html plays and what readalong.json holds. */
export interface ReadAlongDoc {
  version: 1;
  title: string;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  description: string | null;
  language: string;
  cover: string | null;
  chapters: {
    title: string;
    audio: string;
    duration_s: number;
    paragraphs: { text: string; start_s: number | null; end_s: number | null; heading: boolean }[];
  }[];
}

export function readAlongDoc(book: BookDetail, chapters: PublishedChapter[], cover: string | null): ReadAlongDoc {
  return {
    version: 1,
    title: book.title,
    subtitle: book.subtitle,
    author: book.author,
    narrator: book.narrator,
    description: book.description,
    language: book.language,
    cover,
    chapters: chapters.map((c) => ({
      title: c.chapter.title,
      audio: c.chapter.audio_url!,
      duration_s: c.chapter.duration_s,
      paragraphs: c.chapter.paragraphs.map((p) => ({
        text: p.text,
        start_s: p.start_s,
        end_s: p.end_s,
        heading: p.is_heading,
      })),
    })),
  };
}

/** JSON for inside a <script> element: no `</script>` or `<!--` can close it. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function publishWebPlayer(
  svc: MirliService,
  bookId: string,
  options: WebPlayerOptions = {},
): Promise<PublishResult> {
  const book = audiobooks(svc).getBook(bookId);
  if (!book) throw new ModelError("Book not found");
  const warnings: string[] = [];
  const { name, dir } = newPublishDir(svc, book, "webplayer");
  const chapters = await gatherChapters(svc, book, dir, options.encoding ?? "auto", warnings);
  const cover = copyCover(svc, bookId, dir);
  const doc = readAlongDoc(book, chapters, cover);
  const ld = audiobookJsonLd(svc, book, chapters, cover);
  writeFileSync(join(dir, "readalong.json"), JSON.stringify(doc, null, 2));
  writeFileSync(join(dir, "book.jsonld"), JSON.stringify(ld, null, 2));
  writeFileSync(join(dir, "index.html"), webPlayerHtml(doc, ld));

  const files = listFiles(dir);
  let zipPath: string | null = null;
  if (options.zip !== false) {
    zipPath = `${dir}.zip`;
    writeZip(
      zipPath,
      files.map((f) => ({ name: `${name}/${f}`, source: join(dir, f) })),
    );
  }
  return {
    kind: "webplayer",
    name,
    dir,
    zip_path: zipPath,
    download_url: zipPath ? `/api/audiobooks/${encodeURIComponent(bookId)}/publish/files/${encodeURIComponent(name)}.zip` : null,
    files,
    chapters: chapters.length,
    warnings,
    created_at: new Date().toISOString(),
  };
}

/** The player page. Plain JS and CSS, no dependencies, works from file://. */
export function webPlayerHtml(doc: ReadAlongDoc, ld: Record<string, unknown>): string {
  const title = escapeHtml(doc.title);
  return `<!doctype html>
<html lang="${escapeHtml(doc.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${doc.description ? `<meta name="description" content="${escapeHtml(doc.description.slice(0, 300))}">` : ""}
<script type="application/ld+json">${scriptJson(ld)}</script>
<style>
:root{--bg:oklch(0.985 0 0);--fg:oklch(0.2 0 0);--muted:oklch(0.55 0 0);--line:oklch(0.9 0 0);--card:oklch(1 0 0);--accent:oklch(0.55 0.15 260);--hl:oklch(0.93 0.05 260)}
@media (prefers-color-scheme:dark){:root{--bg:oklch(0.17 0 0);--fg:oklch(0.95 0 0);--muted:oklch(0.65 0 0);--line:oklch(0.3 0 0);--card:oklch(0.21 0 0);--accent:oklch(0.72 0.13 260);--hl:oklch(0.32 0.07 260)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}
header{display:flex;gap:20px;padding:24px 16px;max-width:860px;margin:auto;align-items:flex-end}
.cover{width:140px;aspect-ratio:1;border-radius:8px;object-fit:cover;background:var(--line);flex:none}
h1{margin:0;font-size:1.6rem;line-height:1.2}.sub,.by{color:var(--muted);margin:4px 0 0}
main{display:grid;grid-template-columns:220px 1fr;gap:24px;max-width:860px;margin:auto;padding:0 16px 160px}
@media (max-width:700px){main{grid-template-columns:1fr}header{flex-direction:column;align-items:flex-start}}
nav ol{list-style:none;padding:0;margin:0}nav button{all:unset;cursor:pointer;display:block;width:100%;padding:6px 8px;border-radius:6px;color:var(--muted)}
nav button[aria-current=true]{background:var(--hl);color:var(--fg)}
#text p{padding:4px 8px;margin:0 0 8px;border-radius:6px;cursor:pointer;transition:background .2s}
#text p.h{font-weight:600;font-size:1.15rem}#text p.on{background:var(--hl)}#text p.na{opacity:.5;cursor:default}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:10px 16px}
.row{display:flex;gap:8px;align-items:center;max-width:860px;margin:auto;flex-wrap:wrap}
.bar button,.bar select{background:none;border:1px solid var(--line);color:var(--fg);border-radius:6px;padding:6px 10px;font:inherit;cursor:pointer}
.bar button.play{background:var(--accent);color:var(--bg);border-color:var(--accent);min-width:64px}
input[type=range]{flex:1;accent-color:var(--accent)}.t{color:var(--muted);font-variant-numeric:tabular-nums;font-size:.85rem}
</style>
</head>
<body>
<header>
${doc.cover ? `<img class="cover" src="${escapeHtml(doc.cover)}" alt="">` : `<div class="cover" aria-hidden="true"></div>`}
<div><h1>${title}</h1>${doc.subtitle ? `<p class="sub">${escapeHtml(doc.subtitle)}</p>` : ""}
${doc.author ? `<p class="by">By ${escapeHtml(doc.author)}</p>` : ""}${doc.narrator ? `<p class="by">Narrated by ${escapeHtml(doc.narrator)}</p>` : ""}</div>
</header>
<main><nav aria-label="Chapters"><ol id="toc"></ol></nav><article id="text" aria-live="off"></article></main>
<div class="bar"><div class="row">
<button id="b30" title="Back 30 seconds">-30</button><button id="b15" title="Back 15 seconds">-15</button>
<button id="play" class="play">Play</button>
<button id="f15" title="Forward 15 seconds">+15</button><button id="f30" title="Forward 30 seconds">+30</button>
<span class="t" id="cur">0:00</span><input id="seek" type="range" min="0" max="1" step="0.1" value="0" aria-label="Position"><span class="t" id="dur">0:00</span>
<select id="speed" aria-label="Speed"></select>
</div></div>
<audio id="a" preload="metadata"></audio>
<script id="book" type="application/json">${scriptJson(doc)}</script>
<script>
(function(){
var B=JSON.parse(document.getElementById("book").textContent),a=document.getElementById("a"),ci=0,paras=[],on=-1,ready=false,last=0;
var KEY="mirli-webplayer:"+B.title;
function $(i){return document.getElementById(i)}
function fmt(s){s=Math.max(0,Math.floor(s||0));var h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return (h?h+":"+String(m).padStart(2,"0"):m)+":"+String(x).padStart(2,"0")}
function save(){if(!ready)return;last=Date.now();try{localStorage.setItem(KEY,JSON.stringify({c:ci,t:a.currentTime,r:a.playbackRate}))}catch(e){}}
function load(c,t,play){ready=false;ci=c;var ch=B.chapters[c];a.src=ch.audio;a.preservesPitch=true;
 [].forEach.call(document.querySelectorAll("#toc button"),function(b,i){b.setAttribute("aria-current",i===c)});
 var art=$("text");art.innerHTML="";paras=ch.paragraphs.map(function(p){var el=document.createElement("p");el.textContent=p.text;if(p.heading)el.className="h";
  if(p.start_s==null)el.classList.add("na");else el.onclick=function(){a.currentTime=p.start_s;a.play()};art.appendChild(el);return el});on=-1;
 a.addEventListener("loadedmetadata",function f(){a.removeEventListener("loadedmetadata",f);if(t)a.currentTime=t;ready=true;if(play)a.play()});
 if("mediaSession" in navigator){navigator.mediaSession.metadata=new MediaMetadata({title:ch.title,artist:B.author||"",album:B.title,artwork:B.cover?[{src:B.cover}]:[]})}}
B.chapters.forEach(function(ch,i){var li=document.createElement("li"),b=document.createElement("button");b.textContent=ch.title;b.onclick=function(){load(i,0,true)};li.appendChild(b);$("toc").appendChild(li)});
for(var r=0.25;r<=4.001;r+=0.25){var o=document.createElement("option");o.value=r.toFixed(2);o.textContent=r.toFixed(2).replace(/0$/,"")+"x";$("speed").appendChild(o)}
$("speed").value="1.00";$("speed").onchange=function(){a.playbackRate=a.defaultPlaybackRate=+this.value;save()};
$("play").onclick=function(){a.paused?a.play():a.pause()};
function skip(d){a.currentTime=Math.max(0,Math.min((a.duration||0),a.currentTime+d))}
$("b30").onclick=function(){skip(-30)};$("b15").onclick=function(){skip(-15)};$("f15").onclick=function(){skip(15)};$("f30").onclick=function(){skip(30)};
$("seek").oninput=function(){a.currentTime=+this.value};
a.onplay=function(){$("play").textContent="Pause"};a.onpause=function(){$("play").textContent="Play";save()};
a.onloadedmetadata=function(){$("seek").max=a.duration;$("dur").textContent=fmt(a.duration)};
a.onended=function(){if(ci<B.chapters.length-1)load(ci+1,0,true)};
a.ontimeupdate=function(){var t=a.currentTime;$("seek").value=t;$("cur").textContent=fmt(t);var ps=B.chapters[ci].paragraphs,n=-1;
 for(var i=0;i<ps.length;i++){if(ps[i].start_s!=null&&ps[i].start_s<=t+0.05)n=i}
 if(n!==on){if(on>=0&&paras[on])paras[on].classList.remove("on");on=n;if(n>=0){paras[n].classList.add("on");paras[n].scrollIntoView({block:"center",behavior:"smooth"})}}
 if(Date.now()-last>5000)save()};
if("mediaSession" in navigator){var ms=navigator.mediaSession;ms.setActionHandler("play",function(){a.play()});ms.setActionHandler("pause",function(){a.pause()});
 ms.setActionHandler("seekbackward",function(){skip(-15)});ms.setActionHandler("seekforward",function(){skip(15)});
 ms.setActionHandler("previoustrack",function(){if(ci>0)load(ci-1,0,true)});ms.setActionHandler("nexttrack",function(){if(ci<B.chapters.length-1)load(ci+1,0,true)})}
var s=null;try{s=JSON.parse(localStorage.getItem(KEY)||"null")}catch(e){}
if(s&&B.chapters[s.c]){load(s.c,s.t,false);if(s.r){a.playbackRate=a.defaultPlaybackRate=s.r;$("speed").value=(+s.r).toFixed(2)}}else load(0,0,false);
})();
</script>
</body>
</html>
`;
}
