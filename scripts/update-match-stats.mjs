import fs from "node:fs/promises";
import vm from "node:vm";

const OUT_FILE = process.env.MATCH_STATS_OUT_FILE || "data/match-stats.json";
const DEBUG = process.env.DEBUG_MATCH_STATS === "1";
const NOW = process.env.NOW ? new Date(process.env.NOW) : new Date();
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 7);
const LOOKAHEAD_DAYS = Number(process.env.LOOKAHEAD_DAYS || 1);
const MOCK_SCOREBOARD_DIR = process.env.MOCK_SCOREBOARD_DIR || "";
const MOCK_SUMMARY_DIR = process.env.MOCK_SUMMARY_DIR || "";
const HTML_CANDIDATES = ["index.html", "mundial2026_22.html", "mundial2026.html"];

const TEAM_ALIASES = {
  "Mexico": ["mexico", "méxico"],
  "South Africa": ["south africa", "sudafrica", "sudáfrica", "rsa"],
  "South Korea": ["south korea", "corea del sur", "republica de corea", "república de corea", "korea republic"],
  "Czechia": ["czechia", "chequia", "czech republic", "republica checa", "república checa"],
  "United States": ["united states", "estados unidos", "usa", "eeuu", "ee.uu"],
  "Türkiye": ["turkiye", "türkiye", "turquia", "turquía", "turkey"],
  "Bosnia & Herzegovina": ["bosnia-herzegovina", "bosnia", "bosnia herzegovina", "bosnia y herzegovina"],
  "Canada": ["canada", "canadá"],
  "DR Congo": ["dr congo", "rd congo", "congo dr", "republica democratica del congo", "república democrática del congo"],
  "Curaçao": ["curacao", "curaçao"],
  "Ivory Coast": ["ivory coast", "costa de marfil", "cote d'ivoire", "côte d'ivoire"],
  "Cape Verde": ["cape verde", "cabo verde"],
  "New Zealand": ["new zealand", "nueva zelanda"],
  "Saudi Arabia": ["saudi arabia", "arabia saudi", "arabia saudí"],
  "England": ["england", "inglaterra"],
  "Scotland": ["scotland", "escocia"],
  "Germany": ["germany", "alemania"],
  "Netherlands": ["netherlands", "paises bajos", "países bajos", "holanda"],
  "Belgium": ["belgium", "belgica", "bélgica"],
  "Spain": ["spain", "espana", "españa"],
  "France": ["france", "francia"],
  "Brazil": ["brazil", "brasil"],
  "Morocco": ["morocco", "marruecos"],
  "Japan": ["japan", "japon", "japón"],
  "Sweden": ["sweden", "suecia"],
  "Switzerland": ["switzerland", "suiza"],
  "Croatia": ["croatia", "croacia"],
  "Norway": ["norway", "noruega"],
  "Austria": ["austria"],
  "Argentina": ["argentina"],
  "Uruguay": ["uruguay"],
  "Colombia": ["colombia"],
  "Ecuador": ["ecuador"],
  "Paraguay": ["paraguay"],
  "Portugal": ["portugal"],
  "Ghana": ["ghana"],
  "Senegal": ["senegal"],
  "Egypt": ["egypt", "egipto"],
  "Tunisia": ["tunisia", "tunez", "túnez"],
  "Algeria": ["algeria", "argelia"],
  "Haiti": ["haiti", "haití"],
  "Panama": ["panama", "panamá"],
  "Australia": ["australia"],
  "Qatar": ["qatar", "catar"],
  "Iran": ["iran", "irán"],
  "Iraq": ["iraq", "irak"],
  "Jordan": ["jordan", "jordania"],
  "Uzbekistan": ["uzbekistan", "uzbekistán"]
};

