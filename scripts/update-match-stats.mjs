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

function hasWord(text, word) {
  return new RegExp(`\\b${word}\\b`).test(text);
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
  if (fixture.home === "TBD" && fixture.away === "TBD") return false;
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

function matchLabel(fixture) {
  return `${fixture.id} ${fixture.home} vs ${fixture.away}`;
}

function matchEventForFixture(fixture, events) {
  const known = [fixture.home, fixture.away].filter((team) => team && team !== "TBD");
  if (known.length === 1) {
    return events.find((event) => {
      const t = eventTeams(event);
      return sameTeam(t.home, known[0]) || sameTeam(t.away, known[0]);
    });
  }
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

function groupFromRound(round = "") {
  const m = String(round).match(/Group\s+([A-L])/i);
  return m ? m[1].toUpperCase() : "";
}

function scoreFromItemForTeams(item, home, away) {
  if (!item) return null;
  if (item.homeScore !== undefined && item.awayScore !== undefined) {
    const h = Number.parseInt(item.homeScore, 10);
    const a = Number.parseInt(item.awayScore, 10);
    if (Number.isFinite(h) && Number.isFinite(a)) return { home: h, away: a };
  }
  let h = 0;
  let a = 0;
  let hasGoal = false;
  for (const goal of item.goals || []) {
    if (!goal?.team) continue;
    hasGoal = true;
    if (sameTeam(goal.team, home)) h++;
    else if (sameTeam(goal.team, away)) a++;
  }
  return hasGoal || item.stats ? { home: h, away: a } : null;
}

function groupStandings(fixtures, byMatch, group) {
  const rows = new Map();
  for (const fixture of fixtures.filter((f) => groupFromRound(f.round) === group)) {
    for (const team of [fixture.home, fixture.away]) {
      if (!rows.has(team)) rows.set(team, { name: team, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
    }
    const item = byMatch.get(String(fixture.id));
    const score = scoreFromItemForTeams(item, fixture.home, fixture.away);
    if (!score) continue;
    const home = rows.get(fixture.home);
    const away = rows.get(fixture.away);
    home.p++; away.p++;
    home.gf += score.home; home.ga += score.away;
    away.gf += score.away; away.ga += score.home;
    if (score.home > score.away) { home.w++; away.l++; home.pts += 3; }
    else if (score.home < score.away) { away.w++; home.l++; away.pts += 3; }
    else { home.d++; away.d++; home.pts++; away.pts++; }
  }
  return [...rows.values()].sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.name.localeCompare(b.name));
}

function groupClosed(fixtures, byMatch, group) {
  return fixtures.filter((f) => groupFromRound(f.round) === group).filter((f) => byMatch.has(String(f.id))).length >= 6;
}

function resolveDirectSlot(code, fixtures, byMatch) {
  const group = code?.[1];
  const idx = (Number.parseInt(code?.[0], 10) || 1) - 1;
  const row = groupStandings(fixtures, byMatch, group)[idx];
  return row && row.p > 0 ? { name: row.name, confirmed: groupClosed(fixtures, byMatch, group) } : null;
}

function thirdRows(fixtures, byMatch) {
  const groups = unique(fixtures.map((f) => groupFromRound(f.round)).filter(Boolean)).sort();
  return groups.map((group) => {
    const row = groupStandings(fixtures, byMatch, group)[2];
    return row ? { group, name: row.name, p: row.p, pts: row.pts, gd: row.gf - row.ga, gf: row.gf, closed: groupClosed(fixtures, byMatch, group) } : null;
  }).filter(Boolean).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.group.localeCompare(b.group));
}

function resolveThirdSlot(def, fixtures, byMatch) {
  const ranks = new Map(thirdRows(fixtures, byMatch).map((row, idx) => [row.group, idx + 1]));
  const candidates = (def.third || []).map((group) => {
    const row = groupStandings(fixtures, byMatch, group)[2];
    return row && row.p > 0 ? { group, name: row.name, rank: ranks.get(group), closed: groupClosed(fixtures, byMatch, group) } : null;
  }).filter(Boolean);
  const confirmed = candidates.filter((c) => c.closed && c.rank <= 8);
  const open = candidates.filter((c) => !c.closed);
  return confirmed.length === 1 && open.length === 0 ? { name: confirmed[0].name, confirmed: true } : null;
}

function outcomeFromItem(item, sideA, sideB, wantLoser) {
  if (!item || !sideA?.name || !sideB?.name) return null;
  const winnerName = item.winner || item.winnerTeam || item.penaltyWinner || "";
  const loserName = item.loser || item.loserTeam || "";
  if (winnerName) {
    if (!wantLoser) return sameTeam(winnerName, sideA.name) ? sideA : sameTeam(winnerName, sideB.name) ? sideB : { name: winnerName, confirmed: true };
    if (loserName) return sameTeam(loserName, sideA.name) ? sideA : sameTeam(loserName, sideB.name) ? sideB : { name: loserName, confirmed: true };
  }
  const score = scoreFromItemForTeams(item, sideA.name, sideB.name);
  if (!score || score.home === score.away) return null;
  const winner = score.home > score.away ? sideA : sideB;
  const loser = score.home > score.away ? sideB : sideA;
  return wantLoser ? loser : winner;
}

function resolveKnockoutSide(side, fixtures, byMatch) {
  if (typeof side === "string") return resolveDirectSlot(side, fixtures, byMatch);
  if (side?.team) return { name: side.team, confirmed: true };
  if (side?.third) return resolveThirdSlot(side, fixtures, byMatch);
  if (side?.winner || side?.loser) {
    const matchId = side.winner || side.loser;
    const slot = KNOCKOUT_SLOTS.find((s) => s.id === Number(matchId));
    if (!slot) return null;
    const a = resolveKnockoutSide(slot.a, fixtures, byMatch);
    const b = resolveKnockoutSide(slot.b, fixtures, byMatch);
    return outcomeFromItem(byMatch.get(String(matchId)), a, b, !!side.loser);
  }
  return null;
}

function resolveKnockoutFixtures(fixtures, byMatch) {
  for (const fixture of fixtures) {
    if (fixture.home !== "TBD" && fixture.away !== "TBD") continue;
    const slot = KNOCKOUT_SLOTS.find((s) => s.id === Number(fixture.id));
    if (!slot) continue;
    const a = resolveKnockoutSide(slot.a, fixtures, byMatch);
    const b = resolveKnockoutSide(slot.b, fixtures, byMatch);
    if (a?.name) fixture.home = a.name;
    if (b?.name) fixture.away = b.name;
  }
}

function eventOutcome(event, fixture) {
  const competitors = event.competitions?.[0]?.competitors || [];
  const home = competitors.find((c) => sameTeam(c.team?.displayName, fixture.home));
  const away = competitors.find((c) => sameTeam(c.team?.displayName, fixture.away));
  const winner = home?.winner ? fixture.home : away?.winner ? fixture.away : "";
  const loser = winner ? (sameTeam(winner, fixture.home) ? fixture.away : fixture.home) : "";
  return { winner, loser };
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

function canonicalTeam(team, fixture) {
  if (sameTeam(team, fixture.home)) return fixture.home;
  if (sameTeam(team, fixture.away)) return fixture.away;
  return team || "";
}

function cardKind(event) {
  const raw = normalize(`${event.type?.text || ""} ${event.type?.type || ""} ${event.play?.type?.text || ""} ${event.play?.type?.type || ""}`);
  const text = normalize(`${event.text || ""} ${event.shortText || ""} ${event.play?.text || ""} ${event.play?.shortText || ""}`);
  const merged = `${raw} ${text}`;
  const isCard = hasWord(merged, "card") || (hasWord(merged, "yellow") && hasWord(merged, "card")) || (hasWord(merged, "red") && hasWord(merged, "card"));
  if (!isCard) return null;
  if (hasWord(merged, "red") && hasWord(merged, "card")) return "red";
  if (hasWord(merged, "yellow") && hasWord(merged, "card")) return "yellow";
  return null;
}

function cardCountsFromSummary(summary, fixture) {
  const counts = { yellow: { home: 0, away: 0 }, red: { home: 0, away: 0 } };
  const seen = new Set();
  const events = [...(summary.commentary || []), ...(summary.keyEvents || [])];
  for (const event of events) {
    const kind = cardKind(event);
    if (!kind) continue;
    const text = normalize(event.text || event.shortText || event.play?.text || event.play?.shortText || "");
    const team = canonicalTeam(event.team?.displayName || event.play?.team?.displayName || "", fixture);
    const side = sameTeam(team, fixture.home) ? "home" : sameTeam(team, fixture.away) ? "away" : "";
    const key = `${kind}|${side || normalize(team)}|${event.clock?.displayValue || event.time?.displayValue || ""}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (side) counts[kind][side]++;
  }
  return counts;
}

function displayMinute(play) {
  const raw = play?.clock?.displayValue || play?.time?.displayValue || "";
  if (raw) return String(raw).replace(/'+$/, "");
  const val = Number(play?.clock?.value ?? play?.time?.value);
  if (Number.isFinite(val) && val > 0) return String(Math.max(1, Math.ceil(val / 60)));
  return "";
}

function participantName(play, index) {
  const athlete = play?.participants?.[index]?.athlete;
  return athlete?.displayName || athlete?.fullName || athlete?.shortName || "";
}

function playerFromGoalText(text) {
  const own = text.match(/own goal by\s+([^(.,]+)/i);
  if (own) return own[1].trim();
  const afterScore = text.match(/Goal!\s+[^.]+\.\s+([^(.,]+)/i);
  if (afterScore) return afterScore[1].trim();
  return "";
}

function assistFromGoalText(text) {
  const m = text.match(/Assisted by\s+([^.,]+)(?:[.,]|$)/i);
  return m ? m[1].trim() : "";
}

function goalEventsFromSummary(summary, fixture) {
  const plays = [...(summary.keyEvents || []), ...(summary.scoringPlays || [])];
  const seen = new Set();
  const goals = [];
  for (const play of plays) {
    const id = String(play.id || "");
    if (id && seen.has(id)) continue;
    const type = normalize(`${play.type?.text || ""} ${play.type?.type || ""}`);
    const text = String(play.text || play.shortText || play.play?.text || "");
    const textNorm = normalize(text);
    const isGoal = play.scoringPlay || type.includes("goal") || textNorm.startsWith("goal ");
    const disallowed = textNorm.includes("disallowed") || textNorm.includes("overturned");
    if (!isGoal || disallowed) continue;
    if (id) seen.add(id);

    const penalty = textNorm.includes("penalty");
    const ownGoal = textNorm.includes("own goal") || type.includes("own goal");
    const team = canonicalTeam(play.team?.displayName || play.play?.team?.displayName || "", fixture);
    const player = participantName(play, 0) || playerFromGoalText(text);
    let assist = "";
    if (!penalty && !ownGoal) {
      assist = participantName(play, 1) || assistFromGoalText(text);
      if (normalize(assist) === normalize(player)) assist = "";
    }

    goals.push({
      id,
      minute: displayMinute(play),
      period: play.period?.number || null,
      team,
      player,
      assist,
      penalty,
      ownGoal,
      text,
      source: "ESPN"
    });
  }
  return goals.filter((goal) => goal.team && goal.player);
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
  const cardCounts = cardCountsFromSummary(summary, fixture);
  if (cardCounts.yellow.home || cardCounts.yellow.away) stats.yellowCards = { home: cardCounts.yellow.home, away: cardCounts.yellow.away };
  if (cardCounts.red.home || cardCounts.red.away) stats.redCards = { home: cardCounts.red.home, away: cardCounts.red.away };

  const goals = goalEventsFromSummary(summary, fixture);
  const assists = goals.filter((goal) => goal.assist && !goal.ownGoal).map((goal) => ({
    id: goal.id,
    minute: goal.minute,
    period: goal.period,
    team: goal.team,
    player: goal.assist,
    goal: goal.player,
    source: "ESPN"
  }));
  const score = scoreFromEvent(event, fixture);
  const outcome = eventOutcome(event, fixture);

  return {
    matchId: fixture.id,
    espnEventId: event.id,
    date: fixture.date,
    homeTeam: fixture.home,
    awayTeam: fixture.away,
    homeScore: score.home,
    awayScore: score.away,
    winner: outcome.winner,
    loser: outcome.loser,
    source: "ESPN",
    updatedAt: NOW.toISOString(),
    stats,
    goals,
    assists,
    keepers: keeperMetricsFromSummary(summary, fixture, event, stats)
  };
}

async function buildMatchStats(fixtures, existing) {
  const byMatch = new Map();
  for (const item of existing.items) {
    const key = String(item.matchId || `${item.homeTeam}|${item.awayTeam}|${item.date}`);
    if (key) byMatch.set(key, item);
  }
  resolveKnockoutFixtures(fixtures, byMatch);

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
    const teams = eventTeams(event);
    if (fixture.home === "TBD" && teams.home) fixture.home = teams.home;
    if (fixture.away === "TBD" && teams.away) fixture.away = teams.away;
    const state = event.status?.type?.state || "unknown";
    console.log(`${matchLabel(fixture)} -> ESPN ${event.id} (${state})`);
    try {
      const summary = await getSummary(event.id);
      const item = statsFromSummary(summary, fixture, event);
      if (!item) {
        console.log(`${matchLabel(fixture)} -> stats no publicadas aun`);
        continue;
      }
      byMatch.set(matchKey, item);
      resolveKnockoutFixtures(fixtures, byMatch);
      console.log(`${matchLabel(fixture)} -> stats actualizadas (${Object.keys(item.stats).join(", ")}; goles ${item.goals.length}; asistencias ${item.assists.length})`);
    } catch (e) {
      console.warn(`${matchLabel(fixture)} -> error summary ESPN ${event.id}: ${e.message}`);
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
