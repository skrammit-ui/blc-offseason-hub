// ════════════════════════════════════════════════════════════════════════════
//  BLC Offseason Hub — Google Apps Script Backend
//  Paste this entire file into your Apps Script project (Extensions → Apps Script)
//  Then deploy as Web App: Execute as "Me", Access "Anyone"
// ════════════════════════════════════════════════════════════════════════════
const SHEET_ID      = '1isrFPsDq4n4mTr1uUSUydCUi39mCqmkYLEd6voy8nhI'; // ← Replace with your Google Sheet ID
const MLB_STATS_API = 'https://statsapi.mlb.com/api/v1';
const MILB_AB_MAX   = 130;   // career MLB at-bats threshold for MiLB eligibility
const MILB_IP_MAX   = 50;    // career MLB innings-pitched threshold

// ── One-time migration: run once from Script Editor to rename gelof → merrilly ──
function migrateGelofToMerrilly() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  transferTeam(ss, 'gelof', 'merrilly');
  Logger.log('Done — all sheets updated from gelof to merrilly');
}

// ── Debug: run from Script Editor to test each refresh target individually ────
// Open Apps Script → select testFullRefresh → Run → View Logs
function testFullRefresh() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const targets = ['standings', 'rosters', 'draft', 'draftPicks'];
  targets.forEach(function(t) {
    try {
      Logger.log('▶ ' + t + ' …');
      let result;
      if      (t === 'standings')  result = refreshFantraxStandings(ss);
      else if (t === 'rosters')    result = refreshFantraxRosters(ss);
      else if (t === 'draft')      result = refreshFantraxDraft(ss);
      else if (t === 'draftPicks') result = refreshFantraxDraftPicks(ss);
      Logger.log('✓ ' + t + ': ' + JSON.stringify(result).substring(0, 300));
    } catch(e) {
      Logger.log('✗ ' + t + ' FAILED: ' + e.message + '\n' + e.stack);
    }
  });
}
// ── CORS helper ──────────────────────────────────────────────────────────────
function corsResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
// ── GET: Return all league data ───────────────────────────────────────────────
function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const data = {
      league:             getRosters(ss),
      keepers:            getKeepers(ss),
      ownerMap:           getOwnerMap(ss),
      standings:          getStandings(ss),
      picks:              getPicks(ss),
      stats:              getStats(ss),
      projections:        getProjections(ss),
      r5Status:           getR5Status(ss),
      draftPlan:          getDraftPlans(ss),
      builderSlots:       getBuilderSlots(ss),
      divisions:          getDivisions(ss),
      playoffs:           getPlayoffsData(ss),
      matchups:           getMatchups(ss),
      fantraxConnected:   isFantraxConfigured(),
      prospectNotes:      getProspectNotes(ss),
      mlbIdMap:           getMlbIdMap(ss),
    };
    return corsResponse({ ok: true, data });
  } catch(err) {
    return corsResponse({ ok: false, error: err.message });
  }
}
// ── POST: Handle all write actions ───────────────────────────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(SHEET_ID);
    switch (payload.action) {
      case 'setKeeper':
        setKeeper(ss, payload.teamKey, payload.player, payload.keeperType, payload.playerId);
        break;
      case 'removeKeeper':
        removeKeeper(ss, payload.teamKey, payload.playerId, payload.player);
        break;
      case 'editPlayer':
        // payload.fields = { contract, salary, status, ... }
        editPlayerFields(ss, payload.teamKey, payload.playerId, payload.fields);
        break;
      case 'importRosters':
        // payload.league = full LEAGUE object from CSV parse
        importRosters(ss, payload.league);
        break;
      case 'importStandings':
        // payload.standings = [{ team, W, L, pct, GB, RS, RA }]
        importStandings(ss, payload.standings);
        break;
      case 'renameTeam':
        renameTeam(ss, payload.oldName, payload.newName, payload.ownerKey);
        break;
      case 'setPick':
        setPick(ss, payload.round, payload.pick, payload.team, payload.player, payload.salary, payload.contract);
        break;
      case 'r5Pick':
        r5MovePlayer(ss, payload.playerId, payload.player, payload.fromTeamKey, payload.toTeamKey, payload.newStatus);
        break;
      case 'tradePlayers':
        tradePlayers(ss, payload.moves);
        break;
      case 'saveStats':
        saveStats(ss, payload.stats);
        break;
      case 'saveProjections':
        saveProjections(ss, payload.projections);
        break;
      case 'setR5Status':
        setR5Status(ss, payload.status);
        break;
      case 'importPickOrder':
        importPickOrder(ss, payload.slots);
        break;
      case 'importDraftResults':
        importDraftResults(ss, payload.results);
        break;
      case 'transferTeam':
        transferTeam(ss, payload.oldKey, payload.newKey);
        break;
      case 'saveDraftPlan':
        saveDraftPlan(ss, payload.teamKey, payload.plan);
        break;
      case 'saveBuilderPlan':
        saveBuilderPlan(ss, payload.teamKey, payload.plan);
        break;
      case 'saveDivisions':
        saveDivisions(ss, payload.year, payload.divisions);
        break;
      case 'savePlayoffs':
        savePlayoffs(ss, payload.year, payload.playoffs);
        break;
      case 'refreshMLBCareerCache':
        return corsResponse(refreshMLBCareerCache());
      case 'refreshMLBCareerCacheForTeam':
        return corsResponse(refreshMLBCareerCacheForTeam(payload.teamKey));
      case 'refreshTeamFull':
        return corsResponse(refreshTeamFull(payload.teamKey));
      case 'refreshMLBYTDStats':
      case 'refreshYTDStats':
        return corsResponse(refreshMLBYTDStats());
      case 'refreshStandings': {
        const sResult = refreshFantraxStandings(ss);
        let mResult = { ok: true, updated: 0 };
        try { mResult = refreshFantraxMatchups(ss); } catch(e) { mResult = { ok: false, error: e.message }; }
        return corsResponse(Object.assign({}, sResult, { matchupsUpdated: mResult.updated, matchupsOk: mResult.ok }));
      }
      case 'debugStandings':
        return corsResponse(debugStandingsData(ss));
      case 'refreshDraftPicks':
        return corsResponse(refreshFantraxDraftPicks(ss));
      case 'debugDraftPicks':
        return corsResponse(debugDraftPicksData());
      case 'debugDraftResults':
        return corsResponse(debugDraftResultsData());
      case 'refreshFantrax':
        return corsResponse(refreshFantrax(ss, payload.targets || ['standings','rosters','draft']));
      case 'testFantraxConnection':
        return corsResponse(testFantraxConnection());
      case 'debugFantrax':
        return corsResponse(debugFantrax(payload.endpoint, payload.params));
      case 'debugFantraxRosterMatch':
        return corsResponse(debugFantraxRosterMatch());
      case 'buildRostersFromFantrax':
        return corsResponse(buildRostersFromFantrax(ss));
      case 'populateFantraxPlayerIds':
        return corsResponse(populateFantraxPlayerIds(ss));
      case 'debugRosterValues':
        return corsResponse(debugRosterValues(ss));
      case 'debugGetPlayerIds':
        return corsResponse(debugGetPlayerIds());
      case 'debugFantraxPlayerEndpoints':
        return corsResponse(debugFantraxPlayerEndpoints());
      case 'debugFantraxStatsEndpoints':
        return corsResponse(debugFantraxStatsEndpoints());
      case 'saveProspectNote':
        saveProspectNote(ss, payload.player, payload.overrides);
        return corsResponse({ ok: true });
      default:
        return corsResponse({ ok: false, error: 'Unknown action: ' + payload.action });
    }
    return corsResponse({ ok: true });
  } catch(err) {
    return corsResponse({ ok: false, error: err.message });
  }
}
// ════════════════════════════════════════════════════════════════════════════
//  READERS
// ════════════════════════════════════════════════════════════════════════════

// Legacy owner-key aliases: old misspelled key → current correct key.
// Add entries here whenever a key is renamed so old sheet rows still resolve.
const LEGACY_OWNER_KEYS = {
  'defered':  'deferred',
  'loveable': 'lovable',
};

function resolveOwnerKey(raw, ownerMap) {
  // 1. Exact match
  if (ownerMap[raw]) return ownerMap[raw];
  // 2. Known legacy alias
  const legacy = LEGACY_OWNER_KEYS[raw];
  if (legacy && ownerMap[legacy]) return ownerMap[legacy];
  // 3. Case-insensitive scan (catches any future key typos/renames)
  const lower = raw.toLowerCase();
  for (const [k, v] of Object.entries(ownerMap)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

function getRosters(ss) {
  const ownerMap = getOwnerMap(ss);          // key → teamName
  const validNames = new Set(Object.values(ownerMap));
  const sheet = ss.getSheetByName('Rosters');
  if (!sheet) return {};
  const [headers, ...rows] = sheet.getDataRange().getValues();
  // Support both old header ('team') and new header ('teamKey')
  const teamHeader = headers.includes('teamKey') ? 'teamKey' : 'team';
  const league = {};
  rows.forEach(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = String(row[i] ?? ''));
    const raw = obj[teamHeader];
    if (!raw) return;
    // Resolve: try as ownerKey (with legacy alias support), then treat as teamName
    const teamName = resolveOwnerKey(raw, ownerMap) || raw;
    if (!validNames.has(teamName)) return; // skip unknown teams
    if (!league[teamName]) league[teamName] = [];
    const { team: _t, teamKey: _tk, ...player } = obj;
    league[teamName].push(player);
  });
  return league;
}
function getKeepers(ss) {
  const ownerMap = getOwnerMap(ss);
  const sheet = ss.getSheetByName('Keepers');
  if (!sheet) return {};
  const data = sheet.getDataRange().getValues();
  const headers = data[0] || [];
  const typeIdx = headers.indexOf('keeperType');
  const keepers = {};
  for (let i = 1; i < data.length; i++) {
    const raw    = String(data[i][0] || '').trim();
    const player = String(data[i][1] || '').trim();
    const type   = typeIdx >= 0 ? String(data[i][typeIdx] || '').trim() : String(data[i][2] || '').trim();
    if (!raw || !player || !type) continue;
    // Resolve teamKey → teamName (with legacy alias + backward compat for old teamName rows)
    const teamName = resolveOwnerKey(raw, ownerMap) || raw;
    if (!keepers[teamName]) keepers[teamName] = {};
    keepers[teamName][player] = type;
  }
  return keepers;
}

// ── One-time migration: update old owner keys in Rosters + Keepers sheets ────
// Run this once from the Apps Script editor after deploying, then it's safe to
// leave in place (it's a no-op once all rows have been updated).
function migrateOwnerKeys() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // ── Rosters ──────────────────────────────────────────────────────────────
  const rostersSheet = ss.getSheetByName('Rosters');
  if (rostersSheet && rostersSheet.getLastRow() > 1) {
    const headers = rostersSheet.getRange(1, 1, 1, rostersSheet.getLastColumn()).getValues()[0];
    const teamCol = (headers.indexOf('teamKey') >= 0 ? headers.indexOf('teamKey') : headers.indexOf('team')) + 1;
    const data    = rostersSheet.getDataRange().getValues();
    let updated   = 0;
    for (let i = 1; i < data.length; i++) {
      const raw = String(data[i][teamCol - 1] || '').trim();
      const newKey = LEGACY_OWNER_KEYS[raw];
      if (newKey) {
        rostersSheet.getRange(i + 1, teamCol).setValue(newKey);
        updated++;
      }
    }
    Logger.log('Rosters: updated ' + updated + ' rows');
  }

  // ── Keepers ──────────────────────────────────────────────────────────────
  const keepersSheet = ss.getSheetByName('Keepers');
  if (keepersSheet && keepersSheet.getLastRow() > 1) {
    const data  = keepersSheet.getDataRange().getValues();
    let updated = 0;
    for (let i = 1; i < data.length; i++) {
      const raw = String(data[i][0] || '').trim();
      const newKey = LEGACY_OWNER_KEYS[raw];
      if (newKey) {
        keepersSheet.getRange(i + 1, 1).setValue(newKey);
        updated++;
      }
    }
    Logger.log('Keepers: updated ' + updated + ' rows');
  }

  Logger.log('✓ migrateOwnerKeys complete.');
}
function getOwnerMap(ss) {
  const sheet = ss.getSheetByName('Settings');
  if (!sheet) return {};
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const map = {};
  rows.forEach(row => {
    const [key, value] = row;
    if (key && value && !String(key).startsWith('__')) map[key] = value;
  });
  return map;
}
function getR5Status(ss) {
  const sheet = ss.getSheetByName('Settings');
  if (!sheet) return 'pending';
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === '__r5Status') return String(data[i][1] || 'pending');
  }
  return 'pending';
}
function setR5Status(ss, status) {
  const sheet = ss.getSheetByName('Settings');
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === '__r5Status') {
      sheet.getRange(i + 1, 2).setValue(status);
      return;
    }
  }
  sheet.appendRow(['__r5Status', status]);
}
function getStandings(ss) {
  const sheet = ss.getSheetByName('Standings');
  if (!sheet) return {};
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const standings = {};
  rows.forEach(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    const team = obj.team;
    if (team) standings[team] = obj;
  });
  return standings;
}
function getPicks(ss) {
  const sheet = ss.getSheetByName('Picks');
  if (!sheet) return [];
  const [headers, ...rows] = sheet.getDataRange().getValues();
  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = String(row[i] ?? ''));
    return obj;
  }).filter(r => r.round);
}
function getDraftPlans(ss) {
  const sheet = ss.getSheetByName('DraftPlans');
  if (!sheet || sheet.getLastRow() < 2) return {};
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const plans = {};
  rows.forEach(row => {
    const teamKey = String(row[0] || '').trim();
    const player  = String(row[1] || '').trim();
    const slotKey = String(row[2] || '').trim();
    if (!teamKey || !player || !slotKey) return;
    if (!plans[teamKey]) plans[teamKey] = {};
    plans[teamKey][player] = slotKey;
  });
  return plans;
}
function getStats(ss) {
  return _readStatsSheet(ss.getSheetByName('Stats'));
}
function getProjections(ss) {
  return _readStatsSheet(ss.getSheetByName('Projections'));
}
// Shared reader: keys by 'Player ID' / 'ID' / 'id' column when present, falls back to first column
function _readStatsSheet(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return {};
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const idCol = headers.indexOf('Player ID') >= 0 ? headers.indexOf('Player ID')
              : headers.indexOf('ID')        >= 0 ? headers.indexOf('ID')
              : headers.indexOf('id')        >= 0 ? headers.indexOf('id')
              : 0;
  const result = {};
  rows.forEach(row => {
    const key = String(row[idCol] ?? '').trim();
    if (!key) return;
    const obj = {};
    headers.forEach((h, i) => {
      const v = row[i];
      // Sheets auto-converts fraction-like values (e.g. "5/12" H/AB) to Date objects.
      // Convert them back to "M/D" format so they display correctly.
      obj[h] = v instanceof Date
        ? (v.getMonth() + 1) + '/' + v.getDate()
        : String(v ?? '');
    });
    result[key] = obj;
  });
  return result;
}
// ════════════════════════════════════════════════════════════════════════════
//  WRITERS
// ════════════════════════════════════════════════════════════════════════════
function setKeeper(ss, teamKey, player, keeperType, playerId) {
  const sheet   = ss.getSheetByName('Keepers');
  const data    = sheet.getDataRange().getValues();
  const headers = data[0] || [];
  const typeIdx = headers.indexOf('keeperType');
  for (let i = 1; i < data.length; i++) {
    const rowKey      = String(data[i][0]).trim();
    const rowPlayerId = String(data[i][2]).trim(); // col C = playerId in new schema
    const rowPlayer   = String(data[i][1]).trim();
    const match = rowKey === teamKey && (playerId ? rowPlayerId === playerId : rowPlayer === player);
    if (match) {
      sheet.getRange(i + 1, typeIdx >= 0 ? typeIdx + 1 : 4).setValue(keeperType);
      return;
    }
  }
  // New row: [teamKey, player, playerId, keeperType]
  sheet.appendRow([teamKey, player, playerId || '', keeperType]);
}
function removeKeeper(ss, teamKey, playerId, player) {
  const sheet = ss.getSheetByName('Keepers');
  const data  = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    const rowKey      = String(data[i][0]).trim();
    const rowPlayerId = String(data[i][2]).trim();
    const rowPlayer   = String(data[i][1]).trim();
    const idMatch     = playerId && rowPlayerId && rowPlayerId === playerId;
    const nameMatch   = rowPlayer === player;
    if (rowKey === teamKey && (idMatch || nameMatch)) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}
