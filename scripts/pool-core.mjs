// Calcul du pool de hockey Blouin à partir des feuilles de match officielles (ESPN).
// Utilisé par le robot GitHub (node scripts/update.mjs) — aucun module externe.
// Données produites : data.json = { v, updated, closedThrough, days: { "AAAA-MM-JJ": { p: { idJoueur: [pj,b,p,tc,v,bl] }, t: { equipe: [pj,v,dp] } } }, games: {...} }

const API = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl";

export function etDate(d) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}
export function addDays(s, n) {
  const d = new Date(s + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// ESPN écrit parfois Utah « UTA » (horaire, sommaires) et parfois « UTAH » (équipes, alignements) : on garde une seule forme.
export const nab = (a) => (a === "UTA" ? "UTAH" : a || "");
const toiSec = (t) => {
  if (!t) return 0;
  const [m, s] = String(t).split(":").map(Number);
  return (m || 0) * 60 + (s || 0);
};

export async function update(pool, prev, getJSON, now = new Date()) {
  const data = prev && prev.v === 1 ? prev : { v: 1, closedThrough: null, days: {}, games: {} };
  const ids = new Set(), goalieIds = new Set(), tms = new Set();
  for (const p of pool.participants) for (const q of p.picks) {
    if (q.type === "T") tms.add(q.team);
    else { ids.add(q.id); if (q.type === "G") goalieIds.add(q.id); }
  }
  const today = etDate(now);
  const last = today < pool.end ? today : pool.end;
  let closed = data.closedThrough;
  let stillClosing = true;
  // La LNH corrige parfois une passe ou un but le lendemain : on revérifie aussi les 2 dernières soirées déjà fermées.
  let from = closed ? addDays(closed, 1) : pool.start;
  const recheck = addDays(today, -2);
  if (from > recheck) from = recheck < pool.start ? pool.start : recheck;
  for (let d = from; d <= last; d = addDays(d, 1)) {
    let sb;
    try { sb = await getJSON(`${API}/scoreboard?dates=${d.replace(/-/g, "")}`); }
    catch (err) { console.log(`Horaire du ${d} indisponible : ${err.message}`); break; } // on garde les données d'avant et on réessaie au prochain passage
    const evs = (sb.events || []).filter((e) => !e.season || e.season.type === 2);
    // Réponse vide alors qu'on connaissait des matchs ce jour-là : ESPN a un raté, on ne touche à rien.
    if (!evs.length && (data.games[d] || []).length) { stillClosing = false; continue; }
    const day = { p: {}, t: {} };
    const glist = [];
    let dayFinal = true, failed = false;
    for (const e of evs) {
      const c = e.competitions[0];
      const H = c.competitors.find((x) => x.homeAway === "home");
      const A = c.competitors.find((x) => x.homeAway === "away");
      const off = /POSTPONED|CANCELED|SUSPENDED/.test(e.status?.type?.name || "");
      const st = off ? "off" : e.status?.type?.state || "pre";
      const period = e.status?.period || 0;
      glist.push([e.id, nab(A.team.abbreviation), nab(H.team.abbreviation), +A.score || 0, +H.score || 0, st, e.status?.type?.shortDetail || "", period, e.date]);
      if (st === "off") continue;
      if (st !== "post") dayFinal = false;
      if (st === "pre") continue;

      // Équipes : victoire 2, défaite en prolongation / tirs de barrage 1 (seulement quand le match est fini)
      for (const me of [A, H]) {
        const ab = nab(me.team.abbreviation);
        if (!tms.has(ab)) continue;
        const row = day.t[ab] || (day.t[ab] = [0, 0, 0]);
        row[0]++;
        if (st === "post") { if (me.winner) row[1]++; else if (period > 3) row[2]++; }
      }

      let s;
      try { s = await getJSON(`${API}/summary?event=${e.id}`); }
      catch (err) { console.log(`Feuille de match ${e.id} indisponible : ${err.message}`); failed = true; continue; }
      // Buts et passes des gardiens : tirés du détail des buts (hors tirs de barrage)
      const gPts = {};
      for (const pl of s.plays || []) {
        if (!pl.scoringPlay || (pl.period?.number || 0) > 4) continue;
        for (const pa of pl.participants || []) {
          const id = pa.athlete?.id;
          if (!goalieIds.has(id)) continue;
          const r = gPts[id] || (gPts[id] = [0, 0]);
          if (pa.type === "scorer") r[0]++; else if (pa.type === "assister") r[1]++;
        }
      }
      for (const tb of s.boxscore?.players || []) {
        const ab = nab(tb.team?.abbreviation);
        const comp = ab === nab(A.team.abbreviation) ? A : H;
        data.team = data.team || {};
        const goalies = [];
        for (const grp of tb.statistics || []) {
          const k = grp.keys || [];
          for (const a of grp.athletes || []) {
            const id = a.athlete?.id;
            const v = a.stats || [];
            if (ids.has(id)) data.team[id] = ab;
            const num = (key) => { const i = k.indexOf(key); return i < 0 ? 0 : parseFloat(v[i]) || 0; };
            const toi = toiSec(v[k.indexOf("timeOnIce")]);
            if (grp.name === "goalies") {
              if (toi > 0) goalies.push({ id, ga: num("goalsAgainst"), toi });
              if (!ids.has(id) || toi <= 0) continue;
              const row = day.p[id] || (day.p[id] = [0, 0, 0, 0, 0, 0]);
              row[0]++;
              const gp = gPts[id]; if (gp) { row[1] += gp[0]; row[2] += gp[1]; }
            } else {
              if (!ids.has(id)) continue;
              const row = day.p[id] || (day.p[id] = [0, 0, 0, 0, 0, 0]);
              const gl = num("goals");
              row[0]++; row[1] += gl; row[2] += num("assists");
              if (gl >= 3) row[3]++;
            }
          }
        }
        // Victoire et blanchissage du gardien (match terminé seulement)
        if (st === "post" && comp.winner && goalies.length) {
          const dec = goalies.slice().sort((x, y) => y.toi - x.toi)[0];
          if (ids.has(dec.id)) {
            const row = day.p[dec.id] || (day.p[dec.id] = [1, 0, 0, 0, 0, 0]);
            row[4]++;
            if (goalies.length === 1 && dec.ga === 0) row[5]++;
          }
        }
      }
    }
    data.games[d] = glist;
    if (failed) { stillClosing = false; continue; } // une feuille de match manquante : on garde les points d'avant pour ce jour
    if (Object.keys(day.p).length || Object.keys(day.t).length) data.days[d] = day; else delete data.days[d];
    if (stillClosing && dayFinal && d < today) { if (!closed || d > closed) closed = d; } else stillClosing = false;
  }
  data.closedThrough = closed;

  // Alignements LNH : repère les joueurs qui ne sont dans aucune équipe (sans contrat, mineures…)
  // Toutes les 3 heures environ, et au premier passage.
  if (!Array.isArray(data.noRoster) || !data.rosterAt || now - new Date(data.rosterAt) > 3 * 3600e3 - 10 * 60e3) {
    try {
      const seen = new Set(), team = {};
      for (const [ab, t] of Object.entries(pool.teams)) {
        const r = await getJSON(`${API}/teams/${t.id}/roster`);
        for (const g of r.athletes || []) for (const a of g.items || []) {
          if (ids.has(a.id)) { seen.add(a.id); team[a.id] = ab; }
        }
      }
      data.team = { ...(data.team || {}), ...team };
      data.noRoster = [...ids].filter((id) => !seen.has(id)).sort();
      data.rosterAt = now.toISOString();
    } catch (err) { console.log(`Alignements LNH indisponibles : ${err.message}`); }
  }
  // garder seulement 8 jours de matchs pour l'affichage
  const keep = addDays(today, -7);
  for (const k of Object.keys(data.games)) if (k < keep) delete data.games[k];
  return data;
}
