// Robot du pool : node scripts/update.mjs  → met à jour data.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { update } from "./pool-core.mjs";

const pool = JSON.parse(readFileSync("pool.json", "utf8"));
const prev = existsSync("data.json") ? JSON.parse(readFileSync("data.json", "utf8")) : null;

async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "pool-blouin/1.0" } });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * i));
    }
  }
}

const before = prev ? JSON.stringify({ ...prev, updated: null }) : "";
const data = await update(pool, prev ? structuredClone(prev) : null, getJSON);
const after = JSON.stringify({ ...data, updated: null });
if (after === before) {
  console.log("Aucun changement.");
} else {
  data.updated = new Date().toISOString();
  writeFileSync("data.json", JSON.stringify(data));
  console.log(`data.json mis à jour (jours fermés jusqu'au ${data.closedThrough}).`);
}
