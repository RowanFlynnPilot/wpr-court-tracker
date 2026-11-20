/**
 * Backstop for the court-record checks, hosted on Google Apps Script.
 *
 * GitHub's scheduler delivers this repo's scheduled runs late and drops
 * many of them. tools/backstop-check.ps1 fills the gaps from a Windows
 * machine, which only works while that machine is on. This file is the
 * same backstop on Google's servers: it runs every 30 minutes whether or
 * not any computer of ours is awake.
 *
 * It follows the same rules as the PowerShell version:
 *   - weekdays, 8 a.m. to 6:10 p.m. Central only;
 *   - it reads the site's own heartbeat.json and asks GitHub to run the
 *     "Update court data and deploy" workflow ONLY when the last check is
 *     110 or more minutes old;
 *   - it never dispatches twice within 100 minutes.
 * It never contacts the court system. It only asks GitHub to run the
 * existing workflow.
 *
 * SETUP (about five minutes, in the newsroom's own Google account)
 *   1. GitHub: Settings > Developer settings > Fine-grained tokens >
 *      Generate new token. Repository access: only this repository.
 *      Permissions: Actions, read and write. Nothing else. Note the
 *      expiry date: the backstop stops when the token expires.
 *   2. script.google.com > New project. Paste this whole file over the
 *      sample code. Save.
 *   3. Project Settings > Script properties > add GITHUB_TOKEN with the
 *      token as its value. (The token lives there, never in this file.)
 *   4. Back in the editor, choose the function `checkToken` and press
 *      Run. Approve the permission prompt. The log should say the token
 *      works. Then run `dryRun`: the log shows what it would do now.
 *   5. Choose `install` and press Run. That creates the 30-minute trigger.
 *   To stop it: run `uninstall`, or delete the trigger under Triggers.
 *
 * The decision itself is the pure function `decide`, which
 * tools/test-backstop.mjs exercises outside Apps Script.
 */

var SITE = 'https://rowanflynnpilot.github.io/wpr-court-tracker';
var REPO = 'RowanFlynnPilot/wpr-court-tracker';
var WORKFLOW_FILE = 'update.yml';
var OVERDUE_MINUTES = 110; // two-hour spacing on a 30-minute tick; the workflow's own gate is 105
var MIN_GAP_MINUTES = 100; // never dispatch twice inside this window
var OPENS = 8 * 60; // 8:00 a.m. Central, in minutes of the day
var CLOSES = 18 * 60 + 10; // 6:10 p.m., so a tick just after 6 can make the day's last check

/**
 * Decide whether to dispatch.
 *   now: { isoWeekday: 1 (Mon) .. 7 (Sun), minuteOfDay, epoch } in Central time
 *   heartbeatEpoch: when the site last attempted a check, or null if unreadable
 *   lastDispatchEpoch: when this backstop last dispatched, or null
 * Returns { dispatch: boolean, why: string }.
 */
function decide(now, heartbeatEpoch, lastDispatchEpoch) {
  if (now.isoWeekday > 5 || now.minuteOfDay < OPENS || now.minuteOfDay > CLOSES) {
    return { dispatch: false, why: 'outside weekdays 8 a.m.-6:10 p.m. Central' };
  }
  if (lastDispatchEpoch != null) {
    var sinceMine = Math.floor((now.epoch - lastDispatchEpoch) / 60);
    if (sinceMine < MIN_GAP_MINUTES) {
      return { dispatch: false, why: 'this backstop dispatched ' + sinceMine + ' min ago' };
    }
  }
  if (heartbeatEpoch == null) {
    return { dispatch: true, why: 'no heartbeat' };
  }
  var age = Math.floor((now.epoch - heartbeatEpoch) / 60);
  if (age < OVERDUE_MINUTES) {
    return { dispatch: false, why: 'last check was ' + age + ' min ago - the schedule is keeping up' };
  }
  return { dispatch: true, why: 'last check was ' + age + ' min ago' };
}

function centralNow_() {
  var d = new Date();
  var parts = Utilities.formatDate(d, 'America/Chicago', 'u H m').split(' ');
  return {
    isoWeekday: Number(parts[0]),
    minuteOfDay: Number(parts[1]) * 60 + Number(parts[2]),
    epoch: Math.floor(d.getTime() / 1000),
  };
}

function readHeartbeat_(epoch) {
  try {
    var res = UrlFetchApp.fetch(SITE + '/heartbeat.json?t=' + epoch, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var at = Number(JSON.parse(res.getContentText()).attemptedAtEpoch);
    return isFinite(at) && at > 0 ? at : null;
  } catch (e) {
    return null;
  }
}

function run_(dry) {
  var props = PropertiesService.getScriptProperties();
  var now = centralNow_();
  var last = props.getProperty('LAST_DISPATCH');
  var verdict = decide(now, readHeartbeat_(now.epoch), last ? Number(last) : null);
  if (!verdict.dispatch) {
    console.log('skip: ' + verdict.why);
    return;
  }
  if (dry) {
    console.log('WOULD dispatch (' + verdict.why + ')');
    return;
  }
  var token = props.getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Set the GITHUB_TOKEN script property first (see the setup notes).');
  var res = UrlFetchApp.fetch(
    'https://api.github.com/repos/' + REPO + '/actions/workflows/' + WORKFLOW_FILE + '/dispatches',
    {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      payload: JSON.stringify({ ref: 'main' }),
      muteHttpExceptions: true,
    }
  );
  // GitHub answers 204 with no body when the run is queued.
  if (res.getResponseCode() !== 204) {
    throw new Error('GitHub refused the dispatch: HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  }
  props.setProperty('LAST_DISPATCH', String(now.epoch));
  console.log('DISPATCHED (' + verdict.why + ')');
}

/** The trigger calls this every 30 minutes. */
function checkAndDispatch() {
  run_(false);
}

/** Prints what it would do, and dispatches nothing. */
function dryRun() {
  run_(true);
}

/**
 * Confirms the token is set and GitHub accepts it, without starting a
 * check: it only reads the workflow's name. (Reading needs less than
 * dispatching does, so also confirm the token's Actions permission says
 * "Read and write".)
 */
function checkToken() {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('No GITHUB_TOKEN script property yet (Project Settings > Script properties).');
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO + '/actions/workflows/' + WORKFLOW_FILE, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('GitHub did not accept the token: HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  }
  console.log('Token works. It can see the workflow "' + JSON.parse(res.getContentText()).name + '".');
}

/** Creates the 30-minute trigger (replacing any earlier one). */
function install() {
  uninstall();
  ScriptApp.newTrigger('checkAndDispatch').timeBased().everyMinutes(30).create();
  console.log('Installed: checkAndDispatch runs every 30 minutes.');
}

/** Removes the trigger. */
function uninstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkAndDispatch') ScriptApp.deleteTrigger(t);
  });
}