function editPlayerFields(ss, teamKey, playerId, fields) {
  const sheet   = ss.getSheetByName('Rosters');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data    = sheet.getDataRange().getValues();
  const teamCol = headers.indexOf('teamKey') >= 0 ? headers.indexOf('teamKey') : headers.indexOf('team');
  const idCol   = headers.indexOf('id');
  for (let i = 1; i < data.length; i++) {
    const rowKey = String(data[i][teamCol]).trim();
    const rowId  = idCol >= 0 ? String(data[i][idCol]).trim() : '';
    if (rowKey === teamKey && rowId === playerId) {
      Object.entries(fields).forEach(([field, value]) => {
        const col = headers.indexOf(field);
        if (col >= 0) sheet.getRange(i + 1, col + 1).setValue(value);
      });
      return;
    }
  }
}
function importRosters(ss, league) {
  // league is keyed by ownerKey (not teamName)
  const sheet = ss.getSheetByName('Rosters');
  const HEADERS = ['teamKey','player','mlb_team','position','status','salary','contract','id'];
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, HEADERS.length).clearContent();
  // Always rewrite header row so old 'team' column becomes 'teamKey'
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  const rows = [];
  Object.entries(league).forEach(([teamKey, players]) => {
    players.forEach(p => {
      rows.push([
        teamKey,
        p.player    || '',
        p.mlb_team  || '',
        p.position  || '',
        p.status    || '',
        p.salary    || '',
        p.contract  || '',
        p.id        || '',
      ]);
    });
  });
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  }
}
function importStandings(ss, standings) {
  const sheet = ss.getSheetByName('Standings');
  const HEADERS = ['team','W','L','pct','GB','RS','RA','streak'];
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, HEADERS.length).clearContent();
  const rows = Object.entries(standings).map(([team, s]) => [
    team,
    s.W  ?? '', s.L  ?? '', s.pct ?? '',
    s.GB ?? '', s.RS ?? '', s.RA  ?? '', s.streak ?? ''
  ]);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  }
}
function renameTeam(ss, oldName, newName, ownerKey) {
  // Update Settings (canonical source — Rosters/Keepers use ownerKey so no update needed there)
  const settingsSheet = ss.getSheetByName('Settings');
  const settingsData  = settingsSheet.getDataRange().getValues();
  for (let i = 1; i < settingsData.length; i++) {
    if (settingsData[i][0] === ownerKey) {
      settingsSheet.getRange(i + 1, 2).setValue(newName);
      break;
    }
  }
  // Update Standings (still uses teamName as display key)
  const standingsSheet = ss.getSheetByName('Standings');
  if (standingsSheet) {
    const standingsData = standingsSheet.getDataRange().getValues();
    for (let i = 1; i < standingsData.length; i++) {
      if (standingsData[i][0] === oldName) {
        standingsSheet.getRange(i + 1, 1).setValue(newName);
      }
    }
  }
}
function transferTeam(ss, oldKey, newKey) {
  if (!oldKey || !newKey || oldKey === newKey) return;

  // Sheets where column A (index 0) is the ownerKey
  ['Settings', 'Keepers', 'Rosters', 'DraftPlans', 'BuilderSlots'].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === oldKey) sheet.getRange(i + 1, 1).setValue(newKey);
    }
  });

  // Matchups: Home and Visitor columns each hold an ownerKey
  const matchupsSheet = ss.getSheetByName('Matchups');
  if (matchupsSheet && matchupsSheet.getLastRow() > 1) {
    const data    = matchupsSheet.getDataRange().getValues();
    const headers = data[0];
    const hi = headers.indexOf('Home');
    const vi = headers.indexOf('Visitor');
    for (let i = 1; i < data.length; i++) {
      if (hi >= 0 && String(data[i][hi]).trim() === oldKey) matchupsSheet.getRange(i + 1, hi + 1).setValue(newKey);
      if (vi >= 0 && String(data[i][vi]).trim() === oldKey) matchupsSheet.getRange(i + 1, vi + 1).setValue(newKey);
    }
  }

  // Divisions: teamKey column holds ownerKey
  const divisionsSheet = ss.getSheetByName('Divisions');
  if (divisionsSheet && divisionsSheet.getLastRow() > 1) {
    const data  = divisionsSheet.getDataRange().getValues();
    const tkIdx = data[0].indexOf('teamKey');
    if (tkIdx >= 0) {
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][tkIdx]).trim() === oldKey) divisionsSheet.getRange(i + 1, tkIdx + 1).setValue(newKey);
      }
    }
  }

  // Playoffs: team1, team2, winner, loser columns all hold ownerKeys
  const playoffsSheet = ss.getSheetByName('Playoffs');
  if (playoffsSheet && playoffsSheet.getLastRow() > 1) {
    const data    = playoffsSheet.getDataRange().getValues();
    const headers = data[0];
    const cols    = ['team1', 'team2', 'winner', 'loser'].map(h => headers.indexOf(h)).filter(i => i >= 0);
    for (let i = 1; i < data.length; i++) {
      cols.forEach(ci => {
        if (String(data[i][ci]).trim() === oldKey) playoffsSheet.getRange(i + 1, ci + 1).setValue(newKey);
      });
    }
  }

  // HistoricalStandings: teamKey column holds ownerKey
  const histSheet = ss.getSheetByName('HistoricalStandings');
  if (histSheet && histSheet.getLastRow() > 1) {
    const data  = histSheet.getDataRange().getValues();
    const tkIdx = data[0].indexOf('teamKey');
    if (tkIdx >= 0) {
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][tkIdx]).trim() === oldKey) histSheet.getRange(i + 1, tkIdx + 1).setValue(newKey);
      }
    }
  }
}
function setPick(ss, round, pick, team, player, salary, contract) {
  const sheet   = ss.getSheetByName('Picks');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data    = sheet.getDataRange().getValues();
  const key     = String(round) + '_' + String(pick);
  const numCols = Math.max(headers.length, 9);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(round) && String(data[i][1]) === String(pick)) {
      sheet.getRange(i + 1, 3).setValue(team);
      sheet.getRange(i + 1, 4).setValue(player || '');
      sheet.getRange(i + 1, 7).setValue(salary || '');
      sheet.getRange(i + 1, 8).setValue(contract || '');
      sheet.getRange(i + 1, 9).setValue(key);
      return;
    }
  }
  sheet.appendRow([round, pick, team, player || '', '', '', salary || '', contract || '', key]);
}
// ── Bulk-import pick order (round/pick/team slots, no player data) ────────────
function importPickOrder(ss, slots) {
  const sheet   = ss.getSheetByName('Picks') || ss.insertSheet('Picks');
  const HEADERS = ['round','pick','team','player','mlb_team','position','salary','contract','key'];
  // Build map of existing rows to preserve any player data already present
  const existing = {};
  const lastRow  = sheet.getLastRow();
  if (lastRow > 1) {
    const rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    rows.forEach((row, i) => {
      const k = String(row[0]) + '_' + String(row[1]);
      existing[k] = { rowIndex: i + 2, data: row };
    });
  }
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  slots.forEach(s => {
    const key = String(s.round) + '_' + String(s.pick);
    if (existing[key]) {
      // Update team column only; preserve player and other columns
      sheet.getRange(existing[key].rowIndex, 3).setValue(s.team || '');
    } else {
      sheet.appendRow([s.round, s.pick, s.team || '', '', '', '', '', '', key]);
    }
  });
}
// ── Bulk-import draft results (player picks with mlb_team/position) ───────────
function importDraftResults(ss, results) {
  const sheet   = ss.getSheetByName('Picks') || ss.insertSheet('Picks');
  const HEADERS = ['round','pick','team','player','mlb_team','position','salary','contract','key'];
  // Ensure header row has all columns
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  } else {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  // Build map of existing rows by round_pick key
  const existing = {};
  const lastRow  = sheet.getLastRow();
  if (lastRow > 1) {
    const rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    rows.forEach((row, i) => {
      const k = String(row[0]) + '_' + String(row[1]);
      existing[k] = i + 2;
    });
  }
  results.forEach(r => {
    const key = String(r.round) + '_' + String(r.pick);
    const row = [
      r.round, r.pick,
      r.manager || r.team || '',
      r.player  || '',
      r.mlb_team || '',
      r.position || '',
      r.salary   || '',
      r.contract || '',
      key,
    ];
    if (existing[key]) {
      sheet.getRange(existing[key], 1, 1, HEADERS.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
  });
}
// ── Trade: move players between teams ────────────────────────────────────────
function tradePlayers(ss, moves) {
  const sheet   = ss.getSheetByName('Rosters');
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const teamCol = (headers.indexOf('teamKey') >= 0 ? headers.indexOf('teamKey') : headers.indexOf('team')) + 1;
  const idCol   = headers.indexOf('id'); // 0-based
  moves.forEach(({ playerId, player, toTeamKey }) => {
    const idNorm   = String(playerId || '').trim();
    const nameNorm = String(player || '').trim();
    const dest     = String(toTeamKey).trim();
    for (let i = 1; i < data.length; i++) {
      const rowId = idCol >= 0 ? String(data[i][idCol]).trim() : '';
      const matched = idNorm ? rowId === idNorm : String(data[i][headers.indexOf('player')]).trim() === nameNorm;
      if (matched) {
        sheet.getRange(i + 1, teamCol).setValue(dest);
        data[i][teamCol - 1] = dest;
        Logger.log('tradePlayers: moved ' + (idNorm || nameNorm) + ' to ' + dest);
        break;
      }
    }
  });
}
// ── Rule 5 player move ───────────────────────────────────────────────────────
function r5MovePlayer(ss, playerId, player, fromTeamKey, toTeamKey, newStatus) {
  const sheet   = ss.getSheetByName('Rosters');
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const teamCol   = (headers.indexOf('teamKey') >= 0 ? headers.indexOf('teamKey') : headers.indexOf('team')) + 1;
  const playerCol = headers.indexOf('player') + 1;
  const statusCol = headers.indexOf('status') + 1;
  const idCol     = headers.indexOf('id'); // 0-based
  const idNorm    = String(playerId || '').trim();
  const nameNorm  = String(player  || '').trim();
  const destNorm  = String(toTeamKey || '').trim();
  for (let i = 1; i < data.length; i++) {
    const rowId     = idCol >= 0 ? String(data[i][idCol]).trim() : '';
    const rowPlayer = String(data[i][playerCol - 1]).trim();
    const matched   = idNorm ? rowId === idNorm : rowPlayer === nameNorm;
    if (matched) {
      sheet.getRange(i + 1, teamCol).setValue(destNorm);
      sheet.getRange(i + 1, statusCol).setValue(newStatus || 'Rule 5');
      Logger.log('r5MovePlayer: moved ' + (idNorm || nameNorm) + ' to ' + destNorm);
      return;
    }
  }
  Logger.log('r5MovePlayer ERROR: could not find player "' + (idNorm || nameNorm) + '" in Rosters sheet');
}
// ── Save draft plan to sheet ──────────────────────────────────────────────────
function saveDraftPlan(ss, teamKey, plan) {
  const sheet = ss.getSheetByName('DraftPlans') || ss.insertSheet('DraftPlans');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['teamKey', 'player', 'slotKey']);
    sheet.getRange(1, 1, 1, 3)
      .setFontWeight('bold')
      .setBackground('#0d1b2a')
      .setFontColor('#c9a84c');
  }
  // Remove existing rows for this team (iterate in reverse to preserve row indices)
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]).trim() === teamKey) sheet.deleteRow(i + 1);
  }
  // Write new plan rows
  const rows = Object.entries(plan || {}).map(([player, slotKey]) => [teamKey, player, slotKey]);
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
  }
}
// ── Save keeper builder slot overrides to sheet ───────────────────────────────
function saveBuilderPlan(ss, teamKey, plan) {
  const sheet = ss.getSheetByName('BuilderSlots') || ss.insertSheet('BuilderSlots');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['teamKey', 'player', 'slotId']);
    sheet.getRange(1, 1, 1, 3)
      .setFontWeight('bold')
      .setBackground('#0d1b2a')
      .setFontColor('#c9a84c');
  }
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]).trim() === teamKey) sheet.deleteRow(i + 1);
  }
  const rows = Object.entries(plan || {}).map(([player, slotId]) => [teamKey, player, slotId]);
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
  }
}
function getBuilderSlots(ss) {
  const sheet = ss.getSheetByName('BuilderSlots');
  if (!sheet || sheet.getLastRow() < 2) return {};
  const [, ...rows] = sheet.getDataRange().getValues();
  const slots = {};
  rows.forEach(row => {
    const teamKey = String(row[0] || '').trim();
    const player  = String(row[1] || '').trim();
    const slotId  = String(row[2] || '').trim();
    if (!teamKey || !player || !slotId) return;
    if (!slots[teamKey]) slots[teamKey] = {};
    slots[teamKey][player] = slotId;
  });
  return slots;
}
// ── Prospect Notes ────────────────────────────────────────────────────────────
function getProspectNotes(ss) {
  const sheet = ss.getSheetByName('ProspectNotes');
  if (!sheet || sheet.getLastRow() < 2) return {};
  const rows = sheet.getDataRange().getValues().slice(1);
  const result = {};
  rows.forEach(row => {
    const player = String(row[0] || '').trim();
    const json   = String(row[1] || '').trim();
    if (!player || !json) return;
    try { result[player] = JSON.parse(json); } catch(e) {}
  });
  return result;
}
function saveProspectNote(ss, player, overrides) {
  let sheet = ss.getSheetByName('ProspectNotes');
  if (!sheet) {
    sheet = ss.insertSheet('ProspectNotes');
    sheet.appendRow(['Player', 'Overrides', 'UpdatedAt']);
  }
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === player) {
      sheet.getRange(i + 1, 2).setValue(JSON.stringify(overrides));
      sheet.getRange(i + 1, 3).setValue(new Date().toISOString());
      return;
    }
  }
  sheet.appendRow([player, JSON.stringify(overrides), new Date().toISOString()]);
}

// ── Save stats to sheet ───────────────────────────────────────────────────────
function saveStats(ss, stats) {
  writeStatsSheet(ss.getSheetByName('Stats') || ss.insertSheet('Stats'), stats);
}
// ── Save projections to sheet ─────────────────────────────────────────────────
function saveProjections(ss, projections) {
  writeStatsSheet(ss.getSheetByName('Projections') || ss.insertSheet('Projections'), projections);
}
// ── Shared writer for stats/projections ──────────────────────────────────────
function writeStatsSheet(sheet, statsObj) {
  const entries = Object.entries(statsObj);
  if (!entries.length) return;

  // Augment each row to ensure the dict key (player ID) and player name are
  // always present as recoverable columns, regardless of what the source CSV
  // called them. This is what lets other users load stats correctly.
  const augmented = entries.map(([key, stat]) => {
    const row = Object.assign({}, stat);
    if (!row.hasOwnProperty('Player ID') && !row.hasOwnProperty('ID') && !row.hasOwnProperty('id')) {
      row.id = key;
    }
    if (!row.hasOwnProperty('Player') && !row.hasOwnProperty('player')) {
      row.player = key;
    }
    return row;
  });

  const allKeys = new Set();
  augmented.forEach(row => Object.keys(row).forEach(k => allKeys.add(k)));
  const headers = [...allKeys];
  const rows = augmented.map(row => headers.map(h => row[h] ?? ''));
  // Clear and rewrite
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold')
    .setBackground('#0d1b2a')
    .setFontColor('#c9a84c');
  if (rows.length > 0) {
    const dataRange = sheet.getRange(2, 1, rows.length, headers.length);
    // Force all cells to plain-text format before writing so Sheets doesn't
    // auto-convert fraction-like values (e.g. "5/12" H/AB) into dates.
    dataRange.setNumberFormat('@');
    dataRange.setValues(rows);
  }
}
// ════════════════════════════════════════════════════════════════════════════
//  ONE-TIME SETUP: Run this manually once to create all sheet tabs + headers
//  In Apps Script editor: select "setupSheets" from the dropdown and click Run
// ════════════════════════════════════════════════════════════════════════════
function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheets = {
    'Rosters':     ['teamKey','player','mlb_team','position','status','salary','contract','id'],
    'Keepers':     ['teamKey','player','playerId','keeperType'],
    'Settings':    ['ownerKey','teamName'],
    'Standings':   ['team','W','L','pct','GB','RS','RA','streak'],
    'Picks':       ['round','pick','team','player','mlb_team','position','salary','contract','key'],
    'Stats':       ['Player'],
    'Projections': ['Player'],
    'DraftPlans':  ['teamKey', 'player', 'slotKey'],
  };
  Object.entries(sheets).forEach(([name, headers]) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
    // Write headers only if the sheet is empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#0d1b2a')
        .setFontColor('#c9a84c');
    }
  });
  Logger.log('✓ All sheets created. Now run seedFromJSON() or paste your data.');
}
// ════════════════════════════════════════════════════════════════════════════
//  ONE-TIME SEED: Run seedOwnerMap() to populate the Settings sheet
//  with your OWNER_MAP. The roster data gets seeded from the HTML migration
//  tool (migrate.html) which POSTs to this endpoint.
// ════════════════════════════════════════════════════════════════════════════
function seedOwnerMap() {
  const OWNER_MAP = {
    'wetherholt': 'Wetherholt 45s',
    'brew':       'Brew Crew',
    'jardians':   'Cleveland Jardians',
    'danr':       'DAN R',
    'deferred':   'Deferred Victory',
    'domingo':    'Domingo Sherman',
    'merrilly':   'Merrilly We Roll Along',
    'holliday':   'Holliday Road',
    'ironfists':  'Iron Fists',
    'kiners':     'Kiners Korners',
    'kurtz':      'Kurtz Your Enthusiasm',
    'lovable':    'Lovable Losers',
    'gunnar':     'Never Gunnar Give You Up',
    'parker':     "Parker Meadows Can't Lose",
    'perdomo':    'Perdomo My Last Email',
    'reid':       'REID',
    'rally':      'Rally Happs',
    'platoon':    'The Great Platoon',
    'prayers':    'Thoughts & Prayers',
    'tortured':   'Tortured Owners Department',
  };
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Settings');
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 2).clearContent();
  const rows = Object.entries(OWNER_MAP).map(([k, v]) => [k, v]);
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  Logger.log('✓ Owner map seeded: ' + rows.length + ' teams.');
}

// ════════════════════════════════════════════════════════════════════════════
//  STANDINGS — DIVISIONS, HISTORICAL STANDINGS, PLAYOFFS
// ════════════════════════════════════════════════════════════════════════════

// ── Divisions sheet: columns → year | division | teamKey ─────────────────────
function getDivisions(ss) {
  const sheet = ss.getSheetByName('Divisions');
  if (!sheet || sheet.getLastRow() < 2) return {};
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const yearIdx = headers.indexOf('year');
  const divIdx  = headers.indexOf('division');
  const keyIdx  = headers.indexOf('teamKey');
  if (yearIdx < 0 || divIdx < 0 || keyIdx < 0) return {};
  const result = {};
  rows.forEach(row => {
    const year = String(row[yearIdx] || '').trim();
    const div  = String(row[divIdx]  || '').trim();
    const key  = String(row[keyIdx]  || '').trim();
    if (!year || !div || !key) return;
    if (!result[year]) result[year] = {};
    if (!result[year][div]) result[year][div] = [];
    result[year][div].push(key);
  });
  return result;
}