const STAT_MAP = {
  shotsOnGoal: ["shotsOnTarget"],
  shots: ["totalShots"],
  possession: ["possessionPct"],
  passes: ["totalPasses"],
  fouls: ["foulsCommitted"],
  corners: ["wonCorners"],
  saves: ["saves"],
  offsides: ["offsides"]
};

function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function aliases(team) {
  return [...new Set([team, ...(TEAM_ALIASES[team] || [])].map(normalize).filter(Boolean))];
}

function sameTeam(a, b) {
  const aa = aliases(a);
  const bb = aliases(b);
  return aa.some((x) => bb.includes(x));
}

function ymd(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function unique(items) {
  return [...new Set(items)];
}

async function readFixtures() {
  for (const file of HTML_CANDIDATES) {
    try {
      const html = await fs.readFile(file, "utf8");
      const m = html.match(/const FX\s*=\s*(\[[\s\S]*?\n\]);/);
      if (!m) continue;
      const sandbox = {};
      vm.createContext(sandbox);
      vm.runInContext(`result=${m[1]}`, sandbox, { timeout: 1000 });
      return sandbox.result.map((f) => ({
        id: f[0],
        date: f[1],
        time: f[2],
        home: f[3],
        away: f[4],
        round: f[5]
      }));
    } catch {}
  }
  throw new Error("No pude encontrar const FX en index.html o mundial2026_22.html");
}

async function readExisting() {
  try {
    const raw = await fs.readFile(OUT_FILE, "utf8");
    const json = JSON.parse(raw);
    return Array.isArray(json) ? { items: json } : { items: json.items || [] };
  } catch {
    return { items: [] };
  }
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}

async function getScoreboard(dateKey) {
  if (MOCK_SCOREBOARD_DIR) {
    return JSON.parse(await fs.readFile(`${MOCK_SCOREBOARD_DIR}/${dateKey}.json`, "utf8"));
  }
  return fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateKey}`);
}

async function getSummary(eventId) {
  if (MOCK_SUMMARY_DIR) {
    return JSON.parse(await fs.readFile(`${MOCK_SUMMARY_DIR}/${eventId}.json`, "utf8"));
  }
  return fetchJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${eventId}`);
}

function fixtureInWindow(fixture) {
  if (fixture.home === "TBD" || fixture.away === "TBD") return false;
  const start = new Date(`${fixture.date}T${fixture.time || "00:00"}:00Z`);
  const min = addDays(NOW, -LOOKBACK_DAYS);
  const max = addDays(NOW, LOOKAHEAD_DAYS);
  return start >= min && start <= max;
}

function dateKeysForWindow() {
  const keys = [];
  for (let d = -LOOKBACK_DAYS - 1; d <= LOOKAHEAD_DAYS + 1; d++) keys.push(ymd(addDays(NOW, d)));
  return unique(keys);
}

function eventTeams(event) {
  const competitors = event.competitions?.[0]?.competitors || [];
  const home = competitors.find((c) => c.homeAway === "home")?.team?.displayName;
  const away = competitors.find((c) => c.homeAway === "away")?.team?.displayName;
  return { home, away };
}

function matchEventForFixture(fixture, events) {
  const direct = events.find((event) => {
    const t = eventTeams(event);
    return sameTeam(t.home, fixture.home) && sameTeam(t.away, fixture.away);
  });
  if (direct) return direct;
  return events.find((event) => {
    const t = eventTeams(event);
    return sameTeam(t.home, fixture.away) && sameTeam(t.away, fixture.home);
  });
}

function statMap(stats = []) {
  const out = {};
  for (const stat of stats) {
    const val = Number.parseFloat(String(stat.displayValue ?? stat.value ?? "").replace("%", ""));
    if (Number.isFinite(val)) out[stat.name] = val;
  }
  return out;
}

function valueFor(statObj, keys) {
  for (const key of keys) {
    if (statObj[key] !== undefined) return statObj[key];
  }
  return null;
}

