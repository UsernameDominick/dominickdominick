import { SIM_COMPONENTS, getSimulationComponentDefinition, getSimulationCanvasBounds, validateBreadboardColumnSizes, validateComponentOrientations, validateLogicGates, validateSwitchPositions } from "./simulation-render.js";

const MAX_MANUAL_WIRE_WAYPOINTS = 20;
const MAX_SIMULATION_CHECKPOINTS = 20;
const MAX_SIMULATION_VIEWS = 12;
// Far above anything the builder canvas holds, well under the database's row size.
export const MAX_SIMULATION_COMPONENTS = 1000;
export const MAX_SIMULATION_WIRES = 5000;
export const MAX_SIMULATION_BYTES = 1000000;

function isSimulationRecordId(value) {
  return (
    (typeof value === "string" &&
      value.length > 0 &&
      value.length <= 160 &&
      !Object.prototype.hasOwnProperty.call(Object.prototype, value)) ||
    Number.isSafeInteger(value)
  );
}

export function simulationDataError(data, requireCircuitArrays = false, allowCheckpoints = true) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "Simulation data must be an object.";
  const hasComponents = Object.prototype.hasOwnProperty.call(data, "components");
  const hasWires = Object.prototype.hasOwnProperty.call(data, "wires");
  if ((requireCircuitArrays || hasComponents) && !Array.isArray(data.components)) return "Simulation components must be an array.";
  if ((requireCircuitArrays || hasWires) && !Array.isArray(data.wires)) return "Simulation wires must be an array.";
  if (Array.isArray(data.components) && data.components.length > MAX_SIMULATION_COMPONENTS) return `A simulation can hold up to ${MAX_SIMULATION_COMPONENTS} parts.`;
  if (Array.isArray(data.wires) && data.wires.length > MAX_SIMULATION_WIRES) return `A simulation can hold up to ${MAX_SIMULATION_WIRES} wires.`;
  if (JSON.stringify(data).length > MAX_SIMULATION_BYTES) return "This simulation is too large to save (over 1 MB of data).";

  const sizeError = validateBreadboardColumnSizes(data);
  if (sizeError) return sizeError;
  const orientationError = validateComponentOrientations(data);
  if (orientationError) return orientationError;
  const logicGateError = validateLogicGates(data);
  if (logicGateError) return logicGateError;
  const switchPositionError = validateSwitchPositions(data);
  if (switchPositionError) return switchPositionError;

  const components = Array.isArray(data.components) ? data.components : [];
  const wires = Array.isArray(data.wires) ? data.wires : [];
  const componentsById = new Map();
  const renderedComponentIds = new Set();
  for (let index = 0; index < components.length; index++) {
    const component = components[index];
    if (
      !component ||
      typeof component !== "object" ||
      Array.isArray(component) ||
      !isSimulationRecordId(component.id) ||
      componentsById.has(component.id) ||
      renderedComponentIds.has(String(component.id)) ||
      typeof component.type !== "string" ||
      !Object.prototype.hasOwnProperty.call(SIM_COMPONENTS, component.type) ||
      !Number.isFinite(component.x) ||
      !Number.isFinite(component.y) ||
      component.x < 0 ||
      component.x > 1500 ||
      component.y < 0 ||
      component.y > 700
    ) {
      return `Component ${index + 1} must have a unique id, supported type, and numeric coordinates inside the builder canvas.`;
    }
    if (component.locked !== undefined && typeof component.locked !== "boolean") {
      return `Component ${index + 1} has an invalid lock setting.`;
    }
    componentsById.set(component.id, component);
    renderedComponentIds.add(String(component.id));
  }
  const canvasBounds = getSimulationCanvasBounds(components);

  const wireIds = new Set();
  for (let wireIndex = 0; wireIndex < wires.length; wireIndex++) {
    const wire = wires[wireIndex];
    const validEndpoint = (end) => {
      if (
        !end ||
        typeof end !== "object" ||
        Array.isArray(end) ||
        !isSimulationRecordId(end.compId) ||
        typeof end.pin !== "string" ||
        !end.pin ||
        end.pin.length > 100
      ) return false;
      const component = componentsById.get(end.compId);
      const definition = component && getSimulationComponentDefinition(component);
      return Boolean(definition && definition.pins.some((pin) => pin.id === end.pin));
    };
    if (!wire || typeof wire !== "object" || Array.isArray(wire) || !validEndpoint(wire.from) || !validEndpoint(wire.to)) {
      return `Wire ${wireIndex + 1} must have valid endpoints that reference existing component pins.`;
    }
    if (!isSimulationRecordId(wire.id) || wireIds.has(String(wire.id))) {
      return `Wire ${wireIndex + 1} must have a unique id.`;
    }
    wireIds.add(String(wire.id));
    if (Object.prototype.hasOwnProperty.call(wire, "waypoints")) {
      const points = wire.waypoints;
      if (!Array.isArray(points)) return `Wire ${wireIndex + 1} has an invalid bend list.`;
      if (points.length > MAX_MANUAL_WIRE_WAYPOINTS) return `Wire ${wireIndex + 1} has too many bends (maximum ${MAX_MANUAL_WIRE_WAYPOINTS}).`;
      if (wire.auto === true && points.length) return `Wire ${wireIndex + 1} is automatic and cannot include manual bends.`;
      for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
        const point = points[pointIndex];
        if (
          !point ||
          typeof point !== "object" ||
          Array.isArray(point) ||
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          point.x < 0 ||
          point.x > canvasBounds.width ||
          point.y < 0 ||
          point.y > canvasBounds.height
        ) {
          return `Wire ${wireIndex + 1} bend ${pointIndex + 1} must have numeric coordinates inside the builder canvas.`;
        }
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "checkpoints")) {
    if (!allowCheckpoints) return "Nested simulation checkpoints are not supported.";
    if (!Array.isArray(data.checkpoints) || data.checkpoints.length > MAX_SIMULATION_CHECKPOINTS) {
      return `Simulation checkpoints must be an array of at most ${MAX_SIMULATION_CHECKPOINTS} items.`;
    }
    for (let index = 0; index < data.checkpoints.length; index++) {
      const checkpoint = data.checkpoints[index];
      if (
        !checkpoint ||
        typeof checkpoint !== "object" ||
        Array.isArray(checkpoint) ||
        typeof checkpoint.name !== "string" ||
        !checkpoint.name.trim() ||
        !checkpoint.data
      ) {
        return `Checkpoint ${index + 1} has an invalid structure.`;
      }
      const checkpointError = simulationDataError(checkpoint.data, true, false);
      if (checkpointError) return `Checkpoint ${index + 1}: ${checkpointError}`;
    }
  }

  // Named views: saved zoom levels and positions of the builder canvas (x and y
  // are the view's centre as fractions of the board). Only on the top level.
  if (Object.prototype.hasOwnProperty.call(data, "views")) {
    if (!allowCheckpoints) return "Nested simulation views are not supported.";
    if (!Array.isArray(data.views) || data.views.length > MAX_SIMULATION_VIEWS) {
      return `Simulation views must be an array of at most ${MAX_SIMULATION_VIEWS} items.`;
    }
    for (let index = 0; index < data.views.length; index++) {
      const view = data.views[index];
      if (
        !view ||
        typeof view !== "object" ||
        Array.isArray(view) ||
        Object.keys(view).some((key) => !["name", "zoom", "x", "y"].includes(key)) ||
        typeof view.name !== "string" ||
        !view.name.trim() ||
        view.name.length > 60 ||
        !Number.isFinite(view.zoom) ||
        view.zoom < 0.25 ||
        view.zoom > 4 ||
        !Number.isFinite(view.x) ||
        view.x < 0 ||
        view.x > 1 ||
        !Number.isFinite(view.y) ||
        view.y < 0 ||
        view.y > 1
      ) {
        return `View ${index + 1} has an invalid structure.`;
      }
    }
  }
  return null;
}

