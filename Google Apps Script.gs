// ════════════════════════════════════════════════════════════════════════════
//  BLC Offseason Hub — Google Apps Script Backend
//  Paste this entire file into your Apps Script project (Extensions → Apps Script)
//  Then deploy as Web App: Execute as "Me", Access "Anyone"
// ════════════════════════════════════════════════════════════════════════════
const SHEET_ID = '1isrFPsDq4n4mTr1uUSUydCUi39mCqmkYLEd6voy8nhI'; // ← Replace with your Google Sheet ID
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
      case 'refreshFantrax':
        return corsResponse(refreshFantrax(ss, payload.targets || ['matchups','rosters','draft']));
      case 'testFantraxConnection':
        return corsResponse(testFantraxConnection());
      case 'debugFantrax':
        return corsResponse(debugFantrax(payload.endpoint, payload.params));
      case 'debugFantraxRosterMatch':
        return corsResponse(debugFantraxRosterMatch());
      case 'populateFantraxPlayerIds':
        return corsResponse(populateFantraxPlayerIds(ss));
      case 'debugRosterValues':
        return corsResponse(debugRosterValues(ss));
      case 'debugGetPlayerIds':
        return corsResponse(debugGetPlayerIds());
      case 'debugFantraxPlayerEndpoints':
        return corsResponse(debugFantraxPlayerEndpoints());
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
    if (key && value) map[key] = value;
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
    headers.forEach((h, i) => { obj[h] = String(row[i] ?? ''); });
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
    if (rowKey === teamKey && (playerId ? rowPlayerId === playerId : rowPlayer === player)) {
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
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
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
    'gelof':      'Gelof My Lawn',
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
      ['2026','Flying Mummies','gelof'],
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
      ['1','holliday','gelof','Regular Season'],
      ['1','wetherholt','jardians','Regular Season'],
      ['2','deferred','prayers','Regular Season'],
      ['2','domingo','perdomo','Regular Season'],
      ['2','holliday','reid','Regular Season'],
      ['2','wetherholt','kurtz','Regular Season'],
      ['2','ironfists','platoon','Regular Season'],
      ['2','danr','brew','Regular Season'],
      ['2','rally','tortured','Regular Season'],
      ['2','parker','lovable','Regular Season'],
      ['2','kiners','gelof','Regular Season'],
      ['2','gunnar','jardians','Regular Season'],
      ['3','platoon','prayers','Regular Season'],
      ['3','brew','perdomo','Regular Season'],
      ['3','deferred','reid','Regular Season'],
      ['3','domingo','kurtz','Regular Season'],
      ['3','ironfists','tortured','Regular Season'],
      ['3','danr','lovable','Regular Season'],
      ['3','rally','gelof','Regular Season'],
      ['3','parker','jardians','Regular Season'],
      ['3','holliday','kiners','Regular Season'],
      ['3','wetherholt','gunnar','Regular Season'],
      ['4','tortured','prayers','Regular Season'],
      ['4','lovable','perdomo','Regular Season'],
      ['4','platoon','reid','Regular Season'],
      ['4','brew','kurtz','Regular Season'],
      ['4','holliday','deferred','Regular Season'],
      ['4','wetherholt','domingo','Regular Season'],
      ['4','ironfists','gelof','Regular Season'],
      ['4','danr','jardians','Regular Season'],
      ['4','rally','kiners','Regular Season'],
      ['4','parker','gunnar','Regular Season'],
      ['5','gelof','prayers','Regular Season'],
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
      ['6','gelof','reid','Regular Season'],
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
      ['7','gelof','deferred','Regular Season'],
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
      ['8','gelof','platoon','Regular Season'],
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
      ['9','gelof','tortured','Regular Season'],
      ['9','jardians','lovable','Regular Season'],
      ['10','holliday','jardians','Regular Season'],
      ['10','danr','prayers','Regular Season'],
      ['10','tortured','domingo','Regular Season'],
      ['10','brew','platoon','Regular Season'],
      ['10','ironfists','kurtz','Regular Season'],
      ['10','gunnar','rally','Regular Season'],
      ['10','wetherholt','reid','Regular Season'],
      ['10','parker','gelof','Regular Season'],
      ['10','deferred','perdomo','Regular Season'],
      ['10','lovable','kiners','Regular Season'],
      ['11','gelof','kiners','Regular Season'],
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
      ['12','platoon','gelof','Regular Season'],
      ['12','parker','lovable','Regular Season'],
      ['12','kurtz','rally','Regular Season'],
      ['12','holliday','tortured','Regular Season'],
      ['12','domingo','jardians','Regular Season'],
      ['12','gunnar','reid','Regular Season'],
      ['12','perdomo','prayers','Regular Season'],
      ['12','ironfists','danr','Regular Season'],
      ['13','rally','kiners','Regular Season'],
      ['13','tortured','deferred','Regular Season'],
      ['13','wetherholt','gelof','Regular Season'],
      ['13','brew','lovable','Regular Season'],
      ['13','kurtz','jardians','Regular Season'],
      ['13','holliday','reid','Regular Season'],
      ['13','domingo','prayers','Regular Season'],
      ['13','gunnar','danr','Regular Season'],
      ['13','platoon','perdomo','Regular Season'],
      ['13','parker','ironfists','Regular Season'],
      ['14','jardians','kiners','Regular Season'],
      ['14','reid','deferred','Regular Season'],
      ['14','rally','gelof','Regular Season'],
      ['14','tortured','lovable','Regular Season'],
      ['14','platoon','wetherholt','Regular Season'],
      ['14','parker','brew','Regular Season'],
      ['14','kurtz','prayers','Regular Season'],
      ['14','holliday','danr','Regular Season'],
      ['14','domingo','perdomo','Regular Season'],
      ['14','gunnar','ironfists','Regular Season'],
      ['15','prayers','kiners','Regular Season'],
      ['15','danr','deferred','Regular Season'],
      ['15','jardians','gelof','Regular Season'],
      ['15','reid','lovable','Regular Season'],
      ['15','rally','wetherholt','Regular Season'],
      ['15','tortured','brew','Regular Season'],
      ['15','kurtz','perdomo','Regular Season'],
      ['15','holliday','ironfists','Regular Season'],
      ['15','platoon','domingo','Regular Season'],
      ['15','parker','gunnar','Regular Season'],
      ['16','perdomo','kiners','Regular Season'],
      ['16','ironfists','deferred','Regular Season'],
      ['16','prayers','gelof','Regular Season'],
      ['16','danr','lovable','Regular Season'],
      ['16','jardians','wetherholt','Regular Season'],
      ['16','reid','brew','Regular Season'],
      ['16','platoon','rally','Regular Season'],
      ['16','parker','tortured','Regular Season'],
      ['16','kurtz','domingo','Regular Season'],
      ['16','holliday','gunnar','Regular Season'],
      ['17','domingo','kiners','Regular Season'],
      ['17','gunnar','deferred','Regular Season'],
      ['17','perdomo','gelof','Regular Season'],
      ['17','ironfists','lovable','Regular Season'],
      ['17','prayers','wetherholt','Regular Season'],
      ['17','danr','brew','Regular Season'],
      ['17','jardians','rally','Regular Season'],
      ['17','reid','tortured','Regular Season'],
      ['17','platoon','kurtz','Regular Season'],
      ['17','parker','holliday','Regular Season'],
      ['18','kurtz','kiners','Regular Season'],
      ['18','holliday','deferred','Regular Season'],
      ['18','domingo','gelof','Regular Season'],
      ['18','gunnar','lovable','Regular Season'],
      ['18','perdomo','wetherholt','Regular Season'],
      ['18','ironfists','brew','Regular Season'],
      ['18','prayers','rally','Regular Season'],
      ['18','danr','tortured','Regular Season'],
      ['18','platoon','jardians','Regular Season'],
      ['18','parker','reid','Regular Season'],
      ['19','platoon','kiners','Regular Season'],
      ['19','parker','deferred','Regular Season'],
      ['19','kurtz','gelof','Regular Season'],
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
function refreshFantrax(ss, targets) {
  const results = {};
  if (targets.includes('matchups')) {
    try { results.matchups = refreshFantraxMatchups(ss); }
    catch(e) { results.matchups = { ok: false, error: e.message }; }
  }
  if (targets.includes('rosters')) {
    try { results.rosters = refreshFantraxRosters(ss); }
    catch(e) { results.rosters = { ok: false, error: e.message }; }
  }
  if (targets.includes('draft')) {
    try { results.draft = refreshFantraxDraft(ss); }
    catch(e) { results.draft = { ok: false, error: e.message }; }
  }
  return { ok: true, results };
}

// ── Refresh matchup scores ────────────────────────────────────────────────────
// Uses getLeagueInfo which returns all periods' matchups with team names.
// Matches teams by name (with aliases) and updates HomeScore/VisitorScore.
function refreshFantraxMatchups(ss) {
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

// ── Refresh rosters ───────────────────────────────────────────────────────────
// Pulls current team rosters from Fantrax and updates the Rosters sheet.
// Matches players by Fantrax player id. Updates teamKey, position, salary,
// status, and contract year for every matched player.
function refreshFantraxRosters(ss) {
  const data = fetchFantrax('getTeamRosters');
  // Response shape: { period, rosters: { [fantraxTeamId]: { teamName, rosterItems: [{id, position, salary, status, contract:{name}}] } } }
  const rostersObj = data.rosters || (data.data && data.data.rosters) || {};

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
  const idLookup = {};
  rows.forEach((r, i) => {
    const pid = String(r[idIdx] || '').trim();
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
    if (!ownerKey) return; // couldn't match team name to an ownerKey

    (teamData.rosterItems || []).forEach(item => {
      const pid      = String(item.id || '').trim();
      const pos      = String(item.position || '').trim();
      const salary   = item.salary != null ? Number(item.salary) : null;
      const status   = STATUS_FANTRAX[item.status] || '';
      const contract = item.contract ? String(item.contract.name || '') : '';
      if (!pid) return;

      const rowIdx = idLookup[pid];
      if (rowIdx === undefined) { notFound++; return; }

      const rowNum = rowIdx + 2; // +1 for header row, +1 for 1-based index
      if (teamIdx     >= 0)               sheet.getRange(rowNum, teamIdx     + 1).setValue(ownerKey);
      if (posIdx      >= 0 && pos)        sheet.getRange(rowNum, posIdx      + 1).setValue(pos);
      if (salIdx      >= 0 && salary != null) sheet.getRange(rowNum, salIdx  + 1).setValue(salary);
      if (statusIdx   >= 0 && status)     sheet.getRange(rowNum, statusIdx   + 1).setValue(status);
      if (contractIdx >= 0 && contract)   sheet.getRange(rowNum, contractIdx + 1).setValue(contract);
      updated++;
    });
  });

  Logger.log('refreshFantraxRosters: updated=' + updated + ' notFound=' + notFound);
  return { ok: true, updated, notFound };
}

// ── Refresh draft results ─────────────────────────────────────────────────────
// Pulls completed draft picks from Fantrax and writes/updates the Picks sheet.
function refreshFantraxDraft(ss) {
  const data = fetchFantrax('getDraftResults');
  // Shape: data.draftResults = [{ round, pick, teamId, playerName, position, proTeam, ... }]
  const picks = data.draftResults || (data.data && data.data.draftResults) || data.picks || [];
  if (!picks.length) return { ok: true, updated: 0, message: 'No draft results from Fantrax' };

  const ownerMap  = getOwnerMap(ss);
  const teamList  = data.teams || (data.data && data.data.teams) || [];
  const fantraxTeams = {};
  teamList.forEach(t => {
    const tid = String(t.id || t.teamId || '').trim();
    const tname = String(t.name || t.teamName || '').trim().toLowerCase();
    for (const [key, name] of Object.entries(ownerMap)) {
      if (name.toLowerCase() === tname) { fantraxTeams[tid] = key; break; }
    }
  });

  const sheet = ss.getSheetByName('Picks') || ss.insertSheet('Picks');
  if (sheet.getLastRow() === 0) {
    const hdr = ['round','pick','team','player','mlb_team','position','salary','contract','key'];
    sheet.appendRow(hdr);
    sheet.getRange(1, 1, 1, hdr.length).setFontWeight('bold').setBackground('#0d1b2a').setFontColor('#c9a84c');
  }

  const [headers, ...existingRows] = sheet.getDataRange().getValues();
  const roundIdx = headers.indexOf('round');
  const pickIdx  = headers.indexOf('pick');
  const teamIdx  = headers.indexOf('team');
  const playerIdx = headers.indexOf('player');
  const mlbIdx   = headers.indexOf('mlb_team');
  const posIdx   = headers.indexOf('position');

  // Build existing lookup: round|pick → row number (2-indexed)
  const existing = {};
  existingRows.forEach((r, i) => {
    const k = String(r[roundIdx] || '') + '|' + String(r[pickIdx] || '');
    existing[k] = i + 2;
  });

  let updated = 0; let added = 0;
  picks.forEach(p => {
    const round  = String(p.round || p.roundNum || '').trim();
    const pick   = String(p.pick  || p.pickNum  || p.overallPick || '').trim();
    const teamId = String(p.teamId || p.rosterId || '').trim();
    const ownerKey = fantraxTeams[teamId] || '';
    const player  = String(p.playerName || p.name || p.player || '').trim();
    const mlbTeam = String(p.proTeam || p.mlbTeam || p.team || '').trim();
    const pos     = String(p.positions || p.position || '').trim();
    if (!round || !pick || !player) return;

    const lookupKey = round + '|' + pick;
    if (existing[lookupKey]) {
      const rowNum = existing[lookupKey];
      if (teamIdx >= 0 && ownerKey) sheet.getRange(rowNum, teamIdx + 1).setValue(ownerKey);
      if (playerIdx >= 0 && player) sheet.getRange(rowNum, playerIdx + 1).setValue(player);
      if (mlbIdx >= 0 && mlbTeam)   sheet.getRange(rowNum, mlbIdx + 1).setValue(mlbTeam);
      if (posIdx >= 0 && pos)       sheet.getRange(rowNum, posIdx + 1).setValue(pos);
      updated++;
    } else {
      const newRow = headers.map(h => {
        if (h === 'round')    return round;
        if (h === 'pick')     return pick;
        if (h === 'team')     return ownerKey;
        if (h === 'player')   return player;
        if (h === 'mlb_team') return mlbTeam;
        if (h === 'position') return pos;
        return '';
      });
      sheet.appendRow(newRow);
      added++;
    }
  });

  Logger.log('refreshFantraxDraft: updated=' + updated + ' added=' + added);
  return { ok: true, updated, added };
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

// ── One-time: populate the id column in Rosters sheet from Fantrax ─────────────
// Uses getPlayerIds?sport=MLB which returns every Fantrax player name → id.
// Matches by normalized name to rows in the Rosters sheet and writes the id column.
function populateFantraxPlayerIds(ss) {
  // Step 1: fetch complete MLB player ID list
  const data = fetchFantrax('getPlayerIds');
  // Response shape: { playerIds: { "Player Name": "fantraxId", ... } }
  // or { players: [ {id, name}, ... ] } — handle both
  const playerMap = {}; // normName → fantraxId
  if (data.playerIds && typeof data.playerIds === 'object') {
    Object.entries(data.playerIds).forEach(([name, id]) => {
      playerMap[normName(name)] = String(id);
    });
  } else {
    const list = data.players || data.adpList || data.data || [];
    if (Array.isArray(list)) {
      list.forEach(p => {
        const name = String(p.name || p.playerName || '').trim();
        const id   = String(p.id   || p.playerId  || '').trim();
        if (name && id) playerMap[normName(name)] = id;
      });
    }
  }

  if (!Object.keys(playerMap).length) {
    const raw = JSON.stringify(data).substring(0, 600);
    return { ok: false, error: 'getPlayerIds returned no data — check response shape', rawSample: raw };
  }

  // Step 2: match player names in Rosters sheet → write id
  const sheet = ss.getSheetByName('Rosters');
  if (!sheet) return { ok: false, error: 'Rosters sheet not found' };
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const playerIdx = headers.indexOf('player');
  const idIdx     = headers.indexOf('id');
  if (playerIdx < 0 || idIdx < 0) return { ok: false, error: 'Rosters sheet missing player or id column' };

  let matched = 0, unmatched = 0;
  rows.forEach((r, i) => {
    if (String(r[idIdx] || '').trim()) return; // already has an id
    const name = String(r[playerIdx] || '').trim();
    if (!name) return;
    const fantraxId = playerMap[normName(name)];
    if (!fantraxId) { unmatched++; return; }
    sheet.getRange(i + 2, idIdx + 1).setValue(fantraxId);
    matched++;
  });

  Logger.log('populateFantraxPlayerIds: matched=' + matched + ' unmatched=' + unmatched + ' playerMapSize=' + Object.keys(playerMap).length);
  return { ok: true, matched, unmatched, playerMapSize: Object.keys(playerMap).length };
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
  const fantraxSample = (firstTeam.rosterItems || []).slice(0, 5).map(item => ({
    id:           item.id,
    salary:       item.salary,
    salaryStr:    String(item.salary),
    contractName: item.contract ? String(item.contract.name) : '',
  }));

  return { ok: true, sheetSample, fantraxSample, fantraxTeam: firstTeam.teamName };
}
