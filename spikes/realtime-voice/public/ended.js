// The "call ended" card, shared by the call pages. Ending a call stops the
// mic and the audio but leaves you on the call, with a summary and two ways
// out: call again (same face, same voice) or go back to the start.
//
//   showEnded({ who, seconds, turns, last, again, home })

const css = `
.ended { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 24px max(20px, env(safe-area-inset-left, 0px));
         background: color-mix(in srgb, var(--paper) 88%, transparent); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
         animation: endedIn .45s cubic-bezier(0.22, 1, 0.36, 1) both; }
@keyframes endedIn { from { opacity: 0; } }
.ended .card { width: min(560px, 100%); display: grid; gap: 18px; justify-items: start; }
.ended .who { display: flex; align-items: center; gap: 14px; }
.ended .who img { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; border: 1px solid var(--rule); }
.ended h2 { margin: 0; font: 800 clamp(48px, 9vw, 96px)/.88 var(--title); text-transform: uppercase; letter-spacing: .01em; color: var(--ink); }
.ended .meta { font: 400 13px/1.5 var(--log); color: var(--pencil); }
.ended blockquote { margin: 0; padding-left: 14px; border-left: 2px solid var(--rule-strong); color: var(--pencil); font-size: 17px; line-height: 1.45; max-width: 46ch; }
.ended .row { display: flex; flex-wrap: wrap; gap: 10px; }
.ended button { height: 52px; padding: 0 26px; border-radius: 999px; cursor: pointer; font: 600 16px/1 var(--sans); border: 1px solid var(--rule-strong); background: transparent; color: var(--ink); }
.ended button.again { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.ended button:hover { opacity: .9; }
`;

let styled = false;
export function showEnded({ who = "Mirli", photo = "", seconds = 0, turns = 0, last = "", again, home }) {
  if (!styled) { const s = document.createElement("style"); s.textContent = css; document.head.append(s); styled = true; }
  document.querySelector(".ended")?.remove();
  const m = Math.floor(seconds / 60), s = String(Math.floor(seconds % 60)).padStart(2, "0");
  const el = document.createElement("div");
  el.className = "ended";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Call ended");
  el.innerHTML = `<div class="card">
    <div class="who">${photo ? `<img alt="" src="${photo}">` : ""}<div class="meta">call with ${esc(who)} · ${m}:${s}${turns ? ` · ${turns} ${turns === 1 ? "reply" : "replies"}` : ""}</div></div>
    <h2>Call ended.</h2>
    ${last ? `<blockquote>${esc(last.length > 220 ? last.slice(0, 220).trimEnd() + "…" : last)}</blockquote>` : ""}
    <div class="row"><button class="again">Call ${esc(who)} again</button><button class="home">Back to start</button></div>
  </div>`;
  document.body.append(el);
  el.querySelector(".again").onclick = () => { el.remove(); again(); };
  el.querySelector(".home").onclick = () => { el.remove(); home(); };
  el.querySelector(".again").focus();
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
