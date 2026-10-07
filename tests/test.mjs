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
assert.equal(ext._icon.gicon, '/ext/icons/tablet-symbolic.svg');
assert.equal(ext._button.accessible_name, 'Tablet mode');
assert.equal(T[1], undefined, 'no keyboard poll without the kernel node');
assert.equal(Main.wm.kb.length, 1, 'keybinding registered');

Main.wm.kb[0].cb(); flush();   // shortcut toggles
assert.equal(ext._icon.gicon, '/ext/icons/laptop-symbolic.svg');
assert.equal(controls.margin_bottom, 1280, 'overview margin = half of built-in monitor');
assert.deepEqual(ext._overlay.pos, [0, 1280]);
assert.deepEqual(calls(), [true, false]);

click(); flush();
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

// shortcut shows a popup in the top half of the built-in monitor; click does not
const kbToggle = Main.wm.kb[0].cb;
globalThis.__timers['ms1500']?.();               // popup left over from the earlier shortcut use
click(); flush();
assert.equal(Main.uiGroup.kids.length, 0, 'clicking the panel entry shows no popup');
kbToggle(); flush();
assert.equal(Main.uiGroup.kids.length, 1, 'shortcut shows a popup');
assert.deepEqual(Main.uiGroup.kids[0].pos, [924, 307], 'popup is centred in the upper part of the screen');
kbToggle(); flush();
assert.equal(Main.uiGroup.kids.length, 1, 'a new popup replaces the old one');
globalThis.__timers['ms1500']();
assert.equal(Main.uiGroup.kids.length, 0, 'popup goes away after its timeout');
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
click(); flush();
assert.equal(mc._getInset(), 0, 'tablet mode removes the modal inset');
click(); flush();
assert.equal(mc._getInset(), 1280);
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

ext.disable(); flush();
assert.equal(dlg.box.constraints.length, 1, 'lock constraints removed on disable');
assert.equal(modal._backgroundBin.constraints.length, 1, 'modal constraints removed on disable');
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
console.log('ALL TESTS PASSED');