function saveDivisions(ss, year, divisions) {
  // divisions = { divisionName: [teamKey, ...] }
  let sheet = ss.getSheetByName('Divisions');
  if (!sheet) {
    sheet = ss.insertSheet('Divisions');
    sheet.getRange(1, 1, 1, 3).setValues([['year','division','teamKey']]);
  }
  // Remove existing rows for this year
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const yearIdx = headers.indexOf('year');
  // Collect rows to keep (not this year)
  const keepRows = data.slice(1).filter(r => String(r[yearIdx] || '').trim() !== String(year));
  // Build new rows for this year
  const newRows = [];
  Object.entries(divisions).forEach(([divName, keys]) => {
    keys.forEach(key => newRows.push([String(year), divName, key]));
  });
  const allRows = [...keepRows, ...newRows];
  // Rewrite sheet
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 3).setValues([['year','division','teamKey']]);
  if (allRows.length > 0) {
    sheet.getRange(2, 1, allRows.length, 3).setValues(allRows);
  }
  Logger.log('saveDivisions: wrote ' + newRows.length + ' rows for year ' + year);
}

// ── HistoricalStandings sheet: year | teamKey | W | L | RS | RA ──────────────
function getHistoricalStandings(ss) {
  const sheet = ss.getSheetByName('HistoricalStandings');
  if (!sheet || sheet.getLastRow() < 2) return {};
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const idx = h => headers.indexOf(h);
  const result = {};
  rows.forEach(row => {
    const year = String(row[idx('year')] || '').trim();
    const key  = String(row[idx('teamKey')] || '').trim();
    if (!year || !key) return;
    if (!result[year]) result[year] = {};
    result[year][key] = {
      W:  Number(row[idx('W')]  || 0),
      L:  Number(row[idx('L')]  || 0),
      RS: Number(row[idx('RS')] || 0),
      RA: Number(row[idx('RA')] || 0),
    };
  });
  return result;
}

function saveHistoricalStandings(ss, year, standings) {
  // standings = { teamKey: { W, L, RS, RA } }
  let sheet = ss.getSheetByName('HistoricalStandings');
  if (!sheet) {
    sheet = ss.insertSheet('HistoricalStandings');
    sheet.getRange(1, 1, 1, 6).setValues([['year','teamKey','W','L','RS','RA']]);
  }
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const yearIdx = headers.indexOf('year');
  const keepRows = data.slice(1).filter(r => String(r[yearIdx] || '').trim() !== String(year));
  const newRows = Object.entries(standings)
    .filter(([, rec]) => rec && rec.W !== null && rec.W !== undefined)
    .map(([key, rec]) => [String(year), key, rec.W || 0, rec.L || 0, rec.RS || 0, rec.RA || 0]);
  const allRows = [...keepRows, ...newRows];
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 6).setValues([['year','teamKey','W','L','RS','RA']]);
  if (allRows.length > 0) {
    sheet.getRange(2, 1, allRows.length, 6).setValues(allRows);
  }
  Logger.log('saveHistoricalStandings: wrote ' + newRows.length + ' rows for year ' + year);
}

// ── Playoffs sheet: year | matchupId | team1 | team2 | winner | loser ──────────
function getPlayoffsData(ss) {
  const sheet = ss.getSheetByName('Playoffs');
  if (!sheet || sheet.getLastRow() < 2) return {};
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const idx = h => headers.indexOf(h);
  const result = {};
  rows.forEach(row => {
    const year      = String(row[idx('year')]      || '').trim();
    const matchupId = String(row[idx('matchupId')] || '').trim();
    const team1     = String(row[idx('team1')]     || '').trim();
    const team2     = String(row[idx('team2')]     || '').trim();
    const winner    = String(row[idx('winner')]    || '').trim();
    const loser     = String(row[idx('loser')]     || '').trim();
    if (!year || !matchupId) return;
    if (!result[year]) result[year] = {};
    result[year][matchupId] = { team1, team2, winner, loser };
  });
  return result;
}

function savePlayoffs(ss, year, playoffs) {
  // playoffs = { matchupId: { team1, team2, winner, loser } }
  let sheet = ss.getSheetByName('Playoffs');
  if (!sheet) {
    sheet = ss.insertSheet('Playoffs');
    sheet.getRange(1, 1, 1, 6).setValues([['year','matchupId','team1','team2','winner','loser']]);
  }
  // Ensure header is correct (migrate old format)
  const firstRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (!firstRow.includes('matchupId')) {
    sheet.clearContents();
    sheet.getRange(1, 1, 1, 6).setValues([['year','matchupId','team1','team2','winner','loser']]);
  }
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const yearIdx = headers.indexOf('year');
  const keepRows = data.slice(1).filter(r => String(r[yearIdx] || '').trim() !== String(year));
  const newRows = Object.entries(playoffs || {}).map(([id, m]) => [
    String(year), id,
    m.team1 || '', m.team2 || '', m.winner || '', m.loser || ''
  ]);
  const allRows = [...keepRows, ...newRows];
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 6).setValues([['year','matchupId','team1','team2','winner','loser']]);
  if (allRows.length > 0) {
    sheet.getRange(2, 1, allRows.length, 6).setValues(allRows);
  }
  Logger.log('savePlayoffs: wrote ' + newRows.length + ' matchups for year ' + year);
}

// ── One-time setup: create Divisions, HistoricalStandings, and Playoffs sheets ─
// Run this once from the Apps Script editor to initialize the new sheets.
function setupStandingsSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  function ensureSheet(name, headers) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      Logger.log('Created sheet: ' + name);
    } else {
      Logger.log('Sheet already exists: ' + name);
    }
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    return sheet;
  }

  ensureSheet('Divisions',           ['year','division','teamKey']);
  ensureSheet('Playoffs',            ['year','matchupId','team1','team2','winner','loser']);

  // Seed 2026 division assignments
  const divSheet = ss.getSheetByName('Divisions');
  if (divSheet.getLastRow() < 2) {
    const seed2026 = [
      ['2026','Dairy Daddies','deferred'],
      ['2026','Dairy Daddies','holliday'],
      ['2026','Dairy Daddies','ironfists'],
      ['2026','Dairy Daddies','reid'],
      ['2026','Dairy Daddies','tortured'],
      ['2026','Thunder Chickens','wetherholt'],
      ['2026','Thunder Chickens','jardians'],
      ['2026','Thunder Chickens','domingo'],
      ['2026','Thunder Chickens','kurtz'],
      ['2026','Thunder Chickens','perdomo'],
      ['2026','Iron Pigs','brew'],
      ['2026','Iron Pigs','danr'],
      ['2026','Iron Pigs','lovable'],
      ['2026','Iron Pigs','gunnar'],
      ['2026','Iron Pigs','parker'],
      ['2026','Flying Mummies','merrilly'],
      ['2026','Flying Mummies','kiners'],
      ['2026','Flying Mummies','rally'],
      ['2026','Flying Mummies','platoon'],
      ['2026','Flying Mummies','prayers'],
    ];
    divSheet.getRange(2, 1, seed2026.length, 3).setValues(seed2026);
    Logger.log('Seeded 2026 division data: ' + seed2026.length + ' rows.');
  }

  Logger.log('✓ setupStandingsSheets complete.');
}
// ── Matchups ──────────────────────────────────────────────────────────────────

function getMatchups(ss) {
  const sheet = ss.getSheetByName('Matchups');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const wi  = headers.indexOf('Week');
  const hi  = headers.indexOf('Home');
  const vi  = headers.indexOf('Visitor');
  const ti  = headers.indexOf('Type');
  const hsi = headers.indexOf('HomeScore');
  const vsi = headers.indexOf('VisitorScore');
  return rows
    .filter(r => r[wi] !== '' && r[wi] != null)
    .map(r => ({
      week:         Number(r[wi]),
      home:         String(r[hi] || '').trim(),
      visitor:      String(r[vi] || '').trim(),
      type:         String(r[ti] || 'Regular Season').trim(),
      homeScore:    hsi >= 0 && r[hsi] !== '' && r[hsi] != null ? Number(r[hsi]) : null,
      visitorScore: vsi >= 0 && r[vsi] !== '' && r[vsi] != null ? Number(r[vsi]) : null,
    }));
}

// Run once from Apps Script editor to create and seed the Matchups sheet.
function setupMatchupsSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('Matchups');
  if (!sheet) {
    sheet = ss.insertSheet('Matchups');
    Logger.log('Created Matchups sheet.');
  }
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 6).setValues([['Week','Home','Visitor','Type','HomeScore','VisitorScore']]);

  const seed = [
      ['1','reid','prayers','Regular Season'],
      ['1','kurtz','perdomo','Regular Season'],
      ['1','ironfists','deferred','Regular Season'],
      ['1','danr','domingo','Regular Season'],
      ['1','rally','platoon','Regular Season'],
      ['1','parker','brew','Regular Season'],
      ['1','kiners','tortured','Regular Season'],
      ['1','gunnar','lovable','Regular Season'],
      ['1','holliday','merrilly','Regular Season'],
      ['1','wetherholt','jardians','Regular Season'],
      ['2','deferred','prayers','Regular Season'],
      ['2','domingo','perdomo','Regular Season'],
      ['2','holliday','reid','Regular Season'],
      ['2','wetherholt','kurtz','Regular Season'],
      ['2','ironfists','platoon','Regular Season'],
      ['2','danr','brew','Regular Season'],
      ['2','rally','tortured','Regular Season'],
      ['2','parker','lovable','Regular Season'],
      ['2','kiners','merrilly','Regular Season'],
      ['2','gunnar','jardians','Regular Season'],
      ['3','platoon','prayers','Regular Season'],
      ['3','brew','perdomo','Regular Season'],
      ['3','deferred','reid','Regular Season'],
      ['3','domingo','kurtz','Regular Season'],
      ['3','ironfists','tortured','Regular Season'],
      ['3','danr','lovable','Regular Season'],
      ['3','rally','merrilly','Regular Season'],
      ['3','parker','jardians','Regular Season'],
      ['3','holliday','kiners','Regular Season'],
      ['3','wetherholt','gunnar','Regular Season'],
      ['4','tortured','prayers','Regular Season'],
      ['4','lovable','perdomo','Regular Season'],
      ['4','platoon','reid','Regular Season'],
      ['4','brew','kurtz','Regular Season'],
      ['4','holliday','deferred','Regular Season'],
      ['4','wetherholt','domingo','Regular Season'],
      ['4','ironfists','merrilly','Regular Season'],
      ['4','danr','jardians','Regular Season'],
      ['4','rally','kiners','Regular Season'],
      ['4','parker','gunnar','Regular Season'],
      ['5','merrilly','prayers','Regular Season'],
      ['5','jardians','perdomo','Regular Season'],
      ['5','tortured','reid','Regular Season'],
      ['5','lovable','kurtz','Regular Season'],
      ['5','platoon','deferred','Regular Season'],
      ['5','brew','domingo','Regular Season'],
      ['5','ironfists','kiners','Regular Season'],
      ['5','danr','gunnar','Regular Season'],
      ['5','holliday','rally','Regular Season'],
      ['5','wetherholt','parker','Regular Season'],
      ['6','kiners','prayers','Regular Season'],
      ['6','gunnar','perdomo','Regular Season'],
      ['6','merrilly','reid','Regular Season'],
      ['6','jardians','kurtz','Regular Season'],
      ['6','tortured','deferred','Regular Season'],
      ['6','lovable','domingo','Regular Season'],
      ['6','holliday','platoon','Regular Season'],
      ['6','wetherholt','brew','Regular Season'],
      ['6','ironfists','rally','Regular Season'],
      ['6','danr','parker','Regular Season'],
      ['7','rally','prayers','Regular Season'],
      ['7','parker','perdomo','Regular Season'],
      ['7','kiners','reid','Regular Season'],
      ['7','gunnar','kurtz','Regular Season'],
      ['7','merrilly','deferred','Regular Season'],
      ['7','jardians','domingo','Regular Season'],
      ['7','tortured','platoon','Regular Season'],
      ['7','lovable','brew','Regular Season'],
      ['7','holliday','ironfists','Regular Season'],
      ['7','wetherholt','danr','Regular Season'],
      ['8','ironfists','prayers','Regular Season'],
      ['8','danr','perdomo','Regular Season'],
      ['8','rally','reid','Regular Season'],
      ['8','parker','kurtz','Regular Season'],
      ['8','kiners','deferred','Regular Season'],
      ['8','gunnar','domingo','Regular Season'],
      ['8','merrilly','platoon','Regular Season'],
      ['8','jardians','brew','Regular Season'],
      ['8','holliday','tortured','Regular Season'],
      ['8','wetherholt','lovable','Regular Season'],
      ['9','holliday','prayers','Regular Season'],
      ['9','wetherholt','perdomo','Regular Season'],
      ['9','ironfists','reid','Regular Season'],
      ['9','danr','kurtz','Regular Season'],
      ['9','rally','deferred','Regular Season'],
      ['9','parker','domingo','Regular Season'],
      ['9','kiners','platoon','Regular Season'],
      ['9','gunnar','brew','Regular Season'],
      ['9','merrilly','tortured','Regular Season'],
      ['9','jardians','lovable','Regular Season'],
      ['10','holliday','jardians','Regular Season'],
      ['10','danr','prayers','Regular Season'],
      ['10','tortured','domingo','Regular Season'],
      ['10','brew','platoon','Regular Season'],
      ['10','ironfists','kurtz','Regular Season'],
      ['10','gunnar','rally','Regular Season'],
      ['10','wetherholt','reid','Regular Season'],
      ['10','parker','merrilly','Regular Season'],
      ['10','deferred','perdomo','Regular Season'],
      ['10','lovable','kiners','Regular Season'],
      ['11','merrilly','kiners','Regular Season'],
      ['11','lovable','deferred','Regular Season'],
      ['11','kurtz','wetherholt','Regular Season'],
      ['11','holliday','brew','Regular Season'],
      ['11','domingo','rally','Regular Season'],
      ['11','gunnar','tortured','Regular Season'],
      ['11','perdomo','jardians','Regular Season'],
      ['11','ironfists','reid','Regular Season'],
      ['11','platoon','prayers','Regular Season'],
      ['11','parker','danr','Regular Season'],
      ['12','wetherholt','kiners','Regular Season'],
      ['12','brew','deferred','Regular Season'],
      ['12','platoon','merrilly','Regular Season'],
      ['12','parker','lovable','Regular Season'],
      ['12','kurtz','rally','Regular Season'],
      ['12','holliday','tortured','Regular Season'],
      ['12','domingo','jardians','Regular Season'],
      ['12','gunnar','reid','Regular Season'],
      ['12','perdomo','prayers','Regular Season'],
      ['12','ironfists','danr','Regular Season'],
      ['13','rally','kiners','Regular Season'],
      ['13','tortured','deferred','Regular Season'],
      ['13','wetherholt','merrilly','Regular Season'],
      ['13','brew','lovable','Regular Season'],
      ['13','kurtz','jardians','Regular Season'],
      ['13','holliday','reid','Regular Season'],
      ['13','domingo','prayers','Regular Season'],
      ['13','gunnar','danr','Regular Season'],
      ['13','platoon','perdomo','Regular Season'],
      ['13','parker','ironfists','Regular Season'],
      ['14','jardians','kiners','Regular Season'],
      ['14','reid','deferred','Regular Season'],
      ['14','rally','merrilly','Regular Season'],
      ['14','tortured','lovable','Regular Season'],
      ['14','platoon','wetherholt','Regular Season'],
      ['14','parker','brew','Regular Season'],
      ['14','kurtz','prayers','Regular Season'],
      ['14','holliday','danr','Regular Season'],
      ['14','domingo','perdomo','Regular Season'],
      ['14','gunnar','ironfists','Regular Season'],
      ['15','prayers','kiners','Regular Season'],
      ['15','danr','deferred','Regular Season'],
      ['15','jardians','merrilly','Regular Season'],
      ['15','reid','lovable','Regular Season'],
      ['15','rally','wetherholt','Regular Season'],
      ['15','tortured','brew','Regular Season'],
      ['15','kurtz','perdomo','Regular Season'],
      ['15','holliday','ironfists','Regular Season'],
      ['15','platoon','domingo','Regular Season'],
      ['15','parker','gunnar','Regular Season'],
      ['16','perdomo','kiners','Regular Season'],
      ['16','ironfists','deferred','Regular Season'],
      ['16','prayers','merrilly','Regular Season'],
      ['16','danr','lovable','Regular Season'],
      ['16','jardians','wetherholt','Regular Season'],
      ['16','reid','brew','Regular Season'],
      ['16','platoon','rally','Regular Season'],
      ['16','parker','tortured','Regular Season'],
      ['16','kurtz','domingo','Regular Season'],
      ['16','holliday','gunnar','Regular Season'],
      ['17','domingo','kiners','Regular Season'],
      ['17','gunnar','deferred','Regular Season'],
      ['17','perdomo','merrilly','Regular Season'],
      ['17','ironfists','lovable','Regular Season'],
      ['17','prayers','wetherholt','Regular Season'],
      ['17','danr','brew','Regular Season'],
      ['17','jardians','rally','Regular Season'],
      ['17','reid','tortured','Regular Season'],
      ['17','platoon','kurtz','Regular Season'],
      ['17','parker','holliday','Regular Season'],
      ['18','kurtz','kiners','Regular Season'],
      ['18','holliday','deferred','Regular Season'],
      ['18','domingo','merrilly','Regular Season'],
      ['18','gunnar','lovable','Regular Season'],
      ['18','perdomo','wetherholt','Regular Season'],
      ['18','ironfists','brew','Regular Season'],
      ['18','prayers','rally','Regular Season'],
      ['18','danr','tortured','Regular Season'],
      ['18','platoon','jardians','Regular Season'],
      ['18','parker','reid','Regular Season'],
      ['19','platoon','kiners','Regular Season'],
      ['19','parker','deferred','Regular Season'],
      ['19','kurtz','merrilly','Regular Season'],
      ['19','holliday','lovable','Regular Season'],
      ['19','domingo','wetherholt','Regular Season'],
      ['19','gunnar','brew','Regular Season'],
      ['19','perdomo','rally','Regular Season'],
      ['19','ironfists','tortured','Regular Season'],
      ['19','prayers','jardians','Regular Season'],
      ['19','danr','reid','Regular Season'],
  ];
  sheet.getRange(2, 1, seed.length, 4).setValues(seed);
  Logger.log('Seeded ' + seed.length + ' matchup rows into Matchups sheet.');
}

