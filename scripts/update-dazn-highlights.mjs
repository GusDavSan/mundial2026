import fs from "node:fs/promises";
import vm from "node:vm";

const API_KEY = process.env.YOUTUBE_API_KEY;
const OUT_FILE = process.env.HIGHLIGHTS_OUT_FILE || "data/dazn-highlights.json";
const MATCH_STATS_FILE = process.env.MATCH_STATS_FILE || "data/match-stats.json";
const CHANNEL_HANDLE = "@DAZNES";
const CHANNEL_ID = process.env.DAZN_CHANNEL_ID || "UCz9FiMLz6SOgR_4VEFvjeIA";
const FEED_URL = process.env.DAZN_FEED_URL || `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const MAX_UPLOAD_PAGES = Number(process.env.MAX_UPLOAD_PAGES || 3);
const MOCK_UPLOADS_FILE = process.env.MOCK_UPLOADS_FILE || "";
const DEBUG = process.env.DEBUG_HIGHLIGHTS === "1";
const NOW = process.env.NOW ? new Date(process.env.NOW) : new Date();
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE || 12);

const HTML_CANDIDATES = ["index.html", "mundial2026_22.html", "mundial2026.html"];

const TEAM_ALIASES = {
  "Mexico": ["mexico", "mexico", "méxico"],
  "South Africa": ["south africa", "sudafrica", "sudáfrica"],
  "South Korea": ["south korea", "corea del sur", "republica de corea", "república de corea", "korea republic"],
  "Czechia": ["czechia", "chequia", "czech republic", "republica checa", "república checa"],
  "United States": ["united states", "estados unidos", "usa", "eeuu", "ee.uu"],
  "Türkiye": ["turkiye", "türkiye", "turquia", "turquía", "turkey"],
  "Bosnia & Herzegovina": ["bosnia", "bosnia herzegovina", "bosnia y herzegovina"],
  "Canada": ["canada", "canadá"],
  "DR Congo": ["dr congo", "rd congo", "republica democratica del congo", "república democrática del congo"],
  "Curaçao": ["curacao", "curaçao"],
  "Ivory Coast": ["ivory coast", "costa de marfil"],
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
  "Uzbekistan": ["uzbekistan", "uzbekistán"],
  "Wales": ["wales", "gales"]
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
    .toLowerCase();
}

function aliases(team) {
  return [...new Set([team, ...(TEAM_ALIASES[team] || [])].map(normalize).filter(Boolean))];
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasTeam(title, team) {
  const clean = normalize(title);
  return aliases(team).some((name) => {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(name)}([^a-z0-9]|$)`, "i");
    return pattern.test(clean);
  });
}

function scoreVideoForMatch(video, match) {
  const title = normalize(video.title);
  let score = 0;
  if (hasTeam(title, match.home)) score += 6;
  if (hasTeam(title, match.away)) score += 6;
  if (/(resumen|highlights|goles|goals|mejores momentos)/.test(title)) score += 3;
  if (/(mundial|world cup|fifa)/.test(title)) score += 2;
  if (/(copa mundial|world cup|fifa world cup)/.test(title)) score += 1;
  if (/(directo|en vivo|live|previa|preview|rueda de prensa|press conference|entrenamiento|training)/.test(title)) score -= 5;
  if (video.publishedAt && match.date) {
    const published = new Date(video.publishedAt);
    const matchStart = new Date(`${match.date}T${match.time || "00:00"}:00Z`);
    const daysAfter = (published - matchStart) / 86400000;
    if (Number.isFinite(daysAfter)) {
      if (daysAfter >= -0.25 && daysAfter <= 4) score += 2;
      if (daysAfter < -0.5 || daysAfter > 14) score -= 4;
    }
  }
  return score;
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

async function youtube(path) {
  const joiner = path.includes("?") ? "&" : "?";
  const url = `https://www.googleapis.com/youtube/v3/${path}${joiner}key=${encodeURIComponent(API_KEY)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`YouTube API ${r.status}: ${await r.text()}`);
  return r.json();
}

async function getUploadsPlaylist() {
  const data = await youtube(`channels?part=contentDetails,snippet&forHandle=${encodeURIComponent(CHANNEL_HANDLE)}`);
  const channel = data.items?.[0];
  if (!channel) throw new Error(`No encontré el canal ${CHANNEL_HANDLE}`);
  return channel.contentDetails.relatedPlaylists.uploads;
}

async function getRecentUploads(playlistId) {
  const videos = [];
  let pageToken = "";
  for (let page = 0; page < MAX_UPLOAD_PAGES; page++) {
    const data = await youtube(
      `playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(playlistId)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
    );
    for (const item of data.items || []) {
      const sn = item.snippet || {};
      videos.push({
        videoId: sn.resourceId?.videoId,
        title: sn.title,
        publishedAt: sn.publishedAt,
        thumbnail: sn.thumbnails?.high?.url || sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || ""
      });
    }
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return videos.filter((v) => v.videoId && v.title);
}

function decodeXml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function decodeJsonText(text) {
  try {
    return JSON.parse(`"${String(text || "").replace(/"/g, '\\"')}"`);
  } catch {
    return String(text || "");
  }
}

async function getRecentFeedUploads() {
  const r = await fetch(FEED_URL);
  if (!r.ok) throw new Error(`YouTube RSS ${r.status}: ${await r.text()}`);
  const xml = await r.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  return entries.map((entry) => {
    const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1] || "";
    const title = decodeXml(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "");
    const publishedAt = entry.match(/<published>([^<]+)<\/published>/)?.[1] || NOW.toISOString();
    const thumbnail = decodeXml(entry.match(/<media:thumbnail url="([^"]+)"/)?.[1] || "");
    return { videoId, title, publishedAt, thumbnail };
  }).filter((v) => v.videoId && v.title);
}