function scoreFromEvent(event, fixture) {
  const competitors = event.competitions?.[0]?.competitors || [];
  const home = competitors.find((c) => sameTeam(c.team?.displayName, fixture.home));
  const away = competitors.find((c) => sameTeam(c.team?.displayName, fixture.away));
  const homeScore = Number.parseInt(home?.score, 10);
  const awayScore = Number.parseInt(away?.score, 10);
  return {
    home: Number.isFinite(homeScore) ? homeScore : null,
    away: Number.isFinite(awayScore) ? awayScore : null
  };
}

function isKeeperPosition(pos = {}) {
  const txt = normalize(`${pos.name || ""} ${pos.displayName || ""} ${pos.abbreviation || ""}`);
  return txt.includes("goalkeeper") || txt === "g" || txt === "gk";
}

function rosterKeeper(summary, teamName) {
  const roster = (summary.rosters || []).find((r) => sameTeam(r.team?.displayName, teamName));
  const player = roster?.roster?.find((p) => p.starter && isKeeperPosition(p.position)) ||
    roster?.roster?.find((p) => isKeeperPosition(p.position));
  if (!player?.athlete) return null;
  return {
    id: player.athlete.id || "",
    name: player.athlete.displayName || player.athlete.fullName || player.athlete.shortName || "",
    shortName: player.athlete.shortName || player.athlete.displayName || "",
    number: player.jersey || player.athlete.jersey || "",
    source: "ESPN roster"
  };
}

function savesLeader(summary, teamName) {
  const group = (summary.leaders || []).find((item) => sameTeam(item.team?.displayName, teamName));
  const saves = group?.leaders?.find((item) => item.name === "saves");
  const leader = saves?.leaders?.[0];
  if (!leader?.athlete) return null;
  const value = Number.parseFloat(String(leader.displayValue ?? leader.mainStat?.value ?? "").replace("%", ""));
  return {
    id: leader.athlete.id || "",
    name: leader.athlete.displayName || leader.athlete.fullName || leader.athlete.shortName || "",
    shortName: leader.athlete.shortName || leader.athlete.displayName || "",
    number: leader.athlete.jersey || "",
    saves: Number.isFinite(value) ? value : null,
    source: "ESPN leaders"
  };
}

function countPenaltySaves(summary, keeperName) {
  if (!keeperName) return 0;
  const keeper = normalize(keeperName);
  const lastName = keeper.split(" ").filter(Boolean).slice(-1)[0] || keeper;
  const events = [...(summary.commentary || []), ...(summary.keyEvents || [])];
  return events.filter((event) => {
    const text = normalize(`${event.text || ""} ${event.play?.text || ""} ${event.play?.shortText || ""}`);
    const isPenaltySave = text.includes("penalty saved") || text.includes("saved penalty") || text.includes("penalti parado");
    return isPenaltySave && (text.includes(keeper) || text.includes(lastName));
  }).length;
}

function keeperMetricsFromSummary(summary, fixture, event, stats) {
  const score = scoreFromEvent(event, fixture);
  const sides = [
    { side: "home", team: fixture.home, goalsFor: score.home, goalsAgainst: score.away, saves: stats.saves?.home },
    { side: "away", team: fixture.away, goalsFor: score.away, goalsAgainst: score.home, saves: stats.saves?.away }
  ];

  return sides.map((side) => {
    const leader = savesLeader(summary, side.team);
    const roster = rosterKeeper(summary, side.team);
    const keeper = leader || roster;
    if (!keeper?.name) return null;
    const saves = Number.isFinite(leader?.saves) ? leader.saves : Number(side.saves || 0);
    const goalsAgainst = Number.isFinite(side.goalsAgainst) ? side.goalsAgainst : 0;
    const shotsFaced = saves + goalsAgainst;
    const savePct = shotsFaced > 0 ? (saves / shotsFaced) * 100 : (goalsAgainst === 0 ? 100 : 0);
    const penaltySaves = countPenaltySaves(summary, keeper.name);
    return {
      side: side.side,
      team: side.team,
      name: keeper.name,
      shortName: keeper.shortName || keeper.name,
      number: keeper.number || "",
      saves,
      goalsAgainst,
      cleanSheet: goalsAgainst === 0 ? 1 : 0,
      savePct: Math.round(savePct * 10) / 10,
      penaltySaves,
      source: keeper.source || "ESPN"
    };
  }).filter(Boolean);
}