// ════════════════════════════════════════════════════════════════════════════
//  FANTRAX API INTEGRATION
//  Before use, set Script Properties (Project Settings → Script Properties):
//    FANTRAX_LEAGUE_ID  → your Fantrax league ID (from the URL)
//    FANTRAX_COOKIE     → full Cookie header value copied from browser DevTools
//                         (open Fantrax, F12 → Network → any request → copy Cookie header)
// ════════════════════════════════════════════════════════════════════════════

const FANTRAX_BASE  = 'https://www.fantrax.com/fxea/general/';
const FANTRAX_SPORT = 'MLB';

// Fantrax team names that differ from our ownerMap values → ownerKey
const FANTRAX_TEAM_ALIASES = {
  'tortured owners dept':   'tortured',
  "kiner's korner":         'kiners',
  'iron_fists':             'ironfists',
  'domingo shermán':        'domingo',
  't&p':                    'prayers',
  'dan rochat':             'danr',
};

function getFantraxProps() {
  const props = PropertiesService.getScriptProperties();
  return {
    leagueId: props.getProperty('FANTRAX_LEAGUE_ID') || '',
    cookie:   props.getProperty('FANTRAX_COOKIE')    || '',
  };
}

function isFantraxConfigured() {
  const { leagueId, cookie } = getFantraxProps();
  return !!(leagueId && cookie);
}

// ── Core HTTP helper ──────────────────────────────────────────────────────────
function fetchFantrax(endpoint, params) {
  const { leagueId, cookie } = getFantraxProps();
  if (!leagueId || !cookie) throw new Error('Fantrax credentials not configured. Set FANTRAX_LEAGUE_ID and FANTRAX_COOKIE in Script Properties.');

  const qp = Object.assign({ leagueId, sport: FANTRAX_SPORT }, params || {});
  const qs = Object.entries(qp).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  const url = FANTRAX_BASE + endpoint + '?' + qs;

  const response = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: {
      'Cookie': cookie,
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; GoogleAppsScript)',
    },
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  if (code !== 200) throw new Error('Fantrax API returned HTTP ' + code + ' for ' + endpoint);

  try {
    return JSON.parse(response.getContentText());
  } catch(e) {
    throw new Error('Fantrax API returned non-JSON for ' + endpoint + ': ' + response.getContentText().substring(0, 200));
  }
}

// ── Test connection ───────────────────────────────────────────────────────────
function testFantraxConnection() {
  try {
    const data = fetchFantrax('getLeagueInfo');
    Logger.log('Fantrax connection OK: ' + JSON.stringify(data).substring(0, 500));
    return { ok: true, message: 'Connected', preview: JSON.stringify(data).substring(0, 500) };
  } catch(e) {
    Logger.log('Fantrax connection FAILED: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ── Refresh dispatcher ────────────────────────────────────────────────────────
// Each target is independently try-caught so one failure never blocks others.
// 'rosters' only syncs Fantrax rosters — MiLB cache and YTD stats are separate
// targets so the caller can choose what to run and avoid GAS 6-min timeout.
function refreshFantrax(ss, targets) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);
  const results = {};
  if (targets.includes('standings')) {
    try { results.standings = refreshFantraxStandings(ss); }
    catch(e) { results.standings = { ok: false, error: e.message }; }
  }
  if (targets.includes('rosters')) {
    try { results.rosters = refreshFantraxRosters(ss); }
    catch(e) { results.rosters = { ok: false, error: e.message }; }
  }
  if (targets.includes('milb')) {
    try {
      const mlb = refreshMLBCareerCache();
      results.milbCache = { ok: true, message: mlb.eligible + ' MiLB-eligible, ' + mlb.rosterUpdated + ' labeled' };
    } catch(e) { results.milbCache = { ok: false, error: e.message }; }
  }
  if (targets.includes('ytdStats')) {
    try {
      const ytd = refreshMLBYTDStats(ss);
      results.ytdStats = { ok: true, message: ytd.total + ' player stats updated (' + ytd.season + ' YTD)' };
    } catch(e) { results.ytdStats = { ok: false, error: e.message }; }
  }
  if (targets.includes('draft')) {
    try { results.draft = refreshFantraxDraft(ss); }
    catch(e) { results.draft = { ok: false, error: e.message }; }
  }
  if (targets.includes('draftPicks')) {
    try { results.draftPicks = refreshFantraxDraftPicks(ss); }
    catch(e) { results.draftPicks = { ok: false, error: e.message }; }
  }
  if (targets.includes('matchups')) {
    try { results.matchups = refreshFantraxMatchups(ss); }
    catch(e) { results.matchups = { ok: false, error: e.message }; }
  }
  return { ok: true, results };
}

// ── MLB Career Stats Cache ────────────────────────────────────────────────────
// Sheet "MLBCareerCache": fantraxId | playerName | mlbId | careerAB | careerIP | eligible | lastUpdated
function getMLBCareerCache(ss) {
  const sheet = ss.getSheetByName('MLBCareerCache');
  if (!sheet || sheet.getLastRow() < 2) return {};
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const ci = h => headers.indexOf(h);
  const cache = {};
  rows.forEach(r => {
    const fid = String(r[ci('fantraxId')] || '').trim();
    if (!fid) return;
    cache[fid] = {
      playerName: String(r[ci('playerName')] || ''),
      mlbId:      String(r[ci('mlbId')]      || '').trim(),
      careerAB:   Number(r[ci('careerAB')]   || 0),
      careerIP:   parseFloat(r[ci('careerIP')] || '0'),
      eligible:   r[ci('eligible')] === true || String(r[ci('eligible')]).toUpperCase() === 'TRUE',
    };
  });
  return cache;
}

// Returns lightweight { fantraxId: mlbId } map for frontend headshot lookups
function getMlbIdMap(ss) {
  const sheet = ss.getSheetByName('MLBCareerCache');
  if (!sheet || sheet.getLastRow() < 2) return {};
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const fidIdx = headers.indexOf('fantraxId');
  const midIdx = headers.indexOf('mlbId');
  if (fidIdx < 0 || midIdx < 0) return {};
  const map = {};
  rows.forEach(r => {
    const fid   = String(r[fidIdx] || '').trim();
    const mlbId = String(r[midIdx] || '').trim();
    if (fid && mlbId) map[fid] = mlbId;
  });
  return map;
}

function upsertMLBCareerCache(ss, entries) {
  const HDR = ['fantraxId','playerName','mlbId','careerAB','careerIP','eligible','lastUpdated'];
  let sheet = ss.getSheetByName('MLBCareerCache');
  if (!sheet) {
    sheet = ss.insertSheet('MLBCareerCache');
    sheet.getRange(1, 1, 1, HDR.length).setValues([HDR])
         .setFontWeight('bold').setBackground('#0d1b2a').setFontColor('#c9a84c');
  }
  const today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');

  // Read existing data rows (skip header) — one API read
  const lastRow = sheet.getLastRow();
  let existingRows = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, HDR.length).getValues()
    : [];
  const rowLookup = {}; // fantraxId → index in existingRows
  existingRows.forEach((r, i) => {
    const fid = String(r[0] || '').trim();
    if (fid) rowLookup[fid] = i;
  });

  // Merge: update existingRows in-place OR collect as new rows
  const newRows = [];
  entries.forEach(e => {
    const vals = [e.fantraxId, e.playerName, e.mlbId, e.careerAB, e.careerIP, e.eligible, today];
    if (rowLookup[e.fantraxId] !== undefined) {
      existingRows[rowLookup[e.fantraxId]] = vals;
    } else {
      newRows.push(vals);
    }
  });

  // Batch-write all updates in one API call
  if (existingRows.length > 0) {
    sheet.getRange(2, 1, existingRows.length, HDR.length).setValues(existingRows);
  }
  // Batch-append all new rows in one API call
  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, HDR.length).setValues(newRows);
  }
}

// Search MLB Stats API for a player's numeric id by full name.
// Uses mlbTeamAbbr (e.g. "SF") to disambiguate when multiple results return.
function searchMLBPlayerId(name, mlbTeamAbbr) {
  try {
    const url = MLB_STATS_API + '/people/search?names=' + encodeURIComponent(name) +
                '&sportIds=1,11,12,13,14,15,16';
    const resp = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
    const people = resp.people || [];
    if (!people.length) return null;
    if (people.length === 1) return String(people[0].id);
    if (mlbTeamAbbr) {
      const match = people.find(p =>
        p.currentTeam && String(p.currentTeam.abbreviation || '').toUpperCase() === mlbTeamAbbr.toUpperCase()
      );
      if (match) return String(match.id);
    }
    return String(people[0].id);
  } catch(e) {
    Logger.log('searchMLBPlayerId("' + name + '"): ' + e.message);
    return null;
  }
}

// Batch-fetch career MLB stats for up to 150 MLB person IDs per call.
// Returns: { mlbId: { careerAB, careerIP } }
function batchFetchMLBCareerStats(mlbIds) {
  const result = {};
  if (!mlbIds || !mlbIds.length) return result;
  for (let i = 0; i < mlbIds.length; i += 150) {
    const chunk = mlbIds.slice(i, i + 150);
    try {
      const url = MLB_STATS_API + '/people?personIds=' + chunk.join(',') +
                  '&hydrate=stats(group=[hitting,pitching],type=career,sportId=1)';
      const resp = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
      (resp.people || []).forEach(person => {
        let careerAB = 0, careerIP = 0;
        (person.stats || []).forEach(s => {
          const split = s.splits && s.splits[0];
          if (!split) return;
          if (s.group && s.group.displayName === 'hitting')  careerAB = split.stat.atBats || 0;
          if (s.group && s.group.displayName === 'pitching') careerIP = parseFloat(split.stat.inningsPitched || '0');
        });
        result[String(person.id)] = { careerAB, careerIP };
      });
    } catch(e) {
      Logger.log('batchFetchMLBCareerStats chunk[' + i + ']: ' + e.message);
    }
  }
  return result;
}

// ── Daily 3am stats trigger ───────────────────────────────────────────────────
// Called automatically by the time-based trigger set up via setupDailyStatsTrigger().
function dailyStatsRefresh() {
  try {
    const result = refreshMLBYTDStats();
    Logger.log('dailyStatsRefresh: ' + JSON.stringify(result));
  } catch(e) {
    Logger.log('dailyStatsRefresh error: ' + e.message);
  }
}

// Run this ONCE from the Script Editor to install the 3am daily trigger.
// It removes any existing dailyStatsRefresh triggers first to prevent duplicates.
function setupDailyStatsTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyStatsRefresh')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyStatsRefresh')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .create();
  Logger.log('✓ Daily stats trigger installed — runs at 3am every day');
}

// ── Refresh YTD stats from MLB Stats API ─────────────────────────────────────
// Fetches current-season hitting + pitching stats for all players with a known
// MLB ID (from MLBCareerCache) and writes them to the Stats sheet.
// Column names match what index.html expects: H, AB, R, HR, RBI, SB, OBP for
// hitters; IP, K, K9, QA, SVH, ERA, WHIP for pitchers.
function refreshMLBYTDStats(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);
  const cache = getMLBCareerCache(ss);

  // Build mlbId → fantraxId reverse map
  const mlbToFid = {}, fidToName = {};
  Object.entries(cache).forEach(([fid, d]) => {
    if (d.mlbId) { mlbToFid[d.mlbId] = fid; fidToName[fid] = d.playerName; }
  });
  const mlbIds = Object.keys(mlbToFid);
  if (!mlbIds.length) return { ok: true, total: 0, message: 'Run career stats refresh first to populate MLB IDs' };

  const season = new Date().getFullYear();
  const statsMap = {};

  for (let i = 0; i < mlbIds.length; i += 150) {
    const chunk = mlbIds.slice(i, i + 150);
    try {
      const url = MLB_STATS_API + '/people?personIds=' + chunk.join(',') +
                  '&hydrate=stats(group=[hitting,pitching],type=season,season=' + season + ')';
      const resp = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
      (resp.people || []).forEach(person => {
        const fid = mlbToFid[String(person.id)];
        if (!fid) return;
        const row = { 'Player ID': fid, 'Player': fidToName[fid] || fid };
        (person.stats || []).forEach(s => {
          const split = s.splits && s.splits[0];
          if (!split) return;
          const st  = split.stat;
          const grp = s.group && s.group.displayName;
          if (grp === 'hitting') {
            row['H']   = st.hits        ?? 0;
            row['AB']  = st.atBats      ?? 0;
            row['R']   = st.runs        ?? 0;
            row['HR']  = st.homeRuns    ?? 0;
            row['RBI'] = st.rbi         ?? 0;
            row['SB']  = st.stolenBases ?? 0;
            row['OBP'] = st.obp         || '.000';
          }
          if (grp === 'pitching') {
            const ip = parseFloat(st.inningsPitched || '0');
            const k  = st.strikeOuts ?? 0;
            row['IP']   = st.inningsPitched || '0.0';
            row['W']    = st.wins           ?? 0;
            row['L']    = st.losses         ?? 0;
            row['ERA']  = st.era            || '0.00';
            row['WHIP'] = st.whip           || '0.00';
            row['K']    = k;
            row['K9']   = ip > 0 ? (k / ip * 9).toFixed(1) : '0.0';
            row['QA']   = st.qualityStarts  ?? 0;
            row['SVH']  = (st.saves ?? 0) + (st.holds ?? 0);
          }
        });
        if (Object.keys(row).length > 2) statsMap[fid] = row;
      });
    } catch(e) {
      Logger.log('refreshMLBYTDStats chunk[' + i + ']: ' + e.message);
    }
  }

  saveStats(ss, statsMap);
  Logger.log('refreshMLBYTDStats: ' + Object.keys(statsMap).length + ' players, season ' + season);
  return { ok: true, total: Object.keys(statsMap).length, season: season };
}

// ── Refresh MLB career stats cache ────────────────────────────────────────────
// Run from Commissioner panel or Script Editor. Two phases:
//   Phase 1 (slow, first run only): name-searches statsapi.mlb.com for each player's MLB id.
//   Phase 2 (fast on every run): batch-fetches career AB/IP for all known MLB ids.
// Writes results to the "MLBCareerCache" sheet. Used by refreshFantraxRosters to
// auto-set status=Minors for any ACTIVE/RESERVE player with career AB<130 and IP<50.
function refreshMLBCareerCache() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // 1. Build fantraxId → { name, team } from the local Rosters sheet
  //    (avoids an expensive Fantrax getPlayerIds API call — we already have this data)
  const fantraxInfo = {};
  const rosterSheetR = ss.getSheetByName('Rosters');
  if (rosterSheetR) {
    const [rHdrs, ...rRows] = rosterSheetR.getDataRange().getValues();
    const rIdIdx   = rHdrs.indexOf('id');
    const rNameIdx = rHdrs.indexOf('player');
    const rTeamIdx = rHdrs.indexOf('mlb_team');
    rRows.forEach(r => {
      const fid  = String(r[rIdIdx] || '').trim().replace(/\*/g, '');
      const name = String(r[rNameIdx] || '').trim();
      const team = String(r[rTeamIdx] || '').trim();
      if (fid && name) fantraxInfo[fid] = { name, team };
    });
  }

  // 2. Collect ALL rostered players (including MINORS slot) — eligibility is
  //    determined by career AB/IP, not by which Fantrax slot they currently occupy
  const rosters = fetchFantrax('getTeamRosters');
  const activePids = [];
  Object.values(rosters.rosters || {}).forEach(td => {
    (td.rosterItems || []).forEach(item => {
      const pid = String(item.id || '').trim();
      if (pid) activePids.push(pid);
    });
  });
  const uniquePids = [...new Set(activePids)];
  Logger.log('Rostered players (all slots): ' + uniquePids.length);

  // 3. Load existing cache to reuse already-found MLB ids (avoids re-searching)
  const cache = getMLBCareerCache(ss);
  const fidToMlbId = {};
  uniquePids.forEach(fid => { if (cache[fid] && cache[fid].mlbId) fidToMlbId[fid] = cache[fid].mlbId; });

  // 4. Name-search for players not yet in cache
  const needSearch = uniquePids.filter(fid => !fidToMlbId[fid]);
  Logger.log('Phase 1: searching MLB IDs for ' + needSearch.length + ' new players (' +
             (uniquePids.length - needSearch.length) + ' cached)...');
  needSearch.forEach((fid, idx) => {
    const info = fantraxInfo[fid];
    if (!info) return;
    const mlbId = searchMLBPlayerId(info.name, info.team);
    if (mlbId) fidToMlbId[fid] = mlbId;
    else Logger.log('  No MLB ID: ' + info.name + ' (' + fid + ')');
    if ((idx + 1) % 50 === 0) Utilities.sleep(500); // gentle rate-limit every 50 searches
  });

  // 5. Batch-fetch career stats for all known MLB ids
  const mlbIdList = [...new Set(Object.values(fidToMlbId))].filter(Boolean);
  Logger.log('Phase 2: fetching career stats for ' + mlbIdList.length + ' players...');
  const statsMap = batchFetchMLBCareerStats(mlbIdList);

  // 6. Build and write cache entries
  const entries = uniquePids.map(fid => {
    const mlbId    = fidToMlbId[fid] || '';
    const s        = mlbId ? (statsMap[mlbId] || {}) : {};
    const info     = fantraxInfo[fid] || {};
    const careerAB = s.careerAB !== undefined ? s.careerAB : (cache[fid] ? cache[fid].careerAB : 0);
    const careerIP = s.careerIP !== undefined ? s.careerIP : (cache[fid] ? cache[fid].careerIP : 0);
    const eligible = !mlbId || (careerAB < MILB_AB_MAX && careerIP < MILB_IP_MAX);
    return { fantraxId: fid, playerName: info.name || fid, mlbId, careerAB, careerIP, eligible };
  });

  upsertMLBCareerCache(ss, entries);

  // 7. Apply MiLB labels directly to the Rosters sheet.
  //    Only sets status → 'Minors' for eligible players; all other statuses untouched.
  const eligibleSet = new Set(entries.filter(e => e.eligible).map(e => e.fantraxId));
  const rSheet = rosterSheetR; // already read above
  let rosterUpdated = 0;
  if (rSheet) {
    const [rHdrs, ...rRows] = rSheet.getDataRange().getValues();
    const rIdIdx = rHdrs.indexOf('id');
    const rStIdx = rHdrs.indexOf('status');
    if (rIdIdx >= 0 && rStIdx >= 0) {
      // Build full status column, updating only eligible players
      const newStatuses = rRows.map(r => {
        const fid = String(r[rIdIdx] || '').trim().replace(/\*/g, '');
        if (eligibleSet.has(fid)) {
          if (String(r[rStIdx] || '') !== 'Minors') rosterUpdated++;
          return ['Minors'];
        }
        return [r[rStIdx]]; // unchanged
      });
      rSheet.getRange(2, rStIdx + 1, newStatuses.length, 1).setValues(newStatuses);
    }
  }

  const eligible = entries.filter(e => e.eligible).length;
  const noId     = entries.filter(e => !e.mlbId).length;
  Logger.log('MLBCareerCache done: ' + entries.length + ' players, ' + eligible + ' MiLB-eligible, ' +
             rosterUpdated + ' newly labeled in Rosters sheet, ' + noId + ' no MLB ID.');
  return { ok: true, total: entries.length, eligible, rosterUpdated, noMlbId: noId };
}

