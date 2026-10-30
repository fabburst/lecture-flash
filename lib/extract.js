import { promises as dns } from 'node:dns';
import net from 'node:net';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const MAX_BYTES = 5 * 1024 * 1024;
const ERR = 'Impossible de lire ce lien, colle le texte directement.';

export class UserError extends Error {}

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
  }
  const l = ip.toLowerCase();
  if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
}

async function assertSafeUrl(u) {
  let url;
  try { url = new URL(u); } catch { throw new UserError('Lien invalide.'); }
  if (!/^https?:$/.test(url.protocol)) throw new UserError('Seuls les liens http(s) sont acceptés.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new UserError('Adresse non autorisée.');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw new UserError('Site introuvable.'); });
  if (addrs.some(a => isPrivateIp(a.address))) throw new UserError('Adresse non autorisée.');
  return url;
}

async function safeFetch(u, opts = {}, hops = 0) {
  const url = await assertSafeUrl(u);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8', ...(opts.headers || {}) } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      if (hops > 4) throw new UserError(ERR);
      return safeFetch(new URL(r.headers.get('location'), url).href, opts, hops + 1);
    }
    if (!r.ok) throw new UserError(ERR + ' (erreur ' + r.status + ')');
    const reader = r.body.getReader(); const chunks = []; let n = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > MAX_BYTES) { ctrl.abort(); throw new UserError('Page trop volumineuse.'); } chunks.push(value); }
    return { text: Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8'), url: r.url || url.href, type: r.headers.get('content-type') || '' };
  } catch (e) {
    if (e instanceof UserError) throw e;
    throw new UserError(e.name === 'AbortError' ? 'Le site met trop de temps à répondre.' : ERR);
  } finally { clearTimeout(t); }
}

function clean(s) {
  return s.replace(/\r/g, '').replace(/[ \t\u00a0]+/g, ' ').split(/\n\s*\n+/).map(p => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).join('\n\n');
}
function stripLinks(s) { return s.replace(/https?:\/\/t\.co\/\S+/g, '').trim(); }

function articleText(a) {
  if (!a) return '';
  const blocks = a.content && a.content.blocks;
  const body = Array.isArray(blocks) ? blocks.map(b => b.text || '').filter(Boolean).join('\n\n') : (a.preview_text || '');
  return [a.title, body].filter(Boolean).join('\n\n');
}

function tweetText(t) {
  const parts = [];
  const art = articleText(t.article);
  parts.push(art || stripLinks(t.text || (t.raw_text && t.raw_text.text) || ''));
  return parts.filter(Boolean).join('\n\n');
}

async function extractX(user, id) {
  let data;
  for (const base of ['https://api.fxtwitter.com', 'https://api.vxtwitter.com']) {
    try { const r = await safeFetch(`${base}/${user}/status/${id}`, { headers: { Accept: 'application/json' } }); data = JSON.parse(r.text); if (base.includes('vx')) data = { tweet: { text: data.text, author: { name: data.user_name, screen_name: data.user_screen_name }, quote: data.qrt ? { text: data.qrt.text, author: { screen_name: data.qrt.user_screen_name } } : null } }; if (data.tweet) break; } catch { }
  }
  if (!data || !data.tweet) throw new UserError('Impossible de lire ce post X, colle le texte directement.');
  const t = data.tweet;
  let text = tweetText(t);
  if (t.quote) {
    const q = tweetText(t.quote);
    if (q) text += `\n\nEn citation de @${t.quote.author && t.quote.author.screen_name} :\n\n` + q;
  }
  text = clean(text);
  if (!text) throw new UserError('Ce post ne contient pas de texte à lire.');
  const title = (t.article && t.article.title) || `Post de ${t.author ? (t.author.name || '@' + t.author.screen_name) : 'X'}`;
  return { title, text, source: `https://x.com/${user}/status/${id}` };
}

export async function extract(rawUrl) {
  const url = await assertSafeUrl(String(rawUrl || '').trim());
  const m = url.hostname.match(/(^|\.)(x|twitter|fxtwitter|vxtwitter|fixupx)\.com$/i) && url.pathname.match(/^\/([^/]+)\/status(?:es)?\/(\d+)/);
  if (m) return extractX(m[1], m[2]);
  const page = await safeFetch(url.href);
  if (/text\/plain/.test(page.type)) return { title: url.hostname, text: clean(page.text), source: page.url };
  if (!/html|xml/.test(page.type)) throw new UserError(ERR);
  const { document } = parseHTML(page.text);
  const art = new Readability(document, { charThreshold: 200 }).parse();
  if (!art || !art.content) throw new UserError(ERR);
  const { document: d2 } = parseHTML('<!doctype html><html><body><div id="r">' + art.content + '</div></body></html>');
  const root = d2.getElementById('r');
  const blocks = [];
  root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre').forEach(el => {
    if (el.querySelector('p,li,blockquote')) return;
    const t = el.textContent.replace(/\s+/g, ' ').trim(); if (t) blocks.push(t);
  });
  let text = clean(blocks.length ? blocks.join('\n\n') : (art.textContent || ''));
  if (text.split(/\s+/).length < 20) throw new UserError(ERR);
  return { title: (art.title || '').trim(), text, source: page.url };
}

