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
        setKeeper(ss, payload.team, payload.player, payload.keeperType);
        break;
      case 'removeKeeper':
        removeKeeper(ss, payload.team, payload.player);
        break;
      case 'editPlayer':
        // payload.fields = { contract, salary, status, ... }
        editPlayerFields(ss, payload.team, payload.player, payload.fields);
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
        r5MovePlayer(ss, payload.player, payload.fromTeam, payload.toTeam, payload.newStatus);
        break;
      case 'saveStats':
        saveStats(ss, payload.stats);
        break;
      case 'saveProjections':
        saveProjections(ss, payload.projections);
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
  const sheet = ss.getSheetByName('Rosters');
  if (!sheet) return {};
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const league = {};
  rows.forEach(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = String(row[i] ?? ''));
    const team = obj.team;
    if (!team) return;
    if (!league[team]) league[team] = [];
    // Remove the 'team' key from the player object (it's the map key)
    const { team: _t, ...player } = obj;
    league[team].push(player);
  });
  return league;
}
function getKeepers(ss) {
  const sheet = ss.getSheetByName('Keepers');
  if (!sheet) return {};
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const keepers = {};
  rows.forEach(row => {
    const [team, player, type] = row;
    if (!team || !player || !type) return;
    if (!keepers[team]) keepers[team] = {};
    keepers[team][player] = type;
  });
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
function getStats(ss) {
  return _readStatsSheet(ss.getSheetByName('Stats'));
}
function getProjections(ss) {
  return _readStatsSheet(ss.getSheetByName('Projections'));
}
// Shared reader: keys by 'Player ID' or 'ID' column when present, falls back to first column
function _readStatsSheet(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return {};
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const idCol = headers.indexOf('Player ID') >= 0 ? headers.indexOf('Player ID')
              : headers.indexOf('ID')        >= 0 ? headers.indexOf('ID')
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
function setKeeper(ss, team, player, keeperType) {
  const sheet = ss.getSheetByName('Keepers');
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === team && data[i][1] === player) {
      sheet.getRange(i + 1, 3).setValue(keeperType);
      return;
    }
  }
  sheet.appendRow([team, player, keeperType]);
}
function removeKeeper(ss, team, player) {
  const sheet = ss.getSheetByName('Keepers');
  const data  = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === team && data[i][1] === player) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}
function editPlayerFields(ss, team, player, fields) {
  const sheet   = ss.getSheetByName('Rosters');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data    = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === team && data[i][1] === player) {
      Object.entries(fields).forEach(([field, value]) => {
        const col = headers.indexOf(field);
        if (col >= 0) sheet.getRange(i + 1, col + 1).setValue(value);
      });
      return;
    }
  }
}
function importRosters(ss, league) {
  const sheet = ss.getSheetByName('Rosters');
  const HEADERS = ['team','player','mlb_team','position','status','salary','contract','id'];
  // Clear existing data (keep header row)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, HEADERS.length).clearContent();
  const rows = [];
  Object.entries(league).forEach(([team, players]) => {
    players.forEach(p => {
      rows.push([
        team,
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
  // Update Settings
  const settingsSheet = ss.getSheetByName('Settings');
  const settingsData  = settingsSheet.getDataRange().getValues();
  for (let i = 1; i < settingsData.length; i++) {
    if (settingsData[i][0] === ownerKey) {
      settingsSheet.getRange(i + 1, 2).setValue(newName);
      break;
    }
  }
  // Update team column in Rosters
  const rosterSheet = ss.getSheetByName('Rosters');
  const rosterData  = rosterSheet.getDataRange().getValues();
  for (let i = 1; i < rosterData.length; i++) {
    if (rosterData[i][0] === oldName) {
      rosterSheet.getRange(i + 1, 1).setValue(newName);
    }
  }
  // Update Keepers
  const keepersSheet = ss.getSheetByName('Keepers');
  const keepersData  = keepersSheet.getDataRange().getValues();
  for (let i = 1; i < keepersData.length; i++) {
    if (keepersData[i][0] === oldName) {
      keepersSheet.getRange(i + 1, 1).setValue(newName);
    }
  }
  // Update Standings
  const standingsSheet = ss.getSheetByName('Standings');
  const standingsData  = standingsSheet.getDataRange().getValues();
  for (let i = 1; i < standingsData.length; i++) {
    if (standingsData[i][0] === oldName) {
      standingsSheet.getRange(i + 1, 1).setValue(newName);
    }
  }
}
function setPick(ss, round, pick, team, player, salary, contract) {
  const sheet = ss.getSheetByName('Picks');
  const data  = sheet.getDataRange().getValues();
  const key   = String(round) + '_' + String(pick);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(round) && String(data[i][1]) === String(pick)) {
      sheet.getRange(i + 1, 3, 1, 5).setValues([[team, player || '', salary || '', contract || '', key]]);
      return;
    }
  }
  sheet.appendRow([round, pick, team, player || '', salary || '', contract || '', key]);
}
// ── Rule 5 player move ───────────────────────────────────────────────────────
function r5MovePlayer(ss, player, fromTeam, toTeam, newStatus) {
  const sheet   = ss.getSheetByName('Rosters');
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const teamCol   = headers.indexOf('team') + 1;
  const playerCol = headers.indexOf('player') + 1;
  const statusCol = headers.indexOf('status') + 1;
  // Normalize inputs — trim whitespace to avoid mismatches from Excel import
  const playerNorm   = String(player).trim();
  const fromTeamNorm = String(fromTeam).trim();
  const toTeamNorm   = String(toTeam).trim();
  for (let i = 1; i < data.length; i++) {
    const rowPlayer = String(data[i][playerCol - 1]).trim();
    const rowTeam   = String(data[i][teamCol - 1]).trim();
    // Match on player name only — find wherever this player currently lives
    // (in case they were already moved by a previous pick)
    if (rowPlayer === playerNorm) {
      sheet.getRange(i + 1, teamCol).setValue(toTeamNorm);
      sheet.getRange(i + 1, statusCol).setValue(newStatus || 'Rule 5');
      Logger.log('r5MovePlayer: moved ' + playerNorm + ' from ' + rowTeam + ' to ' + toTeamNorm);
      return;
    }
  }
  // If we get here, player wasn't found at all — log it
  Logger.log('r5MovePlayer ERROR: could not find player "' + playerNorm + '" in Rosters sheet');
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
  const headers = Object.keys(entries[0][1]);
  const rows = entries.map(([, stat]) => headers.map(h => stat[h] ?? ''));
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
    'Rosters':     ['team','player','mlb_team','position','status','salary','contract','id'],
    'Keepers':     ['team','player','keeperType'],
    'Settings':    ['ownerKey','teamName'],
    'Standings':   ['team','W','L','pct','GB','RS','RA','streak'],
    'Picks':       ['round','pick','team','player','salary','contract','key'],
    'Stats':       ['Player'],
    'Projections': ['Player'],
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
    'defered':    'Defered Victory',
    'domingo':    'Domingo Sherman',
    'gelof':      'Gelof My Lawn',
    'holliday':   'Holliday Road',
    'ironfists':  'Iron Fists',
    'kiners':     'Kiners Korners',
    'kurtz':      'Kurtz Your Enthusiasm',
    'loveable':   'Loveable Losers',
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