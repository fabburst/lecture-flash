import { extract, UserError } from '../lib/extract.js';
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const url = req.query && req.query.url;
  if (!url) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Ajoute un lien.' })); }
  try {
    const r = await extract(url);
    res.end(JSON.stringify({ ...r, words: r.text.split(/\s+/).filter(Boolean).length }));
  } catch (e) {
    res.statusCode = e instanceof UserError ? 422 : 500;
    res.end(JSON.stringify({ error: e instanceof UserError ? e.message : 'Impossible de lire ce lien, colle le texte directement.' }));
  }
}