// Older saved simulations can have missing or colliding wire IDs. Repair
// those IDs before publishing, duplicating, or restoring a snapshot.
export function normalizeLegacySimulationWireIds(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const normalized = JSON.parse(JSON.stringify(data));
  const normalizeCircuitWires = (circuit) => {
    if (!circuit || typeof circuit !== "object" || Array.isArray(circuit) || !Array.isArray(circuit.wires)) return;
    const reservedIds = new Set();
    for (const wire of circuit.wires) {
      if (wire && typeof wire === "object" && !Array.isArray(wire) && isSimulationRecordId(wire.id)) {
        reservedIds.add(String(wire.id));
      }
    }
    const seenIds = new Set();
    circuit.wires.forEach((wire, index) => {
      if (!wire || typeof wire !== "object" || Array.isArray(wire)) return;
      if (!isSimulationRecordId(wire.id) || seenIds.has(String(wire.id))) {
        const stem = `duplicate_wire_${index + 1}`;
        let id = stem;
        let suffix = 1;
        while (reservedIds.has(id) || seenIds.has(id)) id = `${stem}_${suffix++}`;
        wire.id = id;
        reservedIds.add(id);
      }
      seenIds.add(String(wire.id));
    });
  };
  normalizeCircuitWires(normalized);
  if (Array.isArray(normalized.checkpoints)) {
    normalized.checkpoints.forEach((checkpoint) => normalizeCircuitWires(checkpoint && checkpoint.data));
  }
  return normalized;
}