function statsFromSummary(summary, fixture, event) {
  const teams = summary.boxscore?.teams || [];
  if (teams.length < 2) return null;
  const homeBox = teams.find((x) => sameTeam(x.team?.displayName, fixture.home));
  const awayBox = teams.find((x) => sameTeam(x.team?.displayName, fixture.away));
  if (!homeBox || !awayBox) return null;

  const h = statMap(homeBox.statistics);
  const a = statMap(awayBox.statistics);
  const stats = {};
  for (const [key, names] of Object.entries(STAT_MAP)) {
    const home = valueFor(h, names);
    const away = valueFor(a, names);
    if (home !== null || away !== null) stats[key] = { home: home ?? 0, away: away ?? 0 };
  }
  if (!Object.keys(stats).length) return null;

  return {
    matchId: fixture.id,
    espnEventId: event.id,
    date: fixture.date,
    homeTeam: fixture.home,
    awayTeam: fixture.away,
    source: "ESPN",
    updatedAt: NOW.toISOString(),
    stats,
    keepers: keeperMetricsFromSummary(summary, fixture, event, stats)
  };
}

async function buildMatchStats(fixtures, existing) {
  const byMatch = new Map();
  for (const item of existing.items) {
    const key = String(item.matchId || `${item.homeTeam}|${item.awayTeam}|${item.date}`);
    if (key) byMatch.set(key, item);
  }

  const events = [];
  for (const dateKey of dateKeysForWindow()) {
    try {
      const board = await getScoreboard(dateKey);
      events.push(...(board.events || []));
      if (DEBUG) console.log(`ESPN scoreboard ${dateKey}: ${(board.events || []).length} eventos`);
    } catch (e) {
      if (DEBUG) console.warn(`No pude leer ESPN ${dateKey}: ${e.message}`);
    }
  }

  for (const fixture of fixtures.filter(fixtureInWindow)) {
    const matchKey = String(fixture.id);
    const existingItem = byMatch.get(matchKey);
    if (existingItem?.manual || existingItem?.locked) continue;
    const event = matchEventForFixture(fixture, events);
    if (!event) {
      if (DEBUG) console.log(`Sin evento ESPN para ${fixture.id} ${fixture.home} vs ${fixture.away}`);
      continue;
    }
    try {
      const summary = await getSummary(event.id);
      const item = statsFromSummary(summary, fixture, event);
      if (!item) {
        if (DEBUG) console.log(`ESPN sin stats: ${fixture.id} ${fixture.home} vs ${fixture.away}`);
        continue;
      }
      byMatch.set(matchKey, item);
      if (DEBUG) console.log(`Stats ${fixture.id}: ${fixture.home} vs ${fixture.away} (${Object.keys(item.stats).join(", ")})`);
    } catch (e) {
      if (DEBUG) console.warn(`Error summary ESPN ${event.id}: ${e.message}`);
    }
  }

  return {
    updated: NOW.toISOString(),
    source: "ESPN match stats via GitHub Actions",
    items: [...byMatch.values()].sort((a, b) => (a.matchId || 9999) - (b.matchId || 9999))
  };
}

const [fixtures, existing] = await Promise.all([readFixtures(), readExisting()]);
const output = await buildMatchStats(fixtures, existing);
await fs.mkdir("data", { recursive: true });
await fs.writeFile(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Actualizado ${OUT_FILE} con ${output.items.length} estadísticas`);
