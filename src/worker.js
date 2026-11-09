// Frigo Chef — relais Cloudflare Worker
// - sert la page (dossier public/)
// - /api/check : vérifie le code d'accès
// - /api/all, /api/op : données partagées d'un foyer (Durable Object, cohérent et gratuit)
// - /api/ai : appelle Gemini avec la clé gardée côté serveur (jamais envoyée au téléphone)

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

const DEFAULT_MODELS = {
  // qualité d'abord, puis modèles « Lite » (quotas gratuits plus larges) en secours
  complex: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  default: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash"]
};

function sameText(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function foyerKey(raw) {
  return String(raw || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
function modelList(env, tier) {
  const v = tier === "complex" ? env.MODELS_COMPLEX : env.MODELS_DEFAULT;
  if (v) return String(v).split(",").map(s => s.trim()).filter(Boolean);
  return DEFAULT_MODELS[tier === "complex" ? "complex" : "default"];
}

async function callGemini(env, body) {
  if (!env.GEMINI_API_KEY) return json({ message: "La clé Gemini n'est pas configurée sur le serveur." }, 500);
  const prompt = String(body.prompt || "").slice(0, 60000);
  const images = Array.isArray(body.images) ? body.images.slice(0, 4) : [];
  const parts = [{ text: prompt }, ...images.map(b64 => ({ inline_data: { mime_type: "image/jpeg", data: String(b64) } }))];
  const payload = {
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0.85, ...(body.json ? { responseMimeType: "application/json" } : {}) }
  };
  let last = "";
  for (const model of modelList(env, body.tier)) {
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify(payload)
      });
    } catch (e) { last = "réseau"; continue; }
    if (res.status === 429 || res.status === 404 || res.status >= 500) { last = model + " " + res.status; continue; }
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = j?.error?.message || ("Erreur Gemini " + res.status);
      if (res.status === 400 && /model|not found|not supported/i.test(msg)) { last = model + " 400"; continue; }
      return json({ message: msg }, 502);
    }
    const text = (j?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
    if (!text) { last = model + " vide"; continue; }
    return json({ text, model });
  }
  return json({ message: "La limite gratuite de l'IA est atteinte pour aujourd'hui. Réessayez demain, ou plus tard dans la journée.", detail: last }, 429);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);

    if (!env.ACCESS_CODE) return json({ message: "Le code d'accès n'est pas configuré sur le serveur." }, 500);
    if (!sameText(req.headers.get("x-code"), env.ACCESS_CODE)) return json({ message: "Code d'accès incorrect." }, 401);
    if (url.pathname === "/api/check") return json({ ok: true });

    const foyer = foyerKey(req.headers.get("x-foyer"));
    if (foyer.length < 3) return json({ message: "Nom de foyer manquant ou trop court." }, 400);
    const stub = env.FOYER.get(env.FOYER.idFromName(foyer));

    if (url.pathname === "/api/all" && req.method === "GET") return stub.fetch("https://foyer/all");

    if (url.pathname === "/api/op" && req.method === "POST") {
      const text = await req.text();
      if (text.length > 400000) return json({ message: "Donnée trop volumineuse." }, 413);
      return stub.fetch("https://foyer/op", { method: "POST", body: text });
    }

    if (url.pathname === "/api/ai" && req.method === "POST") {
      const text = await req.text();
      if (text.length > 6000000) return json({ message: "Photos trop lourdes." }, 413);
      let body; try { body = JSON.parse(text); } catch { return json({ message: "Requête invalide." }, 400); }
      const max = Math.max(1, parseInt(env.DAILY_AI_LIMIT || "60", 10));
      const q = await (await stub.fetch("https://foyer/quota?max=" + max, { method: "POST" })).json();
      if (!q.ok) return json({ message: "Votre foyer a atteint sa limite de " + max + " demandes à l'IA pour aujourd'hui. À demain !" }, 429);
      return callGemini(env, body);
    }
    return json({ message: "Introuvable." }, 404);
  }
};

// Un objet par foyer : stocke les documents (frigo, courses, carnet, réglages) et le compteur du jour.
export class Foyer {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(req) {
    const url = new URL(req.url);
    const st = this.ctx.storage;
    if (url.pathname === "/all") {
      const m = await st.list({ prefix: "d:" });
      const docs = {};
      for (const [k, v] of m) docs[k.slice(2)] = v;
      return json({ docs });
    }
    if (url.pathname === "/op") {
      let b; try { b = await req.json(); } catch { return json({ message: "Requête invalide." }, 400); }
      const path = String(b.path || "");
      if (!/^[A-Za-z0-9_.~:@+\-]+(\/[A-Za-z0-9_.~:@+\-]+)*$/.test(path) || path.length > 500 || path.split("/").length % 2) return json({ message: "Chemin invalide." }, 400);
      if (b.op === "set") { if (!b.data || typeof b.data !== "object") return json({ message: "Donnée invalide." }, 400); await st.put("d:" + path, b.data); }
      else if (b.op === "del") await st.delete("d:" + path);
      else return json({ message: "Opération inconnue." }, 400);
      return json({ ok: true });
    }
    if (url.pathname === "/quota") {
      const day = new Date().toISOString().slice(0, 10);
      const k = "q:" + day;
      const n = (await st.get(k)) || 0;
      const max = parseInt(url.searchParams.get("max") || "60", 10);
      if (n >= max) return json({ ok: false, n });
      await st.put(k, n + 1);
      if (n === 0) { const old = await st.list({ prefix: "q:" }); for (const key of old.keys()) if (key !== k) await st.delete(key); }
      return json({ ok: true, n: n + 1 });
    }
    return json({ message: "Introuvable." }, 404);
  }
}
