import fs from "node:fs/promises";
import vm from "node:vm";

const OUT_FILE = process.env.LINEUPS_OUT_FILE || "data/lineups.json";
const MATCH_STATS_FILE = process.env.MATCH_STATS_FILE || "data/match-stats.json";
const DEBUG = process.env.DEBUG_LINEUPS === "1";
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

const R32_SLOTS = [
  { id: 73, a: { team: "South Africa" }, b: { team: "Canada" } },
  { id: 74, a: { team: "Brazil" }, b: { team: "Japan" } },
  { id: 75, a: { team: "Germany" }, b: { team: "Paraguay" } },
  { id: 76, a: { team: "Netherlands" }, b: { team: "Morocco" } },
  { id: 77, a: { team: "Ivory Coast" }, b: { team: "Norway" } },
  { id: 78, a: { team: "France" }, b: { team: "Sweden" } },
  { id: 79, a: { team: "Mexico" }, b: { team: "Ecuador" } },
  { id: 80, a: { team: "England" }, b: { team: "DR Congo" } },
  { id: 81, a: { team: "Belgium" }, b: { team: "Senegal" } },
  { id: 82, a: { team: "United States" }, b: { team: "Bosnia & Herzegovina" } },
  { id: 83, a: { team: "Spain" }, b: { team: "Austria" } },
  { id: 84, a: { team: "Portugal" }, b: { team: "Croatia" } },
  { id: 85, a: { team: "Switzerland" }, b: { team: "Algeria" } },
  { id: 86, a: { team: "Australia" }, b: { team: "Egypt" } },
  { id: 87, a: { team: "Argentina" }, b: { team: "Cape Verde" } },
  { id: 88, a: { team: "Colombia" }, b: { team: "Ghana" } }
];

const KNOCKOUT_SLOTS = R32_SLOTS.concat([
  { id: 89, a: { winner: 75 }, b: { winner: 78 } },
  { id: 90, a: { winner: 73 }, b: { winner: 76 } },
  { id: 91, a: { winner: 74 }, b: { winner: 77 } },
  { id: 92, a: { winner: 79 }, b: { winner: 80 } },
  { id: 93, a: { winner: 84 }, b: { winner: 83 } },
  { id: 94, a: { winner: 82 }, b: { winner: 81 } },
  { id: 95, a: { winner: 87 }, b: { winner: 86 } },
  { id: 96, a: { winner: 85 }, b: { winner: 88 } },
  { id: 97, a: { winner: 89 }, b: { winner: 90 } },
  { id: 98, a: { winner: 93 }, b: { winner: 94 } },
  { id: 99, a: { winner: 91 }, b: { winner: 92 } },
  { id: 100, a: { winner: 95 }, b: { winner: 96 } },
  { id: 101, a: { winner: 97 }, b: { winner: 98 } },
  { id: 102, a: { winner: 99 }, b: { winner: 100 } },
  { id: 103, a: { loser: 101 }, b: { loser: 102 } },
  { id: 104, a: { winner: 101 }, b: { winner: 102 } }
]);

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

