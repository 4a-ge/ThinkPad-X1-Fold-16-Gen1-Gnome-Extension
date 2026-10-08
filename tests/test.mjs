import assert from 'node:assert/strict';
import Ext from '../extension.js';
import * as Main from './stubs/main.js';
const flush = () => { while (globalThis.__pending.length) globalThis.__pending.shift()(); };
const calls = () => globalThis.__log.map(c => c.value);
const click = () => globalThis.__gestures.at(-1).handlers.recognize();
const T = globalThis.__timers;
const fire = sec => { const f = T[sec]; if (!f) return; if (f() === false) delete T[sec]; };
const controls = Main.overview._overview.controls;

const ext = new Ext({});
ext.enable(); flush();
assert.deepEqual(calls(), [true], 'initial state sent once');
assert.equal(globalThis.__lock, false, 'rotation untouched in tablet mode');
assert.equal(globalThis.__applied.length, 0);
assert.equal(ext._icon.gicon, '/ext/icons/tablet-symbolic.svg');
assert.equal(ext._button.accessible_name, 'Tablet mode');
assert.equal(T[1], undefined, 'no keyboard poll without the kernel node');
assert.equal(Main.wm.kb.length, 1, 'keybinding registered');

Main.wm.kb[0].cb(); flush();   // shortcut toggles
assert.equal(ext._icon.gicon, '/ext/icons/laptop-symbolic.svg');
assert.equal(controls.margin_bottom, 1280, 'overview margin = half of built-in monitor');
assert.deepEqual(ext._overlay.pos, [0, 1280]);
assert.deepEqual(calls(), [true, false]);
assert.equal(globalThis.__lock, true, 'laptop mode locks rotation');
assert.equal(globalThis.__applied.length, 1, 'laptop mode rotates the panel');
const [serial, method, config] = globalThis.__applied[0];
assert.equal(serial, 7); assert.equal(method, 1, 'temporary, not persistent');
assert.deepEqual(config, [[0, 0, 1, 0, true, [['eDP-1', 'm2', {}]]]], 'normal landscape, current mode kept');
assert.equal(globalThis.__transform, 0);

click(); flush();
assert.equal(globalThis.__lock, false, 'tablet mode gives rotation back');
assert.equal(ext._icon.gicon, '/ext/icons/tablet-symbolic.svg');
assert.equal(controls.margin_bottom, 0, 'margin removed in tablet mode');
assert.equal(Main.layoutManager.chrome.length, 0);
assert.deepEqual(calls(), [true, false, true]);

// daemon down: one warning, retried on the retry timer, recovers
globalThis.__fail = true;
click(); flush();
assert.equal(globalThis.__warns.length, 1);
assert.ok(T[2], 'retry scheduled');
fire(2); flush();
fire(2); flush();
assert.equal(globalThis.__warns.length, 1, 'only one warning while down');
globalThis.__fail = false;
fire(2); flush();
assert.equal(calls().at(-1), false, 'resent after recovery');
click(); click(); flush();                 // quick double toggle while a call may be in flight
flush();
assert.equal(calls().at(-1), false, 'ends in the last wanted state');

// toggle while a request is in flight is not lost
globalThis.__log.length = 0;
click();                                    // -> tablet, request pending (not flushed)
click();                                    // -> laptop again before reply
flush(); flush();
assert.equal(calls().at(-1), ext._wantedTabletMode, 'final sent state matches wanted state');