// ── Full refresh for one team: roster sync + MiLB eligibility ────────────────
// Called from the GM's roster page. Runs roster sync first (so the sheet has
// the latest Fantrax data) then MiLB refresh (so eligibility reflects that).
function refreshTeamFull(teamKey) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let rosterResult, milbResult, ytdResult;
  try { rosterResult = refreshFantraxRosters(ss, teamKey); }
  catch(e) { rosterResult = { ok: false, error: e.message }; }
  try { milbResult = refreshMLBCareerCacheForTeam(teamKey); }
  catch(e) { milbResult = { ok: false, error: e.message }; }
  try { ytdResult = refreshMLBYTDStats(ss); }
  catch(e) { ytdResult = { ok: false, error: e.message }; }
  return {
    ok:      rosterResult.ok !== false,
    roster:  rosterResult,
    milb:    milbResult,
    ytd:     ytdResult,
    updated: (milbResult.updated || 0),
  };
}

// ── Refresh MLB career cache for one team only ────────────────────────────────
// Called from the GM's own roster page. Looks up career stats for the team's
// non-MiLB players, updates MLBCareerCache, and writes 'Minors' to the Rosters
// sheet for any player who qualifies (career AB < 130 AND IP < 50).
function refreshMLBCareerCacheForTeam(teamKey) {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // 1. Pull ALL of the team's players from the Rosters sheet — eligibility is
  //    determined by career AB/IP regardless of current slot or status label
  const sheet = ss.getSheetByName('Rosters');
  if (!sheet) return { ok: false, error: 'Rosters sheet not found' };
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const idIdx     = headers.indexOf('id');
  const teamIdx2  = headers.indexOf('teamKey');
  const statusIdx = headers.indexOf('status');
  const nameIdx   = headers.indexOf('player');
  const mlbTIdx   = headers.indexOf('mlb_team');

  const teamPlayers = [];
  rows.forEach((r, i) => {
    if (String(r[teamIdx2] || '').trim() !== teamKey) return;
    const pid  = String(r[idIdx] || '').trim().replace(/\*/g, '');
    const name = String(r[nameIdx] || '').trim();
    if (pid && name) teamPlayers.push({ pid, name, mlbTeam: String(r[mlbTIdx] || '').trim(), rowIdx: i });
  });
  if (!teamPlayers.length) return { ok: true, total: 0, eligible: 0, updated: 0 };

  // 2. Load cache; carry forward known MLB ids
  const cache = getMLBCareerCache(ss);
  const fidToMlbId = {};
  teamPlayers.forEach(({ pid }) => { if (cache[pid] && cache[pid].mlbId) fidToMlbId[pid] = cache[pid].mlbId; });

  // 3. Name-search for players not in cache
  const needSearch = teamPlayers.filter(({ pid }) => !fidToMlbId[pid]);
  needSearch.forEach(({ pid, name, mlbTeam }, idx) => {
    const mlbId = searchMLBPlayerId(name, mlbTeam);
    if (mlbId) fidToMlbId[pid] = mlbId;
    if ((idx + 1) % 10 === 0) Utilities.sleep(200);
  });

  // 4. Batch-fetch career stats
  const mlbIdList = [...new Set(Object.values(fidToMlbId))].filter(Boolean);
  const statsMap  = batchFetchMLBCareerStats(mlbIdList);

  // 5. Build entries, write eligible players to Rosters sheet, update cache
  const entries = [];
  let updated = 0;
  teamPlayers.forEach(({ pid, name, rowIdx }) => {
    const mlbId    = fidToMlbId[pid] || '';
    const s        = mlbId ? (statsMap[mlbId] || {}) : {};
    const careerAB = s.careerAB !== undefined ? s.careerAB : (cache[pid] ? cache[pid].careerAB : 0);
    const careerIP = s.careerIP !== undefined ? s.careerIP : (cache[pid] ? cache[pid].careerIP : 0);
    const eligible = !mlbId || (careerAB < MILB_AB_MAX && careerIP < MILB_IP_MAX);
    entries.push({ fantraxId: pid, playerName: name, mlbId, careerAB, careerIP, eligible });
    if (eligible && statusIdx >= 0) {
      sheet.getRange(rowIdx + 2, statusIdx + 1).setValue('Minors');
      updated++;
    }
  });
  upsertMLBCareerCache(ss, entries);

  const eligible = entries.filter(e => e.eligible).length;
  return { ok: true, total: entries.length, eligible, updated, noMlbId: entries.filter(e => !e.mlbId).length };
}

// ── Refresh matchup scores ────────────────────────────────────────────────────
// Uses getLeagueInfo which returns all periods' matchups with team names.
// Matches teams by name (with aliases) and updates HomeScore/VisitorScore.
function refreshFantraxMatchups(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Matchups');
  if (!sheet) throw new Error('Matchups sheet not found');

  const [headers, ...rows] = sheet.getDataRange().getValues();
  const weekIdx   = headers.indexOf('Week');
  const homeIdx   = headers.indexOf('Home');
  const visIdx    = headers.indexOf('Visitor');
  const hScoreIdx = headers.indexOf('HomeScore');
  const vScoreIdx = headers.indexOf('VisitorScore');
  if (weekIdx < 0 || homeIdx < 0 || visIdx < 0) throw new Error('Matchups sheet missing required columns');

  // Build ownerKey → Fantrax team id map from getLeagueInfo matchup data
  const ownerMap = getOwnerMap(ss);
  const nameToKey = {};
  Object.entries(ownerMap).forEach(([key, name]) => { nameToKey[name.toLowerCase()] = key; });
  Object.entries(FANTRAX_TEAM_ALIASES).forEach(([alias, key]) => { nameToKey[alias] = key; });

  // getLeagueInfo returns { matchups: [{ period, matchupList: [{ home:{name,id,score}, away:{name,id,score} }] }] }
  const leagueInfo = fetchFantrax('getLeagueInfo');
  const periods = leagueInfo.matchups || [];

  // Build lookup: "week|homeKey|visKey" → { homeScore, visScore }
  // Also build: ownerKey → fantraxTeamId for score lookup
  const scoreLookup = {}; // "period|ownerKey" → { asHome: score, asAway: score }
  periods.forEach(periodData => {
    const week = String(periodData.period || '');
    (periodData.matchupList || []).forEach(m => {
      const homeKey = nameToKey[(m.home && m.home.name || '').toLowerCase()];
      const awayKey = nameToKey[(m.away && m.away.name || '').toLowerCase()];
      const homeScore = (m.home && (m.home.score || m.home.points)) || '';
      const awayScore = (m.away && (m.away.score || m.away.points)) || '';
      if (homeKey) scoreLookup[week + '|' + homeKey] = { score: homeScore, isHome: true,  partner: awayKey,  partnerScore: awayScore };
      if (awayKey) scoreLookup[week + '|' + awayKey] = { score: awayScore, isHome: false, partner: homeKey, partnerScore: homeScore };
    });
  });

  let updated = 0;
  rows.forEach((row, i) => {
    const week    = String(row[weekIdx] || '').trim();
    const homeKey = String(row[homeIdx] || '').trim();
    const visKey  = String(row[visIdx]  || '').trim();
    const entry   = scoreLookup[week + '|' + homeKey] || scoreLookup[week + '|' + visKey];
    if (!entry || entry.score === '') return;

    const rowNum = i + 2;
    const hScore = entry.isHome ? entry.score : entry.partnerScore;
    const vScore = entry.isHome ? entry.partnerScore : entry.score;
    if (hScoreIdx >= 0 && hScore !== '') sheet.getRange(rowNum, hScoreIdx + 1).setValue(hScore);
    if (vScoreIdx >= 0 && vScore !== '') sheet.getRange(rowNum, vScoreIdx + 1).setValue(vScore);
    updated++;
  });

  Logger.log('refreshFantraxMatchups: updated ' + updated + ' rows');
  return { ok: true, updated };
}

// ── Debug: matchup score resolution ──────────────────────────────────────────
function testMatchupScores() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // 1. What does getLeagueInfo top-level look like?
  const leagueInfo = fetchFantrax('getLeagueInfo');
  Logger.log('getLeagueInfo top-level keys: ' + Object.keys(leagueInfo).join(', '));

  // 2. Is there a matchups key?
  const periods = leagueInfo.matchups || [];
  Logger.log('periods count: ' + periods.length);
  if (periods.length > 0) {
    Logger.log('period[0] keys: ' + Object.keys(periods[0]).join(', '));
    Logger.log('period[0].period: ' + periods[0].period);
    const ml = periods[0].matchupList || periods[0].matchups || [];
    Logger.log('matchupList[0] length: ' + ml.length);
    if (ml.length > 0) {
      Logger.log('matchupList[0][0]: ' + JSON.stringify(ml[0]));
    }
  }

  // 3. Try getStandings to see if it has matchup data instead
  const standings = fetchFantrax('getStandings');
  Logger.log('getStandings top-level keys: ' + Object.keys(standings).join(', '));
  // Check first entry for matchup-level data
  const firstVal = Object.values(standings)[0];
  if (firstVal && typeof firstVal === 'object') {
    Logger.log('standings[0] keys: ' + Object.keys(firstVal).join(', '));
    Logger.log('standings[0] sample: ' + JSON.stringify(firstVal).substring(0, 400));
  }

  // 4. Owner key → name map
  const ownerMap = getOwnerMap(ss);
  Logger.log('ownerMap sample: ' + JSON.stringify(ownerMap).substring(0, 300));
}

// ── Debug: raw getStandings response ─────────────────────────────────────────
function debugStandingsData(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);
  const raw = fetchFantrax('getStandings');
  return {
    ok: true,
    topLevelKeys: Object.keys(raw),
    raw,
  };
}

// ── Refresh standings from Fantrax ────────────────────────────────────────────
// getStandings returns a plain array (numeric-keyed object) of:
//   { teamName, teamId, rank, gamesBack, winPercentage, points:"W-L-T" }
// "points" is category W-L-T for the season; winPercentage = (W+0.5T)/(W+L+T).
function refreshFantraxStandings(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);

  const ownerMap = getOwnerMap(ss);
  const nameToKey = {};
  Object.entries(ownerMap).forEach(([key, name]) => { nameToKey[name.toLowerCase()] = key; });
  Object.entries(FANTRAX_TEAM_ALIASES).forEach(([alias, key]) => { nameToKey[alias] = key; });

  const data   = fetchFantrax('getStandings');
  const rows   = Object.values(data); // response is numeric-keyed array-like object
  const recs   = {};
  const unresolved = [];

  rows.forEach(function(row) {
    if (!row || typeof row !== 'object') return;
    const name = String(row.teamName || '').toLowerCase();
    const key  = nameToKey[name];
    if (!key) { if (name) unresolved.push(row.teamName || name); return; }

    // "points" = "W-L-T" string e.g. "100-38-12"
    const parts = String(row.points || '0-0-0').split('-');
    const W = parseInt(parts[0]) || 0;
    const L = parseInt(parts[1]) || 0;
    const T = parseInt(parts[2]) || 0;

    recs[key] = {
      W,
      L,
      T,
      pct:  row.winPercentage != null ? Number(row.winPercentage).toFixed(3) : '.000',
      GB:   row.gamesBack > 0 ? row.gamesBack : '-',
      catW: W,  // category wins = W in H2H categories
      catL: L,
      rank: Number(row.rank || 0),
    };
  });

  const allKeys = Object.keys(recs).sort((a, b) => recs[a].rank - recs[b].rank);

  // Persist to Standings sheet
  const sheet = ss.getSheetByName('Standings');
  if (sheet) {
    const HEADERS = ['team','W','L','T','pct','GB','catW','catL'];
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, HEADERS.length).clearContent();
    const sheetRows = allKeys.map(k => {
      const r = recs[k];
      return [k, r.W, r.L, r.T, r.pct, r.GB, r.catW, r.catL];
    });
    if (sheetRows.length > 0) {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      sheet.getRange(2, 1, sheetRows.length, HEADERS.length).setValues(sheetRows);
    }
  }

  Logger.log('refreshFantraxStandings: ' + allKeys.length + ' teams, unresolved: ' + unresolved.join(', '));
  return { ok: true, teams: allKeys.length, unresolved, standings: recs };
}

// ── Refresh rosters ───────────────────────────────────────────────────────────
// Pulls current team rosters from Fantrax and updates the Rosters sheet.
// Matches players by Fantrax player id. Updates teamKey, position, salary,
// status, and contract year for every matched player.
function refreshFantraxRosters(ss, filterKey) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);
  const data = fetchFantrax('getTeamRosters');
  // Response shape: { period, rosters: { [fantraxTeamId]: { teamName, rosterItems: [{id, position, salary, status, contract:{name}}] } } }
  const rostersObj = data.rosters || (data.data && data.data.rosters) || {};

  // Eligible positions live in getLeagueInfo.playerInfo[id].eligiblePos (comma-separated fantasy positions)
  const leagueInfo  = fetchFantrax('getLeagueInfo');
  const leaguePInfo = (leagueInfo && leagueInfo.playerInfo) || {};

  // Player names + MLB teams for new-player rows — keyed by Fantrax player ID
  const playerData = fetchFantrax('getPlayerIds');
  const playerMeta = {}; // pid → { name, mlb_team }
  Object.entries(playerData || {}).forEach(function(kv) {
    const p = kv[1]; if (!p || typeof p !== 'object') return;
    const id = String(p.fantraxId || p.id || kv[0]).trim(); if (!id) return;
    let name = String(p.name || p.playerName || '').trim();
    if (name.includes(',')) { var pts = name.split(','); name = pts[1].trim() + ' ' + pts[0].trim(); }
    playerMeta[id] = { name: name, mlb_team: String(p.team || p.mlbTeam || '').trim() };
  });

  // MLB career stats cache — used to auto-detect MiLB-eligible players in MLB slots
  const mlbCache = getMLBCareerCache(ss);

  const sheet = ss.getSheetByName('Rosters');
  if (!sheet) throw new Error('Rosters sheet not found');

  const [headers, ...rows] = sheet.getDataRange().getValues();
  const idIdx       = headers.indexOf('id');
  const teamIdx     = headers.indexOf('teamKey');
  const posIdx      = headers.indexOf('position');
  const salIdx      = headers.indexOf('salary');
  const statusIdx   = headers.indexOf('status');
  const contractIdx = headers.indexOf('contract');
  if (idIdx < 0) throw new Error('Rosters sheet missing id column — needed to match Fantrax players');

  // Build reverse ownerMap: teamName (lowercase) → ownerKey, plus Fantrax aliases
  const ownerMap = getOwnerMap(ss); // ownerKey → teamName
  const nameToKey = {};
  Object.entries(ownerMap).forEach(([key, name]) => { nameToKey[name.toLowerCase()] = key; });
  Object.entries(FANTRAX_TEAM_ALIASES).forEach(([alias, key]) => { nameToKey[alias] = key; });

  // Build player lookup: fantraxPlayerId → row index (0-based, rows array)
  // Sheet stores ids as "*041pz*" — strip asterisks to match Fantrax's bare "041pz"
  const idLookup = {};
  rows.forEach((r, i) => {
    const pid = String(r[idIdx] || '').trim().replace(/\*/g, '');
    if (pid) idLookup[pid] = i;
  });

  // Fantrax status → sheet status value
  const STATUS_FANTRAX = {
    'ACTIVE':          'Active',
    'RESERVE':         'Reserve',
    'INJURED_RESERVE': 'Inj Res',
    'MINORS':          'Minors',
  };

  let updated = 0;
  let notFound = 0;

  Object.entries(rostersObj).forEach(([, teamData]) => {
    const ownerKey = nameToKey[String(teamData.teamName || '').toLowerCase()];
    if (!ownerKey) return;
    if (filterKey && ownerKey !== filterKey) return; // per-team mode: skip other teams

    (teamData.rosterItems || []).forEach(item => {
      const pid      = String(item.id || '').trim();
      // Use eligiblePos from getLeagueInfo (e.g. "2B,UT,SS,MI"); fall back to roster-slot position
      const pos = (leaguePInfo[pid] && leaguePInfo[pid].eligiblePos) || item.position || '';
      const salary   = item.salary != null ? Number(item.salary) : null;
      const contract = item.contract ? String(item.contract.name || '') : '';
      let   status   = STATUS_FANTRAX[item.status] || '';
      if (!pid) return;

      const rowIdx = idLookup[pid];

      // MiLB eligibility check (applied to both existing and new rows)
      if (item.status !== 'MINORS') {
        if (mlbCache[pid] && mlbCache[pid].eligible) {
          status = 'Minors';
        } else if (rowIdx !== undefined && (item.status === 'ACTIVE' || item.status === 'RESERVE') &&
                   statusIdx >= 0 && String(rows[rowIdx][statusIdx] || '') === 'Minors') {
          status = 'Minors'; // preserve manual override until cache is populated
        }
      }

      if (rowIdx === undefined) {
        // New player — not yet in the Rosters sheet. Add a new row.
        const meta = playerMeta[pid] || {};
        const newRow = headers.map(function(h) {
          if (h === 'teamKey')   return ownerKey;
          if (h === 'player')    return meta.name    || '';
          if (h === 'mlb_team')  return meta.mlb_team || '';
          if (h === 'position')  return pos;
          if (h === 'salary')    return salary != null ? salary : '';
          if (h === 'status')    return status || '';
          if (h === 'contract')  return contract;
          if (h === 'id')        return '*' + pid + '*';
          return '';
        });
        sheet.appendRow(newRow);
        idLookup[pid] = rows.length; // prevent duplicate inserts within same sync
        rows.push(newRow);
        notFound++;
        return;
      }

      const rowNum = rowIdx + 2; // +1 for header row, +1 for 1-based index
      if (teamIdx     >= 0)                   sheet.getRange(rowNum, teamIdx     + 1).setValue(ownerKey);
      if (posIdx      >= 0 && pos)            sheet.getRange(rowNum, posIdx      + 1).setValue(pos);
      if (salIdx      >= 0 && salary != null) sheet.getRange(rowNum, salIdx      + 1).setValue(salary);
      if (statusIdx   >= 0 && status)         sheet.getRange(rowNum, statusIdx   + 1).setValue(status);
      if (contractIdx >= 0 && contract)       sheet.getRange(rowNum, contractIdx + 1).setValue(contract);
      updated++;
    });
  });

  Logger.log('refreshFantraxRosters: updated=' + updated + ' added=' + notFound);
  return { ok: true, updated, added: notFound };
}

