// Bottom Half Blocker: tablet/laptop toggle for the ThinkPad X1 Fold 16.
//
// Modified version of the Bottom Half Blocker extension by somefoo,
// https://github.com/somefoo/ThinkPad-X1-Fold-16-Gen1-Gnome-Extension
// Licensed under the GPL-3.0, like the original (see LICENSE).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as SwitcherPopup from 'resource:///org/gnome/shell/ui/switcherPopup.js';
import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

const KEYBOARD_ATTACHED_PATH = '/sys/devices/platform/thinkpad_acpi/keyboard_attached_on_screen';

// D-Bus service of the tablet-mode daemon, which owns the virtual
// SW_TABLET_MODE input switch that GNOME listens to.
const TABLET_DAEMON_NAME = 'org.probos.TabletMode';
const TABLET_DAEMON_PATH = '/org/probos/TabletMode';
const TABLET_DAEMON_IFACE = 'org.probos.TabletMode';

const SETTINGS_SCHEMA = 'org.gnome.shell.extensions.bottom-half-blocker';
const KEYBINDING_NAME = 'toggle-mode';

// Connector names of the built-in panel; the first one that exists is used.
const BUILTIN_CONNECTORS = ['eDP-1', 'eDP-2', 'eDP-3', 'LVDS-1', 'DSI-1'];

// In laptop mode the keyboard covers the lower half, so there is exactly one
// usable orientation: the built-in panel is turned to this transform
// (0 = normal landscape). The auto-rotate setting is never touched, GNOME's
// tablet mode being off already stops auto-rotation.
const LAPTOP_TRANSFORM = 0;

const DISPLAY_CONFIG_NAME = 'org.gnome.Mutter.DisplayConfig';
const DISPLAY_CONFIG_PATH = '/org/gnome/Mutter/DisplayConfig';
const DISPLAY_CONFIG_METHOD_TEMPORARY = 1;

const KEYBOARD_POLL_SECONDS = 1;
const DAEMON_RETRY_SECONDS = 2;
const DBUS_TIMEOUT_MILLISECONDS = 2000;

// Fraction of the built-in monitor, from the bottom, that the keyboard covers.
const COVERED_FRACTION = 0.5;

// How deep below Main.uiGroup to look for existing MonitorConstraints.
const SCAN_DEPTH = 6;

// Shrinks an actor that is sized by a MonitorConstraint (lock screen, modal
// dialogs, Alt-Tab, OSD, screenshot UI) so it only uses the visible part of the
// monitor. It has to be added after the MonitorConstraint, constraints are
// applied in order. getInset() returns how many pixels to cut off the bottom.
const BottomInsetConstraint = GObject.registerClass(
class BottomInsetConstraint extends Clutter.Constraint {
    _init(getInset) {
        super._init();
        this._getInset = getInset;
    }

    refresh() {
        this.get_actor()?.queue_relayout();
    }

    vfunc_update_allocation(actor, allocation) {
        const inset = this._getInset();

        if (inset > 0) {
            allocation.set_size(
                allocation.get_width(),
                Math.max(1, allocation.get_height() - inset));
        }
    }
});

export default class BottomHalfBlockerExtension extends Extension {
    constructor(metadata) {
        super(metadata);

        // Kept on the instance (not reset in enable()) so the choice survives
        // enable()/disable() cycles, e.g. when the screen is locked.
        this._manualTabletMode = true;
        this._forceTablet = false;
    }