async function readMatchStats() {
  try {
    const raw = await fs.readFile(MATCH_STATS_FILE, "utf8");
    const json = JSON.parse(raw);
    const items = Array.isArray(json) ? json : json.items || [];
    return new Map(items.map((item) => [String(item.matchId), item]));
  } catch {
    return new Map();
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
  for (let d = -LOOKBACK_DAYS - 1; d <= LOOKAHEAD_DAYS + 1; d++) {
    keys.push(ymd(addDays(NOW, d)));
  }
  return unique(keys);
}

function eventTeams(event) {
  const competitors = event.competitions?.[0]?.competitors || [];
  const home = competitors.find((c) => c.homeAway === "home")?.team?.displayName;
  const away = competitors.find((c) => c.homeAway === "away")?.team?.displayName;
  return { home, away };
}

function matchLabel(fixture) {
  return `${fixture.id} ${fixture.home} vs ${fixture.away}`;
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

function scoreFromItem(item) {
  if (!item) return null;
  const h = Number.parseInt(item.homeScore, 10);
  const a = Number.parseInt(item.awayScore, 10);
  if (Number.isFinite(h) && Number.isFinite(a)) return { home: h, away: a };
  let home = 0, away = 0, hasGoal = false;
  for (const goal of item.goals || []) {
    if (!goal?.team || goal.ownGoal) continue;
    hasGoal = true;
    if (sameTeam(goal.team, item.homeTeam || item.home)) home++;
    else if (sameTeam(goal.team, item.awayTeam || item.away)) away++;
  }
  return hasGoal ? { home, away } : null;
}

function outcomeFromItem(item, sideA, sideB, wantLoser) {
  if (!item || !sideA?.name || !sideB?.name) return null;
  const winnerName = item.winner || item.winnerTeam || item.penaltyWinner || "";
  const loserName = item.loser || item.loserTeam || "";
  if (winnerName) {
    if (!wantLoser) return sameTeam(winnerName, sideA.name) ? sideA : sameTeam(winnerName, sideB.name) ? sideB : { name: winnerName };
    if (loserName) return sameTeam(loserName, sideA.name) ? sideA : sameTeam(loserName, sideB.name) ? sideB : { name: loserName };
  }
  const score = scoreFromItem(item);
  if (!score || score.home === score.away) return null;
  const winner = score.home > score.away ? sideA : sideB;
  const loser = score.home > score.away ? sideB : sideA;
  return wantLoser ? loser : winner;
}

function resolveKnockoutSide(side, byStats) {
  if (side?.team) return { name: side.team };
  if (side?.winner || side?.loser) {
    const matchId = side.winner || side.loser;
    const slot = KNOCKOUT_SLOTS.find((s) => s.id === Number(matchId));
    if (!slot) return null;
    const a = resolveKnockoutSide(slot.a, byStats);
    const b = resolveKnockoutSide(slot.b, byStats);
    return outcomeFromItem(byStats.get(String(matchId)), a, b, !!side.loser);
  }
  return null;
}

function resolveKnockoutFixtures(fixtures, byStats) {
  for (const fixture of fixtures) {
    if (fixture.home !== "TBD" && fixture.away !== "TBD") continue;
    const slot = KNOCKOUT_SLOTS.find((s) => s.id === Number(fixture.id));
    if (!slot) continue;
    const a = resolveKnockoutSide(slot.a, byStats);
    const b = resolveKnockoutSide(slot.b, byStats);
    if (a?.name) fixture.home = a.name;
    if (b?.name) fixture.away = b.name;
  }
}

function playerFromRosterEntry(entry) {
  return {
    name: entry.athlete?.displayName || entry.athlete?.fullName || "",
    shortName: entry.athlete?.shortName || "",
    num: entry.jersey || "",
    pos: entry.position?.abbreviation || "",
    position: entry.position?.displayName || entry.position?.name || "",
    formationPlace: entry.formationPlace || "",
    subbedIn: !!entry.subbedIn,
    subbedOut: !!entry.subbedOut
  };
}

function sideFromRoster(roster, fixtureTeam) {
  const players = roster.roster || [];
  return {
    team: fixtureTeam,
    espnTeam: roster.team?.displayName || "",
    formation: roster.formation || "",
    logo: roster.team?.logos?.[0]?.href || "",
    starters: players.filter((p) => p.starter).map(playerFromRosterEntry).filter((p) => p.name),
    bench: players.filter((p) => !p.starter).map(playerFromRosterEntry).filter((p) => p.name)
  };
}

function lineupFromSummary(summary, fixture, event) {
  const rosters = summary.rosters || [];
  if (rosters.length < 2) return null;
  const homeRoster = rosters.find((r) => sameTeam(r.team?.displayName, fixture.home));
  const awayRoster = rosters.find((r) => sameTeam(r.team?.displayName, fixture.away));
  if (!homeRoster || !awayRoster) return null;
  const home = sideFromRoster(homeRoster, fixture.home);
  const away = sideFromRoster(awayRoster, fixture.away);
  if (home.starters.length < 11 || away.starters.length < 11) return null;
  return {
    matchId: fixture.id,
    espnEventId: event.id,
    date: fixture.date,
    homeTeam: fixture.home,
    awayTeam: fixture.away,
    source: "ESPN",
    updatedAt: NOW.toISOString(),
    home,
    away
  };
}

async function buildLineups(fixtures, existing) {
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
      console.log(`${matchLabel(fixture)} -> ESPN no encontrado`);
      continue;
    }
    const state = event.status?.type?.state || "unknown";
    console.log(`${matchLabel(fixture)} -> ESPN ${event.id} (${state})`);
    try {
      const summary = await getSummary(event.id);
      const lineup = lineupFromSummary(summary, fixture, event);
      if (!lineup) {
        console.log(`${matchLabel(fixture)} -> lineup no publicada aun`);
        continue;
      }
      byMatch.set(matchKey, lineup);
      console.log(`${matchLabel(fixture)} -> lineup actualizada (${lineup.home.formation || "?"} / ${lineup.away.formation || "?"})`);
    } catch (e) {
      console.warn(`${matchLabel(fixture)} -> error summary ESPN ${event.id}: ${e.message}`);
    }
  }

  return {
    updated: NOW.toISOString(),
    source: "ESPN lineups via GitHub Actions",
    items: [...byMatch.values()].sort((a, b) => (a.matchId || 9999) - (b.matchId || 9999))
  };
}

const [fixtures, existing, matchStats] = await Promise.all([readFixtures(), readExisting(), readMatchStats()]);
resolveKnockoutFixtures(fixtures, matchStats);
const output = await buildLineups(fixtures, existing);
await fs.mkdir("data", { recursive: true });
await fs.writeFile(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Actualizado ${OUT_FILE} con ${output.items.length} alineaciones`);