// the shortcut shows the shell's OSD (label only, on the built-in monitor); clicking does not
const kbToggle = Main.wm.kb[0].cb;
const shown = Main.osdWindowManager.shown;
shown.length = 0;
click(); flush();
assert.equal(shown.length, 0, 'clicking the panel entry shows no OSD');
kbToggle(); flush();
assert.equal(shown.length, 1, 'shortcut shows an OSD');
const [monitorIndex, icon, label, level, maxLevel] = shown[0];
assert.equal(monitorIndex, 0, 'OSD goes to the built-in monitor');
assert.equal(label, ext._wantedTabletMode ? 'Tablet mode' : 'Laptop mode');
assert.ok(icon.endsWith(ext._wantedTabletMode ? 'tablet-symbolic.svg' : 'laptop-symbolic.svg'));
assert.equal(level, null, 'no level bar');
assert.equal(maxLevel, null);
kbToggle(); flush();
assert.equal(shown.length, 2);
assert.notEqual(shown[0][2], shown[1][2], 'the label follows the mode');
kbToggle(); flush();
click(); flush();                                 // restore the mode we expect below
click(); flush();
// lock screen: dialog created while in laptop mode gets the inset, follows toggles
if (ext._wantedTabletMode) { click(); flush(); }   // make sure we are in laptop mode
const dlg = Main.makeDialog();
globalThis.__idle(); globalThis.__idle = null;
const cons = dlg.box.constraints.at(-1);
assert.equal(dlg.box.constraints.length, 2, 'inset constraint added after the monitor constraint');
assert.equal(cons._getInset(), 1280, 'lock dialog shrinks to the top half in laptop mode');
click(); flush();
assert.equal(cons._getInset(), 0, 'tablet mode removes the inset');
click(); flush();
assert.equal(cons._getInset(), 1280);
// modal dialogs (shutdown, password prompts): inset only on the built-in monitor
const modal = Main.makeModal(0); globalThis.__idle(); globalThis.__idle = null;
const mc = modal._backgroundBin.constraints.at(-1);
assert.equal(modal._backgroundBin.constraints.length, 2, 'modal dialog bin gets the constraint');
assert.equal(mc._getInset(), 1280, 'modal dialog on the built-in monitor shrinks');
modal._monitorConstraint.index = 1;
assert.equal(mc._getInset(), 0, 'modal dialog on another monitor is left alone');
modal._monitorConstraint.index = -1;
assert.equal(mc._getInset(), 0, 'unset monitor index is ignored');
modal._monitorConstraint.index = 0;
// Alt-Tab switcher popup: shrunk to the visible half so it is centred there
const sw = Main.makeSwitcher(); globalThis.__idle(); globalThis.__idle = null;
assert.equal(sw._switcherList.translation_y, -640, 'switcher list moves up by half the covered height');
// screenshot UI: the toolbar's primary-monitor bin and the per-monitor bins shrink
const ss = Main.makeScreenshotUI(); globalThis.__idle(); globalThis.__idle = null;
assert.equal(ss.primaryBin.constraints.length, 2, 'screenshot UI primary bin gets the constraint');
assert.equal(ss.primaryBin.constraints.at(-1)._getInset(), 1280, 'screenshot UI toolbar moves into the visible half');
assert.equal(ss.monitorBin.constraints.at(-1)._getInset(), 1280, 'screenshot UI monitor bin shrinks');
// a constrained actor inside a constrained one is not shrunk twice; work-area constraints are left alone
const nest = Main.makeNested(); globalThis.__idle(); globalThis.__idle = null;
assert.equal(nest.outer.constraints.length, 2, 'outer actor gets the constraint');
assert.equal(nest.outer.inner.constraints.length, 1, 'nested actor is not shrunk twice');
assert.equal(nest.work.constraints.length, 1, 'work-area constraint is left alone');
click(); flush();
assert.equal(sw._switcherList.translation_y, 0, 'tablet mode puts the switcher list back');
assert.equal(mc._getInset(), 0, 'tablet mode removes the modal inset');
click(); flush();
assert.equal(mc._getInset(), 1280);
// volume/brightness popups: one per monitor, shrunk to the visible half
const osd = Main.osdWindowManager._osdWindows[0];
assert.equal(osd.constraints.length, 2, 'OSD window gets the constraint');
const oc = osd.constraints.at(-1);
assert.equal(oc._getInset(), 1280, 'OSD moves into the visible half in laptop mode');
click(); flush();
assert.equal(oc._getInset(), 0, 'tablet mode puts the OSD back');
click(); flush();
const dlg2 = Main.makeDialog(); globalThis.__idle(); globalThis.__idle = null;
assert.equal(dlg2.box.constraints.length, 2);
globalThis.__idle = null;
// forced overview resync (unlock / before opening) re-lays the overview out
const before = controls.relayouts;
ext._syncOverview(true);
assert.equal(controls.margin_bottom, 1280);
assert.ok(controls.relayouts > before, 'forced resync queues a relayout');
// overview recovered even if something reset the margin behind our back
controls.margin_bottom = 0;
ext._syncOverview(true);
assert.equal(controls.margin_bottom, 1280, 'forced resync restores a reset margin');