// ── Refresh draft results ─────────────────────────────────────────────────────
// Pulls completed draft picks from Fantrax and writes/updates the Picks sheet.
// Actual response shape: { draftPicks: [{ round, pickInRound, teamId, playerId, time }] }
// Player names/positions resolved via getLeagueInfo; team names via getTeamRosters.
function refreshFantraxDraft(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);
  const data = fetchFantrax('getDraftResults');

  const picks = data.draftPicks || [];
  if (!picks.length) return { ok: true, updated: 0, added: 0, message: 'No draft picks from Fantrax. Keys: ' + Object.keys(data).join(', ') };

  // Resolve playerId → { name, mlb_team, position } via getPlayerIds (same as buildRostersFromFantrax)
  const playerData  = fetchFantrax('getPlayerIds');
  const leagueInfo  = fetchFantrax('getLeagueInfo');
  const leaguePInfo = (leagueInfo && leagueInfo.playerInfo) || {};
  const playerById  = {};
  Object.entries(playerData || {}).forEach(function(kv) {
    const p  = kv[1];
    if (!p || typeof p !== 'object') return;
    const id = String(p.fantraxId || p.id || kv[0]).trim();
    if (!id) return;
    let name = String(p.name || p.playerName || '').trim();
    if (name.includes(',')) { var pts = name.split(','); name = pts[1].trim() + ' ' + pts[0].trim(); }
    const posRaw = p.positions || p.position || p.pos || '';
    playerById[id] = {
      name:     name,
      mlb_team: String(p.team || p.mlbTeam || '').trim(),
      position: (leaguePInfo[id] && leaguePInfo[id].eligiblePos) || (Array.isArray(posRaw) ? posRaw.join(',') : String(posRaw).trim()),
    };
  });

  // Resolve teamId → ownerKey and playerId → { salary, contract } via getTeamRosters.
  // roster item.id matches playerId format from getDraftResults.
  const ownerMap = getOwnerMap(ss);
  const nameToKey = {};
  Object.entries(ownerMap).forEach(function(kv) { nameToKey[kv[1].toLowerCase()] = kv[0]; });
  Object.entries(FANTRAX_TEAM_ALIASES).forEach(function(kv) { nameToKey[kv[0]] = kv[1]; });
  const rostersData = fetchFantrax('getTeamRosters');
  const rostersObj  = rostersData.rosters || {};
  const teamIdToKey  = {};
  const playerSalCon = {};
  Object.entries(rostersObj).forEach(function(kv) {
    const tname = String(kv[1].teamName || '').trim().toLowerCase();
    const key = nameToKey[tname];
    if (key) teamIdToKey[kv[0]] = key;
    (kv[1].rosterItems || []).forEach(function(item) {
      const pid = String(item.id || '').trim();
      if (!pid) return;
      playerSalCon[pid] = {
        salary:   item.salary != null ? String(item.salary) : '',
        contract: item.contract ? String(item.contract.name || '') : ''
      };
    });
  });

  const sheet = ss.getSheetByName('Picks') || ss.insertSheet('Picks');
  if (sheet.getLastRow() === 0) {
    const hdr = ['round','pick','team','player','mlb_team','position','salary','contract','key'];
    sheet.appendRow(hdr);
    sheet.getRange(1, 1, 1, hdr.length).setFontWeight('bold').setBackground('#0d1b2a').setFontColor('#c9a84c');
  }

  const sheetData   = sheet.getDataRange().getValues();
  const headers     = sheetData[0];
  const existingRows = sheetData.slice(1);
  const roundIdx    = headers.indexOf('round');
  const pickIdx     = headers.indexOf('pick');
  const teamIdx     = headers.indexOf('team');
  const playerIdx   = headers.indexOf('player');
  const mlbIdx      = headers.indexOf('mlb_team');
  const posIdx      = headers.indexOf('position');
  const salaryIdx   = headers.indexOf('salary');
  const contractIdx = headers.indexOf('contract');

  // round|pickInRound → sheet row number (1-indexed)
  const existing = {};
  existingRows.forEach(function(r, i) {
    const k = String(r[roundIdx] || '') + '|' + String(r[pickIdx] || '');
    existing[k] = i + 2;
  });

  let updated = 0; let added = 0; let skipped = 0;
  picks.forEach(function(p) {
    const round    = String(p.round        || '').trim();
    const pick     = String(p.pickInRound  || p.pick || '').trim();
    const teamId   = String(p.teamId       || '').trim();
    const playerId = String(p.playerId     || '').trim();
    if (!round || !pick || !playerId) { skipped++; return; }

    const pInfo    = playerById[playerId]   || {};
    const pLeague  = leaguePInfo[playerId]  || {};
    const pSalCon  = playerSalCon[playerId] || {};
    const player   = pInfo.name     || '';
    const mlbTeam  = pInfo.mlb_team || '';
    const pos      = pInfo.position || String(pLeague.eligiblePos || '').trim();
    const ownerKey = teamIdToKey[teamId] || '';
    const salary   = pSalCon.salary   || round;
    const contract = pSalCon.contract || '';
    if (!player) { skipped++; return; }

    const lookupKey = round + '|' + pick;
    if (existing[lookupKey]) {
      const rowNum = existing[lookupKey];
      if (teamIdx     >= 0 && ownerKey) sheet.getRange(rowNum, teamIdx     + 1).setValue(ownerKey);
      if (playerIdx   >= 0 && player)   sheet.getRange(rowNum, playerIdx   + 1).setValue(player);
      if (mlbIdx      >= 0 && mlbTeam)  sheet.getRange(rowNum, mlbIdx      + 1).setValue(mlbTeam);
      if (posIdx      >= 0 && pos)      sheet.getRange(rowNum, posIdx      + 1).setValue(pos);
      if (salaryIdx   >= 0 && salary)   sheet.getRange(rowNum, salaryIdx   + 1).setValue(salary);
      if (contractIdx >= 0 && contract) sheet.getRange(rowNum, contractIdx + 1).setValue(contract);
      updated++;
    } else {
      const newRow = headers.map(function(h) { // salary/contract from Fantrax roster data
        if (h === 'round')    return round;
        if (h === 'pick')     return pick;
        if (h === 'team')     return ownerKey;
        if (h === 'player')   return player;
        if (h === 'mlb_team') return mlbTeam;
        if (h === 'position') return pos;
        if (h === 'salary')   return salary;
        if (h === 'contract') return contract;
        return '';
      });
      sheet.appendRow(newRow);
      added++;
    }
  });

  Logger.log('refreshFantraxDraft: updated=' + updated + ' added=' + added + ' skipped=' + skipped);
  return { ok: true, updated, added, skipped };
}

// Run from Apps Script editor — finds playerId "06alt" in getTeamRosters and dumps all its fields
function debugRosterItem() {
  const TARGET_ID = '06alt';
  const data = fetchFantrax('getTeamRosters');
  const rostersObj = data.rosters || {};
  let found = null;
  Object.entries(rostersObj).forEach(function(kv) {
    (kv[1].rosterItems || []).forEach(function(item) {
      if (String(item.id || '').trim() === TARGET_ID) found = item;
    });
  });
  if (found) {
    Logger.log('Found item for ' + TARGET_ID + ': ' + JSON.stringify(found));
  } else {
    Logger.log('NOT FOUND in any rosterItems. Total teams: ' + Object.keys(rostersObj).length);
    // Log first item from first team to see the shape
    const firstTeam = Object.values(rostersObj)[0] || {};
    const firstItem = (firstTeam.rosterItems || [])[0] || null;
    Logger.log('Sample rosterItem fields: ' + JSON.stringify(firstItem));
  }
}

// Run from Apps Script editor — checks whether playerId keys resolve via getLeagueInfo
function debugDraftResolution() {
  const draftData  = fetchFantrax('getDraftResults');
  const picks      = draftData.draftPicks || [];
  Logger.log('Total picks: ' + picks.length);

  const sample = picks[0];
  Logger.log('Sample pick: ' + JSON.stringify(sample));

  const leagueInfo = fetchFantrax('getLeagueInfo');
  const playerInfo = (leagueInfo && leagueInfo.playerInfo) || {};
  const pInfoKeys  = Object.keys(playerInfo);
  Logger.log('playerInfo entries: ' + pInfoKeys.length);
  Logger.log('playerInfo sample keys: ' + JSON.stringify(pInfoKeys.slice(0, 5)));
  if (pInfoKeys.length > 0) {
    Logger.log('playerInfo sample entry: ' + JSON.stringify(playerInfo[pInfoKeys[0]]));
  }

  if (sample) {
    const pid = String(sample.playerId || '').trim();
    Logger.log('Looking up playerId "' + pid + '": ' + JSON.stringify(playerInfo[pid] || 'NOT FOUND'));
    // Also try the first 3 draft pick IDs
    picks.slice(0, 3).forEach(function(p) {
      const id = String(p.playerId || '').trim();
      Logger.log('  ' + id + ' → ' + JSON.stringify(playerInfo[id] || 'NOT FOUND'));
    });
  }

  // Also check what getLeagueInfo top-level keys look like
  Logger.log('getLeagueInfo top-level keys: ' + JSON.stringify(Object.keys(leagueInfo).slice(0, 10)));
}

// Run from Apps Script editor to test the import without touching the sheet
function testDraftResultsImport() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const data = fetchFantrax('getDraftResults');
  const picks = data.draftPicks || [];
  Logger.log('Total picks: ' + picks.length + '  draftState: ' + data.draftState);

  const leagueInfo = fetchFantrax('getLeagueInfo');
  const playerInfo = (leagueInfo && leagueInfo.playerInfo) || {};

  const ownerMap = getOwnerMap(ss);
  const nameToKey = {};
  Object.entries(ownerMap).forEach(function(kv) { nameToKey[kv[1].toLowerCase()] = kv[0]; });
  Object.entries(FANTRAX_TEAM_ALIASES).forEach(function(kv) { nameToKey[kv[0]] = kv[1]; });
  const rostersData = fetchFantrax('getTeamRosters');
  const rostersObj  = rostersData.rosters || {};
  const teamIdToKey = {};
  Object.entries(rostersObj).forEach(function(kv) {
    const tname = String(kv[1].teamName || '').trim().toLowerCase();
    const key = nameToKey[tname];
    if (key) teamIdToKey[kv[0]] = key;
  });

  // Resolve names via getPlayerIds (same as buildRostersFromFantrax)
  const playerData2 = fetchFantrax('getPlayerIds');
  const leagueInfo2 = fetchFantrax('getLeagueInfo');
  const leaguePInfo2 = (leagueInfo2 && leagueInfo2.playerInfo) || {};
  const playerById2 = {};
  Object.entries(playerData2 || {}).forEach(function(kv) {
    const p = kv[1]; if (!p || typeof p !== 'object') return;
    const id = String(p.fantraxId || p.id || kv[0]).trim(); if (!id) return;
    let name = String(p.name || p.playerName || '').trim();
    if (name.includes(',')) { var pts = name.split(','); name = pts[1].trim() + ' ' + pts[0].trim(); }
    playerById2[id] = { name: name, mlb_team: String(p.team || p.mlbTeam || '').trim() };
  });
  Logger.log('Teams resolved: ' + Object.keys(teamIdToKey).length + ' / ' + Object.keys(rostersObj).length);
  Logger.log('Players resolved via getPlayerIds: ' + Object.keys(playerById2).length);
  picks.slice(0, 5).forEach(function(p) {
    const pr = playerById2[p.playerId] || {};
    Logger.log('Rd ' + p.round + ' Pk ' + p.pickInRound +
      ' | team=' + (teamIdToKey[p.teamId] || '??' + p.teamId) +
      ' | player=' + (pr.name || '??' + p.playerId) +
      ' | mlb=' + (pr.mlb_team || ''));
  });
}

// ── Refresh future/current draft pick ownership from Fantrax ──────────────────
// Uses getDraftPicks to sync which team owns each pick (including traded picks).
// Writes round/pick/team to the Picks sheet without overwriting player data.
function refreshFantraxDraftPicks(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);

  const ownerMap = getOwnerMap(ss);
  const nameToKey = {};
  Object.entries(ownerMap).forEach(([key, name]) => { nameToKey[name.toLowerCase()] = key; });
  Object.entries(FANTRAX_TEAM_ALIASES).forEach(([alias, key]) => { nameToKey[alias] = key; });

  const data = fetchFantrax('getDraftPicks');

  // Fantrax returns futureDraftPicks and/or currentDraftPicks
  const picks = [].concat(data.futureDraftPicks || [], data.currentDraftPicks || [],
                           data.picks || [], data.draftPicks || []);

  if (!Array.isArray(picks) || picks.length === 0) {
    return { ok: true, updated: 0, added: 0, note: 'No picks found. Keys: ' + Object.keys(data).join(', ') };
  }

  const sheet = ss.getSheetByName('Picks');
  if (!sheet) throw new Error('Picks sheet not found');

  const HEADERS = ['round','pick','team','player','mlb_team','position','salary','contract','key'];
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }

  const allData = sheet.getDataRange().getValues();
  const headers = allData[0];
  const rows    = allData.slice(1);
  const rdIdx = headers.indexOf('round');
  const pkIdx = headers.indexOf('pick');
  const tmIdx = headers.indexOf('team');
  const plIdx = headers.indexOf('player');

  // Build lookup: "rd|pk" → row index in rows[]
  const rowByKey = {};
  rows.forEach((row, i) => {
    const rd = String(row[rdIdx] || '').trim();
    const pk = String(row[pkIdx] || '').trim();
    if (rd && pk) rowByKey[rd + '|' + pk] = i;
  });

  let updated = 0;
  const newRows = [];
  const unresolved = [];

  picks.forEach(p => {
    const round = String(p.round || p.roundNum || p.rd || p.roundNumber || '').trim();
    const pick  = String(p.pick  || p.pickNum  || p.pickNumber || p.overallPick || '').trim();
    const rawName = (p.teamName || p.name || p.ownerName || p.team || '').toLowerCase();
    const teamKey = nameToKey[rawName] || '';
    if (!teamKey && rawName) unresolved.push(rawName);
    if (!round || !pick) return;

    const lookupKey = round + '|' + pick;
    if (rowByKey[lookupKey] !== undefined) {
      const idx = rowByKey[lookupKey];
      // Only update ownership if this pick hasn't been used (no player drafted yet)
      if (teamKey && !rows[idx][plIdx] && rows[idx][tmIdx] !== teamKey) {
        rows[idx][tmIdx] = teamKey;
        updated++;
      }
    } else {
      const newRow = new Array(headers.length).fill('');
      if (rdIdx >= 0) newRow[rdIdx] = round;
      if (pkIdx >= 0) newRow[pkIdx] = pick;
      if (tmIdx >= 0) newRow[tmIdx] = teamKey;
      newRows.push(newRow);
    }
  });

  // Batch write
  if (updated > 0) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  if (newRows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);

  Logger.log('refreshFantraxDraftPicks: updated=' + updated + ' added=' + newRows.length);
  return { ok: true, updated, added: newRows.length, total: picks.length, unresolved };
}

