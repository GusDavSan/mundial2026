import fs from 'node:fs';

const SOURCE = '/Users/gustavo.davila/Downloads/wiki-worldcup-squads.html';
const OUT = '/Users/gustavo.davila/Downloads/squads.json';

const APP_TEAM_NAMES = {
  'Czech Republic': 'Czechia',
  'Bosnia and Herzegovina': 'Bosnia & Herzegovina',
  Turkey: 'Türkiye',
  Curacao: 'Curaçao',
  'DR Congo': 'DR Congo'
};

const EXPECTED = [
  'Mexico','South Africa','South Korea','Czechia',
  'Canada','Bosnia & Herzegovina','Qatar','Switzerland',
  'Brazil','Morocco','Haiti','Scotland',
  'United States','Paraguay','Australia','Türkiye',
  'Germany','Curaçao','Ivory Coast','Ecuador',
  'Netherlands','Japan','Sweden','Tunisia',
  'Belgium','Egypt','Iran','New Zealand',
  'Spain','Cape Verde','Saudi Arabia','Uruguay',
  'France','Senegal','Iraq','Norway',
  'Argentina','Algeria','Austria','Jordan',
  'Portugal','DR Congo','Uzbekistan','Colombia',
  'England','Croatia','Ghana','Panama'
];

function decodeHtml(value = '') {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(value = '') {
  return decodeHtml(value)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<sup[\s\S]*?<\/sup>/gi, ' ')
    .replace(/<small[\s\S]*?<\/small>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanName(value = '') {
  return stripTags(value)
    .replace(/\s+\((?:captain|vice-captain)\)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTeamSection(rawTeam, sectionHtml) {
  const team = APP_TEAM_NAMES[rawTeam] || rawTeam;
  const coachMatch = sectionHtml.match(/Coach:\s*([\s\S]*?)<\/p>/i);
  const coach = coachMatch ? stripTags(coachMatch[1]) : '';
  const tableMatch = sectionHtml.match(/<table class="sortable wikitable plainrowheaders"[\s\S]*?<\/table>/);
  const tableHtml = tableMatch ? tableMatch[0] : sectionHtml;
  const rows = [...tableHtml.matchAll(/<tr class="nat-fs-player">([\s\S]*?)<\/tr>/g)].map(m => m[1]);
  const players = rows.map(row => {
    const td = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
    const num = stripTags(td[0] || '');
    const posMatch = (td[1] || '').match(/>(GK|DF|MF|FW)<\/a>/i);
    const pos = posMatch ? posMatch[1].toUpperCase() : stripTags(td[1] || '').replace(/^\d+/, '').trim().toUpperCase();
    const nameMatch = row.match(/<th[^>]*scope="row"[^>]*>([\s\S]*?)<\/th>/) || row.match(/<th[^>]*>([\s\S]*?)<\/th>/);
    const name = cleanName(nameMatch ? nameMatch[1] : '');
    const ageMatch = stripTags(td[2] || '').match(/\(aged\s+(\d+)\)/i);
    const age = ageMatch ? Number(ageMatch[1]) : null;
    const club = stripTags(td[5] || '');
    return { num, pos, role: pos, name, age, club };
  }).filter(p => p.name && p.pos);
  return { team, coach, players };
}

const html = fs.readFileSync(SOURCE, 'utf8');
const headingRe = /<div class="mw-heading mw-heading3"><h3[^>]*>([\s\S]*?)<\/h3><\/div>/g;
const headings = [...html.matchAll(headingRe)].map(m => ({ index: m.index, team: stripTags(m[1]) }));
const squads = {};

headings.forEach((heading, i) => {
  const start = heading.index;
  const end = i + 1 < headings.length ? headings[i + 1].index : html.length;
  const section = html.slice(start, end);
  if (!/<tr class="nat-fs-player">/.test(section)) return;
  const parsed = parseTeamSection(heading.team, section);
  squads[parsed.team] = { coach: parsed.coach, players: parsed.players };
});

const orderedSquads = {};
EXPECTED.forEach(team => {
  if (squads[team]) orderedSquads[team] = squads[team];
});

const missing = EXPECTED.filter(team => !orderedSquads[team]);
const short = Object.entries(orderedSquads).filter(([, squad]) => squad.players.length < 23 || squad.players.length > 26);

if (missing.length) {
  console.error('Missing teams:', missing.join(', '));
  process.exitCode = 1;
}
if (short.length) {
  console.error('Unexpected squad sizes:');
  short.forEach(([team, squad]) => console.error(`- ${team}: ${squad.players.length}`));
  process.exitCode = 1;
}
if (process.exitCode) process.exit();

const out = {
  source: 'FIFA official squad positions via Wikipedia 2026 FIFA World Cup squads; VG/FourFourTwo used as spot-check validation',
  updated: '2026-06-14',
  squads: orderedSquads
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

console.log(`Wrote ${OUT}`);
console.log(`Teams: ${Object.keys(orderedSquads).length}`);
console.log(`Players: ${Object.values(orderedSquads).reduce((sum, squad) => sum + squad.players.length, 0)}`);
console.log(`Norway GK: ${orderedSquads.Norway.players.filter(p => p.pos === 'GK').map(p => `${p.name} (${p.club})`).join(' | ')}`);
console.log(`Spain: ${orderedSquads.Spain.players.length} players`);
console.log(`England: ${orderedSquads.England.players.length} players`);
