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
      league:      getRosters(ss),
      keepers:     getKeepers(ss),
      ownerMap:    getOwnerMap(ss),
      standings:   getStandings(ss),
      picks:       getPicks(ss),
      stats:       getStats(ss),
      projections: getProjections(ss),
      r5Status:    getR5Status(ss),
      draftPlan:   getDraftPlans(ss),
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
    // Resolve: try as ownerKey first, then treat as teamName (backward compat)
    const teamName = ownerMap[raw] || raw;
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
    // Resolve teamKey → teamName (with backward compat for old teamName rows)
    const teamName = ownerMap[raw] || raw;
    if (!keepers[teamName]) keepers[teamName] = {};
    keepers[teamName][player] = type;
  }
  return keepers;
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