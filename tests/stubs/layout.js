export class MonitorConstraint {
    constructor(props = {}) {
        Object.assign(this, {primary: false, index: -1, focus_monitor: false, work_area: false}, props);
    }
}