function debugDraftPicksData() {
  const data = fetchFantrax('getDraftPicks');
  const picks = [].concat(data.futureDraftPicks || [], data.currentDraftPicks || [],
                           data.picks || [], data.draftPicks || []);
  return { ok: true, topLevelKeys: Object.keys(data), total: picks.length, sample: picks.slice(0, 3) };
}

function debugDraftResultsData() {
  try {
    const data = fetchFantrax('getDraftResults');
    const topLevelKeys = Object.keys(data);
    const picks = data.draftResults || (data.data && data.data.draftResults) || data.picks || data.results || [];
    return {
      ok: true,
      topLevelKeys,
      picksFound: Array.isArray(picks) ? picks.length : typeof picks,
      sample: Array.isArray(picks) ? picks.slice(0, 3) : picks,
      rawSample: topLevelKeys.slice(0, 6).reduce(function(o, k) {
        const v = data[k];
        o[k] = Array.isArray(v) ? v.slice(0, 2) : (typeof v === 'object' && v ? { _keys: Object.keys(v).slice(0, 5) } : v);
        return o;
      }, {})
    };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// Run this from Apps Script editor: select testDraftResults → Run → View Logs
function testDraftResults() {
  const data = fetchFantrax('getDraftResults');
  Logger.log('Top-level keys: ' + JSON.stringify(Object.keys(data)));
  // Log each key's type and length/preview
  Object.keys(data).forEach(function(k) {
    const v = data[k];
    if (Array.isArray(v)) {
      Logger.log(k + ': Array[' + v.length + '] — first item: ' + JSON.stringify(v[0] || null));
    } else if (v && typeof v === 'object') {
      Logger.log(k + ': Object — keys: ' + JSON.stringify(Object.keys(v).slice(0, 8)));
    } else {
      Logger.log(k + ': ' + JSON.stringify(v));
    }
  });
}

// ── Debug: return raw Fantrax API response ────────────────────────────────────
function debugFantrax(endpoint, params) {
  try {
    const data = fetchFantrax(endpoint || 'getTeamRosters', params || {});
    const keys = Object.keys(data);
    const sample = {};
    keys.forEach(k => {
      const val = data[k];
      if (Array.isArray(val)) {
        sample[k] = val.slice(0, 2);
      } else if (val && typeof val === 'object') {
        const subKeys = Object.keys(val);
        sample[k] = { _keys: subKeys, _sample: subKeys.slice(0, 3).reduce((o, sk) => { o[sk] = val[sk]; return o; }, {}) };
      } else {
        sample[k] = val;
      }
    });
    return { ok: true, topLevelKeys: keys, sample };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ── Debug: compare Fantrax team names vs ownerMap + sample roster IDs ─────────
function debugFantraxRosterMatch() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const ownerMap = getOwnerMap(ss); // ownerKey → teamName
    const nameToKey = {};
    Object.entries(ownerMap).forEach(([key, name]) => { nameToKey[name.toLowerCase()] = key; });
    Object.entries(FANTRAX_TEAM_ALIASES).forEach(([alias, key]) => { nameToKey[alias] = key; });

    const data = fetchFantrax('getTeamRosters');
    const rostersObj = data.rosters || {};

    // Check team name matching
    const teamMatches = [];
    Object.entries(rostersObj).forEach(([fantraxId, teamData]) => {
      const fantraxName = String(teamData.teamName || '');
      const matched = nameToKey[fantraxName.toLowerCase()];
      teamMatches.push({ fantraxId, fantraxName, matchedKey: matched || '❌ NO MATCH' });
    });

    // Sample a few player IDs from the sheet
    const sheet = ss.getSheetByName('Rosters');
    const [headers, ...rows] = sheet.getDataRange().getValues();
    const idIdx = headers.indexOf('id');
    const sampleSheetIds = rows.slice(0, 5).map(r => String(r[idIdx] || '(empty)'));

    // Sample a few player IDs from Fantrax (first matched team)
    const firstTeam = Object.values(rostersObj)[0];
    const sampleFantraxIds = (firstTeam && firstTeam.rosterItems || []).slice(0, 5).map(i => i.id);

    return { ok: true, teamMatches, sampleSheetIds, sampleFantraxIds, ownerMapKeys: Object.keys(ownerMap) };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ── Build Rosters sheet from Fantrax (use when sheet is empty) ────────────────
// Combines getPlayerIds (name, mlb_team, position) + getTeamRosters (salary,
// status, contract, fantasy team). Clears data rows and rewrites them.
// Preserves existing header row if present; otherwise writes standard headers.
function buildRostersFromFantrax(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);

  // 1. Fetch player info: fantraxId → { name, mlb_team, position }
  const playerData = fetchFantrax('getPlayerIds');
  if (!playerData || typeof playerData !== 'object') {
    return { ok: false, error: 'getPlayerIds failed' };
  }

  // Eligible positions live in getLeagueInfo.playerInfo[id].eligiblePos
  const leagueInfoData = fetchFantrax('getLeagueInfo');
  const leaguePInfo    = (leagueInfoData && leagueInfoData.playerInfo) || {};

  const playerInfo = {}; // fantraxId → { name, mlb_team, position }
  Object.entries(playerData).forEach(([key, p]) => {
    if (!p || typeof p !== 'object') return;
    const id = String(p.fantraxId || p.id || key).trim();
    if (!id) return;
    let name = String(p.name || p.playerName || '').trim();
    // Convert "Last, First" → "First Last"
    if (name.includes(',')) {
      const parts = name.split(',');
      name = parts[1].trim() + ' ' + parts[0].trim();
    }
    const pPosRaw    = p.positions || p.position || p.pos || '';
    const fallbackPos = Array.isArray(pPosRaw) ? pPosRaw.join(',') : String(pPosRaw).trim();
    playerInfo[id] = {
      name,
      mlb_team: String(p.team || p.mlbTeam || '').trim(),
      position: (leaguePInfo[id] && leaguePInfo[id].eligiblePos) || fallbackPos,
    };
  });

  // 2. Fetch team rosters: salary, status, contract, fantasy team assignment
  const rosterData = fetchFantrax('getTeamRosters');
  const rostersObj = rosterData.rosters || {};
  const ownerMap   = getOwnerMap(ss);
  const nameToKey  = {};
  Object.entries(ownerMap).forEach(([key]) => { nameToKey[key.toLowerCase()] = key; });
  Object.entries(ownerMap).forEach(([key, name]) => { nameToKey[name.toLowerCase()] = key; });
  Object.entries(FANTRAX_TEAM_ALIASES).forEach(([alias, key]) => { nameToKey[alias] = key; });

  const STATUS_MAP = {
    'ACTIVE': 'Active', 'RESERVE': 'Reserve',
    'INJURED_RESERVE': 'Inj Res', 'MINORS': 'Minors',
  };

  // 3. Build rows
  const newRows = [];
  let noName = 0;
  Object.entries(rostersObj).forEach(([, teamData]) => {
    const ownerKey = nameToKey[String(teamData.teamName || '').toLowerCase()];
    if (!ownerKey) return;
    (teamData.rosterItems || []).forEach(item => {
      const fantraxId = String(item.id || '').trim();
      if (!fantraxId) return;
      const info     = playerInfo[fantraxId] || {};
      const name     = info.name || '';
      if (!name) noName++;
      const status   = STATUS_MAP[item.status] || String(item.status || '');
      const salary   = item.salary != null ? String(item.salary) : '';
      const contract = item.contract ? String(item.contract.name || '') : '';
      // id stored as *fantraxId* to match existing app format
      newRows.push([ownerKey, name, info.mlb_team || '', info.position || '', salary, status, contract, '*' + fantraxId + '*']);
    });
  });

  if (!newRows.length) return { ok: false, error: 'No roster rows built — check team name aliases' };

  // 4. Write to sheet
  const sheet = ss.getSheetByName('Rosters');
  if (!sheet) return { ok: false, error: 'Rosters sheet not found' };

  const HEADERS = ['teamKey','player','mlb_team','position','salary','status','contract','id'];
  // Clear everything and rewrite
  sheet.clearContents();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.getRange(2, 1, newRows.length, HEADERS.length).setValues(newRows);

  return { ok: true, rowsWritten: newRows.length, noNameCount: noName };
}

// ── One-time: populate the id column in Rosters sheet from Fantrax ─────────────
// Uses getPlayerIds?sport=MLB to populate mlb_team and position columns.
// Matches rows by the existing id column (sheet stores "*041pz*"; strips * to get bare Fantrax id).
function populateFantraxPlayerIds(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);
  // Response shape: { "041pz": { name: "Last, First", fantraxId: "041pz", team: "BAL", position: "SS" }, ... }
  const data = fetchFantrax('getPlayerIds');
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'getPlayerIds returned unexpected shape', rawSample: JSON.stringify(data).substring(0, 400) };
  }

  // Eligible positions live in getLeagueInfo.playerInfo[id].eligiblePos
  const leagueInfoData2 = fetchFantrax('getLeagueInfo');
  const leaguePInfo2    = (leagueInfoData2 && leagueInfoData2.playerInfo) || {};

  // Build lookup: bare fantraxId → { team, position }
  const playerMap = {};
  Object.entries(data).forEach(([key, p]) => {
    if (!p || typeof p !== 'object') return;
    const id       = String(p.fantraxId || p.id || key).trim();
    const team     = String(p.team     || p.mlbTeam || '').trim();
    const posRaw   = p.positions || p.position || p.pos || '';
    const fallback = Array.isArray(posRaw) ? posRaw.join(',') : String(posRaw).trim();
    const position = (leaguePInfo2[id] && leaguePInfo2[id].eligiblePos) || fallback;
    if (id) playerMap[id] = { team, position };
  });

  if (!Object.keys(playerMap).length) {
    return { ok: false, error: 'getPlayerIds returned no entries', rawSample: JSON.stringify(data).substring(0, 400) };
  }

  const sheet = ss.getSheetByName('Rosters');
  if (!sheet) return { ok: false, error: 'Rosters sheet not found' };
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const idIdx      = headers.indexOf('id');
  const mlbTeamIdx = headers.indexOf('mlb_team');
  const posIdx     = headers.indexOf('position');
  if (idIdx < 0) return { ok: false, error: 'Rosters sheet missing id column' };

  let matched = 0, skipped = 0;
  rows.forEach((r, i) => {
    // Strip asterisks: "*041pz*" → "041pz"
    const fantraxId = String(r[idIdx] || '').trim().replace(/\*/g, '');
    if (!fantraxId) { skipped++; return; }
    const entry = playerMap[fantraxId];
    if (!entry) { skipped++; return; }

    const rowNum = i + 2;
    if (mlbTeamIdx >= 0 && entry.team)     sheet.getRange(rowNum, mlbTeamIdx + 1).setValue(entry.team);
    if (posIdx     >= 0 && entry.position) sheet.getRange(rowNum, posIdx + 1).setValue(entry.position);
    matched++;
  });

  return { ok: true, matched, skipped, totalRows: rows.length, playerMapSize: Object.keys(playerMap).length };
}

function normName(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

// ── Debug: probe candidate player-info endpoints with a few known IDs ──────────
function debugFantraxPlayerEndpoints() {
  const sampleIds = ['02hfr', '02jh6', '02c47'];
  const results = {};

  const { leagueId } = getFantraxProps();
  const candidates = [
    { endpoint: 'getPlayerIds',          params: { playerIds: sampleIds.join(',') } },
    { endpoint: 'getPlayerIds',          params: { ids: sampleIds.join(',') } },
    { endpoint: 'getTeamRosters',        params: { addPlayerInfo: true } },
    { endpoint: 'getTeamRosters',        params: { includePlayerName: true } },
    { endpoint: 'getTeamRosterStats',    params: {} },
    { endpoint: 'getLeagueRosters',      params: {} },
    { endpoint: 'getScoreboard',         params: {} },
    { endpoint: 'getLeagueScoreboard',   params: {} },
    { endpoint: 'getTeamRoster',         params: {} },
    { endpoint: 'getLeagueStandings',    params: {} },
    { endpoint: 'getLeagueInfo',         params: {} },
  ];

  candidates.forEach(c => {
    const key = c.endpoint + '?' + JSON.stringify(c.params);
    try {
      const data = fetchFantrax(c.endpoint, c.params);
      // Return full raw response so we can see error codes/messages
      results[key] = { ok: true, raw: JSON.stringify(data).substring(0, 600) };
    } catch(e) {
      results[key] = { ok: false, error: e.message.substring(0, 200) };
    }
  });

  return { ok: true, results };
}

// ── Debug: probe candidate stats endpoints ────────────────────────────────────
function debugFantraxStatsEndpoints() {
  const results = {};
  const candidates = [
    { endpoint: 'getLeagueRosterItems',      params: {} },
    { endpoint: 'getLeagueStats',            params: {} },
    { endpoint: 'getPlayersTable',           params: {} },
    { endpoint: 'getRotoReport',             params: {} },
    { endpoint: 'getReport',                 params: {} },
    { endpoint: 'getPlayerRankings',         params: {} },
    { endpoint: 'getLeaguePlayerRankings',   params: {} },
    { endpoint: 'getPlayerSeasonStats',      params: {} },
    { endpoint: 'getLeagueScoringPeriods',   params: {} },
    { endpoint: 'getLeagueStandings',        params: {} },
    { endpoint: 'getTeamRosterStats',        params: {} },
    { endpoint: 'getPlayerStats',            params: { scoringPeriod: 0 } },
    { endpoint: 'getPlayerStats',            params: {} },
    { endpoint: 'getLeagueScoreboard',       params: {} },
  ];
  candidates.forEach(c => {
    const key = c.endpoint + (Object.keys(c.params).length ? '?' + JSON.stringify(c.params) : '');
    try {
      const data = fetchFantrax(c.endpoint, c.params);
      results[key] = { ok: true, raw: JSON.stringify(data).substring(0, 500) };
    } catch(e) {
      results[key] = { ok: false, error: e.message.substring(0, 150) };
    }
  });
  return { ok: true, results };
}

// ── Debug: try getPlayerIds with sport parameter ──────────────────────────────
function debugGetPlayerIds() {
  const sampleIds = ['02hfr', '02jh6', '02c47'];
  const results = {};
  const sportCodes = ['MLB', 'mlb', 'BASEBALL', 'baseball', '1', '2'];
  sportCodes.forEach(sport => {
    try {
      const data = fetchFantrax('getPlayerIds', { playerIds: sampleIds.join(','), sport });
      results['sport=' + sport] = { ok: true, raw: JSON.stringify(data).substring(0, 400) };
    } catch(e) {
      results['sport=' + sport] = { ok: false, error: e.message.substring(0, 120) };
    }
  });
  return { ok: true, results };
}

// ── Debug: compare sheet salary/contract format vs Fantrax ────────────────────
function debugRosterValues(ss) {
  if (!ss) ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Rosters');
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const teamIdx     = headers.indexOf('teamKey');
  const salIdx      = headers.indexOf('salary');
  const contractIdx = headers.indexOf('contract');
  const playerIdx   = headers.indexOf('player');

  const sheetSample = rows.slice(0, 8).map(r => ({
    player:      String(r[playerIdx]   || ''),
    teamKey:     String(r[teamIdx]     || ''),
    salary:      r[salIdx],
    salaryStr:   String(r[salIdx]      || ''),
    contract:    r[contractIdx],
    contractStr: String(r[contractIdx] || ''),
  }));

  const data = fetchFantrax('getTeamRosters');
  const firstTeam = Object.values(data.rosters || {})[0] || {};
  const fantraxSample = (firstTeam.rosterItems || []).slice(0, 5).map(item => {
    // Return ALL fields so we can see what position-related keys exist
    const out = {};
    Object.keys(item).forEach(k => {
      const v = item[k];
      out[k] = (v && typeof v === 'object') ? JSON.stringify(v) : v;
    });
    return out;
  });

  Logger.log('Team: ' + firstTeam.teamName);
  fantraxSample.forEach((item, i) => Logger.log('Item ' + i + ': ' + JSON.stringify(item)));
  return { ok: true, sheetSample, fantraxSample, fantraxTeam: firstTeam.teamName };
}

// ── Debug: inspect raw Fantrax data for MiLB-eligible MLB players ─────────────
// Run this from the Script Editor to see exactly what fields Fantrax returns
// for players with the green "M" (MiLB eligible). Check the Execution Log.
// Run from Script Editor to verify MiLB-eligible detection.
// contract.smallId='Q' = MiLB/indefinite keeper contract.
// Flags: (1) MINORS-slot players, (2) ACTIVE/RESERVE players with Q contract
// (MiLB-eligible in MLB slots — the green-M case), (3) anyone named Bericoto.
function debugMiLBEligibility() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const data = fetchFantrax('getTeamRosters');
  const leagueInfo = fetchFantrax('getLeagueInfo');
  const leaguePInfo = (leagueInfo && leagueInfo.playerInfo) || {};

  const results = [];
  const rostersObj = data.rosters || {};
  Object.entries(rostersObj).forEach(([, teamData]) => {
    (teamData.rosterItems || []).forEach(item => {
      const pid             = String(item.id || '').trim();
      const pinfo           = leaguePInfo[pid] || {};
      const name            = pinfo.name || item.name || pid;
      const contractSmallId = item.contract ? String(item.contract.smallId || '') : '';
      const fantraxStatus   = String(item.status || '').toUpperCase();
      const isBericoto      = name.toLowerCase().includes('bericoto');
      const isMinors        = fantraxStatus === 'MINORS';
      // Q contract + ACTIVE/RESERVE = MiLB-eligible player placed in MLB slot
      const isQinMLBSlot    = contractSmallId === 'Q' &&
                              (fantraxStatus === 'ACTIVE' || fantraxStatus === 'RESERVE');

      if (isBericoto || isMinors || isQinMLBSlot) {
        results.push({
          flag:          isBericoto ? 'BERICOTO' : isQinMLBSlot ? 'Q_IN_MLB_SLOT' : 'MINORS',
          name,
          pid,
          team:          teamData.teamName,
          fantraxStatus: item.status,
          contractSmallId,
          contractName:  item.contract ? item.contract.name : '',
          eligiblePos:   pinfo.eligiblePos || '',
          rawItem:       JSON.stringify(item),
        });
      }
    });
  });

  const qInMLB = results.filter(r => r.flag === 'Q_IN_MLB_SLOT');
  const minors  = results.filter(r => r.flag === 'MINORS');
  Logger.log('=== SUMMARY: Q_IN_MLB_SLOT=' + qInMLB.length + '  MINORS=' + minors.length + '  total=' + results.length);
  Logger.log('=== Q-contract players in MLB slots (will be labeled MiLB):');
  qInMLB.forEach(r => Logger.log(JSON.stringify(r)));
  Logger.log('=== MINORS slot players (first 10):');
  minors.slice(0, 10).forEach(r => Logger.log(JSON.stringify(r)));
  return { ok: true, qInMLBSlot: qInMLB.length, minors: minors.length };
}

