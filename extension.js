import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

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

const KEYBOARD_POLL_SECONDS = 1;
const DAEMON_RETRY_SECONDS = 2;

// Shrinks an actor that is sized by a MonitorConstraint (like the lock-screen
// dialog) so it only uses the top part of the monitor. It has to be added
// after the MonitorConstraint, constraints are applied in order.
const BottomInsetConstraint = GObject.registerClass(
class BottomInsetConstraint extends Clutter.Constraint {
    _init() {
        super._init();
        this._inset = 0;
    }

    setInset(inset) {
        if (inset === this._inset)
            return;

        this._inset = inset;
        this.get_actor()?.queue_relayout();
    }

    vfunc_update_allocation(actor, allocation) {
        if (this._inset > 0) {
            allocation.set_size(
                allocation.get_width(),
                Math.max(1, allocation.get_height() - this._inset));
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
        this._lockInsets = new Map();
        this._lockIdleId = 0;
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
                    this._attachLockInsets();
                }),
            ],
            [
                Main.overview,
                Main.overview.connect('showing', () => this._syncOverview(true)),
            ],
        ];

        this._watchLockScreen();

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

        if (this._lockIdleId) {
            GLib.Source.remove(this._lockIdleId);
            this._lockIdleId = 0;
        }

        for (const [box, constraint] of this._lockInsets ?? []) {
            try {
                box.remove_constraint(constraint);
                box.queue_relayout();
            } catch (error) {
                console.debug(`${this.uuid}: could not remove the lock-screen constraint: ${error}`);
            }
        }
        this._lockInsets?.clear();

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
            Main.wm.addKeybinding(
                KEYBINDING_NAME,
                this._settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW |
                    Shell.ActionMode.LOCK_SCREEN | Shell.ActionMode.UNLOCK_SCREEN,
                () => this._toggleMode()
            );
            this._keybindingAdded = true;
        } catch (error) {
            this._settings = null;
            console.warn(`${this.uuid}: keyboard shortcut unavailable: ${error.message}`);
        }
    }

    _toggleMode() {
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
            2000,
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

    _applyBlockedState() {
        if (this._blocked) {
            this._ensureOverlay();
            this._syncOverlay();
        } else {
            this._destroyOverlay();
        }

        this._syncOverview();
        this._syncLockInsets();
    }

    _syncGeometry() {
        this._syncOverlay();
        this._syncOverview();
        this._syncLockInsets();
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

        const height = Math.floor(monitor.height / 2);
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

    // How much of the primary monitor is covered, i.e. how far the overview and
    // the lock screen have to shrink. Both are sized to the primary monitor.
    _getPrimaryInset() {
        if (!this._blocked)
            return 0;

        const geometry = this._getBlockedGeometry();
        const primary = Main.layoutManager.primaryMonitor;

        if (geometry && primary && geometry.monitor.index === primary.index)
            return geometry.height;

        return 0;
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

    // The unlock dialog is created again on every lock, so its children are
    // picked up as they are added.
    _watchLockScreen() {
        const group = Main.screenShield?._lockDialogGroup;
        if (!group)
            return;

        this._signals.push([
            group,
            group.connect('child-added', () => this._scheduleLockInsetAttach()),
        ]);
        this._attachLockInsets();
    }

    _scheduleLockInsetAttach() {
        if (this._lockIdleId)
            return;

        // The dialog builds its contents right after being added.
        this._lockIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._lockIdleId = 0;
            this._attachLockInsets();
            return GLib.SOURCE_REMOVE;
        });
    }

    _attachLockInsets() {
        const group = Main.screenShield?._lockDialogGroup;
        if (!group)
            return;

        for (const dialog of group.get_children()) {
            // The dialog's main box (clock, prompt, notifications) is its last
            // child and is sized by a monitor constraint.
            const box = dialog.get_last_child?.();
            if (!box || this._lockInsets.has(box) || !box.get_constraints?.().length)
                continue;

            const constraint = new BottomInsetConstraint();
            constraint.setInset(this._getPrimaryInset());
            box.add_constraint(constraint);
            box.connect('destroy', () => this._lockInsets.delete(box));
            this._lockInsets.set(box, constraint);
        }
    }

    _syncLockInsets() {
        const inset = this._getPrimaryInset();

        for (const constraint of this._lockInsets.values())
            constraint.setInset(inset);
    }
}