function uniqueVideos(videos) {
  const seen = new Set();
  return videos.filter((video) => {
    const key = video.videoId || video.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseSearchVideos(html) {
  const out = [];
  const re = /"videoId":"([^"]+)"[\s\S]{0,1600}?"title":\{"runs":\[\{"text":"([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    out.push({
      videoId: m[1],
      title: decodeJsonText(m[2]),
      publishedAt: NOW.toISOString(),
      thumbnail: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`
    });
  }
  return uniqueVideos(out);
}

async function getOembedAuthor(videoId) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`YouTube oEmbed ${r.status}`);
  const data = await r.json();
  return data.author_name || "";
}

async function searchDaznForMatch(match) {
  const query = `${match.home} ${match.away} Resumen goles Highlights Copa Mundial FIFA 2026 DAZN`;
  const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
  if (!r.ok) throw new Error(`YouTube search ${r.status}`);
  const scored = parseSearchVideos(await r.text())
    .map((video) => ({ video, score: scoreVideoForMatch(video, match) }))
    .filter((x) => x.score >= MIN_CONFIDENCE)
    .sort((a, b) => b.score - a.score);
  for (const item of scored.slice(0, 6)) {
    try {
      const author = await getOembedAuthor(item.video.videoId);
      if (normalize(author) === "dazn es") return item;
      if (DEBUG) console.log(`Descartado ${item.video.videoId}: autor ${author}`);
    } catch (e) {
      if (DEBUG) console.log(`oEmbed falló ${item.video.videoId}: ${e.message}`);
    }
  }
  return null;
}

async function readMockUploads() {
  const raw = await fs.readFile(MOCK_UPLOADS_FILE, "utf8");
  const data = JSON.parse(raw);
  const items = Array.isArray(data) ? data : data.items || [];
  return items.map((item) => ({
    videoId: item.videoId || item.id,
    title: item.title,
    publishedAt: item.publishedAt || NOW.toISOString(),
    thumbnail: item.thumbnail || ""
  })).filter((v) => v.videoId && v.title);
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

function sameTeam(a, b) {
  const aa = aliases(a);
  const bb = aliases(b);
  return aa.some((x) => bb.includes(x));
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

function matchDateHasPassed(match) {
  if (match.home === "TBD" || match.away === "TBD") return false;
  return new Date(`${match.date}T${match.time || "23:59"}:00Z`) <= NOW;
}

async function buildHighlights(fixtures, uploads, existing) {
  const byMatch = new Map();
  for (const item of existing.items) {
    const key = String(item.matchId || item.eventId || `${item.home}|${item.away}|${item.date}`);
    if (key) byMatch.set(key, item);
  }

  for (const match of fixtures.filter(matchDateHasPassed)) {
    const matchKey = String(match.id);
    const existingItem = byMatch.get(matchKey);
    if (existingItem?.manual || existingItem?.locked) continue;
    let best = uploads
      .map((video) => ({ video, score: scoreVideoForMatch(video, match) }))
      .filter((x) => x.score >= MIN_CONFIDENCE)
      .sort((a, b) => b.score - a.score || new Date(b.video.publishedAt) - new Date(a.video.publishedAt))[0];
    if (!best) {
      best = await searchDaznForMatch(match).catch((e) => {
        console.warn(`Búsqueda DAZN falló ${match.id} ${match.home} vs ${match.away}: ${e.message}`);
        return null;
      });
    }
    if (!best) {
      console.log(`Sin highlight DAZN: ${match.id} ${match.home} vs ${match.away}`);
      continue;
    }
    console.log(`Encontrado ${match.home}-${match.away} -> ${best.video.videoId} (${best.score}) "${best.video.title}"`);
    byMatch.set(matchKey, {
      matchId: match.id,
      date: match.date,
      home: match.home,
      away: match.away,
      source: "DAZN ES",
      title: best.video.title,
      url: `https://www.youtube.com/watch?v=${best.video.videoId}`,
      thumbnail: best.video.thumbnail,
      videoId: best.video.videoId,
      publishedAt: best.video.publishedAt,
      confidence: best.score
    });
  }

  return {
    updated: new Date().toISOString(),
    source: "DAZN ES YouTube highlights via GitHub Actions",
    items: [...byMatch.values()].sort((a, b) => (a.matchId || 9999) - (b.matchId || 9999))
  };
}

const [fixtures, existing, matchStats] = await Promise.all([readFixtures(), readExisting(), readMatchStats()]);
resolveKnockoutFixtures(fixtures, matchStats);
let uploads = [];
if (MOCK_UPLOADS_FILE) {
  uploads = await readMockUploads();
} else {
  const feedUploads = await getRecentFeedUploads().catch((e) => {
    console.warn(`Feed DAZN no disponible: ${e.message}`);
    return [];
  });
  let apiUploads = [];
  if (API_KEY) {
    apiUploads = await getRecentUploads(await getUploadsPlaylist()).catch((e) => {
      console.warn(`YouTube API no disponible: ${e.message}`);
      return [];
    });
  } else {
    console.log("YOUTUBE_API_KEY no definido; usando feed RSS público de DAZN.");
  }
  uploads = uniqueVideos([...feedUploads, ...apiUploads]);
}
const output = await buildHighlights(fixtures, uploads, existing);

await fs.mkdir("data", { recursive: true });
await fs.writeFile(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);

console.log(`Actualizado ${OUT_FILE} con ${output.items.length} highlights`);
