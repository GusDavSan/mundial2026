import fs from "node:fs/promises";
import vm from "node:vm";

const API_KEY = process.env.YOUTUBE_API_KEY;
const OUT_FILE = "data/dazn-highlights.json";
const CHANNEL_HANDLE = "@DAZNES";
const MAX_UPLOAD_PAGES = 3;

const HTML_CANDIDATES = ["index.html", "mundial2026_22.html", "mundial2026.html"];

const TEAM_ALIASES = {
  "Mexico": ["mexico", "mexico", "méxico"],
  "South Africa": ["south africa", "sudafrica", "sudáfrica"],
  "South Korea": ["south korea", "corea del sur", "korea republic"],
  "Czechia": ["czechia", "chequia", "czech republic", "republica checa", "república checa"],
  "United States": ["united states", "estados unidos", "usa", "eeuu", "ee.uu"],
  "Türkiye": ["turkiye", "türkiye", "turquia", "turquía", "turkey"],
  "Bosnia & Herzegovina": ["bosnia", "bosnia herzegovina", "bosnia y herzegovina"],
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
  "Canada": ["canada", "canadá"],
  "Australia": ["australia"],
  "Qatar": ["qatar", "catar"],
  "Iran": ["iran", "irán"],
  "Iraq": ["iraq", "irak"],
  "Jordan": ["jordan", "jordania"],
  "Uzbekistan": ["uzbekistan", "uzbekistán"],
  "Morocco": ["morocco", "marruecos"]
};

function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function aliases(team) {
  return [...new Set([team, ...(TEAM_ALIASES[team] || [])].map(normalize).filter(Boolean))];
}

function hasTeam(title, team) {
  const clean = normalize(title);
  return aliases(team).some((name) => clean.includes(name));
}

function scoreVideoForMatch(video, match) {
  const title = normalize(video.title);
  let score = 0;
  if (hasTeam(title, match.home)) score += 6;
  if (hasTeam(title, match.away)) score += 6;
  if (/(resumen|highlights|goles|goals|mejores momentos)/.test(title)) score += 3;
  if (/(mundial|world cup|fifa)/.test(title)) score += 2;
  if (/(directo|previa|preview|rueda de prensa|press conference)/.test(title)) score -= 5;
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

async function readExisting() {
  try {
    const raw = await fs.readFile(OUT_FILE, "utf8");
    const json = JSON.parse(raw);
    return Array.isArray(json) ? { items: json } : { items: json.items || [] };
  } catch {
    return { items: [] };
  }
}

function matchDateHasPassed(match) {
  if (match.home === "TBD" || match.away === "TBD") return false;
  return new Date(`${match.date}T${match.time || "23:59"}:00Z`) <= new Date();
}

function buildHighlights(fixtures, uploads, existing) {
  const byMatch = new Map();
  for (const item of existing.items) {
    const key = String(item.matchId || item.eventId || `${item.home}|${item.away}|${item.date}`);
    if (key) byMatch.set(key, item);
  }

  for (const match of fixtures.filter(matchDateHasPassed)) {
    const matchKey = String(match.id);
    const existingItem = byMatch.get(matchKey);
    if (existingItem?.manual || existingItem?.locked) continue;
    const best = uploads
      .map((video) => ({ video, score: scoreVideoForMatch(video, match) }))
      .filter((x) => x.score >= 12)
      .sort((a, b) => b.score - a.score || new Date(b.video.publishedAt) - new Date(a.video.publishedAt))[0];
    if (!best) continue;
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

if (!API_KEY) {
  throw new Error("Falta el secreto YOUTUBE_API_KEY en GitHub Actions");
}

const [fixtures, existing] = await Promise.all([readFixtures(), readExisting()]);
const uploadsPlaylist = await getUploadsPlaylist();
const uploads = await getRecentUploads(uploadsPlaylist);
const output = buildHighlights(fixtures, uploads, existing);

await fs.mkdir("data", { recursive: true });
await fs.writeFile(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);

console.log(`Actualizado ${OUT_FILE} con ${output.items.length} highlights`);