globalThis.__lock = false;
ext.disable(); flush();
assert.equal(globalThis.__lock, false, 'rotation lock released on disable');
assert.equal(dlg.box.constraints.length, 1, 'lock constraints removed on disable');
assert.equal(modal._backgroundBin.constraints.length, 1, 'modal constraints removed on disable');
assert.equal(osd.constraints.length, 1, 'OSD constraint removed on disable');
assert.equal(calls().at(-1), true, 'tablet mode restored on disable');
assert.equal(controls.margin_bottom, 0);
assert.equal(Main.wm.kb.length, 0, 'keybinding removed');
assert.equal(Main.layoutManager.chrome.length, 0);
assert.equal(globalThis.__button.destroyed, true);
assert.equal(Object.keys(T).length, 0, 'no timers left');

// choice survives enable/disable
ext.enable(); flush();
assert.equal(ext._icon.gicon, '/ext/icons/laptop-symbolic.svg');
ext.disable(); flush();

// missing schema: extension still works
globalThis.__noSchema = true;
const ext3 = new Ext({}); ext3.enable(); flush();
assert.equal(Main.wm.kb.length, 0);
assert.ok(globalThis.__warns.some(w => w.includes('shortcut unavailable')));
click(); flush();
assert.equal(ext3._icon.gicon, '/ext/icons/laptop-symbolic.svg');
ext3.disable(); flush();
globalThis.__noSchema = false;

// shell refuses the shortcut: warned, nothing to remove, panel entry still works
globalThis.__refuse = true; globalThis.__warns.length = 0;
const ext4 = new Ext({}); ext4.enable(); flush();
assert.ok(globalThis.__warns.some(w => w.includes('did not register')), 'refused shortcut is reported');
assert.equal(ext4._keybindingAdded, false);
ext4.disable(); flush();
globalThis.__refuse = false;

// keyboard node present: polling on, click only while attached
const ext2 = new Ext({});
globalThis.__keyboardNode = '0\n';
ext2.enable(); flush();
assert.ok(T[1], 'poll registered when the node exists');
click(); flush();
assert.equal(ext2._wantedTabletMode, true, 'detached: click does nothing');
globalThis.__keyboardNode = '1\n';
fire(1); flush();
assert.equal(ext2._wantedTabletMode, false, 'attached: laptop mode');
click(); flush();
assert.equal(ext2._wantedTabletMode, true, 'click forces tablet while attached');
ext2.disable(); flush();
assert.equal(Object.keys(T).length, 0);

// rotation: already normal -> no call; an existing user lock is kept; failures only warn
globalThis.__applied.length = 0; globalThis.__lock = true; globalThis.__warns.length = 0;
const ext5 = new Ext({}); ext5.enable(); flush();          // starts in laptop mode (choice kept)
if (ext5._wantedTabletMode) { click(); flush(); }
assert.equal(globalThis.__applied.length, 0, 'already normal: nothing applied');
assert.equal(globalThis.__lock, true);
ext5.disable(); flush();
assert.equal(globalThis.__lock, true, 'a lock the user set stays');
globalThis.__lock = false; globalThis.__transform = 3; globalThis.__rotateFail = true;
const ext6 = new Ext({}); ext6.enable(); flush();
if (ext6._wantedTabletMode) { click(); flush(); }
assert.ok(globalThis.__warns.some(w => w.includes('could not rotate')), 'rotation failure is reported');
globalThis.__rotateFail = false;
ext6.disable(); flush();
assert.equal(globalThis.__lock, false);
globalThis.__noOrientationSchema = true; globalThis.__lock = false;
const ext7 = new Ext({}); ext7.enable(); flush();
if (ext7._wantedTabletMode) { click(); flush(); }
assert.equal(globalThis.__lock, false, 'no schema: lock skipped');
ext7.disable(); flush();
globalThis.__noOrientationSchema = false;
console.log('ALL TESTS PASSED');
