// Les 3 dernières nouvelles hockey de RDS → news.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FEED = "https://www.rds.ca/arc/outboundfeeds/rss/category/hockey/?outputType=xml";
const ent = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ent[e.toLowerCase()] ?? m;
});
const clean = (s) => decode(String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i")); return m ? m[1] : ""; };
const attr = (x, t, a) => { const m = x.match(new RegExp(`<${t}[^>]*\\s${a}="([^"]+)"`, "i")); return m ? decode(m[1]) : ""; };

const r = await fetch(FEED, { headers: { "User-Agent": "pool-blouin/1.0" } });
if (!r.ok) { console.log("RDS indisponible :", r.status); process.exit(0); }
const xml = await r.text();
const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => {
  const x = m[1];
  const desc = clean(tag(x, "description"));
  return {
    title: clean(tag(x, "title")),
    link: clean(tag(x, "link")),
    date: new Date(clean(tag(x, "pubDate"))).toISOString(),
    img: attr(x, "media:content", "url") || attr(x, "enclosure", "url") || attr(x, "media:thumbnail", "url"),
    desc: desc.length > 220 ? desc.slice(0, 217).replace(/\s+\S*$/, "") + "…" : desc,
  };
}).filter((n) => n.title && /^https:\/\/www\.rds\.ca\//.test(n.link) && !isNaN(new Date(n.date)));
items.sort((a, b) => b.date.localeCompare(a.date));
const out = { items: items.slice(0, 3) };
const prev = existsSync("news.json") ? readFileSync("news.json", "utf8") : "";
const next = JSON.stringify(out);
if (prev.trim() !== next) { writeFileSync("news.json", next); console.log("news.json mis à jour :", out.items.map((n) => n.title).join(" | ")); }
else console.log("Nouvelles inchangées.");