// ── Debug: verify MiLB eligibility via MLB Stats API career stats ─────────────
// Looks up Bericoto, Rodriguez (MiLB eligible), and Kim (not eligible) by name,
// fetches career MLB AB and IP, and checks against league thresholds (<130 AB, <50 IP).
function debugMLBApiMiLBCheck() {
  const PLAYERS = [
    { name: 'Victor Bericoto',  expect: true  },
    { name: 'Jesus Rodriguez',  expect: true  },
    { name: 'Hyeseong Kim',     expect: false },
  ];
  const AB_THRESHOLD = 130;
  const IP_THRESHOLD = 50;

  PLAYERS.forEach(p => {
    Logger.log('--- ' + p.name + ' (expect MiLB eligible: ' + p.expect + ') ---');
    try {
      // Step 1: find MLB player id by name
      const searchUrl = 'https://statsapi.mlb.com/api/v1/people/search?names=' +
                        encodeURIComponent(p.name) + '&sportIds=1,11,12,13,14,15,16';
      const searchResp = JSON.parse(UrlFetchApp.fetch(searchUrl, {muteHttpExceptions: true}).getContentText());
      Logger.log('  search raw: ' + JSON.stringify(searchResp).substring(0, 300));
      const person = searchResp.people && searchResp.people[0];
      if (!person) { Logger.log('  NOT FOUND in MLB API'); return; }
      const mlbId = person.id;
      Logger.log('  mlbId=' + mlbId + ' fullName=' + person.fullName);

      // Step 2: career hitting stats (AB)
      const hitUrl = 'https://statsapi.mlb.com/api/v1/people/' + mlbId +
                     '/stats?stats=career&group=hitting&sportId=1';
      const hitResp = JSON.parse(UrlFetchApp.fetch(hitUrl, {muteHttpExceptions: true}).getContentText());
      const hitSplit = hitResp.stats && hitResp.stats[0] && hitResp.stats[0].splits && hitResp.stats[0].splits[0];
      const careerAB = hitSplit ? (hitSplit.stat.atBats || 0) : 0;
      Logger.log('  career MLB AB: ' + careerAB + ' (threshold <' + AB_THRESHOLD + ')');

      // Step 3: career pitching stats (IP)
      const pitchUrl = 'https://statsapi.mlb.com/api/v1/people/' + mlbId +
                       '/stats?stats=career&group=pitching&sportId=1';
      const pitchResp = JSON.parse(UrlFetchApp.fetch(pitchUrl, {muteHttpExceptions: true}).getContentText());
      const pitchSplit = pitchResp.stats && pitchResp.stats[0] && pitchResp.stats[0].splits && pitchResp.stats[0].splits[0];
      const careerIP = pitchSplit ? parseFloat(pitchSplit.stat.inningsPitched || '0') : 0;
      Logger.log('  career MLB IP: ' + careerIP + ' (threshold <' + IP_THRESHOLD + ')');

      const eligible = careerAB < AB_THRESHOLD && careerIP < IP_THRESHOLD;
      Logger.log('  MiLB ELIGIBLE: ' + eligible + ' | expected: ' + p.expect +
                 (eligible === p.expect ? ' ✓ MATCH' : ' ✗ MISMATCH'));
    } catch(e) {
      Logger.log('  ERROR: ' + e.message);
    }
  });
}

// ── Debug: full raw dump of every player on the Wetherholt 45s roster ────────
// Run from Script Editor. Shows fantraxStatus + leaguePInfo for every player
// so you can compare ACTIVE vs MINORS vs MiLB-eligible side by side.
function debugWetherholtRoster() {
  const TARGET_TEAM = 'wetherholt 45s'; // case-insensitive match
  const data        = fetchFantrax('getTeamRosters');
  const leagueInfo  = fetchFantrax('getLeagueInfo');
  const leaguePInfo = (leagueInfo && leagueInfo.playerInfo) || {};
  const rostersObj  = data.rosters || {};

  let teamData = null;
  Object.values(rostersObj).forEach(td => {
    if (String(td.teamName || '').toLowerCase().includes(TARGET_TEAM.toLowerCase())) teamData = td;
  });
  if (!teamData) {
    Logger.log('Team "' + TARGET_TEAM + '" not found. Available: ' +
      Object.values(rostersObj).map(t => t.teamName).join(', '));
    return;
  }

  Logger.log('=== ' + teamData.teamName + ' — ' + (teamData.rosterItems || []).length + ' players ===');
  (teamData.rosterItems || []).forEach(item => {
    const pid    = String(item.id || '').trim();
    const pinfo  = leaguePInfo[pid] || {};
    Logger.log(JSON.stringify({
      name:          pinfo.name || item.name || pid,
      pid,
      fantraxStatus: item.status,          // ACTIVE / RESERVE / INJURED_RESERVE / MINORS
      leagueStatus:  pinfo.status || '',   // 'T' for MiLB-eligible?
      eligiblePos:   pinfo.eligiblePos || '',
      salary:        item.salary,
      rawItem:       item,
      rawLeague:     pinfo,
    }));
  });
}

// ── Debug: compare 3 specific players to find the MiLB-eligibility flag ──────
// Bericoto (051wu) + Jesus Rodriguez (052h8) = MiLB eligible (green M).
// Hyeseong Kim (06in4) = NOT eligible (career AB > 130).
// All 3 are in RESERVE slots on Wetherholt 45s.
// Run from Script Editor to see if any API field differs between the eligible vs non-eligible pair.
function debugCompareReservePlayers() {
  const KNOWN_PIDS = {
    '051wu': 'Bericoto, Victor (MiLB ELIGIBLE)',
    '052h8': 'Rodriguez, Jesus (MiLB ELIGIBLE)',
    '06in4': 'Kim, Hyeseong (NOT eligible)',
  };
  const TARGETS = ['bericoto', 'rodriguez', 'kim'];

  // ── A: fetch getPlayerIds to build name → pid map ─────────────────────────
  Logger.log('=== A: getPlayerIds — build name→pid map ===');
  const nameToPid  = {};  // lowercase fragment → pid
  const pidToName  = {};
  const pidToRaw   = {};  // pid → full player object from getPlayerIds
  try {
    const pd  = fetchFantrax('getPlayerIds');
    const raw = JSON.stringify(pd);
    Logger.log('getPlayerIds top-level keys: ' + Object.keys(pd).join(', '));
    // Try common shapes
    const playerMap = pd.players || pd.playerInfo || pd;
    Object.entries(playerMap).forEach(([key, val]) => {
      if (!val || typeof val !== 'object') return;
      const name = String(val.name || val.playerName || val.fullName || '').trim();
      const pid  = String(val.id || val.fantraxId || val.playerId || key).trim();
      if (!name || !pid) return;
      pidToName[pid]           = name;
      pidToRaw[pid]            = val;
      nameToPid[name.toLowerCase()] = pid;
    });
    TARGETS.forEach(t => {
      const found = Object.keys(nameToPid).filter(n => n.includes(t));
      Logger.log('Name search "' + t + '": ' + JSON.stringify(found.slice(0, 5)));
      found.slice(0, 3).forEach(n => Logger.log('  → pid ' + nameToPid[n] + ': ' + JSON.stringify(pidToRaw[nameToPid[n]])));
    });
    if (!Object.keys(pidToName).length) {
      Logger.log('WARNING: could not parse player names from getPlayerIds. Raw sample: ' + raw.substring(0, 600));
    }
  } catch(e) { Logger.log('getPlayerIds ERROR: ' + e.message); }

  // ── B: locate all 3 in getTeamRosters ─────────────────────────────────────
  Logger.log('=== B: getTeamRosters — find all 3 targets ===');
  const foundInRoster = {}; // pid → { team, item }
  try {
    const rosters = fetchFantrax('getTeamRosters');
    const raw = JSON.stringify(rosters);
    // Search raw for names directly (in case names appear in roster response)
    TARGETS.forEach(t => {
      const idx = raw.toLowerCase().indexOf(t);
      if (idx >= 0) Logger.log('Raw roster search "' + t + '": ' + raw.substring(Math.max(0, idx - 30), idx + 200));
    });
    // Search by pid if we found them in step A
    Object.values(rosters.rosters || {}).forEach(td => {
      (td.rosterItems || []).forEach(item => {
        const pid  = String(item.id || '').trim();
        const name = pidToName[pid] || '';
        const isTarget = TARGETS.some(t => name.toLowerCase().includes(t));
        if (isTarget) {
          foundInRoster[pid] = { team: td.teamName, name, item };
          Logger.log('Found target "' + name + '" (pid=' + pid + ') on "' + td.teamName +
            '" — fantraxStatus=' + item.status + ' raw=' + JSON.stringify(item));
        }
      });
    });
    if (!Object.keys(foundInRoster).length) {
      Logger.log('Targets not found by pid — dumping ALL RESERVE items with their raw data:');
      Object.values(rosters.rosters || {}).forEach(td => {
        (td.rosterItems || []).forEach(item => {
          if (item.status === 'RESERVE') {
            Logger.log('RESERVE pid=' + item.id + ' team=' + td.teamName + ' raw=' + JSON.stringify(item));
          }
        });
      });
    }
  } catch(e) { Logger.log('getTeamRosters ERROR: ' + e.message); }

  // ── C: compare getLeagueInfo.playerInfo for each found pid ─────────────────
  Logger.log('=== C: getLeagueInfo.playerInfo for each target ===');
  try {
    const info    = fetchFantrax('getLeagueInfo');
    const pInfo   = info.playerInfo || {};
    Logger.log('getLeagueInfo top-level keys: ' + Object.keys(info).join(', '));
    Object.entries(foundInRoster).forEach(([pid, data]) => {
      Logger.log('playerInfo[' + pid + '] (' + data.name + '): ' + JSON.stringify(pInfo[pid]));
    });
    // Also show a full-detail pid entry to see ALL possible keys
    const samplePid = Object.keys(pInfo)[0];
    Logger.log('Sample playerInfo entry (first pid=' + samplePid + '): ' + JSON.stringify(pInfo[samplePid]));
  } catch(e) { Logger.log('getLeagueInfo ERROR: ' + e.message); }

  // ── D: try stats endpoints for each found pid ──────────────────────────────
  Logger.log('=== D: probe stats endpoints for career AB/IP ===');
  const pids = Object.keys(foundInRoster).join(',') || '06aw3';
  [
    { ep: 'getPlayerStats',       params: { playerIds: pids } },
    { ep: 'getPlayerStats',       params: { playerIds: pids, scoringPeriod: 0 } },
    { ep: 'getPlayerCareerStats', params: { playerIds: pids } },
    { ep: 'getPlayerInfo',        params: { playerIds: pids } },
    { ep: 'getStatsForPlayers',   params: { playerIds: pids } },
  ].forEach(c => {
    try {
      const r = fetchFantrax(c.ep, c.params);
      Logger.log(c.ep + ' ' + JSON.stringify(c.params) + ' → ' + JSON.stringify(r).substring(0, 600));
    } catch(e) {
      Logger.log(c.ep + ' ERROR: ' + e.message);
    }
  });
}

// ── Debug: find eligible positions endpoint ───────────────────────────────────
// Run this to probe which endpoint exposes multi-position eligibility.
function debugEligiblePositions() {
  const wetherholtId = '06aw3'; // JJ Wetherholt — expect "2B,SS" or similar

  // ── A: Deep dump of getLeagueInfo — look for wetherholt anywhere ──────────
  try {
    const info = fetchFantrax('getLeagueInfo');
    Logger.log('=== getLeagueInfo top keys: ' + Object.keys(info).join(', '));
    const raw = JSON.stringify(info);
    const idx = raw.indexOf(wetherholtId);
    if (idx >= 0) {
      Logger.log('getLeagueInfo: found ' + wetherholtId + ' at ' + idx + ': ' + raw.substring(Math.max(0, idx-30), idx+300));
    } else {
      Logger.log('getLeagueInfo: ' + wetherholtId + ' not found. Length=' + raw.length + '. First 600: ' + raw.substring(0, 600));
    }
  } catch(e) { Logger.log('getLeagueInfo ERROR: ' + e.message); }

  // ── B: getTeamRosters — dump full raw for first team to see ALL fields ────
  try {
    const rosters = fetchFantrax('getTeamRosters');
    const firstTeam = Object.values(rosters.rosters || rosters || {})[0] || {};
    const items = firstTeam.rosterItems || firstTeam.players || [];
    // Find Wetherholt or just dump first 2 items fully
    const target = items.find(i => i.id === wetherholtId) || items[0] || null;
    Logger.log('=== getTeamRosters item (all fields): ' + JSON.stringify(target));
    // Also check raw for wetherholt
    const raw2 = JSON.stringify(rosters);
    const idx2 = raw2.indexOf(wetherholtId);
    if (idx2 >= 0) {
      Logger.log('getTeamRosters: found ' + wetherholtId + ': ' + raw2.substring(Math.max(0, idx2-30), idx2+300));
    } else {
      Logger.log('getTeamRosters: ' + wetherholtId + ' not in response at all');
    }
  } catch(e) { Logger.log('getTeamRosters ERROR: ' + e.message); }

  // ── C: getPlayerIds with explicit playerIds param ─────────────────────────
  try {
    const pd = fetchFantrax('getPlayerIds', { playerIds: wetherholtId });
    Logger.log('=== getPlayerIds?playerIds=06aw3: ' + JSON.stringify(pd).substring(0, 600));
  } catch(e) { Logger.log('getPlayerIds+playerIds ERROR: ' + e.message); }

  // ── D: Probe more endpoint name variations ────────────────────────────────
  const probes = [
    { name: 'getStandings',           params: {} },
    { name: 'getLeagueSettings',      params: {} },
    { name: 'getPlayerInfo',          params: { playerIds: wetherholtId } },
    { name: 'getPlayerCard',          params: { playerId: wetherholtId } },
    { name: 'getLeaguePlayers',       params: {} },
    { name: 'getAllPlayers',          params: {} },
    { name: 'getAvailablePlayers',    params: {} },
    { name: 'getFreeAgents',          params: {} },
    { name: 'getPlayers',             params: {} },
    { name: 'getRosters',             params: {} },
    { name: 'getLeagueRosterInfo',    params: {} },
    { name: 'getPlayerPositions',     params: {} },
    { name: 'getPositionEligibility', params: {} },
    { name: 'getScoring',             params: {} },
    { name: 'getMatchups',            params: {} },
    { name: 'getTeamInfo',            params: {} },
  ];

  probes.forEach(ep => {
    try {
      const data = fetchFantrax(ep.name, ep.params);
      const raw = JSON.stringify(data);
      const topKeys = Object.keys(data).join(', ');
      const idx = raw.indexOf(wetherholtId);
      if (idx >= 0) {
        Logger.log('FOUND ' + ep.name + ': ' + wetherholtId + ' at ' + idx + ': ' + raw.substring(Math.max(0,idx-30), idx+300));
      } else {
        Logger.log('OK ' + ep.name + ' (no ' + wetherholtId + '): keys=' + topKeys + ' len=' + raw.length);
      }
    } catch(e) {
      const msg = e.message || '';
      if (msg.includes('Unable to find method')) {
        Logger.log('INVALID ' + ep.name);
      } else {
        Logger.log('ERROR ' + ep.name + ': ' + msg.substring(0, 100));
      }
    }
  });
}

// ── Debug: find where eligible positions live in Fantrax API ──────────────────
// Run this from the Apps Script editor to see all fields returned by getPlayerIds
// for a few known player IDs. Look for any field that lists multiple positions.
function debugPlayerPositions() {
  // Use the same sample IDs we already know from debugRosterValues
  const sampleIds = ['02hfr', '02jh6', '02c47', '03qju', '0569p'];

  // 1. Check getPlayerIds
  try {
    const data = fetchFantrax('getPlayerIds');
    const hits = sampleIds.map(id => {
      const p = data[id];
      if (!p) return id + ': NOT FOUND';
      // Log every field on the player object
      const fields = Object.keys(p).map(k => k + '=' + JSON.stringify(p[k])).join(', ');
      return id + ': ' + fields;
    });
    Logger.log('=== getPlayerIds results ===');
    hits.forEach(h => Logger.log(h));
  } catch(e) {
    Logger.log('getPlayerIds ERROR: ' + e.message);
  }

  // 2. Check getTeamRosters with addPlayerInfo=true
  try {
    const data2 = fetchFantrax('getTeamRosters', { addPlayerInfo: true });
    const firstTeam2 = Object.values(data2.rosters || {})[0] || {};
    const sample2 = (firstTeam2.rosterItems || []).slice(0, 3);
    Logger.log('=== getTeamRosters?addPlayerInfo=true ===');
    sample2.forEach((item, i) => Logger.log('Item ' + i + ': ' + JSON.stringify(item)));
  } catch(e) {
    Logger.log('getTeamRosters+addPlayerInfo ERROR: ' + e.message);
  }
}