    enable() {
        this._blocked = false;
        this._wantedTabletMode = true;
        this._hasKeyboardAttachedState = false;
        this._keyboardAttached = false;
        this._overlay = null;
        this._overviewMargin = 0;
        this._insetConstraints = new Map();
        this._switcherPopups = new Set();
        this._insetHooksInstalled = false;
        this._trackedConstraints = new Map();
        this._injectionManager = new InjectionManager();
        this._pollSourceId = 0;
        this._retrySourceId = 0;
        this._lastSentTabletMode = null;
        this._daemonRequestInFlight = false;
        this._daemonWarned = false;
        this._keybindingAdded = false;
        this._cancellable = new Gio.Cancellable();
        this._keyboardAttachedFile = Gio.File.new_for_path(KEYBOARD_ATTACHED_PATH);
        this._hasKeyboardAttachedState = this._keyboardAttachedFile.query_exists(null);

        // No menu: clicking or tapping the entry toggles the mode directly.
        this._button = new PanelMenu.Button(0.0, 'Bottom Half Blocker', true);
        this._icons = {
            tablet: Gio.icon_new_for_string(`${this.path}/icons/tablet-symbolic.svg`),
            laptop: Gio.icon_new_for_string(`${this.path}/icons/laptop-symbolic.svg`),
        };
        this._icon = new St.Icon({
            gicon: this._icons.tablet,
            style_class: 'system-status-icon',
        });
        this._button.add_child(this._icon);
        this._addToggleHandler();
        Main.panel.addToStatusArea(this.uuid, this._button);

        this._addKeybinding();

        this._signals = [
            [
                Main.layoutManager,
                Main.layoutManager.connect('monitors-changed', () => this._syncGeometry()),
            ],
            // The overview and the lock screen lay themselves out as if the
            // whole monitor were free, so they are re-adjusted whenever the
            // session changes (lock/unlock) and right before the overview opens.
            [
                Main.sessionMode,
                Main.sessionMode.connect('updated', () => {
                    this._syncOverview(true);
                    this._attachInsets();
                }),
            ],
            [
                Main.overview,
                Main.overview.connect('showing', () => this._syncOverview(true)),
            ],
        ];

        this._refreshBlockedState();

        // The kernel node (when it exists) cannot notify about changes, so it
        // has to be polled. Without it there is nothing to poll.
        if (this._hasKeyboardAttachedState) {
            this._pollSourceId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                KEYBOARD_POLL_SECONDS,
                () => this._refreshBlockedState()
            );
        }
    }

    disable() {
        this._cancellable?.cancel();
        this._cancellable = null;

        for (const [source, signalId] of this._signals ?? [])
            source.disconnect(signalId);

        this._signals = null;

        this._removeInsetHooks();

        if (this._pollSourceId) {
            GLib.Source.remove(this._pollSourceId);
            this._pollSourceId = 0;
        }

        if (this._retrySourceId) {
            GLib.Source.remove(this._retrySourceId);
            this._retrySourceId = 0;
        }

        if (this._keybindingAdded) {
            Main.wm.removeKeybinding(KEYBINDING_NAME);
            this._keybindingAdded = false;
        }
        this._settings = null;

        this._blocked = false;
        this._destroyOverlay();
        this._syncOverview();

        if (this._button) {
            this._button.destroy();
            this._button = null;
        }

        // The overlay is gone, so leave GNOME in the daemon's default state
        // (tablet mode on) instead of a stale "laptop" state.
        if (this._lastSentTabletMode === false)
            this._callDaemon(true, null, null);

        this._icon = null;
        this._icons = null;
        this._toggleGesture = null;
        this._keyboardAttachedFile = null;
    }

    _addToggleHandler() {
        // Current GNOME Shell: gestures handle both mouse clicks and touch taps.
        if (Clutter.ClickGesture) {
            this._toggleGesture = new Clutter.ClickGesture();
            this._toggleGesture.connect('recognize', () => this._toggleMode());
            this._button.add_action(this._toggleGesture);
        } else if (Clutter.ClickAction) {
            // Older shells.
            this._toggleGesture = new Clutter.ClickAction();
            this._toggleGesture.connect('clicked', () => this._toggleMode());
            this._button.add_action(this._toggleGesture);
        } else {
            console.warn(`${this.uuid}: no click handler available, the panel entry cannot be toggled`);
        }
    }

    _addKeybinding() {
        // Needs the compiled schema (glib-compile-schemas schemas/); the panel
        // entry keeps working without it.
        try {
            this._settings = this.getSettings(SETTINGS_SCHEMA);
            const action = Main.wm.addKeybinding(
                KEYBINDING_NAME,
                this._settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW |
                    Shell.ActionMode.LOCK_SCREEN | Shell.ActionMode.UNLOCK_SCREEN,
                () => this._toggleMode(true)
            );

            // The shell reports a refused registration (e.g. the name is
            // already taken) only through this return value.
            if (action === Meta.KeyBindingAction.NONE)
                throw new Error(`the shell did not register the "${KEYBINDING_NAME}" shortcut`);

            this._keybindingAdded = true;
        } catch (error) {
            this._settings = null;
            console.warn(`${this.uuid}: keyboard shortcut unavailable: ${error.message}`);
        }
    }

    _toggleMode(showOsd = false) {
        if (this._hasKeyboardAttachedState) {
            // With keyboard detection the only manual override is forcing
            // tablet mode while the keyboard is attached; with the keyboard
            // detached there is nothing to toggle.
            if (!this._keyboardAttached)
                return;

            this._forceTablet = !this._forceTablet;
        } else {
            this._manualTabletMode = !this._manualTabletMode;
        }

        this._syncState();

        if (showOsd)
            this._showModeOsd();
    }

    // Shows the shell's own volume-style popup. It is moved into the visible
    // half like the other popups, see _scanForMonitorActors().
    _showModeOsd() {
        const monitor = this._findBuiltinMonitor();
        if (!monitor || !this._icons)
            return;

        const tablet = this._wantedTabletMode;
        Main.osdWindowManager.showOne(
            monitor.index,
            tablet ? this._icons.tablet : this._icons.laptop,
            tablet ? 'Tablet mode' : 'Laptop mode',
            null,
            null);
    }

    _callDaemon(tabletMode, cancellable, callback) {
        Gio.DBus.system.call(
            TABLET_DAEMON_NAME,
            TABLET_DAEMON_PATH,
            TABLET_DAEMON_IFACE,
            'SetTabletMode',
            new GLib.Variant('(b)', [tabletMode]),
            null,
            Gio.DBusCallFlags.NONE,
            DBUS_TIMEOUT_MILLISECONDS,
            cancellable,
            callback
        );
    }

    // Keeps GNOME's tablet-mode switch in step with the mode shown in the panel.
    // A failed call (e.g. the daemon is not up yet at login) is retried.
    _syncDaemon() {
        const wanted = this._wantedTabletMode;

        if (!this._cancellable || this._daemonRequestInFlight || this._lastSentTabletMode === wanted)
            return;

        this._daemonRequestInFlight = true;
        this._callDaemon(wanted, this._cancellable, (connection, result) => {
            this._daemonRequestInFlight = false;

            try {
                connection.call_finish(result);
            } catch (error) {
                if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;

                if (!this._daemonWarned) {
                    this._daemonWarned = true;
                    console.warn(`${this.uuid}: SetTabletMode failed, is the tablet-mode service running? ${error.message}`);
                }
                this._scheduleDaemonRetry();
                return;
            }

            this._daemonWarned = false;
            this._lastSentTabletMode = wanted;

            // The wanted mode may have changed while the call was running.
            this._syncDaemon();
        });
    }

    _scheduleDaemonRetry() {
        if (this._retrySourceId || !this._cancellable)
            return;

        this._retrySourceId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            DAEMON_RETRY_SECONDS,
            () => {
                this._retrySourceId = 0;
                this._syncDaemon();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _updateIndicator() {
        if (!this._icon)
            return;

        const tablet = this._wantedTabletMode;
        this._icon.gicon = tablet ? this._icons.tablet : this._icons.laptop;
        this._button.accessible_name = tablet ? 'Tablet mode' : 'Laptop mode';
    }

    // Tablet mode runs none of our code: the hooks are only installed while
    // the overlay is up.
    _applyBlockedState() {
        if (this._blocked) {
            this._installInsetHooks();
            this._ensureOverlay();
            this._syncOverlay();
        } else {
            this._removeInsetHooks();
            this._destroyOverlay();
        }

        this._syncOverview();
        this._syncInsets();
        this._syncRotation();
    }

    // Laptop mode: turn the panel to its one orientation. Tablet mode leaves
    // the rotation alone.
    _syncRotation() {
        if (this._blocked)
            this._rotateBuiltinMonitor(LAPTOP_TRANSFORM);
    }

    // Sets the transform of the built-in monitor through Mutter's display
    // configuration, keeping everything else as it is. Not persistent.
    _rotateBuiltinMonitor(transform) {
        Gio.DBus.session.call(
            DISPLAY_CONFIG_NAME, DISPLAY_CONFIG_PATH, DISPLAY_CONFIG_NAME,
            'GetCurrentState', null, null,
            Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MILLISECONDS, this._cancellable,
            (connection, result) => {
                try {
                    const state = connection.call_finish(result).recursiveUnpack();
                    this._applyTransform(state, transform);
                } catch (error) {
                    if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        return;

                    console.warn(`${this.uuid}: could not rotate the screen: ${error.message}`);
                }
            }
        );
    }

    _applyTransform(state, transform) {
        const [serial, monitors, logicalMonitors] = state;

        const monitorManager = global.backend.get_monitor_manager();
        const builtin = BUILTIN_CONNECTORS.find(connector => monitorManager.get_monitor_for_connector(connector) >= 0);
        if (!builtin)
            return;

        const currentModeId = connector => {
            const monitor = monitors.find(m => m[0][0] === connector);
            return monitor?.[1].find(mode => mode[6]['is-current'])?.[0];
        };

        let changed = false;
        const config = logicalMonitors.map(([x, y, scale, current, primary, members]) => {
            const isBuiltin = members.some(member => member[0] === builtin);
            if (isBuiltin && current !== transform)
                changed = true;

            return [
                x, y, scale, isBuiltin ? transform : current, primary,
                members.map(member => [member[0], currentModeId(member[0]), {}]),
            ];
        });

        if (!changed)
            return;

        Gio.DBus.session.call(
            DISPLAY_CONFIG_NAME, DISPLAY_CONFIG_PATH, DISPLAY_CONFIG_NAME,
            'ApplyMonitorsConfig',
            new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})',
                [serial, DISPLAY_CONFIG_METHOD_TEMPORARY, config, {}]),
            null, Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MILLISECONDS, this._cancellable,
            (connection, result) => {
                try {
                    connection.call_finish(result);
                } catch (error) {
                    if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`${this.uuid}: could not rotate the screen: ${error.message}`);
                }
            }
        );
    }

    _syncGeometry() {
        this._attachInsets();
        this._syncOverlay();
        this._syncOverview();
        this._syncInsets();
    }

    _refreshBlockedState() {
        this._keyboardAttached = this._readKeyboardAttachedOnScreen();
        this._syncState();
        return GLib.SOURCE_CONTINUE;
    }

    _syncState() {
        const blocked = this._hasKeyboardAttachedState
            ? this._keyboardAttached && !this._forceTablet
            : !this._manualTabletMode;

        this._wantedTabletMode = !blocked;
        this._updateIndicator();
        this._syncDaemon();

        if (this._blocked === blocked)
            return;

        this._blocked = blocked;
        this._applyBlockedState();
    }

    _readKeyboardAttachedOnScreen() {
        try {
            if (!this._hasKeyboardAttachedState)
                return false;

            const [, contents] = this._keyboardAttachedFile.load_contents(null);
            return new TextDecoder().decode(contents).trim() === '1';
        } catch (error) {
            console.debug(`${this.uuid}: failed to read ${KEYBOARD_ATTACHED_PATH}: ${error}`);
            return false;
        }
    }

    // The built-in panel, not necessarily the primary monitor.
    _findBuiltinMonitor() {
        const {monitors, primaryMonitor} = Main.layoutManager;

        try {
            const monitorManager = global.backend.get_monitor_manager();

            for (const connector of BUILTIN_CONNECTORS) {
                const index = monitorManager.get_monitor_for_connector(connector);
                if (index >= 0 && monitors[index])
                    return monitors[index];
            }
        } catch (error) {
            console.debug(`${this.uuid}: could not look up the built-in monitor: ${error}`);
        }

        return primaryMonitor;
    }

    // The bottom half of the built-in monitor, i.e. the part the keyboard covers.
    _getBlockedGeometry() {
        const monitor = this._findBuiltinMonitor();
        if (!monitor)
            return null;

        const height = Math.floor(monitor.height * COVERED_FRACTION);
        return {monitor, height, y: monitor.y + monitor.height - height};
    }

    _ensureOverlay() {
        if (this._overlay)
            return;

        this._overlay = new St.Widget({
            name: 'bottom-half-blocker',
            reactive: true,
            can_focus: false,
            style: 'background-color: #000;',
        });
        this._overlay.set_size(1, 1);

        // Chrome tracking follows the actor's size, position and visibility
        // on its own, so no manual region updates are needed.
        Main.layoutManager.addChrome(this._overlay, {
            affectsStruts: true,
            trackFullscreen: true,
        });
    }

    _destroyOverlay() {
        if (!this._overlay)
            return;

        Main.layoutManager.removeChrome(this._overlay);
        this._overlay.destroy();
        this._overlay = null;
    }

    _syncOverlay() {
        if (!this._overlay || !this._blocked)
            return;

        const geometry = this._getBlockedGeometry();

        if (!geometry) {
            this._overlay.hide();
            return;
        }

        this._overlay.set_position(geometry.monitor.x, geometry.y);
        this._overlay.set_size(geometry.monitor.width, geometry.height);
        this._overlay.show();
    }

    // How much of the given monitor is covered by the overlay, i.e. how far
    // things that are sized to that whole monitor have to shrink.
    _getInsetForMonitor(index) {
        if (!this._blocked || index === undefined || index < 0)
            return 0;

        const geometry = this._getBlockedGeometry();
        return geometry && geometry.monitor.index === index ? geometry.height : 0;
    }

    // The overview and the lock screen are sized to the primary monitor.
    _getPrimaryInset() {
        return this._getInsetForMonitor(Main.layoutManager.primaryMonitor?.index);
    }

    // The overview lays itself out over the whole primary monitor (struts only
    // move its top edge), so it would extend under the overlay. A bottom
    // margin on its controls keeps the dash, workspaces and app grid in the
    // visible half. With force the margin is re-applied even if unchanged, to
    // make the overview lay itself out again (after unlock, before opening).
    _syncOverview(force = false) {
        const margin = this._getPrimaryInset();

        if (margin === this._overviewMargin && !force)
            return;

        const controls = Main.overview?._overview?.controls;
        if (!controls)
            return;

        try {
            if (force && margin > 0)
                controls.margin_bottom = 0;

            controls.margin_bottom = margin;
            controls.queue_relayout();
            this._overviewMargin = margin;
        } catch (error) {
            console.warn(`${this.uuid}: could not adjust the overview: ${error.message}`);
        }
    }

    // Everything the shell sizes with a MonitorConstraint (lock screen, modal
    // dialogs, OSD popups, screenshot UI, ...) is shrunk to the visible half by
    // one hook: every MonitorConstraint that gets created or attached gets a
    // BottomInsetConstraint added after it on the same actor. Constraints that
    // exist already when the extension is enabled are found by a scan.
    _installInsetHooks() {
        if (this._insetHooksInstalled)
            return;

        this._insetHooksInstalled = true;
        const extension = this;

        this._injectionManager.overrideMethod(
            Layout.MonitorConstraint.prototype, '_init',
            original => function (...args) {
                original.apply(this, args);
                extension._trackMonitorConstraint(this);
            });

        // The switcher popups (Alt-Tab, Super+`) have no monitor constraint,
        // they centre their list, and the window thumbnails below it, on the
        // primary monitor themselves while allocating. The whole popup is
        // moved up instead, by half the covered height.
        this._injectionManager.overrideMethod(
            SwitcherPopup.SwitcherPopup.prototype, 'show',
            original => function (...args) {
                const result = original.apply(this, args);
                extension._trackSwitcherPopup(this);
                return result;
            });

        this._attachInsets();
    }

    _removeInsetHooks() {
        this._insetHooksInstalled = false;
        this._injectionManager?.clear();

        for (const [monitorConstraint, signalId] of this._trackedConstraints ?? [])
            monitorConstraint.disconnect(signalId);
        this._trackedConstraints?.clear();

        for (const [actor, constraint] of this._insetConstraints ?? []) {
            try {
                actor.remove_constraint(constraint);
                actor.queue_relayout();
            } catch (error) {
                console.debug(`${this.uuid}: could not remove an inset constraint: ${error}`);
            }
        }
        this._insetConstraints?.clear();

        for (const popup of this._switcherPopups ?? [])
            this._moveSwitcherPopup(popup, 0);
        this._switcherPopups?.clear();
    }

    // Adds the inset to the actor of a MonitorConstraint, now or, when the
    // constraint is not attached yet, as soon as it is.
    _trackMonitorConstraint(monitorConstraint) {
        if (this._trackedConstraints.has(monitorConstraint))
            return;

        if (monitorConstraint.get_actor()) {
            this._addInset(monitorConstraint);
            return;
        }

        const signalId = monitorConstraint.connect('notify::actor', () => {
            if (monitorConstraint.get_actor())
                this._addInset(monitorConstraint);
        });
        this._trackedConstraints.set(monitorConstraint, signalId);
    }

    _addInset(monitorConstraint) {
        const actor = monitorConstraint.get_actor();
        if (this._insetConstraints.has(actor))
            return;

        const constraint = new BottomInsetConstraint(
            () => this._isExcluded(actor, monitorConstraint)
                ? 0
                : this._getConstraintInset(monitorConstraint));
        actor.add_constraint(constraint);
        actor.connect('destroy', () => this._insetConstraints?.delete(actor));
        this._insetConstraints.set(actor, constraint);
    }

    // Constraints on the work area already respect the overlay's struts, the
    // overview is handled by _syncOverview() and the overlay is the cover.
    _isExcluded(actor, monitorConstraint) {
        if (monitorConstraint.work_area)
            return true;

        for (let parent = actor; parent; parent = parent.get_parent?.()) {
            if (parent === this._overlay || parent === Main.layoutManager.overviewGroup)
                return true;
        }

        return false;
    }

    // How many pixels to cut off the bottom of an actor that a
    // MonitorConstraint sizes to a monitor. The monitor is looked up on every
    // layout, dialogs choose theirs after they are created.
    _getConstraintInset(monitorConstraint) {
        if (monitorConstraint.primary)
            return this._getPrimaryInset();

        if (monitorConstraint.focus_monitor)
            return this._getInsetForMonitor(Main.layoutManager.focusIndex);

        return this._getInsetForMonitor(monitorConstraint.index);
    }

    // Picks up the MonitorConstraints that exist already (OSD windows, the
    // screenshot UI, a lock dialog from before the extension was enabled).
    _attachInsets() {
        if (!this._insetHooksInstalled)
            return;

        this._scanForMonitorConstraints(Main.uiGroup, 0);
    }

    _scanForMonitorConstraints(actor, depth) {
        if (!actor)
            return;

        for (const constraint of actor.get_constraints?.() ?? []) {
            if (constraint instanceof Layout.MonitorConstraint)
                this._trackMonitorConstraint(constraint);
        }

        if (depth >= SCAN_DEPTH)
            return;

        for (const child of actor.get_children?.() ?? [])
            this._scanForMonitorConstraints(child, depth + 1);
    }

    _trackSwitcherPopup(popup) {
        if (!this._switcherPopups.has(popup)) {
            this._switcherPopups.add(popup);
            popup.connect('destroy', () => this._switcherPopups?.delete(popup));
        }

        this._moveSwitcherPopup(popup, this._getPrimaryInset() / 2);
    }

    _moveSwitcherPopup(popup, offset) {
        popup.translation_y = offset > 0 ? -offset : 0;
    }

    _syncInsets() {
        for (const popup of this._switcherPopups)
            this._moveSwitcherPopup(popup, this._getPrimaryInset() / 2);

        for (const constraint of this._insetConstraints.values())
            constraint.refresh();
    }
}
