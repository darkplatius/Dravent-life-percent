import { WEAPON_CATALOG, cloneCatalogWeapon } from "./weapons.js";
import { ARMOR_CATALOG, armorCatalogOptions } from "./armors.js";

const MODULE_ID = "dravent-health-percent";
// CSS.escape is absent in some embedded/older browser engines. Keep selectors safe
// without making module initialization depend on that API.
function dhpCssEscape(value) {
  const text = String(value ?? "");
  if (globalThis.CSS && typeof globalThis.CSS.escape === "function") return globalThis.CSS.escape(text);
  return text.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character.codePointAt(0).toString(16)} `);
}
const SYSTEM_ID = "worldofdarkness";
const HEALTH_SELECTOR = `[data-${MODULE_ID}-widget]`;
const ARSENAL_SELECTOR = `[data-${MODULE_ID}-arsenal]`;
const initializingActors = new Set();
const patchedClasses = new WeakSet();
let macroManagerLastOpenedAt = 0;
const pendingCombatDefenses = new Map();
const CRITICAL_DICE = { B: 1, L: 2, A: 3 };
const AMMUNITION_TYPES = {
  standard: { label: "Comum", dice: null, type: null, mode: null, notes: "" },
  rubber: { label: "Borracha", dice: null, type: "B", mode: null, notes: "Contusão; não representa perfuração convencional." },
  teflon: { label: "Teflon", dice: null, type: "L", mode: null, notes: "Letal; possível efeito contra certos tipos de proteção, a critério do Narrador." },
  flechette: { label: "Flechette", dice: 7, type: "L", mode: "fixed", notes: "Munição de flechette." },
  explosive: { label: "Explosiva", dice: 6, type: "L", mode: "fixed", notes: "Projétil explosivo; efeitos de área não são simulados para o cartucho." },
  incendiary: { label: "Incendiária", dice: 4, type: "A", mode: "fixed", notes: "Pode incendiar o alvo ou o ambiente." },
  ectoplasmic: { label: "Disruptor ectoplasmático", dice: 5, type: "A", mode: "fixed", notes: "Munição tecnomágica; efeito contra entidades espirituais fica a critério do Narrador." }
};
const CATEGORY_LABELS = {
  natural: "Arma natural", melee: "Corpo a corpo", thrown: "Arremesso", firearm: "Armas de fogo",
  bow: "Arcos e bestas", heavy: "Militares pesadas", special: "Especiais", explosive: "Explosivos"
};

const safeNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, Math.round(safeNumber(value, min))));
const clampInt = (value, min = 0, max = 1_000_000_000) => Math.min(max, Math.max(min, Math.floor(safeNumber(value, min))));
const deepClone = (value) => foundry.utils.deepClone(value);

function normalized(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function asElement(html, app) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (app?.element instanceof HTMLElement) return app.element;
  if (app?.element?.[0] instanceof HTMLElement) return app.element[0];
  return null;
}

function resolveActor(app) {
  const candidates = [app?.document, app?.actor, app?.object];
  return candidates.find((candidate) => candidate?.documentName === "Actor" && (candidate?.type === "PC" || candidate?.system?.health)) ?? null;
}

function isWoDActor(actor) {
  // The module is system-scoped: support PC sheets, legacy splat sheets, and supported creature sheets.
  return Boolean(actor?.documentName === "Actor" && game.system?.id === SYSTEM_ID && (actor.type === "PC" || actor.system?.health));
}

function isPlayerCharacterActor(actor) {
  // Fichas com ao menos um proprietário não-GM usam Vitalidade percentual.
  // Atores controlados exclusivamente pelo GM usam PV absolutos, independentemente do tipo.
  if (!actor) return false;
  const candidates = [...new Set([actor, actor.baseActor, actor.token?.actor, actor.parent?.actor].filter(Boolean))];
  const ownerLevel = Number(globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3);
  const users = [...(game.users?.contents ?? game.users ?? [])].filter((user) => user && !user.isGM);
  for (const user of users) {
    for (const document of candidates) {
      try {
        if (document.hasPlayerOwner === true && document === actor) return true;
        if (document.testUserPermission?.(user, ownerLevel) === true || document.testUserPermission?.(user, "OWNER") === true) return true;
        const derivedLevel = Number(document.getUserLevel?.(user));
        if (Number.isFinite(derivedLevel) && derivedLevel >= ownerLevel) return true;
        const ownership = document.ownership ?? document._source?.ownership ?? {};
        const level = Number(ownership[user.id] ?? ownership.default ?? 0);
        if (Number.isFinite(level) && level >= ownerLevel) return true;
      } catch (_) {
        // Un documento sintético pode não expor todos os métodos de permissão.
      }
    }
  }
  return false;
}

function isAbsoluteHealthActor(actor) {
  // Atores sem proprietário jogador (NPCs e personagens controlados só pelo GM) usam PV.
  return Boolean(actor) && !isPlayerCharacterActor(actor);
}

function healthMax(actor) {
  return Math.max(1, Math.min(1_000_000_000, Math.floor(safeNumber(actor?.getFlag?.(MODULE_ID, "max"), 100))));
}

function healthCurrent(actor) {
  const max = healthMax(actor);
  return Math.max(0, Math.min(max, Math.floor(safeNumber(actor?.getFlag?.(MODULE_ID, "current"), max))));
}

function healthPercentFrom(current, max) {
  const safeMax = Math.max(1, safeNumber(max, 100));
  return Math.max(0, Math.min(100, Math.round((Math.max(0, safeNumber(current)) / safeMax) * 1000) / 10));
}

// healthValue intentionally remains a percentage for penalties, token bars, and banding.
// Stored current/max values are absolute vitality points; non-PC actors keep max=100 by default.
function healthValue(actor) {
  return healthPercentFrom(healthCurrent(actor), healthMax(actor));
}

function vitalityDisplay(actor, current = healthCurrent(actor)) {
  const max = healthMax(actor);
  const percent = healthPercentFrom(current, max);
  if (isAbsoluteHealthActor(actor)) {
    return `${Math.floor(current).toLocaleString("pt-BR")} / ${Math.floor(max).toLocaleString("pt-BR")} PV (${String(percent).replace(".", ",")}%)`;
  }
  return `${Math.round(percent)}%`;
}

function damageUnit(actor) {
  return isAbsoluteHealthActor(actor) ? "PV" : "%";
}

function getHealthState(current) {
  const label = `${clamp(current)}%`;
  if (current >= 100) return { label, penalty: 0, band: "healthy" };
  if (current >= 86) return { label, penalty: 0, band: "bruised" };
  if (current >= 72) return { label, penalty: -1, band: "hurt" };
  if (current >= 58) return { label, penalty: -1, band: "injured" };
  if (current >= 44) return { label, penalty: -2, band: "wounded" };
  if (current >= 30) return { label, penalty: -2, band: "mauled" };
  if (current > 0) return { label, penalty: -5, band: "crippled" };
  return { label, penalty: -99, band: "incapacitated" };
}

function legacyDamageSnapshot(actor) {
  const damage = actor?.system?.health?.damage;
  return damage ? deepClone(damage) : null;
}

function legacyWoundCount(actor) {
  const dmg = actor?.system?.health?.damage;
  if (!dmg) return 0;
  const count = (source) => safeNumber(source?.bashing) + safeNumber(source?.lethal) + safeNumber(source?.aggravated);
  return Math.max(count(dmg), count(dmg.chimerical), count(dmg.corpus));
}

function legacyHealthPercent(actor) {
  const health = actor?.system?.health ?? {};
  const levelNames = ["bruised", "hurt", "injured", "wounded", "mauled", "crippled", "incapacitated"];
  const levelMaximum = levelNames.reduce((sum, key) => sum + safeNumber(health[key]?.total), 0);
  const configuredMaximum = safeNumber(actor?.system?.traits?.health?.totalhealthlevels?.max);
  // M20's PC sheets use named health-level objects; legacy sheets may only expose the damage counters.
  const max = Math.max(levelMaximum, configuredMaximum, legacyWoundCount(actor) > 0 ? 7 : 0);
  const wounds = legacyWoundCount(actor);
  if (max <= 0 || wounds <= 0) return 100;
  return clamp(100 * Math.max(0, max - wounds) / max);
}

function legacyDamageClearUpdates(actor) {
  const damage = actor?.system?.health?.damage;
  if (!damage || typeof damage !== "object") return {};
  const updates = {};
  for (const key of ["bashing", "lethal", "aggravated"]) {
    if (damage[key] !== undefined && Number.isFinite(Number(damage[key]))) updates[`system.health.damage.${key}`] = 0;
  }
  for (const group of ["chimerical", "corpus"]) {
    for (const key of ["bashing", "lethal", "aggravated"]) {
      if (damage[group]?.[key] !== undefined && Number.isFinite(Number(damage[group][key]))) {
        updates[`system.health.damage.${group}.${key}`] = 0;
      }
    }
  }
  return updates;
}

async function ensureHealthFlags(actor) {
  if (!isWoDActor(actor) || initializingActors.has(actor.id)) return;
  const schema = safeNumber(actor.getFlag(MODULE_ID, "schema"), 0);
  const initialized = actor.getFlag(MODULE_ID, "initialized") === true;
  const replaceLegacy = game.settings.get(MODULE_ID, "replaceLegacyHealth");
  const legacyNeutralized = actor.getFlag(MODULE_ID, "legacyNeutralized") === true;
  const desiredMode = isAbsoluteHealthActor(actor) ? "absolute" : "percent";
  const storedMode = actor.getFlag(MODULE_ID, "healthMode");
  const needsInitialization = schema < 5 || !initialized || storedMode !== desiredMode;
  const needsNeutralization = replaceLegacy && !legacyNeutralized;
  if (!needsInitialization && !needsNeutralization) return;

  initializingActors.add(actor.id);
  try {
    const oldCurrent = actor.getFlag(MODULE_ID, "current");
    const oldMaxRaw = actor.getFlag(MODULE_ID, "max");
    const oldMax = Math.max(1, Math.min(1_000_000_000, Math.floor(safeNumber(oldMaxRaw, 100))));
    let max = desiredMode === "absolute" ? oldMax : 100;
    let current;
    if (oldCurrent === undefined) {
      const legacyPercent = legacyHealthPercent(actor);
      current = desiredMode === "absolute" ? Math.round(max * legacyPercent / 100) : Math.round(legacyPercent);
    } else {
      const stored = Math.max(0, Math.floor(safeNumber(oldCurrent, oldMax)));
      if (storedMode && storedMode !== desiredMode) {
        // Convert between the prior and requested storage models without losing the ratio.
        const percent = healthPercentFrom(stored, oldMax);
        if (desiredMode === "percent") { max = 100; current = Math.round(percent); }
        else { max = oldMaxRaw === undefined ? 100 : oldMax; current = Math.round(max * percent / 100); }
      } else if (schema < 5 && desiredMode === "percent") {
        // Versions <=0.10 stored player-owned actors as current/max PV. Convert them back
        // to the requested 0-100 scale, preserving the visible life percentage.
        current = Math.round(healthPercentFrom(stored, oldMax));
        max = 100;
      } else if (schema < 4 && oldMax !== 100) {
        // Early builds stored percentage in `current` while accepting a custom max.
        current = Math.round(max * Math.max(0, Math.min(100, stored)) / 100);
      } else {
        current = stored;
      }
    }
    current = Math.max(0, Math.min(max, current));

    const update = {
      [`flags.${MODULE_ID}.current`]: current,
      [`flags.${MODULE_ID}.max`]: max,
      [`flags.${MODULE_ID}.healthMode`]: desiredMode,
      [`flags.${MODULE_ID}.schema`]: 5,
      [`flags.${MODULE_ID}.initialized`]: true,
      [`flags.${MODULE_ID}.legacyMigrated`]: true,
      [`flags.${MODULE_ID}.weapons`]: actor.getFlag(MODULE_ID, "weapons") ?? []
    };

    // Save the previous wound counters in a module flag, then zero the old counters once. This
    // keeps old system rolls from continuing to use the abandoned health boxes. The system files
    // are not edited, and the old values remain available in flags for manual restoration.
    const clearUpdates = needsNeutralization ? legacyDamageClearUpdates(actor) : {};
    if (needsNeutralization) {
      const snapshot = legacyDamageSnapshot(actor);
      if (snapshot) update[`flags.${MODULE_ID}.legacyHealthBackup`] = actor.getFlag(MODULE_ID, "legacyHealthBackup") ?? snapshot;
      update[`flags.${MODULE_ID}.legacyNeutralized`] = true;
      Object.assign(update, clearUpdates);
    }

    await actor.update(update);
    void syncTokenBarsForActor(actor);
  } catch (error) {
    console.error(`${MODULE_ID} | Could not initialize Vitalidade for ${actor.name}`, error);
  } finally {
    initializingActors.delete(actor.id);
  }
}

function actorHealthData(actor) {
  const current = healthCurrent(actor);
  const max = healthMax(actor);
  const percent = healthPercentFrom(current, max);
  const state = getHealthState(percent);
  return { current, max, percent, state };
}

function makeHealthCard(actor) {
  const { current, max, percent, state } = actorHealthData(actor);
  const editable = Boolean(actor.isOwner);
  const absolute = isAbsoluteHealthActor(actor);
  const card = document.createElement("section");
  card.className = "dravent-health-percent dhp-health-panel";
  card.setAttribute(`data-${MODULE_ID}-widget`, "true");
  card.dataset.actorId = actor.id;
  const currentLabel = absolute
    ? `${current.toLocaleString("pt-BR")}<small> / ${max.toLocaleString("pt-BR")} PV</small>`
    : `${Math.round(percent)}<small>%</small>`;
  const controlHtml = absolute ? `
    <label class="dhp-field"><span>Dano recebido (PV)</span><input type="number" min="0" max="1000000000" step="1" value="0" data-dhp-damage ${editable ? "" : "disabled"}/></label>
    <button type="button" data-dhp-action="damage" ${editable ? "" : "disabled"}>Aplicar dano</button>
    <label class="dhp-field"><span>Cura (PV)</span><input type="number" min="0" max="1000000000" step="1" value="0" data-dhp-heal ${editable ? "" : "disabled"}/></label>
    <button type="button" data-dhp-action="heal" ${editable ? "" : "disabled"}>Curar</button>
    <label class="dhp-field dhp-current-field"><span>Vida atual (PV)</span><input type="number" min="0" max="1000000000" step="1" value="${current}" data-dhp-set ${editable ? "" : "disabled"}/></label>
    <button type="button" data-dhp-action="set" ${editable ? "" : "disabled"}>Definir vida</button>
    <label class="dhp-field"><span>Vida máxima (PV)</span><input type="number" min="1" max="1000000000" step="1" value="${max}" data-dhp-max ${editable ? "" : "disabled"}/></label>
    <button type="button" data-dhp-action="setmax" ${editable ? "" : "disabled"}>Atualizar máximo</button>
  ` : `
    <label class="dhp-field"><span>Dano recebido (%)</span><input type="number" min="0" max="100" step="1" value="0" data-dhp-damage ${editable ? "" : "disabled"}/></label>
    <button type="button" data-dhp-action="damage" ${editable ? "" : "disabled"}>Aplicar dano</button>
    <label class="dhp-field"><span>Cura (%)</span><input type="number" min="0" max="100" step="1" value="0" data-dhp-heal ${editable ? "" : "disabled"}/></label>
    <button type="button" data-dhp-action="heal" ${editable ? "" : "disabled"}>Curar</button>
    <label class="dhp-field dhp-current-field"><span>Definir Vitalidade (%)</span><input type="number" min="0" max="100" step="1" value="${Math.round(percent)}" data-dhp-set ${editable ? "" : "disabled"}/></label>
    <button type="button" data-dhp-action="set" ${editable ? "" : "disabled"}>Atualizar</button>
  `;
  card.innerHTML = `
    <div class="dhp-header">
      <div><div class="dhp-eyebrow">DRAVENT · REGRAS OPCIONAIS</div><h3>${absolute ? "Vida" : "Vitalidade"}</h3></div>
      <div class="dhp-current" data-dhp-current>${currentLabel}</div>
    </div>
    <div class="dhp-track" role="progressbar" aria-label="Vitalidade atual" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
      <div class="dhp-fill ${state.band}" data-dhp-fill style="width:${percent}%"></div>
    </div>
    <div class="dhp-life-percent" data-dhp-life-percent>${healthPercentFrom(current, max).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da vida máxima</div>
    <div class="dhp-controls ${editable ? "" : "dhp-readonly"}">${controlHtml}</div>
  `;

  const performHealthAction = async (action) => {
    if (!actor.isOwner) return;
    const now = healthCurrent(actor);
    const currentMax = healthMax(actor);
    const limit = absolute ? 1_000_000_000 : 100;
    let next = now;
    let nextMax = currentMax;
    if (action === "damage") next = Math.max(0, now - clampInt(card.querySelector("[data-dhp-damage]")?.value, 0, limit));
    if (action === "heal") next = Math.min(currentMax, now + clampInt(card.querySelector("[data-dhp-heal]")?.value, 0, limit));
    if (action === "set") {
      const raw = safeNumber(card.querySelector("[data-dhp-set]")?.value, now);
      next = absolute ? clampInt(raw, 0, currentMax) : Math.round(currentMax * clamp(raw, 0, 100) / 100);
    }
    if (action === "setmax") {
      nextMax = clampInt(card.querySelector("[data-dhp-max]")?.value, 1, 1_000_000_000);
      // If the character was at full health before changing the maximum, keep it full.
      // If injured, preserve the remaining absolute points and only clamp if above the new max.
      next = now >= currentMax ? nextMax : Math.min(now, nextMax);
    }
    await setActorHealth(actor, next, nextMax);
    if (action === "damage" && card.querySelector("[data-dhp-damage]")) card.querySelector("[data-dhp-damage]").value = "0";
    if (action === "heal" && card.querySelector("[data-dhp-heal]")) card.querySelector("[data-dhp-heal]").value = "0";
    refreshHealthPanels(actor);
  };

  card.querySelectorAll("[data-dhp-action]").forEach((button) => button.addEventListener("click", () => performHealthAction(button.dataset.dhpAction)));
  for (const [selector, action] of [["[data-dhp-damage]", "damage"], ["[data-dhp-heal]", "heal"], ["[data-dhp-set]", "set"], ["[data-dhp-max]", "setmax"]]) {
    card.querySelector(selector)?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      void performHealthAction(action);
    });
  }
  return card;
}

function healthPercentLabel(current) {
  return `${clamp(current)}%`;
}

async function setActorHealth(actor, current, maximum = healthMax(actor)) {
  const max = clampInt(maximum, 1, 1_000_000_000);
  const value = clampInt(current, 0, max);
  await actor.update({
    [`flags.${MODULE_ID}.current`]: value,
    [`flags.${MODULE_ID}.max`]: max,
    [`flags.${MODULE_ID}.healthMode`]: isAbsoluteHealthActor(actor) ? "absolute" : "percent",
    [`flags.${MODULE_ID}.schema`]: 5,
    [`flags.${MODULE_ID}.initialized`]: true
  });
  void syncTokenBarsForActor(actor);
  refreshLegacyVitalityStatus(actor);
  if (game.user.isGM && actor.system?.health?.damage) {
    const percent = healthPercentFrom(value, max);
    actor.system.health.damage.woundpenalty = getHealthState(percent).penalty;
    actor.system.health.damage.woundlevel = healthPercentLabel(percent);
    actor.system.health.woundlevel = healthPercentLabel(percent);
  }
}

function refreshHealthCard(card, actor) {
  const current = healthCurrent(actor);
  const max = healthMax(actor);
  const percent = healthPercentFrom(current, max);
  const state = getHealthState(percent);
  const label = card.querySelector("[data-dhp-current]");
  const fill = card.querySelector("[data-dhp-fill]");
  const track = card.querySelector(".dhp-track");
  if (label) label.innerHTML = isAbsoluteHealthActor(actor)
    ? `${current.toLocaleString("pt-BR")}<small> / ${max.toLocaleString("pt-BR")} PV</small>`
    : `${Math.round(percent)}<small>%</small>`;
  if (fill) { fill.style.width = `${percent}%`; fill.className = `dhp-fill ${state.band}`; }
  if (track) track.setAttribute("aria-valuenow", String(percent));
  const percentLabel = card.querySelector("[data-dhp-life-percent]");
  if (percentLabel) percentLabel.textContent = `${percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da vida máxima`;
  const input = card.querySelector("[data-dhp-set]");
  if (input && document.activeElement !== input) input.value = String(isAbsoluteHealthActor(actor) ? current : Math.round(percent));
  const maxInput = card.querySelector("[data-dhp-max]");
  if (maxInput && document.activeElement !== maxInput) maxInput.value = String(max);
}

function refreshHealthPanels(actor) {
  document.querySelectorAll(`.dhp-health-panel[data-actor-id="${dhpCssEscape(actor.id)}"]`).forEach((card) => refreshHealthCard(card, actor));
}

function firstBioTab(root) {
  return root.querySelector('.tab.bio, .tab[data-tab="bio"], section[data-tab="bio"]');
}

function findParadigmBlock(bio) {
  if (!bio) return null;
  const direct = bio.querySelector('[for="data.system.focus.paradigm"], [name="system.focus.paradigm"], [data-target="system.focus.paradigm"]');
  if (direct) {
    // In the legacy Mage sheet the focus partial has its own wrapper, which is the exact desired
    // insertion point. Avoid a generic .sheet-area match: the V2 sheet's first row also contains
    // the name and portrait, so inserting before that row would put Vitalidade above the details.
    const legacyFocus = direct.closest(".clearareaBox.sheet-area.flex-columns");
    if (legacyFocus) return legacyFocus;
  }
  const candidate = [...bio.querySelectorAll("label, .headlineText, .sheet-banner-text, .floating-label")]
    .find((el) => normalized(el.textContent).includes("paradigm"));
  return candidate?.closest(".clearareaBox.sheet-area.flex-columns") ?? null;
}

function rgbaAlpha(color) {
  const source = String(color ?? "").trim().toLowerCase();
  if (source.startsWith("rgba(")) {
    const inside = source.slice(source.indexOf("(") + 1, source.lastIndexOf(")"));
    const parts = inside.split(/[,\s/]+/).filter(Boolean);
    const alpha = Number(parts[3] ?? 1);
    return Number.isFinite(alpha) ? alpha : 1;
  }
  return source.startsWith("rgb(") ? 1 : 0;
}

function colorLuminance(color) {
  const match = String(color ?? "").match(/rgba?\(([^)]+)\)/i);
  let rgb;
  if (match) {
    rgb = match[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map((value) => Number(value) / 255);
  } else {
    const hex = String(color ?? "").match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
    if (!hex) return null;
    const expanded = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
    rgb = [0, 2, 4].map((index) => parseInt(expanded.slice(index, index + 2), 16) / 255);
  }
  if (rgb.length !== 3 || rgb.some((value) => !Number.isFinite(value))) return null;
  return rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function applySheetTheme(panel, root) {
  if (!panel || !root) return;
  const visibleColor = (element, property) => {
    if (!element) return "";
    const value = getComputedStyle(element)[property];
    if (!value || value === "transparent" || value === "rgba(0, 0, 0, 0)") return "";
    if (property === "backgroundColor" && rgbaAlpha(value) < 0.45) return "";
    return value;
  };
  const sheetRoot = root.querySelector?.(".window-content") ?? root;
  let background = visibleColor(sheetRoot, "backgroundColor");
  let cursor = root;
  while (cursor && cursor !== document.body && !background) {
    background = visibleColor(cursor, "backgroundColor");
    cursor = cursor.parentElement;
  }
  if (!background) {
    cursor = panel.parentElement;
    while (cursor && cursor !== document.body && !background) {
      background = visibleColor(cursor, "backgroundColor");
      cursor = cursor.parentElement;
    }
  }
  background ||= "#262626";
  const luminance = colorLuminance(background);
  const darkSurface = luminance === null || luminance < 0.43;
  const ink = darkSurface ? "#f7f6fa" : "#15131a";
  const muted = darkSurface ? "#c5c1cc" : "#56515c";
  let accent = "";
  for (const button of root.querySelectorAll?.("button, .item-create, [role=button]") ?? []) {
    if (panel.contains(button)) continue;
    const color = visibleColor(button, "backgroundColor");
    if (color && color !== "rgb(0, 0, 0)" && color !== "rgb(255, 255, 255)") { accent = color; break; }
  }
  panel.style.setProperty("--dhp-panel", background);
  panel.style.setProperty("--dhp-ink", ink);
  panel.style.setProperty("--dhp-muted", muted);
  panel.style.setProperty("--dhp-border", darkSurface ? "rgba(255,255,255,.26)" : "rgba(20,16,24,.22)");
  panel.dataset.dhpSurface = darkSurface ? "dark" : "light";
  if (accent) panel.style.setProperty("--dhp-accent", accent);
}

function placeHealthPanel(root, actor) {
  if (!root || root.querySelector(HEALTH_SELECTOR)) return;
  const bio = firstBioTab(root);
  if (!bio) return;
  const panel = makeHealthCard(actor);
  const paradigm = findParadigmBlock(bio);
  if (paradigm?.parentElement) {
    paradigm.parentElement.insertBefore(panel, paradigm);
    applySheetTheme(panel, root);
    return;
  }

  // In the V2 PC sheet, biography identity fields and splat-specific fields share the first row.
  // Place Vitalidade immediately after that row, before longer background/description fields.
  const inner = bio.querySelector(":scope > .sheet-inner-area") || bio.querySelector(".sheet-inner-area") || bio;
  const areas = [...inner.querySelectorAll(":scope > .sheet-area")];
  const details = areas.find((area) => area.querySelector('input[name="name"], input[name="system.bio.nature"], input[name="system.nature"], .profile-img'));
  if (details?.parentElement) details.insertAdjacentElement("afterend", panel);
  else inner.insertAdjacentElement("afterbegin", panel);
  applySheetTheme(panel, root);
}

const LEGACY_VITALITY_STATES = new Set([
  "healthy", "fine", "unharmed", "uninjured", "ileso", "ilesa", "bruised", "hurt", "injured", "wounded", "mauled", "crippled", "incapacitated",
  "saudavel", "contundido", "machucado", "ferido", "gravementeferido", "muitoferido", "incapacitado"
]);

// The legacy MageActorSheet may render the status as translated text rather than using
// the selectors found in the newer PC sheet. Replace that leaf with the module's percentage.
function replaceLegacyVitalityStatus(root, actor) {
  if (!root || !actor) return;
  const currentLabel = vitalityDisplay(actor);

  // Keep every previously replaced label synchronized as PV/max and percentage change.
  root.querySelectorAll('[data-dhp-native-vitality="true"]').forEach((element) => {
    element.textContent = currentLabel;
  });

  // WoD20 versions translate the uninjured state differently and do not share a stable selector.
  // Replacing exact leaf labels is more reliable than assuming a single DOM nesting layout.
  const stateLeaves = [...root.querySelectorAll("*")].filter((element) => {
    if (element.closest(".dravent-health-percent")) return false;
    if (element.hasAttribute("data-dhp-native-vitality")) return false;
    if (element.children.length !== 0) return false;
    return LEGACY_VITALITY_STATES.has(normalized(element.textContent));
  });
  for (const state of stateLeaves) {
    state.textContent = currentLabel;
    state.setAttribute("data-dhp-native-vitality", "true");
    state.dataset.dhpActorId = actor.id;
    state.setAttribute("title", "Vida atual / máxima em PV; o percentual é calculado automaticamente.");
  }

  // Some sheet variants render the state a few frames after the sheet hook. Use the nearby
  // Vitalidade heading to catch that version without touching the separate Experiência label.
  const headings = [...root.querySelectorAll("*")].filter((element) => {
    if (element.closest(".dravent-health-percent")) return false;
    return element.children.length === 0 && normalized(element.textContent) === "vitalidade";
  });
  for (const heading of headings) {
    let container = heading.parentElement;
    for (let depth = 0; container && depth < 7; depth += 1, container = container.parentElement) {
      if (container.closest?.(".dravent-health-percent")) break;
      const leaves = [...container.querySelectorAll("*")].filter((element) => element.children.length === 0);
      const state = leaves.find((element) => LEGACY_VITALITY_STATES.has(normalized(element.textContent)));
      if (!state) continue;
      state.textContent = currentLabel;
      state.setAttribute("data-dhp-native-vitality", "true");
      state.dataset.dhpActorId = actor.id;
      state.setAttribute("title", "Vida atual / máxima em PV; o percentual é calculado automaticamente.");
      break;
    }
  }
}
function refreshLegacyVitalityStatus(actor) {
  for (const app of Object.values(ui.windows ?? {})) {
    if (resolveActor(app)?.id !== actor?.id) continue;
    replaceLegacyVitalityStatus(asElement(app.element, app), actor);
  }
  // ApplicationV2 sheets are not always registered in ui.windows. Keep labels already
  // replaced in any open V2/legacy sheet synchronized by the actor id stored on the label.
  const label = isAbsoluteHealthActor(actor) ? vitalityDisplay(actor) : `${Math.round(healthValue(actor))}%`;
  document.querySelectorAll('[data-dhp-native-vitality="true"]').forEach((element) => {
    if (element.dataset.dhpActorId === actor.id) element.textContent = label;
  });
}

function hideLegacyHealth(root) {
  if (!game.settings.get(MODULE_ID, "replaceLegacyHealth")) return;
  // The V2 combat template renders health as a heading followed by two sibling containers.
  // Hide that entire health block but stop at the next heading so armor/movement/conditions remain.
  root.querySelectorAll(".sheet-headline.sheet-banner-small, .sheet-headline.sheet-banner").forEach((heading) => {
    const label = normalized(heading.textContent);
    if (!/(^|)(health|chimericalhealth|saude|ferimentos|ferimento|healthlevels)(|$)/.test(label)) return;
    heading.classList.add("dhp-legacy-hidden");
    let sibling = heading.nextElementSibling;
    while (sibling && !sibling.matches(".sheet-headline, .sheet-banner-small, .sheet-banner")) {
      sibling.classList.add("dhp-legacy-hidden");
      sibling = sibling.nextElementSibling;
    }
  });
  // Combat health area is exclusively the old wound track.
  root.querySelectorAll(".combat-bottomhealth").forEach((el) => el.classList.add("dhp-legacy-hidden"));
  // Individual boxes are hidden instead of hiding a whole column that may also contain XP.
  root.querySelectorAll(".health .resource-counter, .health .resource-value-step, .healthbox, .resource-counter.healthbox").forEach((el) => {
    const row = el.closest(".health") || el.closest(".resource-counter") || el;
    row.classList.add("dhp-legacy-hidden");
  });
  root.querySelectorAll(".healthBox .sheet-headline, .healthBox .sheet-banner-small, .healthBox .information-area, .healthBox .sheet-boxcontainer").forEach((el) => {
    if (el.querySelector(".experienceValue") || el.classList.contains("experienceValue")) return;
    const text = normalized(el.textContent);
    if (el.querySelector(".health") || el.querySelector(".healthbox") || /health|saude|ferimento|penalty|penalidade/.test(text)) {
      if (!el.querySelector(".experienceValue")) el.classList.add("dhp-legacy-hidden");
    }
  });
  // Disable any remaining legacy health click handlers if a system template adds hidden hitboxes.
  if (!root.dataset.dhpLegacyHealthGuard) {
    root.dataset.dhpLegacyHealthGuard = "true";
    root.addEventListener("click", (event) => {
      if (event.target.closest(".health .resource-value-step, .healthbox .resource-value-step, .combat-bottomhealth .resource-value-step")) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    root.addEventListener("contextmenu", (event) => {
      if (event.target.closest(".health .resource-value-step, .healthbox .resource-value-step, .combat-bottomhealth .resource-value-step")) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
  }
}

function hideWoundPenaltyDescription(root) {
  if (!root) return;
  const exactTerms = ["penalidadedaferida", "penalidadedeferimento", "woundpenalty", "woundpenaltylabel"];
  const candidates = [...root.querySelectorAll("*")].filter((element) => {
    if (element.closest(".dravent-health-percent")) return false;
    const text = normalized(element.textContent);
    if (!text || text.length > 100 || !exactTerms.some((term) => text.includes(term))) return false;
    return ![...element.children].some((child) => {
      const childText = normalized(child.textContent);
      return childText && exactTerms.some((term) => childText.includes(term));
    });
  });
  for (const element of candidates) element.classList.add("dhp-legacy-hidden");
}

function actorHealthPenalty(actor) {
  return getHealthState(healthValue(actor)).penalty;
}

function actorIgnoresPain(actor) {
  if (!actor) return false;
  const trueValue = (value) => value === true || value === 1 || normalized(value) === "true" || normalized(value) === "yes";
  const directCandidates = [
    actor.getFlag?.(MODULE_ID, "ignorePain"),
    actor.getFlag?.(SYSTEM_ID, "ignorePain"),
    actor.flags?.[MODULE_ID]?.ignorePain,
    actor.system?.conditions?.ignorePain,
    actor.system?.conditions?.ignorepain,
    actor.system?.combat?.ignorePain,
    actor.system?.combat?.ignorepain,
    actor.system?.settings?.ignorePain,
    actor.system?.settings?.ignorepain,
    actor.system?.ignorePain,
    actor.system?.ignorepain
  ];
  if (directCandidates.some(trueValue)) return true;

  const statuses = actor.statuses instanceof Set ? [...actor.statuses] : Array.isArray(actor.statuses) ? actor.statuses : [];
  if (statuses.some((status) => ["ignorepain", "ignorador", "ignorarador", "semdor"].includes(normalized(status)))) return true;
  const effects = [...(actor.effects ?? []), ...(actor.items ?? [])];
  return effects.some((document) => {
    if (document.disabled || document.system?.enabled === false || document.system?.active === false) return false;
    const names = [document.name, document.label, document.system?.name, document.system?.label, document.system?.slug];
    return names.some((name) => {
      const value = normalized(name);
      return value.includes("ignorepain") || value.includes("ignorador") || value.includes("ignorarador") || value.includes("semdor");
    });
  });
}

function defineSystemHealthResource(actor) {
  const system = actor?.system;
  if (!system) return;
  try {
    const existing = Object.getOwnPropertyDescriptor(system, "draventVitalidade");
    if (existing?.get) return;
    Object.defineProperty(system, "draventVitalidade", {
      configurable: true,
      enumerable: false,
      get() { return { value: healthValue(actor?.baseActor ?? actor), max: 100 }; }
    });
  } catch (error) {
    console.debug(`${MODULE_ID} | Could not expose system-level token resource for ${actor?.name}`, error);
  }
}

function patchWoundPenaltyIntegration() {
  const ActorClass = CONFIG.Actor?.documentClass;
  const prototype = ActorClass?.prototype;
  if (!prototype || patchedClasses.has(prototype)) return;
  const original = prototype.prepareDerivedData;
  if (typeof original !== "function") return;

  // Keep the system's derived-data lifecycle synchronous; only substitute its visible wound label.
  prototype.prepareDerivedData = function(...args) {
    const result = original.apply(this, args);
    try {
      if (game.system?.id === SYSTEM_ID && this.system?.health) {
        defineSystemHealthResource(this);
        const penalty = actorHealthPenalty(this);
        const health = this.system.health;
        health.woundPenalty = penalty;
        health.woundpenalty = penalty;
        if (health.damage) {
          health.damage.woundpenalty = penalty;
          health.damage.woundlevel = healthPercentLabel(healthValue(this));
        }
        health.woundlevel = healthPercentLabel(healthValue(this));
      }
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not sync WoD20 wound penalty`, error);
    }
    return result;
  };
  patchedClasses.add(prototype);

  for (const actor of game.actors ?? []) {
    if (!actor.system?.health) continue;
    defineSystemHealthResource(actor);
    const penalty = actorHealthPenalty(actor);
    actor.system.health.woundPenalty = penalty;
    actor.system.health.woundpenalty = penalty;
    if (actor.system.health.damage) {
      actor.system.health.damage.woundpenalty = penalty;
      actor.system.health.damage.woundlevel = healthPercentLabel(healthValue(actor));
    }
    actor.system.health.woundlevel = healthPercentLabel(healthValue(actor));
  }
}

function installTokenHealthAttribute() {
  const proto = CONFIG.Actor?.documentClass?.prototype;
  if (!proto || Object.getOwnPropertyDescriptor(proto, "draventVitalidade")) return;
  Object.defineProperty(proto, "draventVitalidade", {
    configurable: true,
    enumerable: false,
    get() { return { value: healthValue(this?.baseActor ?? this), max: 100 }; }
  });
  for (const actor of game.actors ?? []) defineSystemHealthResource(actor);
}

function tokenDocumentsForActor(actor) {
  const found = new Map();
  const activeTokens = actor.getActiveTokens?.(true) ?? [];
  for (const token of activeTokens) if (token?.document) found.set(token.document.uuid, token.document);
  for (const scene of game.scenes ?? []) {
    for (const tokenDoc of scene.tokens ?? []) {
      if (tokenDoc.actorId === actor.id || tokenDoc.actor === actor) found.set(tokenDoc.uuid, tokenDoc);
    }
  }
  if (actor.isToken && actor.token?.document) found.set(actor.token.document.uuid, actor.token.document);
  return [...found.values()];
}

async function syncTokenBarsForActor(actor) {
  // Only PC/player-sheet actors receive the Dravent Vida % resource. NPCs keep their configured bars.
  if (!isWoDActor(actor) || !isPlayerCharacterActor(actor)) return;
  try {
    if (game.user.isGM && actor.prototypeToken?.bar1?.attribute !== "draventVitalidade") {
      await actor.update({ "prototypeToken.bar1.attribute": "draventVitalidade" });
    }
    const docs = tokenDocumentsForActor(actor);
    for (const tokenDoc of docs) {
      if (tokenDoc.getFlag(MODULE_ID, "preserveBar1") === true) continue;
      const representedActor = tokenDoc.actor ?? tokenDoc.baseActor;
      if (representedActor && !isPlayerCharacterActor(representedActor)) continue;
      if (tokenDoc.bar1?.attribute !== "draventVitalidade" && game.user.isGM) {
        await tokenDoc.update({ "bar1.attribute": "draventVitalidade" });
      }
      const placeable = canvas.tokens?.get(tokenDoc.id);
      placeable?.renderFlags?.set?.({ refreshBars: true });
      placeable?.refresh?.();
    }
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not sync token bars for ${actor.name}`, error);
  }
}

async function syncAllTokenBars() {
  if (!game.user?.isGM) return;
  for (const actor of game.actors ?? []) {
    if (!isWoDActor(actor)) continue;
    await ensureHealthFlags(actor);
    await syncTokenBarsForActor(actor);
  }
}

// ----------------------------- Arsenal ------------------------------------
function getWeapons(actor) {
  const weapons = actor.getFlag(MODULE_ID, "weapons");
  if (!Array.isArray(weapons)) return [];
  return deepClone(weapons).map((weapon) => {
    const template = WEAPON_CATALOG.find((entry) => weapon.catalogId === entry.id || weapon.id === entry.id || String(weapon.id ?? "").startsWith(`${entry.id}-`));
    if (!template) return weapon;
    return { ...weapon, catalogId: weapon.catalogId ?? template.id, automatic: weapon.automatic === true || template.automatic === true };
  });
}

async function setWeapons(actor, weapons) {
  await actor.setFlag(MODULE_ID, "weapons", weapons);
}

function categoryLabel(category) { return CATEGORY_LABELS[category] ?? category; }
function damageTypeLabel(type) { return ({ B: "Contusão", L: "Letal", A: "Agravado" })[type] ?? type; }

function weaponDamageText(weapon) {
  const dice = safeNumber(weapon.damageDice);
  if (weapon.damageMode === "strength") return `${dice > 0 ? `Força + ${dice}d10` : "Força"} ${weapon.damageType}`;
  return `${dice > 0 ? `${dice}d10 ${weapon.damageType}` : "Efeito especial · sem dano direto"}`;
}

function getCatalogOptions() {
  const groups = new Map();
  for (const weapon of WEAPON_CATALOG) {
    const label = categoryLabel(weapon.category);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(weapon);
  }
  return [...groups.entries()].map(([group, weapons]) => `<optgroup label="${escapeHtml(group)}">${weapons.map((weapon) => `<option value="${escapeHtml(weapon.id)}">${escapeHtml(weapon.name)} - ${escapeHtml(weaponDamageText(weapon))}</option>`).join("")}</optgroup>`).join("");
}

function renderWeaponRow(weapon, actor) {
  const canEdit = actor.isOwner;
  const cadence = Math.max(1, safeNumber(weapon.cadence, 1));
  const shots = Array.from({ length: Math.min(cadence, 10) }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join("");
  const rangeInput = ["firearm", "bow", "heavy", "special", "thrown"].includes(weapon.category)
    ? `<label class="dhp-inline-field"><span>Distância (m)</span><input type="number" min="0" max="50000" value="0" data-dhp-distance /></label>` : "";
  const shotInput = cadence > 1 && !["melee", "explosive"].includes(weapon.category)
    ? `<label class="dhp-inline-field dhp-shot-mode-field"><span>Disparos</span><select data-dhp-shots>${shots}</select></label>` : "";
  const fireModeInput = automaticModeOptions(weapon);
  const suppressAreaInput = weaponSupportsAutomatic(weapon)
    ? `<label class="dhp-inline-field dhp-suppress-area-field" hidden><span>Raio da área (m)</span><input type="number" min="1" max="100" value="${Math.max(1, safeNumber(weapon.areaM, 5) || 5)}" data-dhp-suppress-area /></label>` : "";
  const ammoTypeInput = weapon.ammoCapacity != null && ["firearm", "bow", "heavy", "special"].includes(weapon.category)
    ? `<label class="dhp-inline-field dhp-ammo-field"><span>Munição especial</span><select data-dhp-ammo-type>${Object.entries(AMMUNITION_TYPES).map(([key, value]) => `<option value="${key}">${escapeHtml(value.label)}</option>`).join("")}</select></label>` : "";
  const targetRegionInput = "";
  const ammoText = weapon.ammoCapacity == null ? "Sem munição" : `${safeNumber(weapon.ammoCurrent)}/${safeNumber(weapon.ammoCapacity)}`;
  const attackText = weapon.category === "explosive" ? "Detonar" : "Atacar";
  return `<article class="dhp-weapon-row" data-dhp-weapon-id="${escapeHtml(weapon.id)}">
    <div class="dhp-weapon-main"><strong>${escapeHtml(weapon.name)}</strong><span>${escapeHtml(categoryLabel(weapon.category))} · ${escapeHtml(weaponDamageText(weapon))}</span>
      <small>Dificuldade ${safeNumber(weapon.difficulty)} · Alcance ${safeNumber(weapon.rangeM)} m · Cadência ${cadence} · Munição ${ammoText}</small>
      ${weapon.areaM ? `<small>Área: raio de ${safeNumber(weapon.areaM)} m. ${escapeHtml(weapon.notes ?? "")}</small>` : (weapon.notes ? `<small>${escapeHtml(weapon.notes)}</small>` : "")}
    </div>
    <div class="dhp-weapon-controls">${fireModeInput}${shotInput}${suppressAreaInput}${rangeInput}${targetRegionInput}${ammoTypeInput}
      <button type="button" data-dhp-weapon-action="attack" ${canEdit ? "" : "disabled"}>${attackText}</button>
      ${weapon.ammoCapacity != null ? `<button type="button" data-dhp-weapon-action="reload" ${canEdit && safeNumber(weapon.ammoCurrent) < safeNumber(weapon.ammoCapacity) ? "" : "disabled"}>Recarregar</button>` : ""}
      ${canEdit ? `<button type="button" data-dhp-weapon-action="edit">Editar</button><button type="button" data-dhp-weapon-action="delete">Remover</button>` : ""}
    </div>
  </article>`;
}

function customWeaponFormHtml(actor) {
  return `<form class="dhp-custom-form" data-dhp-custom-form hidden>
    <h4 data-dhp-form-title>Adicionar arma personalizada</h4>
    <div class="dhp-custom-grid">
      <label>Nome<input name="name" required maxlength="80" /></label>
      <label>Categoria<select name="category"><option value="natural">Arma natural</option><option value="melee">Corpo a corpo</option><option value="thrown">Arremesso</option><option value="firearm">Arma de fogo</option><option value="bow">Arco / besta</option><option value="heavy">Militar pesada</option><option value="special">Especial</option><option value="explosive">Explosivo</option></select></label>
      <label>Modo de dano<select name="damageMode"><option value="fixed">Dano fixo (Xd10)</option><option value="strength">Força + Xd10</option></select></label>
      <label>Dados de dano<input name="damageDice" type="number" min="0" max="100" value="4" required /></label>
      <label>Dificuldade-base<input name="difficulty" type="number" min="1" max="10" value="4" required /></label>
      <label>Tipo de dano<select name="damageType"><option value="B">Contusão</option><option value="L" selected>Letal</option><option value="A">Agravado</option></select></label>
      <label>Alcance (m)<input name="rangeM" type="number" min="0" max="50000" value="0" /></label>
      <label>Cadência<input name="cadence" type="number" min="1" max="20" value="1" /></label>
      <label class="dhp-checkbox-field"><input name="automatic" type="checkbox" /><span>Arma automática (habilita rajada, automático e metralhar)</span></label>
      <label>Capacidade de munição<input name="ammoCapacity" type="number" min="0" max="10000" value="0" /><small>Use 0 para arma sem munição contada.</small></label>
      <label>Munição atual<input name="ammoCurrent" type="number" min="0" max="10000" value="0" /></label>
      <label>Área explosiva (m)<input name="areaM" type="number" min="0" max="1000" value="0" /></label>
      <label>Observações<input name="notes" maxlength="240" /></label>
    </div>
    <div class="dhp-weapon-controls"><button type="submit">Salvar arma</button><button type="button" data-dhp-custom-cancel>Cancelar</button></div>
  </form>`;
}

function armorCatalogPanelHtml(canEdit) {
  return `<section class="dhp-armor-catalog" aria-label="Catálogo de armaduras">
    <div class="dhp-armor-catalog-heading"><div><strong>Proteções e armaduras</strong><small>Catálogo M20 e adaptações Dravent. Valores de absorção em d10: contusão / letal / agravado.</small></div></div>
    <div class="dhp-armor-catalog-controls">
      <label class="dhp-field"><span>Escolher equipamento</span><select data-dhp-armor-catalog ${canEdit ? "" : "disabled"}>${armorCatalogOptions()}</select></label>
      <button type="button" data-dhp-armor-action="add-catalog" ${canEdit ? "" : "disabled"}>Adicionar e equipar</button>
    </div>
    <p class="dhp-note">Equipamentos do catálogo são adicionados como itens Armor nativos. Equipamentos personalizados continuam disponíveis pelo criador de itens da ficha.</p>
  </section>`;
}

function armorItemData(armor) {
  const system = {
    reference: `${armor.source}; classificação de referência ${armor.rating}. Absorção Dravent por conversão caseira: ${armor.soak.bashing}/${armor.soak.lethal}/${armor.soak.aggravated} d10. Penalidade de mobilidade Dravent: +${Math.abs(safeNumber(armor.dexPenalty))} à dificuldade de defesa.` ,
    description: armor.description,
    details: "",
    property: [],
    bonuslist: [],
    isequipped: true,
    ismagical: false,
    isweapon: false,
    iscontainer: false,
    era: "wod.era.modern",
    soak: {
      bashing: armor.soak.bashing,
      lethal: armor.soak.lethal,
      aggravated: armor.soak.aggravated,
      chimerical: { bashing: 0, lethal: 0, aggravated: 0 }
    },
    dexpenalty: 0,
    forms: { hasomid: true, hasglabro: false, hascrinos: false, hashispo: false, haslupus: false }
  };
  return {
    name: armor.name,
    type: "Armor",
    img: armor.coverage.includes("shield") ? "icons/svg/shield.svg" : (armor.coverage.includes("head") ? "icons/svg/helmet.svg" : "icons/svg/chest.svg"),
    system,
    flags: { [MODULE_ID]: {
      armorCatalogId: armor.id,
      armorRating: armor.rating,
      armorCoverage: (armor.coverage ?? []).map(normalized).includes("shield") ? ["shield"] : ["full"],
      armorCatalogSource: armor.source,
      armorCatalogKind: armor.category,
      mobilityPenalty: Math.abs(safeNumber(armor.dexPenalty))
    } }
  };
}

function makeArsenalPanel(actor, sheetRoot = null) {
  const panel = document.createElement("section");
  panel.className = "dravent-health-percent dhp-arsenal";
  panel.setAttribute(`data-${MODULE_ID}-arsenal`, "true");
  panel.dataset.actorId = actor.id;
  const weapons = getWeapons(actor);
  const canEdit = actor.isOwner;
  panel.innerHTML = `
    <div class="dhp-header"><div><div class="dhp-eyebrow">DRAVENT · COMBATE</div><h3>Arsenal e rolagens</h3></div><span class="dhp-arsenal-subtitle">Ataque, dano e munição</span></div>
    <div class="dhp-arsenal-add">
      <label class="dhp-field"><span>Catálogo de armas</span><select data-dhp-catalog ${canEdit ? "" : "disabled"}>${getCatalogOptions()}</select></label>
      <button type="button" data-dhp-arsenal-action="add-catalog" ${canEdit ? "" : "disabled"}>Adicionar</button>
      <button type="button" data-dhp-arsenal-action="toggle-custom" ${canEdit ? "" : "disabled"}>Arma personalizada</button>
      <button type="button" data-dhp-arsenal-action="import" ${canEdit ? "" : "disabled"}>Importar existentes</button>
    </div>
    ${customWeaponFormHtml(actor)}
    <div class="dhp-weapon-list">${weapons.length ? weapons.map((weapon) => renderWeaponRow(weapon, actor)).join("") : `<p class="dhp-empty">Nenhuma arma cadastrada. Escolha uma arma no catálogo ou importe os itens já vinculados à ficha.</p>`}</div>
    ${armorCatalogPanelHtml(canEdit)}
    <p class="dhp-note">O ataque usa a ficha do personagem. Cada 1 cancela o maior resultado da mesma rolagem; cada 10 válido conta como dois sucessos. Apenas 10 válidos no ataque geram críticos.</p>
  `;
  bindArsenalPanel(panel, actor, sheetRoot);
  if (sheetRoot) applySheetTheme(panel, sheetRoot);
  return panel;
}

function combatTabFor(root) {
  return root.querySelector('.tab.combat, .tab[data-tab="combat"], section[data-tab="combat"]');
}

function hideLegacyWeaponLists(combatTab) {
  combatTab.querySelectorAll(".combat-natural-itemlist, .combat-melee-itemlist, .combat-ranged-itemlist").forEach((element) => {
    if (element.closest(".dhp-arsenal")) return;
    // Hide the smallest legacy card that contains only one of the replaced weapon lists.
    // Search upward carefully so armor, movement, conditions and soak panels remain intact.
    const sharedContent = /armadura|armor|movement|movimento|condition|condicao|soak|absor/;
    const candidates = [
      element.closest(".item-row-area"),
      element.closest(".sheet-boxcontainer"),
      element.closest(".information-area"),
      element.closest(".sheet-area")
    ].filter((candidate, index, list) => candidate && list.indexOf(candidate) === index);
    const safeWrapper = candidates.find((candidate) => !sharedContent.test(normalized(candidate.textContent ?? "")));
    if (safeWrapper) {
      safeWrapper.classList.add("dhp-legacy-weapon-hidden");
      return;
    }
    element.classList.add("dhp-legacy-weapon-hidden");
    const headline = element.previousElementSibling;
    if (headline && headline.matches(".sheet-headline, .sheet-banner, .sheet-banner-small, h2, h3, h4")) {
      headline.classList.add("dhp-legacy-weapon-hidden");
    }
    // If the wrapper is now only headings and hidden lists, collapse it too; never collapse
    // a wrapper that contains armor, movement, conditions, or another visible combat control.
    let parent = element.parentElement;
    while (parent && parent !== combatTab && !parent.matches(".sheet-area")) {
      const contentText = normalized([...parent.children].filter((child) => !child.classList.contains("dhp-legacy-weapon-hidden")).map((child) => child.textContent ?? "").join(" "));
      const isKnownCombatWrapper = parent.matches(".item-row-area, .sheet-boxcontainer, .information-area");
      if ((isKnownCombatWrapper && !contentText) || /^(combate|combat|armas|weapons|weapon)$/.test(contentText)) {
        parent.classList.add("dhp-legacy-weapon-hidden");
        parent = parent.parentElement;
        continue;
      }
      break;
    }
  });
}

function placeArsenalPanel(root, actor) {
  const combatTab = combatTabFor(root);
  if (!combatTab) return;
  const existingPanel = combatTab.querySelector(ARSENAL_SELECTOR);
  if (existingPanel) { applySheetTheme(existingPanel, root); return; }
  hideLegacyWeaponLists(combatTab);
  const panel = makeArsenalPanel(actor, root);
  // Keep the arsenal outside the sheet's multi-column .sheet-inner-area. Inserting it into a
  // child .sheet-area limited it to one column and caused the editor/form to be clipped.
  combatTab.insertAdjacentElement("afterbegin", panel);
  applySheetTheme(panel, root);
}

function findTraitValue(actor, traitType, name) {
  const dictionary = traitType === "attribute" ? actor.system?.attributes : actor.system?.abilities;
  const aliases = {
    dexterity: ["dexterity", "destreza"], strength: ["strength", "forca"], stamina: ["stamina", "vigor", "resistencia"], alertness: ["alertness", "prontidao"],
    firearms: ["firearms", "armasdefogo", "tirodearma", "tiro"], melee: ["melee", "armasbrancas", "combatecorpoacorpo", "luta"],
    brawl: ["brawl", "briga", "unarmed"], archery: ["archery", "arquearia", "arco"], athletics: ["athletics", "atletismo", "esportes", "esportesatletismo", "sports", "sport"],
    dodge: ["dodge", "esquiva"]
  };
  const wanted = aliases[name] ?? [normalized(name)];
  const readValue = (entry) => {
    const raw = entry?.total ?? entry?.system?.total ?? entry?.system?.value ?? entry?.value ?? entry?.rating ?? entry?.system?.rating ?? entry;
    return clamp(raw, 0, 100);
  };

  if (traitType === "attribute") {
    const value = dictionary?.[name] ?? dictionary?.[wanted[0]] ?? actor.system?.[name];
    if (value !== undefined) return readValue(value);
  }

  // The newer WoD20 PC sheet stores Abilities as embedded Item documents, not as a single
  // system.abilities dictionary. Search those first, matching both local labels and localization keys.
  const entries = [];
  if (dictionary && typeof dictionary === "object") entries.push(...Object.entries(dictionary).map(([key, entry]) => ({ key, entry })));
  if (traitType === "ability") {
    for (const item of actor.items ?? []) {
      if (item.type !== "Ability") continue;
      entries.push({ key: item.name, entry: item });
    }
  }
  for (const { key, entry } of entries) {
    const candidates = [key, entry?.name, entry?.label, entry?.system?.id, entry?.system?.slug, entry?.system?.label, entry?.system?.type];
    if (candidates.some((candidate) => wanted.includes(normalized(candidate)))) return readValue(entry);
  }
  for (const { key, entry } of entries) {
    const candidates = [key, entry?.name, entry?.label, entry?.system?.id, entry?.system?.slug, entry?.system?.label, entry?.system?.type].map(normalized);
    if (candidates.some((candidate) => wanted.some((item) => candidate && (candidate.includes(item) || item.includes(candidate))))) return readValue(entry);
  }
  return 0;
}

function weaponAbility(weapon) {
  const raw = normalized(weapon.attackAbility ?? "");
  if (raw.includes("brawl") || raw.includes("briga") || raw.includes("unarmed")) return "brawl";
  if (raw.includes("archery") || raw.includes("arquer") || raw.includes("bow")) return "archery";
  if (raw.includes("athletic") || raw.includes("atlet")) return "athletics";
  if (raw.includes("firearm") || raw.includes("arma de fogo") || raw.includes("tiro")) return "firearms";
  if (raw.includes("melee") || raw.includes("arma branca") || raw.includes("combate corpo")) return "melee";
  if (weapon.category === "natural") return "brawl";
  if (weapon.category === "melee") return "melee";
  if (weapon.category === "thrown" || weapon.category === "explosive") return "athletics";
  if (weapon.category === "bow") return "archery";
  return "firearms";
}

function attackPool(actor, weapon) {
  const attr = findTraitValue(actor, "attribute", "dexterity");
  const skill = findTraitValue(actor, "ability", weaponAbility(weapon));
  const woundPenalty = actorIgnoresPain(actor) ? 0 : actorHealthPenalty(actor);
  return { raw: attr + skill, penalty: woundPenalty, pool: Math.max(0, attr + skill + woundPenalty), attr, skill, ability: weaponAbility(weapon) };
}

async function evaluateRoll(formula) {
  const roll = new Roll(formula);
  await roll.evaluate();
  return roll;
}

function diceResults(roll) {
  return (roll?.dice ?? []).flatMap((die) => (die.results ?? []).filter((result) => result.active !== false).map((result) => safeNumber(result.result)));
}

function resolveOnesCancelHighest(results) {
  // House rule: each 1 cancels the highest other result in the same roll, including a 10.
  // A 1 is not eligible to be cancelled by another 1.
  const onesIndexes = results.map((value, index) => value === 1 ? index : -1).filter((index) => index >= 0);
  const entries = results.map((value, index) => ({ value, index })).filter((entry) => entry.value !== 1);
  const ranked = [...entries].sort((a, b) => b.value - a.value || a.index - b.index);
  const cancelledEntries = ranked.slice(0, Math.min(onesIndexes.length, ranked.length));
  const cancelledIndexes = new Set(cancelledEntries.map((entry) => entry.index));
  const remaining = entries.filter((entry) => !cancelledIndexes.has(entry.index)).sort((a, b) => a.index - b.index);
  return {
    ones: onesIndexes.length,
    onesIndexes,
    cancelledIndexes: [...cancelledIndexes],
    cancelledResults: cancelledEntries.map((entry) => entry.value),
    remainingResults: remaining.map((entry) => entry.value),
    remainingIndexes: remaining.map((entry) => entry.index)
  };
}

function rollSuccesses(results, difficulty) {
  const resolved = resolveOnesCancelHighest(results);
  const successfulEntries = resolved.remainingResults.map((value, index) => ({ value, index: resolved.remainingIndexes[index] }))
    .filter((entry) => entry.value >= difficulty);
  const successfulResults = successfulEntries.map((entry) => entry.value);
  return {
    ...resolved,
    successes: successfulResults.reduce((sum, value) => sum + (value === 10 ? 2 : 1), 0),
    successfulResults,
    successfulIndexes: successfulEntries.map((entry) => entry.index),
    contribution: successfulResults.reduce((sum, value) => sum + value, 0),
    // Valid tens count as two successes and only attack-roll tens trigger criticals.
    tens: successfulResults.filter((result) => result === 10).length
  };
}

function sumSuccessfulDice(results, difficulty = 6) {
  // Weapon and critical damage rolls use absolute successful values but do not trigger
  // the house-rule cancellation: 1s on damage dice are simply below difficulty.
  const entries = (results ?? []).map((value, index) => ({ value, index }));
  const successfulEntries = entries.filter((entry) => entry.value >= difficulty);
  const successfulResults = successfulEntries.map((entry) => entry.value);
  return {
    ones: 0,
    onesIndexes: [],
    cancelledIndexes: [],
    cancelledResults: [],
    remainingResults: (results ?? []).slice(),
    remainingIndexes: entries.map((entry) => entry.index),
    successes: successfulResults.reduce((sum, value) => sum + (value === 10 ? 2 : 1), 0),
    successfulResults,
    successfulIndexes: successfulEntries.map((entry) => entry.index),
    contribution: successfulResults.reduce((sum, value) => sum + value, 0),
    tens: successfulResults.filter((value) => value === 10).length
  };
}

function renderDiceStrip(results, resolution, difficulty = 6, markTensCritical = false) {
  if (!results?.length) return `<div class="dhp-dice-strip dhp-dice-empty"><span>Sem dados</span></div>`;
  const successes = new Set(resolution?.successfulIndexes ?? []);
  const cancelled = new Set(resolution?.cancelledIndexes ?? []);
  const ones = new Set(resolution?.onesIndexes ?? []);
  const ordered = results.map((value, index) => ({ value, index })).sort((a, b) => {
    const group = (entry) => entry.value === 1 ? 0 : (cancelled.has(entry.index) ? 1 : entry.value === 10 ? 4
      : (successes.has(entry.index) ? 3 : 1));
    return group(a) - group(b) || a.value - b.value || a.index - b.index;
  });
  return `<div class="dhp-dice-strip" role="list" aria-label="Dados rolados">${ordered.map(({ value, index }) => {
    let state = "miss";
    let title = `Resultado ${value}`;
    if (ones.has(index)) { state = "one"; title = `1 - cancela o maior resultado`; }
    else if (cancelled.has(index)) { state = "cancelled"; title = `${value} - cancelado por 1`; }
    else if (successes.has(index)) { state = value === 10 && markTensCritical ? "critical" : "success"; title = value === 10 ? `10 - dois sucessos` : `${value} - sucesso`; }
    else { title = `${value} - abaixo da dificuldade ${difficulty}`; }
    return `<span class="dhp-die dhp-die--${state}" role="listitem" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}"><img src="/icons/svg/d10-grey.svg" alt="" aria-hidden="true" draggable="false"><span>${value}</span></span>`;
  }).join("")}</div>`;
}

function cancellationNote(resolution) {
  if (!resolution?.ones) return "";
  const cancelled = resolution.cancelledResults?.length ? resolution.cancelledResults.join(", ") : "nenhum dado disponível";
  return `<div class="dhp-cancel-note">1${resolution.ones > 1 ? ` × ${resolution.ones}` : ""} cancelou${resolution.ones > 1 ? "ram" : ""} ${escapeHtml(cancelled)}.</div>`;
}

function compactRollLine(label, results, resolution, difficulty = 6, markTensCritical = false) {
  return `<div class="dhp-roll-block"><div class="dhp-roll-label">${escapeHtml(label)}</div>${renderDiceStrip(results, resolution, difficulty, markTensCritical)}${cancellationNote(resolution)}</div>`;
}

async function rollWeaponDamage(actor, weapon, outOfRange = false, ammoType = "standard", criticalHits = 0, extraDamageDice = 0) {
  const ammo = AMMUNITION_TYPES[ammoType] ?? AMMUNITION_TYPES.standard;
  let diceCount = Math.max(0, safeNumber(ammo.dice ?? weapon.damageDice)) + Math.max(0, clampInt(extraDamageDice, 0, 100));
  if (outOfRange && diceCount > 0 && ["firearm", "bow", "heavy", "special", "thrown", "explosive"].includes(weapon.category)) diceCount = Math.max(1, Math.floor(diceCount / 2));
  const damageMode = ammo.mode ?? weapon.damageMode;
  const damageType = ammo.type ?? weapon.damageType;
  const staticBonus = damageMode === "strength" ? findTraitValue(actor, "attribute", "strength") : 0;

  let baseRoll = null;
  let baseResults = [];
  let baseResolution = { successes: 0, successfulResults: [], cancelledResults: [], ones: 0, contribution: 0, remainingResults: [] };
  if (diceCount > 0) {
    baseRoll = await evaluateRoll(`${diceCount}d10`);
    baseResults = diceResults(baseRoll);
    baseResolution = sumSuccessfulDice(baseResults, 6);
  }

  // Criticals are generated by surviving attack 10s, not by 10s on the weapon-damage roll.
  const crits = Math.max(0, safeNumber(criticalHits));
  const critDice = crits * (CRITICAL_DICE[damageType] ?? 0);
  let criticalRoll = null;
  let criticalResults = [];
  let criticalResolution = { successes: 0, successfulResults: [], cancelledResults: [], ones: 0, contribution: 0, remainingResults: [] };
  if (critDice > 0) {
    criticalRoll = await evaluateRoll(`${critDice}d10`);
    criticalResults = diceResults(criticalRoll);
    criticalResolution = sumSuccessfulDice(criticalResults, 6);
  }

  const damage = staticBonus + baseResolution.contribution + criticalResolution.contribution;
  return {
    damage, staticBonus, diceCount, extraDamageDice: Math.max(0, clampInt(extraDamageDice, 0, 100)), damageType, ammoType, ammoLabel: ammo.label, ammoNotes: ammo.notes,
    baseRoll, baseResults, baseResolution, crits, critDice, criticalRoll, criticalResults, criticalResolution
  };
}

function currentTargetToken() {
  return [...(game.user.targets ?? [])][0] ?? null;
}

function tokenDocumentUuid(token) {
  return token?.document?.uuid ?? token?.uuid ?? null;
}

// Capture target ownership into the attack card while the attacker can still resolve
// the selected token and its base actor. This keeps targeted defense available to the
// correct player even when the target is a synthetic actor from an unlinked token.
function targetActorDocuments(targetToken, knownActor = null) {
  const tokenDocument = targetToken?.document ?? targetToken ?? null;
  const actor = knownActor ?? targetToken?.actor ?? tokenDocument?.actor ?? null;
  const documents = [];
  const append = (document) => {
    if (document && !documents.includes(document)) documents.push(document);
  };
  for (const document of [
    // A permissão pode estar definida diretamente no TokenDocument, e não no Actor.
    // Incluí-lo aqui permite reconhecer o jogador que controla o token selecionado.
    tokenDocument, actor, actor?.baseActor, actor?.parent?.actor, actor?.parent?.baseActor,
    tokenDocument?.actor, tokenDocument?.baseActor, tokenDocument?.actor?.baseActor
  ]) append(document);
  const actorId = tokenDocument?.actorId ?? tokenDocument?._source?.actorId ?? actor?.baseActor?.id ?? actor?.id;
  if (actorId) {
    try { append(game.actors?.get?.(String(actorId))); } catch (_) { /* ActorCollection variants */ }
  }
  return documents;
}

function targetOwnerUserIds(targetToken, knownActor = null) {
  try {
    const documents = targetActorDocuments(targetToken, knownActor);
    const documentIds = new Set(documents.flatMap((document) => [document?.id, document?._id, document?.uuid].filter(Boolean).map(String)));
    const collection = game.users?.contents ?? game.users ?? [];
    const users = Array.isArray(collection) ? collection : Array.from(collection);
    const owners = [];
    const ownerLevel = Number(globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3);
    for (const user of users) {
      if (!user || user.isGM) continue;
      const assigned = user.character;
      const assignedIds = [assigned?.id, assigned?._id, assigned?.uuid].filter(Boolean).map(String);
      let assignedToTarget = assignedIds.some((id) => documentIds.has(id));
      if (!assignedToTarget) {
        assignedToTarget = documents.some((document) => {
          try {
            if (document.testUserPermission?.(user, ownerLevel) === true || document.testUserPermission?.(user, "OWNER") === true) return true;
          } catch (_) { /* fall back to ownership data */ }
          const ownership = document.ownership ?? document._source?.ownership ?? {};
          const level = Number(ownership[user.id] ?? ownership.default ?? 0);
          return Number.isFinite(level) && level >= ownerLevel;
        });
      }
      if (assignedToTarget) owners.push(String(user.id));
    }
    return [...new Set(owners)];
  } catch (error) {
    console.warn(`${MODULE_ID} | Não foi possível pré-calcular os proprietários do alvo; a verificação normal continuará.`, error);
    return [];
  }
}

function userIsTargetOwnerFromFlags(user, combat) {
  if (!user || !combat) return false;
  if (user.isGM) return true;
  if (Array.isArray(combat.targetOwnerIds) && combat.targetOwnerIds.map(String).includes(String(user.id))) return true;
  const character = user.character;
  const characterIds = [character?.id, character?._id, character?.uuid].filter(Boolean).map(String);
  const targetIds = [combat.targetActorId, combat.targetActorUuid].filter(Boolean).map(String);
  return characterIds.some((id) => targetIds.includes(id));
}

async function createAttackChatCard({ actor, weapon, shot, maneuverLabel = "", difficulty, pool, attackRoll, attackResults, attackResolution, successes, distance, damageData, targetToken, targetName, damage, ammoType, allocationLabel = "" }) {
  const resolved = attackResolution ?? rollSuccesses(attackResults, difficulty);
  // The resolved dice are authoritative. Some macro and weapon pathways may pass a stale
  // success counter; defense eligibility must follow the actual roll displayed in the card.
  const hit = safeNumber(resolved?.successes, safeNumber(successes)) > 0;
  const damageType = damageData?.damageType ?? weapon.damageType;
  const weaponResolution = damageData?.baseResolution ?? { successes: 0, successfulResults: [], successfulIndexes: [], contribution: 0, cancelledIndexes: [], onesIndexes: [] };
  const criticalResolution = damageData?.criticalResolution ?? { successes: 0, successfulResults: [], successfulIndexes: [], contribution: 0, cancelledIndexes: [], onesIndexes: [] };
  const weaponContribution = safeNumber(damageData?.baseResolution?.contribution) + safeNumber(damageData?.staticBonus);
  const criticalContribution = safeNumber(damageData?.criticalResolution?.contribution);
  const targetUuid = tokenDocumentUuid(targetToken);
  const targetActor = targetToken?.actor ?? targetToken?.document?.actor ?? null;
  const targetActorUuid = targetActor?.uuid ?? targetToken?.document?.actor?.uuid ?? "";
  // actorId is the linked/base actor ID when the target token has one; targetActorUuid
  // separately preserves synthetic actors for unlinked tokens.
  const targetActorId = targetToken?.document?.actorId ?? targetActor?.baseActor?.id ?? targetActor?.id ?? "";
  const targetOwnerIds = targetActor ? targetOwnerUserIds(targetToken, targetActor) : [];
  const damageUnitLabel = targetActor ? (isAbsoluteHealthActor(targetActor) ? "PV" : "%") : "pontos";
  const targetHasShield = Boolean(targetActor && equippedArmor(targetActor).some((item) => armorCoverage(item).includes("shield")));
  const shieldOption = targetHasShield ? `<option value="shield">Bloqueio com escudo</option>` : "";
  const attackDifficultyLabel = `Dif. ${difficulty}`;
  const weaponBlock = damageData ? `<div class="dhp-combat-roll-section">
      <div class="dhp-section-heading"><span>Dano da arma</span><span class="dhp-type-badge dhp-type-${String(damageType).toLowerCase()}">${escapeHtml(damageTypeLabel(damageType))}</span></div>
      <div class="dhp-roll-meta">${damageData.diceCount}d10 · dificuldade 6${damageData.extraDamageDice ? ` · +${damageData.extraDamageDice}d10 da manobra` : ""}${damageData.staticBonus ? ` · Força +${damageData.staticBonus}` : ""}</div>
      ${compactRollLine("Rolagem", damageData.baseResults, weaponResolution, 6)}
      <div class="dhp-contribution">${weaponResolution.successes ?? 0} sucessos <span>${(damageData.baseResolution?.successfulResults ?? []).length ? damageData.baseResolution.successfulResults.join(" + ") : "0"}${damageData.staticBonus ? ` + ${damageData.staticBonus}` : ""} = <strong>${weaponContribution} ${damageUnitLabel}</strong></span></div>
      ${damageData.crits ? `<div class="dhp-critical-block"><div class="dhp-section-heading"><span>Crítico do ataque</span><span class="dhp-mini-badge">${damageData.crits} × 10 → ${damageData.critDice}d10</span></div>${compactRollLine("Dados críticos", damageData.criticalResults, criticalResolution, 6)}<div class="dhp-contribution">+ <strong>${criticalContribution} ${damageUnitLabel}</strong></div></div>` : ""}
    </div>` : "";
  const hasUniqueTarget = Boolean(targetUuid || targetActorUuid || targetActorId);
  const defenses = hit ? `<div class="dhp-defense-controls" data-dhp-open-defense="${hasUniqueTarget ? "false" : "true"}">
      ${hasUniqueTarget ? `<div class="dhp-target-identity"><span>Alvo</span><strong>${escapeHtml(targetName || targetToken?.name || targetActor?.name || "Selecionado")}</strong><small>${escapeHtml(vitalityDisplay(targetActor))}</small></div>` : `<div class="dhp-target-identity dhp-target-open"><strong>Defesa aberta</strong><small>Sem alvo único. Cada jogador pode escolher um personagem que controla para defender.</small></div>`}
      <label><span>Ação defensiva</span><select data-dhp-defense-mode>
        <option value="dodge">Esquivar</option><option value="parry">Aparar</option><option value="brawl">Defesa corporal</option>${shieldOption}<option value="magic">Defesa mágica</option><option value="rote">Rotina defensiva</option>
      </select></label>
      <label class="dhp-difficulty-control"><span>Dificuldade</span><input type="number" min="2" max="10" value="6" data-dhp-defense-difficulty /></label>
      <button type="button" data-dhp-chat-defend>Rolar defesa</button>
    </div>` : "";
  const vitalityPenaltyText = pool.penalty ? ` · Vitalidade ${pool.penalty < 0 ? "−" : "+"}${Math.abs(pool.penalty)}` : "";
  const content = `<div class="dhp-chat-card dhp-attack-card">
    <header><strong>${escapeHtml(actor.name)} · ${escapeHtml(weapon.name)}${typeof shot === "number" ? ` · Disparo ${shot}` : shot ? ` · ${escapeHtml(shot)}` : ""}</strong></header>
    <div class="dhp-attack-meta">Ataque · Destreza ${pool.attr} + ${escapeHtml(weaponAbilityLabel(pool.ability ?? weaponAbility(weapon)))} ${pool.skill}${vitalityPenaltyText} = ${pool.pool}d10 · ${attackDifficultyLabel}${distance > 0 ? ` · ${distance} m` : ""}${maneuverLabel ? `<br><strong>${escapeHtml(maneuverLabel)}</strong>` : ""}${allocationLabel ? `<br>${escapeHtml(allocationLabel)}` : ""}</div>
    <div class="dhp-success-count">Sucessos <strong>${resolved.successes ?? 0}</strong> ${hit ? `<span class="dhp-hit-badge">ACERTO</span>` : `<span class="dhp-miss-badge">ERRO</span>`}</div>
    ${compactRollLine("Ataque", attackResults, resolved, difficulty, true)}
    ${weaponBlock}
    <div class="dhp-damage-total"><span>Dano potencial</span><strong>${hit ? Math.max(0, safeNumber(damage)) : 0} ${damageUnitLabel}</strong></div>
    ${defenses}
  </div>`;
  const weaponDamageState = damageData ? {
    staticBonus: damageData.staticBonus, diceCount: damageData.diceCount, extraDamageDice: damageData.extraDamageDice ?? 0, damageType: damageData.damageType,
    ammoType: damageData.ammoType, ammoLabel: damageData.ammoLabel, baseResults: damageData.baseResults,
    baseResolution: damageData.baseResolution, crits: damageData.crits, critDice: damageData.critDice,
    criticalResults: damageData.criticalResults, criticalResolution: damageData.criticalResolution
  } : null;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }), content,
    rolls: [attackRoll, ...(damageData?.baseRoll ? [damageData.baseRoll] : []), ...(damageData?.criticalRoll ? [damageData.criticalRoll] : [])],
    flags: { [MODULE_ID]: {
      damage: hit ? damage : 0, targetUuid: targetUuid ?? "", targetActorUuid, targetActorId, applied: false, weaponId: weapon.id,
      combat: hit ? {
        targetUuid: targetUuid ?? "", targetActorUuid, targetActorId, targetOwnerIds,
        targetName: targetName ?? targetToken?.name ?? targetActor?.name ?? "", attackerName: actor.name, attackerId: actor.id, weaponName: weapon.name,
        weaponCategory: weapon.category, damageType, difficulty, distance, maneuverLabel, allocationLabel,
        attackResults, attackResolution: resolved, attackPool: pool,
        weaponDamage: weaponDamageState, potentialDamage: Math.max(0, safeNumber(damage)), ammoType
      } : null
    } }
  });
}

function weaponAbilityLabel(key) {
  return ({ firearms: "Armas de Fogo", melee: "Armas Brancas", brawl: "Briga", dodge: "Esquiva", alertness: "Prontidão", archery: "Arquearia", athletics: "Esportes/Atletismo" })[key] ?? "Habilidade";
}

function weaponSupportsAutomatic(weapon) {
  return Boolean(weapon?.automatic) && ["firearm", "heavy", "special"].includes(weapon.category) && weapon.ammoCapacity != null;
}

function automaticModeOptions(weapon) {
  if (!weaponSupportsAutomatic(weapon)) return "";
  return `<label class="dhp-inline-field dhp-fire-mode-field"><span>Modo de tiro</span><select data-dhp-fire-mode>
    <option value="normal">Disparo normal</option>
    <option value="burst">Rajada de 3 tiros (+1 dif., +3d10)</option>
    <option value="automatic">Automático: pente inteiro (+2 dif., +10d10)</option>
    <option value="suppressive">Metralhar área (+2 dif., +10d10 distribuídos)</option>
  </select></label>`;
}

async function fireWeapon(actor, weaponId, row = null, overrides = {}) {
  if (!actor?.isOwner) return;
  const weapons = getWeapons(actor);
  const weapon = weapons.find((entry) => entry.id === weaponId);
  if (!weapon) return ui.notifications.warn("A arma não foi encontrada no arsenal.");
  if (healthValue(actor) <= 0) return ui.notifications.warn("A Vitalidade está em 0%; o personagem não pode atacar.");
  if (weapon.category === "explosive") { await detonateWeapon(actor, weapon, weapons); return; }

  const readRow = (selector, fallback) => row?.querySelector(selector)?.value ?? fallback;
  const autoCapable = weaponSupportsAutomatic(weapon);
  let fireMode = autoCapable ? String(overrides.fireMode ?? readRow("[data-dhp-fire-mode]", "normal")) : "normal";
  if (!["normal", "burst", "automatic", "suppressive"].includes(fireMode)) fireMode = "normal";
  let shots = Math.max(1, safeNumber(overrides.shots ?? readRow("[data-dhp-shots]", 1), 1));
  shots = Math.min(shots, Math.max(1, safeNumber(weapon.cadence, 1)));
  if (["melee", "natural"].includes(weapon.category)) shots = 1;

  const hasAmmo = weapon.ammoCapacity != null;
  const available = hasAmmo ? Math.max(0, safeNumber(weapon.ammoCurrent)) : Number.POSITIVE_INFINITY;
  if (hasAmmo && available <= 0) return ui.notifications.warn(`${weapon.name}: sem munição. Use Recarregar.`);
  if (fireMode !== "normal" && !autoCapable) return ui.notifications.warn("Esta arma não foi configurada como automática.");
  if (fireMode === "burst" && (!hasAmmo || available < 3 || safeNumber(weapon.cadence) < 3)) {
    return ui.notifications.warn("A rajada de três tiros exige uma arma automática com cadência 3 ou maior e pelo menos 3 munições.");
  }
  if ((fireMode === "automatic" || fireMode === "suppressive") && (!hasAmmo || available < 1)) {
    return ui.notifications.warn("Este modo exige munição no carregador.");
  }

  const target = currentTargetToken();
  const distanceInput = row?.querySelector("[data-dhp-distance]");
  const distanceRequested = overrides.distance !== undefined || Boolean(distanceInput);
  let distance = Math.max(0, safeNumber(overrides.distance ?? readRow("[data-dhp-distance]", 0), 0));
  if (distanceRequested && distance === 0 && target) {
    const attackerToken = (canvas.tokens?.controlled ?? []).find((token) => token.actor?.id === actor.id)
      ?? (actor.getActiveTokens?.(true) ?? []).find((token) => token?.scene === canvas.scene || token?.document?.parent?.id === canvas.scene?.id);
    const measured = sceneDistanceMeters(attackerToken, target);
    if (Number.isFinite(measured)) distance = Math.round(measured * 10) / 10;
  }
  if (distanceInput && distance > 0 && safeNumber(distanceInput.value) === 0) distanceInput.value = String(distance);
  const beyondRange = weapon.rangeM > 0 && distance > safeNumber(weapon.rangeM) && ["firearm", "bow", "heavy", "special", "thrown"].includes(weapon.category);
  const rangePenalty = beyondRange ? Math.floor((distance - safeNumber(weapon.rangeM)) / 10) : 0;
  const ammoType = overrides.ammoType ?? readRow("[data-dhp-ammo-type]", "standard");
  const basePool = attackPool(actor, weapon);
  if (basePool.pool <= 0) return ui.notifications.warn("A parada de ataque está em 0 dados após as penalidades de Vitalidade.");

  let modeShots = shots;
  let difficultyBonus = 0;
  let extraDamageDice = 0;
  let ammoToConsume = shots;
  let singleSpecialAttack = false;
  let maneuverLabel = "";
  let areaRadius = 0;
  if (fireMode === "burst") {
    modeShots = 3; ammoToConsume = 3; difficultyBonus = 1; extraDamageDice = 3; singleSpecialAttack = true;
    maneuverLabel = "Rajada de 3 tiros: +1 dificuldade, +3d10 de dano";
  } else if (fireMode === "automatic") {
    modeShots = available; ammoToConsume = available; difficultyBonus = 2; extraDamageDice = 10; singleSpecialAttack = true;
    maneuverLabel = `Modo automático: ${modeShots} munições, +2 dificuldade, +10d10 de dano`;
  } else if (fireMode === "suppressive") {
    modeShots = available; ammoToConsume = available; difficultyBonus = 2; extraDamageDice = 10; singleSpecialAttack = true;
    areaRadius = Math.max(1, safeNumber(overrides.areaRadius ?? readRow("[data-dhp-suppress-area]", weapon.areaM || 5), weapon.areaM || 5));
    maneuverLabel = `Metralhar área: raio ${areaRadius} m, carregador gasto, +2 dificuldade, +10d10 distribuídos`;
  } else if (hasAmmo) {
    modeShots = Math.min(modeShots, available); ammoToConsume = modeShots;
  }

  let areaTargets = [];
  if (fireMode === "suppressive") {
    if (!target) return ui.notifications.warn("Selecione um token para marcar o centro da área que será metralhada.");
    areaTargets = (canvas.tokens?.placeables ?? []).filter((token) => token.actor && token.actor.id !== actor.id && sceneDistanceMeters(target, token) <= areaRadius);
    if (!areaTargets.length) return ui.notifications.warn("Não há alvos dentro do raio selecionado. A munição não foi consumida.");
  }

  const singleAttack = async () => {
    const difficulty = Math.min(10, safeNumber(weapon.difficulty, 6) + rangePenalty + difficultyBonus);
    const attackRoll = await evaluateRoll(`${basePool.pool}d10`);
    const attackResults = diceResults(attackRoll);
    const result = rollSuccesses(attackResults, difficulty);
    if (result.successes <= 0) {
      await createAttackChatCard({
        actor, weapon, shot: fireMode === "normal" ? null : (fireMode === "burst" ? "Rajada" : fireMode === "automatic" ? "Automático" : "Metralhar"),
        maneuverLabel, difficulty, pool: basePool, attackRoll, attackResults, attackResolution: result, successes: 0,
        distance, damageData: null, targetToken: target, targetName: target?.name ?? "", damage: 0, ammoType
      });
      return;
    }

    if (fireMode !== "suppressive") {
      const damageData = await rollWeaponDamage(actor, weapon, beyondRange, ammoType, result.tens, extraDamageDice);
      const damage = result.contribution + damageData.damage;
      await createAttackChatCard({
        actor, weapon, shot: fireMode === "normal" ? (modeShots > 1 ? 1 : null) : (fireMode === "burst" ? "Rajada de 3 tiros" : "Modo automático"),
        maneuverLabel, difficulty, pool: basePool, attackRoll, attackResults, attackResolution: result, successes: result.successes,
        distance, damageData, targetToken: target, targetName: target?.name ?? "", damage, ammoType
      });
      return;
    }

    // Metralhar: roll the weapon + 10d10 damage pool once, then distribute the individual
    // rolled damage dice and the successful attack faces across all targets in the area.
    const pooledDamage = await rollWeaponDamage(actor, weapon, beyondRange, ammoType, result.tens, extraDamageDice);
    const targetCount = areaTargets.length;
    const attackDiceByTarget = areaTargets.map(() => []);
    result.successfulResults.forEach((value, index) => attackDiceByTarget[index % targetCount].push(value));
    const damageDiceByTarget = areaTargets.map(() => []);
    pooledDamage.baseResults.forEach((value, index) => damageDiceByTarget[index % targetCount].push(value));
    const criticalDiceCountPerTarget = attackDiceByTarget.map((values) => values.filter((value) => value === 10).length * (CRITICAL_DICE[pooledDamage.damageType] ?? 0));
    const criticalDiceByTarget = areaTargets.map(() => []);
    let criticalOffset = 0;
    criticalDiceCountPerTarget.forEach((count, index) => {
      criticalDiceByTarget[index] = pooledDamage.criticalResults.slice(criticalOffset, criticalOffset + count);
      criticalOffset += count;
    });
    for (let index = 0; index < areaTargets.length; index += 1) {
      const targetToken = areaTargets[index];
      const attackContribution = attackDiceByTarget[index].reduce((sum, value) => sum + value, 0);
      const baseResults = damageDiceByTarget[index];
      const baseResolution = sumSuccessfulDice(baseResults, 6);
      const criticalResults = criticalDiceByTarget[index];
      const criticalResolution = sumSuccessfulDice(criticalResults, 6);
      const perTargetDamageData = {
        ...pooledDamage,
        extraDamageDice: 0,
        diceCount: baseResults.length,
        baseResults,
        baseResolution,
        crits: attackDiceByTarget[index].filter((value) => value === 10).length,
        critDice: criticalResults.length,
        criticalResults,
        criticalResolution,
        damage: safeNumber(pooledDamage.staticBonus) + baseResolution.contribution + criticalResolution.contribution
      };
      const targetDamage = attackContribution + perTargetDamageData.damage;
      await createAttackChatCard({
        actor, weapon, shot: "Metralhar", maneuverLabel, difficulty, pool: basePool,
        attackRoll, attackResults, attackResolution: result, successes: result.successes,
        distance, damageData: perTargetDamageData, targetToken, targetName: targetToken.name,
        damage: targetDamage, ammoType,
        allocationLabel: `Alvo ${index + 1}/${targetCount} · ${attackContribution} do ataque + ${baseResolution.contribution + criticalResolution.contribution} do dano` 
      });
    }
  };

  if (singleSpecialAttack || fireMode === "normal") {
    if (fireMode === "normal") {
      for (let index = 0; index < modeShots; index += 1) {
        const difficulty = Math.min(10, safeNumber(weapon.difficulty, 6) + rangePenalty);
        const attackRoll = await evaluateRoll(`${basePool.pool}d10`);
        const attackResults = diceResults(attackRoll);
        const result = rollSuccesses(attackResults, difficulty);
        let damageData = null;
        let damage = 0;
        if (result.successes > 0) {
          damageData = await rollWeaponDamage(actor, weapon, beyondRange, ammoType, result.tens);
          damage = result.contribution + damageData.damage;
        }
        await createAttackChatCard({
          actor, weapon, shot: modeShots > 1 ? index + 1 : null, difficulty,
          pool: basePool, attackRoll, attackResults, attackResolution: result, successes: result.successes,
          distance, damageData, targetToken: target, targetName: target?.name ?? "", damage, ammoType
        });
      }
    } else {
      await singleAttack();
    }
  }

  if (hasAmmo) {
    weapon.ammoCurrent = Math.max(0, safeNumber(weapon.ammoCurrent) - ammoToConsume);
    await setWeapons(actor, weapons);
    refreshArsenals(actor);
  }
}

function sceneDistanceMeters(tokenA, tokenB) {
  const a = tokenA?.center ?? tokenA?.object?.center;
  const b = tokenB?.center ?? tokenB?.object?.center;
  if (!a || !b) return Infinity;
  const size = safeNumber(canvas.grid?.size, 100) || 100;
  const gridDistance = safeNumber(canvas.scene?.grid?.distance, 1) || 1;
  let distance = Math.hypot(a.x - b.x, a.y - b.y) / size * gridDistance;
  const units = normalized(canvas.scene?.grid?.units ?? "m");
  if (units === "ft" || units.includes("foot") || units.includes("feet")) distance *= 0.3048;
  else if (units === "mile" || units === "miles") distance *= 1609.344;
  return distance;
}

async function detonateWeapon(actor, weapon, weapons) {
  if (weapon.ammoCapacity != null && safeNumber(weapon.ammoCurrent) <= 0) return ui.notifications.warn(`${weapon.name}: sem munição.`);
  const centerToken = currentTargetToken();
  if (!centerToken) return ui.notifications.warn("Selecione o token que marca o centro pretendido da explosão.");
  const throwerToken = (canvas.tokens?.controlled ?? []).find((token) => token.actor?.id === actor.id)
    ?? (actor.getActiveTokens?.(true) ?? []).find((token) => token?.scene === canvas.scene || token?.document?.parent?.id === canvas.scene?.id);
  const distance = sceneDistanceMeters(throwerToken, centerToken);
  const knownDistance = Number.isFinite(distance);
  const beyondRange = knownDistance && weapon.rangeM > 0 && distance > safeNumber(weapon.rangeM);
  const rangePenalty = beyondRange ? Math.floor((distance - safeNumber(weapon.rangeM)) / 10) : 0;
  const difficulty = Math.min(10, safeNumber(weapon.difficulty, 6) + rangePenalty);
  const pool = attackPool(actor, weapon);
  if (pool.pool <= 0) return ui.notifications.warn("A parada de arremesso está em 0 dados após as penalidades de Vitalidade.");

  const attackRoll = await evaluateRoll(`${pool.pool}d10`);
  const attackResults = diceResults(attackRoll);
  const attack = rollSuccesses(attackResults, difficulty);
  if (weapon.ammoCapacity != null) {
    weapon.ammoCurrent = Math.max(0, safeNumber(weapon.ammoCurrent) - 1);
    await setWeapons(actor, weapons);
    refreshArsenals(actor);
  }
  if (attack.successes <= 0) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="dhp-chat-card dhp-attack-card"><header><strong>${escapeHtml(actor.name)} · ${escapeHtml(weapon.name)} · Arremesso</strong></header><div class="dhp-attack-meta">Destreza ${pool.attr} + Atletismo ${pool.skill} = ${pool.pool}d10 · Dif. ${difficulty}${knownDistance ? ` · ${Math.round(distance * 10) / 10} m` : ""}</div><div class="dhp-success-count">Sucessos <strong>0</strong><span class="dhp-miss-badge">ERRO</span></div>${compactRollLine("Arremesso", attackResults, attack, difficulty)}<div class="dhp-no-damage">A explosão não atingiu o ponto designado; dispersão a critério do Narrador.</div></div>`,
      rolls: [attackRoll],
      flags: { [MODULE_ID]: { explosiveMiss: true, weaponId: weapon.id } }
    });
    return;
  }

  const damageData = await rollWeaponDamage(actor, weapon, beyondRange, "standard", attack.tens);
  const damage = attack.contribution + damageData.damage;
  const victims = (canvas.tokens?.placeables ?? []).filter((token) => sceneDistanceMeters(centerToken, token) <= safeNumber(weapon.areaM));
  if (!victims.length) return ui.notifications.info("Nenhum token foi encontrado dentro do raio da explosão.");
  for (const victim of victims) {
    await createAttackChatCard({
      actor, weapon, shot: null, difficulty, pool, attackRoll, attackResults, attackResolution: attack,
      successes: attack.successes, distance: knownDistance ? distance : 0, damageData,
      targetToken: victim, targetName: victim.name, damage, ammoType: "standard", targetRegion: "general"
    });
  }
}

function damageTypeSystemKey(type) {
  return ({ B: "bashing", L: "lethal", A: "aggravated" })[type] ?? "lethal";
}

function itemIsEquipped(item) {
  const values = [item?.system?.isequipped, item?.system?.isEquipped, item?.system?.equipped, item?.system?.worn];
  return values.some((value) => value === true || value === 1 || normalized(value) === "true" || normalized(value) === "equipped" || normalized(value) === "worn");
}

function armorCoverage(item) {
  const raw = item?.getFlag?.(MODULE_ID, "armorCoverage") ?? item?.flags?.[MODULE_ID]?.armorCoverage;
  const values = Array.isArray(raw) ? raw.map((entry) => normalized(entry)) : [normalized(raw || "full")];
  // Dravent attacks are resolved generally, not by body region. The only special coverage
  // state kept by the editor is whether the equipment is a shield that must be actively used.
  return values.includes("shield") ? ["shield"] : ["full"];
}

function armorCoversRegion(item, region = "torso") {
  const coverage = armorCoverage(item);
  const target = normalized(region || "torso");
  return coverage.includes("full") || coverage.includes(target);
}

function equippedArmor(actor, region = null) {
  const items = (actor?.items ?? []).filter((item) => item.type === "Armor" && itemIsEquipped(item));
  return region ? items.filter((item) => armorCoversRegion(item, region)) : items;
}

function mobilityReferenceText(reference, mobility) {
  const marker = /(?:[.;|·]\s*)?Penalidade de mobilidade Dravent:\s*\+\d+\s*à dificuldade de defesa\.?/gi;
  const base = String(reference ?? "").replace(marker, "").replace(/[.;|·]\s*$/, "").trim();
  const note = `Penalidade de mobilidade Dravent: +${Math.max(0, safeNumber(mobility))} à dificuldade de defesa.`;
  return base ? `${base}; ${note}` : note;
}

async function normalizeArmorMobility(item, incomingChanges = null) {
  if (!item || item.type !== "Armor" || !item.update) return;
  const systemPenalty = safeNumber(item.system?.dexpenalty);
  const hasDottedChange = incomingChanges && Object.prototype.hasOwnProperty.call(incomingChanges, "system.dexpenalty");
  const hasNestedChange = incomingChanges?.system && Object.prototype.hasOwnProperty.call(incomingChanges.system, "dexpenalty");
  const hasExplicitPenalty = Boolean(hasDottedChange || hasNestedChange);
  const explicitPenalty = hasDottedChange ? incomingChanges["system.dexpenalty"] : hasNestedChange ? incomingChanges.system.dexpenalty : undefined;
  const storedPenalty = item.getFlag?.(MODULE_ID, "mobilityPenalty") ?? item.flags?.[MODULE_ID]?.mobilityPenalty;
  // A saved field change is authoritative, including setting the penalty back to zero.
  const mobility = hasExplicitPenalty ? Math.abs(safeNumber(explicitPenalty))
    : Math.max(Math.abs(systemPenalty), Math.max(0, safeNumber(storedPenalty)));
  const original = item.getFlag?.(MODULE_ID, "originalDexterityPenalty") ?? item.flags?.[MODULE_ID]?.originalDexterityPenalty;
  const needsNativeReset = systemPenalty !== 0;
  const needsFlag = storedPenalty === undefined || storedPenalty === null || safeNumber(storedPenalty) !== mobility || (needsNativeReset && original === undefined);
  const reference = mobilityReferenceText(item.system?.reference, mobility);
  const needsReference = reference !== String(item.system?.reference ?? "");
  if (!needsNativeReset && !needsFlag && !needsReference) return;
  const update = { "system.dexpenalty": 0, [`flags.${MODULE_ID}.mobilityPenalty`]: mobility };
  if (needsReference) update["system.reference"] = reference;
  if (original === undefined && systemPenalty !== 0) update[`flags.${MODULE_ID}.originalDexterityPenalty`] = systemPenalty;
  await item.update(update);
}

function patchArmorItemSheet(app, html) {
  const item = app?.document ?? app?.item ?? app?.object;
  if (game.system?.id !== SYSTEM_ID || item?.documentName !== "Item" || item.type !== "Armor") return;
  const root = asElement(html, app);
  if (!root) return;
  // Remove stale body-region selectors left by older Dravent builds. Combat no longer targets regions.
  root.querySelectorAll(".dhp-region-field, [data-dhp-coverage-region], [data-dhp-region-selector], .dhp-armor-coverage-regions").forEach((element) => element.remove());
  root.querySelectorAll('input[data-dhp-coverage-value]:not([data-dhp-coverage-value="shield"])').forEach((input) => {
    const label = input.closest("label");
    if (label) label.remove();
  });
  if (root.querySelector("[data-dhp-armor-item-coverage]")) return;
  const mobilityValue = Math.max(0, safeNumber(item.getFlag?.(MODULE_ID, "mobilityPenalty") ?? item.flags?.[MODULE_ID]?.mobilityPenalty ?? Math.abs(safeNumber(item.system?.dexpenalty))));
  const dexInput = root.querySelector('[name="system.dexpenalty"]');
  if (dexInput) {
    dexInput.value = String(-mobilityValue);
    const group = dexInput.closest(".form-group, .form-group-stacked, fieldset, label") ?? dexInput.parentElement;
    const label = group?.querySelector("label, .label");
    if (label) label.textContent = "Penalidade de mobilidade Dravent";
    if (group && !group.querySelector("[data-dhp-mobility-help]")) {
      const help = document.createElement("small");
      help.dataset.dhpMobilityHelp = "true";
      help.textContent = "Use 0 a -3. O valor aumenta a dificuldade da defesa, sem remover dados.";
      group.append(help);
    }
  }
  const savedCoverage = item.getFlag?.(MODULE_ID, "armorCoverage") ?? item.flags?.[MODULE_ID]?.armorCoverage;
  const isShield = (Array.isArray(savedCoverage) ? savedCoverage : [savedCoverage]).some((value) => normalized(value) === "shield");
  const coveragePanel = document.createElement("section");
  coveragePanel.className = "dhp-armor-item-coverage";
  coveragePanel.dataset.dhpArmorItemCoverage = "true";
  coveragePanel.innerHTML = `<strong>Proteção Dravent</strong><p>O combate usa defesa geral, sem selecionar partes do corpo. Toda armadura equipada contribui conforme os dados de absorção cadastrados. Marque somente os itens que são escudos, pois eles só contribuem quando usados numa defesa ativa.</p><div class="dhp-armor-coverage-options"><label><input type="checkbox" data-dhp-coverage-value="shield" ${isShield ? "checked" : ""}><span>Este equipamento é um escudo</span></label></div>`;
  const insertAfter = dexInput?.closest(".form-group, .form-group-stacked, fieldset") ?? root.querySelector('[name="system.reference"]')?.closest(".form-group, .form-group-stacked, fieldset") ?? root.querySelector("form");
  (insertAfter ?? root).insertAdjacentElement(insertAfter ? "afterend" : "afterbegin", coveragePanel);
  coveragePanel.addEventListener("change", async (event) => {
    const changed = event.target.closest('input[data-dhp-coverage-value="shield"]');
    if (!changed) return;
    const selected = changed.checked ? ["shield"] : ["full"];
    try { await item.update({ [`flags.${MODULE_ID}.armorCoverage`]: selected }); }
    catch (error) { ui.notifications.error("Não foi possível salvar a configuração do equipamento."); console.error(error); }
  });
}

function armorDexterityPenalty(actor) {
  // WoD20 stores this modifier as a signed negative value. The Dravent defense
  // rule converts its absolute total to a difficulty penalty, not a dice penalty.
  return equippedArmor(actor).reduce((sum, item) => {
    const system = item.system ?? {};
    const flagPenalty = item.getFlag?.(MODULE_ID, "mobilityPenalty") ?? item.flags?.[MODULE_ID]?.mobilityPenalty;
    if (flagPenalty !== undefined && flagPenalty !== null) return sum - Math.max(0, safeNumber(flagPenalty));
    const raw = system.dexpenalty ?? system.dexterityPenalty ?? system.dexPenalty ?? system.dexterity?.penalty ?? system.penalty?.dexterity;
    return sum + Math.min(0, safeNumber(raw));
  }, 0);
}

function armorDiceForRegion(actor, typeKey, region = "general") {
  const all = equippedArmor(actor);
  const isShieldItem = (item) => armorCoverage(item).includes("shield");
  const candidates = region === "shield"
    ? all.filter(isShieldItem)
    : all.filter((item) => !isShieldItem(item));
  // Combat is generalized, without targeting body regions. Worn protective items
  // contribute their configured soak dice; mobility penalties are accumulated separately
  // and make active defenses harder. Shields contribute only when actively selected.
  return candidates.reduce((sum, item) => sum + Math.max(0, safeNumber(item.system?.soak?.[typeKey])), 0);
}

function soakPoolFor(actor, damageType, targetRegion = "general", includeShield = false) {
  const typeKey = damageTypeSystemKey(damageType);
  const derivedEntry = actor?.system?.soak?.[typeKey];
  const derived = Number(derivedEntry?.total ?? derivedEntry?.value ?? derivedEntry?.system?.total ?? derivedEntry);
  const allArmorDice = equippedArmor(actor).reduce((sum, item) => sum + Math.max(0, safeNumber(item.system?.soak?.[typeKey])), 0);
  const applicableArmorDice = armorDiceForRegion(actor, typeKey, "general");
  const shieldDice = includeShield ? armorDiceForRegion(actor, typeKey, "shield") : 0;
  // Remove the system's aggregate armor component and reconstruct the generalized
  // Dravent pool from all equipped worn protection. A shield adds dice only when actively selected.
  if (derivedEntry !== undefined && Number.isFinite(derived)) {
    const baseSystemSoak = Math.max(0, Math.floor(derived - allArmorDice));
    return baseSystemSoak + applicableArmorDice + shieldDice;
  }

  const settings = actor?.system?.settings?.soak?.[typeKey];
  const stamina = settings?.isrollable ? findTraitValue(actor, "attribute", "stamina") : 0;
  const bonus = safeNumber(settings?.bonus);
  return Math.max(0, Math.floor(applicableArmorDice + shieldDice + stamina + bonus));
}

function findAreteValue(actor) {
  // Legacy Mage actors store Arete below system.mage; the configurable PC actor may
  // expose advantages directly. Prefer a positive roll pool, then permanent dots.
  const direct = actor?.system?.mage?.advantages?.arete ?? actor?.system?.advantages?.arete;
  const directValues = [direct?.roll, direct?.permanent, direct?.system?.roll, direct?.system?.permanent,
    direct?.value, direct?.system?.value].map((value) => safeNumber(value, -1));
  const directPositive = directValues.find((value) => value > 0);
  if (directPositive !== undefined) return clamp(directPositive, 0, 10);
  const directAvailable = directValues.find((value) => value >= 0);
  if (directAvailable !== undefined) return clamp(directAvailable, 0, 10);

  for (const item of actor?.items ?? []) {
    const terms = [item.name, item.system?.id, item.system?.slug, item.system?.label].map(normalized);
    if (!terms.some((term) => term === "arete" || term.includes("arete"))) continue;
    const values = [item.system?.roll, item.system?.permanent, item.system?.value,
      item.system?.rating].map((value) => safeNumber(value, -1));
    const positive = values.find((entry) => entry > 0);
    const value = positive ?? values.find((entry) => entry >= 0);
    if (value !== undefined) return clamp(value, 0, 10);
  }
  return 0;
}

function defensePoolFor(actor, mode, attackCategory = "") {
  const signedArmorPenalty = armorDexterityPenalty(actor);
  const nativeDexterity = findTraitValue(actor, "attribute", "dexterity");
  const dexEntry = actor?.system?.attributes?.dexterity ?? actor?.system?.attributes?.destreza;
  const directValue = Number(dexEntry?.value ?? dexEntry?.system?.value);
  const baseDexterity = Number.isFinite(directValue) ? Math.max(0, directValue) : Math.max(0, nativeDexterity);
  const modeConfig = ({
    // Regra Dravent: esquiva sempre usa Destreza + Esportes/Atletismo,
    // tanto contra ataques à distância quanto contra ataques corpo a corpo.
    dodge: { label: "Esquiva", ability: "athletics" },
    parry: { label: "Aparar", ability: "melee" },
    shield: { label: "Bloqueio com escudo", ability: "melee" },
    brawl: { label: "Defesa corporal", ability: "brawl" }
  })[mode] ?? { label: "Esquiva", ability: "athletics" };
  const skill = findTraitValue(actor, "ability", modeConfig.ability);
  const ignoresPain = actorIgnoresPain(actor);
  const woundPenalty = ignoresPain ? 0 : actorHealthPenalty(actor);
  const stunned = Boolean(actor?.system?.conditions?.isstunned || actor?.system?.conditions?.stunned ||
    (actor?.effects ?? []).some((effect) => !effect.disabled && ["stunned", "atordoado"].includes(normalized(effect.name))));
  const pool = stunned ? 0 : Math.max(0, baseDexterity + skill + woundPenalty);
  const mobilityDifficultyPenalty = Math.max(0, -signedArmorPenalty);
  return {
    mode, label: modeConfig.label, ability: modeConfig.ability,
    dexterity: baseDexterity, baseDexterity, skill, woundPenalty,
    armorDexterityPenalty: signedArmorPenalty, mobilityDifficultyPenalty,
    ignoresPain, stunned, pool
  };
}

function statusBadgesHtml(defense, armor) {
  const badges = [];
  if (defense.stunned) badges.push("Atordoado");
  if (defense.ignoresPain) badges.push("Ignora dor");
  if (defense.woundPenalty) badges.push(`Vitalidade ${defense.woundPenalty}`);
  if (defense.mobilityDifficultyPenalty) badges.push(`Mobilidade +${defense.mobilityDifficultyPenalty} na dificuldade`);
  if (armor.length) badges.push(`Armadura: ${armor.map((item) => item.name).join(", ")}`);
  return badges.length ? `<div class="dhp-status-badges">${badges.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>` : "";
}

async function selectDefenderActor(combat) {
  const attackerId = combat?.attackerId;
  const tokenActors = [...(canvas.tokens?.controlled ?? [])].map((token) => token.actor).filter((actor) => actor && actor.id !== attackerId && (game.user.isGM || actor.testUserPermission?.(game.user, "OWNER") || actor.isOwner));
  if (tokenActors.length === 1) return tokenActors[0];
  if (game.user.character && game.user.character.id !== attackerId && (game.user.isGM || game.user.character.isOwner || game.user.character.testUserPermission?.(game.user, "OWNER"))) return game.user.character;
  const candidates = [...(game.actors ?? [])].filter((actor) => actor.id !== attackerId && isWoDActor(actor) && (game.user.isGM || actor.testUserPermission?.(game.user, "OWNER") || actor.isOwner));
  if (tokenActors.length > 1) return chooseActorDialog(tokenActors, "Escolha o personagem que está se defendendo.");
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) {
    ui.notifications.warn("Não encontrei uma ficha que você controle para realizar esta defesa. Selecione seu token ou associe um personagem ao usuário.");
    return null;
  }
  return chooseActorDialog(candidates, "O ataque não tem alvo único. Escolha qual personagem está se defendendo.");
}

function chooseActorDialog(actors, prompt) {
  const unique = [...new Map(actors.map((actor) => [actor.id, actor])).values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  if (unique.length === 1) return Promise.resolve(unique[0]);
  const options = unique.map((actor) => `<option value="${escapeHtml(actor.uuid)}">${escapeHtml(actor.name)}</option>`).join("");
  return new Promise((resolve) => {
    let dialog;
    dialog = new Dialog({
      title: "Escolher personagem defensor",
      content: `<div class="dhp-defender-picker"><p>${escapeHtml(prompt)}</p><label>Personagem<select name="dhpDefenderActor">${options}</select></label></div>`,
      buttons: {
        confirm: { label: "Continuar", callback: (html) => {
          const root = asElement(html) ?? dialog.element;
          const uuid = root?.querySelector('[name="dhpDefenderActor"]')?.value;
          resolve(unique.find((actor) => actor.uuid === uuid) ?? null);
        } },
        cancel: { label: "Cancelar", callback: () => resolve(null) }
      },
      default: "confirm",
      close: () => resolve(null)
    }, { width: 400, height: "auto" });
    dialog.render(true);
  });
}

async function openMagicExecutionMenu(actor) {
  if (!actor?.sheet) {
    ui.notifications.warn("Não consegui abrir a ficha do alvo. Abra a ficha e entre na área de Mágika para executar o efeito defensivo.");
    return false;
  }
  try {
    await actor.sheet.render(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    let root = asElement(actor.sheet.element, actor.sheet);
    if (!root) return false;

    // Open the native power/magic area first. The PC actor sheet may expose it as a tab,
    // an icon-only control, or a legacy tab link.
    const tabSelectors = [
      '.tabs [data-tab="magic"]', '.sheet-navigation [data-tab="magic"]', 'button[data-tab="magic"]', 'a[data-tab="magic"]',
      '.tabs [data-tab="magick"]', '.sheet-navigation [data-tab="magick"]', 'button[data-tab="magick"]', 'a[data-tab="magick"]',
      '.tabs [data-tab="power"]', '.sheet-navigation [data-tab="power"]', 'button[data-tab="power"]', 'a[data-tab="power"]',
      '[data-tab="esferas"]', '[data-tab="sphere"]', '[data-tab="routines"]', '[data-tab="rote"]'
    ];
    let tab = null;
    for (const selector of tabSelectors) {
      const candidate = [...root.querySelectorAll(selector)].find((element) => element.matches("[role=tab],button,a"));
      if (candidate) { tab = candidate; break; }
    }
    if (!tab) {
      tab = [...root.querySelectorAll('button, a, [role="tab"], [data-action]')]
        .find((element) => /m[aá]gika|magick|poderes|esferas|rotinas/i.test(element.textContent ?? ""));
    }
    tab?.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    root = asElement(actor.sheet.element, actor.sheet) ?? root;

    // Click the exact native launcher where available. This opens WoD20's own "Conjurando
    // magia" dialog with its normal sphere/Quintessence/difficulty options instead of a Dravent
    // imitation. Exclude tab navigation and unrelated sphere/routine roll controls.
    const interactive = [...root.querySelectorAll('button, a, [role="button"], [data-action], .rollable, .vrollable')];
    const scoreLauncher = (element) => {
      if (element.matches('[role="tab"], [data-tab]')) return -100;
      if (element.disabled || element.getAttribute("aria-disabled") === "true") return -100;
      const text = normalized([element.textContent, element.getAttribute("title"), element.getAttribute("aria-label"),
        element.dataset?.action, element.className].filter(Boolean).join(" "));
      if (/conjur.*(magia|magika|magick|magic)|conjurando|conjuringmagic|conjuremagic|castmagic|rollmagic|magiccasting|magickcasting|openmagicdialog|conjure/.test(text)) return 10;
      if (/^(magick|magic|magia|magika|conjurar|conjuracaodemagika|conjuracaomagica)$/.test(text.trim())) return 5;
      return -1;
    };
    const launchers = interactive.map((element) => ({ element, score: scoreLauncher(element) }))
      .filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
    if (launchers.length) {
      launchers[0].element.click();
      ui.notifications.info("A janela nativa de conjuração do WoD20 foi aberta. Escolha o efeito defensivo e faça a rolagem normalmente.");
      return true;
    }

    // Compatibility fallback: try native sheet methods only when their name clearly denotes
    // opening/casting magic and they accept no required arguments.
    const seen = new Set();
    let proto = actor.sheet;
    while (proto && proto !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (seen.has(name)) continue;
        seen.add(name);
        if (!/(open|show|start|conjur|cast|roll).*(magic|magick|conjur)|(magic|magick).*(dialog|conjur|cast)/i.test(name)) continue;
        const method = actor.sheet[name];
        if (typeof method !== "function" || method.length > 0) continue;
        try {
          const result = method.call(actor.sheet);
          if (result && typeof result.then === "function") await result;
          ui.notifications.info("A ação nativa de Mágika do WoD20 foi chamada. Escolha o efeito defensivo e role normalmente.");
          return true;
        } catch (error) {
          console.debug(`${MODULE_ID} | Método de Mágika ${name} não pôde ser chamado automaticamente.`, error);
        }
      }
      proto = Object.getPrototypeOf(proto);
    }

    ui.notifications.warn("Abri a área de Mágika da ficha, mas não encontrei o botão nativo para abrir 'Conjurando magia'. Clique nesse botão da própria ficha; a rolagem será vinculada à defesa assim que aparecer no chat.");
    return false;
  } catch (error) {
    console.error(`${MODULE_ID} | Não foi possível abrir a conjuração nativa.`, error);
    ui.notifications.warn("Não consegui abrir automaticamente a conjuração. Abra a ficha do alvo e inicie Mágika normalmente; a rolagem poderá ser vinculada à defesa.");
    return false;
  }
}

async function getAttackAndDefender(sourceControl, selectedNativeRoll = null) {
  const sourceMessageId = selectedNativeRoll?.attackMessageId ?? sourceControl.closest("[data-message-id]")?.dataset?.messageId;
  const sourceMessage = sourceMessageId ? game.messages?.get(sourceMessageId) : null;
  const combat = sourceMessage?.getFlag(MODULE_ID, "combat");
  if (!combat) {
    ui.notifications.warn("Esta rolagem não está vinculada a um ataque válido.");
    return null;
  }

  let targetDocument = null;
  let targetActor = null;
  // O token alvo é a fonte principal. UUID/ID do ator servem como fallback para
  // tokens vinculados, tokens sintéticos e fichas do tipo PC.
  if (combat.targetUuid) {
    try { targetDocument = await fromUuid(combat.targetUuid); } catch (_) { targetDocument = null; }
  }
  if (targetDocument) targetActor = targetDocument.actor ?? targetDocument.baseActor ?? null;
  if (!targetActor && combat.targetActorUuid) {
    try { targetActor = await fromUuid(combat.targetActorUuid); } catch (_) { targetActor = null; }
  }
  if (!targetActor && combat.targetActorId) targetActor = game.actors?.get(String(combat.targetActorId)) ?? null;
  if (!targetActor && selectedNativeRoll?.actorUuid && !combat.targetUuid) {
    try {
      const actorDoc = await fromUuid(selectedNativeRoll.actorUuid);
      targetActor = actorDoc?.actor ?? actorDoc;
    } catch (_) { targetActor = null; }
  }
  if (!targetActor) targetActor = await selectDefenderActor(combat);
  if (!targetActor?.setFlag) return null;

  const canControl = userIsTargetOwnerFromFlags(game.user, combat) || await canUserControlTarget(
    targetDocument?.uuid ?? combat.targetUuid,
    targetActor.uuid ?? combat.targetActorUuid,
    combat.targetActorId ?? targetActor.id,
    targetActor,
    combat.targetOwnerIds ?? []
  );
  if (!game.user.isGM && !canControl) {
    ui.notifications.warn("Somente o jogador que controla o alvo ou o Narrador pode rolar esta defesa.");
    return null;
  }
  return { sourceMessage, combat, targetActor, targetDocument, sourceMessageId };
}

async function beginMagicDefense(sourceControl) {
  const info = await getAttackAndDefender(sourceControl);
  if (!info) return;
  const { sourceMessage, combat, targetActor } = info;
  const previous = pendingCombatDefenses.get(game.user.id);
  if (previous && previous.attackMessageId !== sourceMessage.id) {
    ui.notifications.warn("Já existe uma defesa aguardando uma rolagem. Conclua-a ou selecione outra defesa primeiro.");
    return;
  }
  pendingCombatDefenses.set(game.user.id, {
    attackMessageId: sourceMessage.id, targetUuid: combat.targetUuid ?? "", actorUuid: targetActor.uuid,
    actorId: targetActor.id, mode: "magic", createdAt: Date.now(), expiresAt: Date.now() + 5 * 60 * 1000
  });
  await openMagicExecutionMenu(targetActor);
}

async function beginRoteDefense(sourceControl) {
  const info = await getAttackAndDefender(sourceControl);
  if (!info) return;
  const { sourceMessage, combat, targetActor } = info;
  const rotes = listActorRotes(targetActor);
  if (!rotes.length) {
    ui.notifications.warn(`${targetActor.name} não tem rotinas (Rotes) cadastradas na ficha.`);
    return;
  }
  const options = rotes.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  let dialog;
  dialog = new Dialog({
    title: "Escolher rotina defensiva",
    content: `<div class="dhp-defender-picker"><p>Selecione a rotina que deseja usar para se defender deste ataque. A rolagem será vinculada ao combate atual.</p><label>Rotina<select name="dhpDefenseRote">${options}</select></label></div>`,
    buttons: {
      confirm: { label: "Executar rotina", callback: async (html) => {
        const root = asElement(html) ?? dialog.element;
        const itemId = root?.querySelector('[name="dhpDefenseRote"]')?.value;
        const item = rotes.find((rote) => rote.id === itemId);
        if (!item) return ui.notifications.warn("Selecione uma rotina válida.");
        const previous = pendingCombatDefenses.get(game.user.id);
        if (previous && previous.attackMessageId !== sourceMessage.id) {
          ui.notifications.warn("Já existe uma defesa aguardando uma rolagem.");
          return;
        }
        pendingCombatDefenses.set(game.user.id, {
          attackMessageId: sourceMessage.id, targetUuid: combat.targetUuid ?? "", actorUuid: targetActor.uuid,
          actorId: targetActor.id, mode: "rote", roteItemId: item.id, createdAt: Date.now(), expiresAt: Date.now() + 5 * 60 * 1000
        });
        await executeRoteMacro(targetActor, { roteItemId: item.id });
      } },
      cancel: { label: "Cancelar" }
    }, default: "confirm"
  }, { width: 460, height: "auto" });
  dialog.render(true);
}

function cancelPendingMagicDefense(sourceControl) {
  const attackElement = sourceControl.closest("[data-message-id]");
  const sourceMessageId = attackElement?.dataset?.messageId;
  const pending = pendingCombatDefenses.get(game.user.id);
  if (!pending || pending.attackMessageId !== sourceMessageId) return;
  pendingCombatDefenses.delete(game.user.id);
}

function attachMagicDefenseAction(message, root, nativeCards) {
  const pending = pendingCombatDefenses.get(game.user?.id);
  if (!pending) return;
  if (Date.now() > pending.expiresAt) {
    pendingCombatDefenses.delete(game.user.id);
    return;
  }
  if (Number.isFinite(Number(message?.timestamp)) && Number(message.timestamp) < pending.createdAt) return;
  const actorId = message?.speaker?.actor ?? message?.speaker?.actorId;
  if (!actorId || actorId !== pending.actorId) return;
  for (const card of nativeCards) {
    if (card.dataset.dhpMagicDefenseActionAdded === "true" || root.querySelector("[data-dhp-use-native-defense]")) continue;
    const cardText = normalized(card.textContent ?? "");
    if (pending.mode === "magic" && !/(arete|iluminacao|esfera|coincidente|vulgar|magika|magica|conjurando)/.test(cardText)) continue;
    if (pending.mode === "rote" && !/(sucessos|success|rote|rotina|magika|magica)/.test(cardText)) continue;
    const results = (() => {
      try { return JSON.parse(card.dataset.dhpRollValues ?? "[]").map((value) => clamp(value, 1, 10)); }
      catch (_) { return []; }
    })();
    if (card.dataset.dhpSuccesses === undefined || !results.length) continue;
    const difficulty = clamp(card.dataset.dhpDifficulty ?? 6, 2, 10);
    // Never use the WoD20 success count as damage reduction: a defense reduces damage by
    // the absolute face values of valid rolled dice. Auto-successes count as successes but
    // have no die face, so they do not create a numeric reduction.
    const rollResolution = rollSuccesses(results, difficulty);
    const autoBonus = Math.max(0, safeNumber(card.dataset.dhpAutoBonus));
    const successes = rollResolution.successes + autoBonus;
    const contribution = rollResolution.contribution;
    const action = document.createElement("button");
    action.type = "button";
    action.className = "dhp-use-magic-defense";
    action.dataset.dhpUseNativeDefense = "true";
    action.dataset.dhpBound = "true";
    action.textContent = pending.mode === "rote" ? `Usar rolagem da rotina (${successes} sucessos) como defesa` : `Usar rolagem mágica (${successes} sucessos) como defesa`;
    const header = card.querySelector("header, h3, h4, .tray-title");
    action.title = header?.textContent?.trim() || (pending.mode === "rote" ? "Rotina defensiva" : "Mágika defensiva");
    action.addEventListener("click", async (event) => {
      event.preventDefault(); event.stopPropagation();
      action.disabled = true;
      await resolveDefense(action, {
        attackMessageId: pending.attackMessageId, actorId: pending.actorId, actorUuid: pending.actorUuid,
        mode: pending.mode, successes, results, resolution: rollResolution, contribution,
        difficulty,
        rollMessageId: message.id, rollTitle: action.title || "Rolagem defensiva", autoBonus
      });
    });
    (root.querySelector(".message-content") ?? root).append(action);
    card.dataset.dhpMagicDefenseActionAdded = "true";
  }
}

async function resolveDefense(button, nativeRoll = null) {
  if (!nativeRoll) {
    const attackElement = button.closest("[data-message-id]");
    const sourceId = attackElement?.dataset?.messageId;
    const source = sourceId ? game.messages?.get(sourceId) : null;
    const mode = source?.getFlag(MODULE_ID, "combat") ? (attackElement?.querySelector("[data-dhp-defense-mode]")?.value ?? "dodge") : "dodge";
    if (mode === "magic") return beginMagicDefense(button);
    if (mode === "rote") return beginRoteDefense(button);
  }
  const info = await getAttackAndDefender(button, nativeRoll);
  if (!info) return;
  const { sourceMessage, combat, targetActor } = info;
  if (nativeRoll) {
    const pending = pendingCombatDefenses.get(game.user?.id);
    if (!pending || pending.attackMessageId !== sourceMessage.id || pending.actorId !== targetActor.id || Date.now() > pending.expiresAt) {
      return ui.notifications.warn("Esta rolagem não está mais vinculada a uma defesa pendente.");
    }
  }

  const allPriorDefenseMessages = [...(game.messages ?? [])].filter((message) => message.getFlag(MODULE_ID, "defendedMessageId") === sourceMessage.id);
  const repeated = combat.targetUuid
    ? allPriorDefenseMessages.length > 0
    : allPriorDefenseMessages.some((message) => message.getFlag(MODULE_ID, "defenderActorId") === targetActor.id);
  if (repeated) return ui.notifications.info("Este personagem já resolveu a defesa contra este ataque.");

  const attackElement = document.querySelector(`[data-message-id="${dhpCssEscape(sourceMessage.id)}"]`);
  const selectedMode = nativeRoll?.mode ?? attackElement?.querySelector("[data-dhp-defense-mode]")?.value ?? "dodge";
  const mode = nativeRoll?.mode ?? selectedMode;
  const baseDifficulty = clamp(attackElement?.querySelector("[data-dhp-defense-difficulty]")?.value ?? 6, 2, 10);
  const usesShield = mode === "shield";
  if (usesShield && !equippedArmor(targetActor).some((item) => armorCoverage(item).includes("shield"))) return ui.notifications.warn("Para usar Bloqueio com escudo, equipe primeiro um escudo.");

  let defense = nativeRoll ? {
    mode, label: mode === "rote" ? "Rotina defensiva" : "Defesa mágica", ability: mode,
    dexterity: 0, baseDexterity: 0, skill: safeNumber(nativeRoll.successes), woundPenalty: 0,
    armorDexterityPenalty: armorDexterityPenalty(targetActor), mobilityDifficultyPenalty: 0,
    ignoresPain: actorIgnoresPain(targetActor), stunned: false, pool: nativeRoll.results?.length ?? 0
  } : defensePoolFor(targetActor, mode, combat.weaponCategory);
  const difficulty = nativeRoll ? clamp(nativeRoll.difficulty ?? 6, 2, 10) : clamp(baseDifficulty + defense.mobilityDifficultyPenalty, 2, 10);

  let defenseRoll = null;
  let defenseResults = [];
  let defenseResolution = { ones: 0, onesIndexes: [], cancelledIndexes: [], cancelledResults: [], remainingResults: [], remainingIndexes: [], successfulResults: [], successfulIndexes: [], successes: 0, contribution: 0 };
  if (nativeRoll) {
    defenseResults = (nativeRoll.results ?? []).map((value) => clamp(value, 1, 10));
    defenseResolution = rollSuccesses(defenseResults, difficulty);
    // Automatic successes from the native roll add to the count only. They do not represent
    // rolled d10 faces and therefore cannot reduce the absolute damage value.
    defenseResolution.successes += Math.max(0, safeNumber(nativeRoll.autoBonus));
  } else if (defense.pool > 0) {
    defenseRoll = await evaluateRoll(`${defense.pool}d10`);
    defenseResults = diceResults(defenseRoll);
    defenseResolution = { ...rollSuccesses(defenseResults, difficulty), rawResults: defenseResults };
  }

  const potentialDamage = Math.max(0, safeNumber(combat.potentialDamage));
  // Defense reduces damage by the absolute values of successful dice. Native magic/Rote
  // rolls use the sum of their valid die values, not just their success count.
  const rawDefenseReduction = Math.max(0, safeNumber(defenseResolution.contribution));
  const defenseReduction = Math.min(potentialDamage, rawDefenseReduction);
  const remainingAfterActiveDefense = Math.max(0, potentialDamage - defenseReduction);
  const systemDamageType = damageTypeSystemKey(combat.damageType);
  const soakPool = remainingAfterActiveDefense > 0 ? soakPoolFor(targetActor, combat.damageType, "general", usesShield) : 0;
  let soakRoll = null;
  let soakResults = [];
  let soakResolution = { ones: 0, onesIndexes: [], cancelledIndexes: [], cancelledResults: [], remainingResults: [], remainingIndexes: [], successfulResults: [], successfulIndexes: [], successes: 0, contribution: 0 };
  if (soakPool > 0) {
    soakRoll = await evaluateRoll(`${soakPool}d10`);
    soakResults = diceResults(soakRoll);
    soakResolution = { ...rollSuccesses(soakResults, 6), rawResults: soakResults };
  }

  const soakReduction = Math.min(remainingAfterActiveDefense, safeNumber(soakResolution.contribution));
  const totalReduction = Math.min(potentialDamage, defenseReduction + soakReduction);
  const effectiveDamage = Math.max(0, Math.round(potentialDamage - totalReduction));
  const vitalityBefore = healthCurrent(targetActor);
  const maxVitality = healthMax(targetActor);
  const vitalityAfter = Math.max(0, vitalityBefore - effectiveDamage);
  const vitalityBeforeLabel = vitalityDisplay(targetActor, vitalityBefore);
  const vitalityAfterLabel = vitalityDisplay(targetActor, vitalityAfter);
  const armor = equippedArmor(targetActor);
  const flags = statusBadgesHtml(defense, armor);
  const typeLabel = damageTypeLabel(combat.damageType);
  const defenseAbility = nativeRoll
    ? `${nativeRoll.mode === "rote" ? "Rotina" : "Rolagem nativa de Mágika"}: ${escapeHtml(nativeRoll.rollTitle || "efeito defensivo")}`
    : `Destreza ${defense.dexterity} + ${weaponAbilityLabel(defense.ability)} ${defense.skill}`;
  const activeReductionLabel = nativeRoll ? (nativeRoll.mode === "rote" ? "Redução pela rotina defensiva" : "Redução pela defesa mágica") : "Redução pela defesa ativa";
  const defenseDiceMeta = nativeRoll ? `${nativeRoll.mode === "rote" ? "Rotina defensiva" : "Rolagem original de Mágika"} · ${defenseResolution.successes} sucessos` : `${defense.pool}d10 · dif. ${baseDifficulty}${defense.mobilityDifficultyPenalty ? ` + ${defense.mobilityDifficultyPenalty}` : ""} = ${difficulty}`;
  const closeOriginalDefense = Boolean(combat.targetUuid || game.user?.isGM);
  const content = `<div class="dhp-chat-card dhp-defense-card">
    <header><strong>Defesa · ${escapeHtml(targetActor.name)} · ${escapeHtml(combat.weaponName)}</strong></header>
    <div class="dhp-defense-received"><span>Ataque recebido</span><strong>${potentialDamage} ${damageUnit(targetActor) === "PV" ? "PV" : "%"}</strong><em>${escapeHtml(typeLabel)}</em></div>
    <section class="dhp-combat-roll-section">
      <div class="dhp-section-heading"><span>${nativeRoll ? (nativeRoll.mode === "rote" ? "Rotina defensiva" : "Defesa mágica") : `Defesa ativa · ${escapeHtml(defense.label)}`}</span><span class="dhp-roll-meta">${defenseDiceMeta}</span></div>
      <div class="dhp-roll-meta">${defenseAbility}${!nativeRoll && defense.woundPenalty ? ` · Vitalidade ${defense.woundPenalty}` : ""}</div>
      <div class="dhp-success-count">Sucessos <strong>${defenseResolution.successes ?? 0}</strong></div>
      ${renderDiceStrip(defenseResults, defenseResolution, difficulty)}
      ${cancellationNote(defenseResolution)}
      <div class="dhp-contribution">${activeReductionLabel} <strong>${defenseReduction} ${damageUnit(targetActor) === "PV" ? "PV" : "%"}</strong>${nativeRoll ? `<small>Redução pela soma dos valores dos dados válidos, limitada ao dano recebido.</small>` : ""}</div>
    </section>
    <section class="dhp-combat-roll-section dhp-soak-section">
      <div class="dhp-section-heading"><span>Absorção e armadura</span><span class="dhp-roll-meta">${soakPool}d10 · dif. 6${usesShield ? " + escudo ativo" : ""}</span></div>
      ${armor.length ? `<div class="dhp-armor-label">${armor.map((item) => escapeHtml(item.name)).join(" · ")}</div>` : ""}
      ${soakPool > 0 ? `<div class="dhp-success-count">Sucessos <strong>${soakResolution.successes ?? 0}</strong></div>${renderDiceStrip(soakResults, soakResolution, 6)}${cancellationNote(soakResolution)}` : `<div class="dhp-no-roll">${remainingAfterActiveDefense <= 0 ? "A defesa já neutralizou o dano." : "Sem dados de absorção."}</div>`}
      <div class="dhp-contribution">Redução por absorção <strong>${soakReduction} ${damageUnit(targetActor) === "PV" ? "PV" : "%"}</strong></div>
    </section>
    ${flags}
    <div class="dhp-defense-summary"><div><span>Redução total</span><strong>${totalReduction} ${damageUnit(targetActor) === "PV" ? "PV" : "%"}</strong></div><div><span>Dano efetivo</span><strong>${effectiveDamage} ${damageUnit(targetActor) === "PV" ? "PV" : "%"}</strong></div></div>
    <div class="dhp-vitality-result">Vida ${escapeHtml(vitalityBeforeLabel)} <span>→</span> <strong>${escapeHtml(vitalityAfterLabel)}</strong></div>
    ${effectiveDamage > 0 ? `<button type="button" class="dhp-chat-apply" data-dhp-chat-apply data-target-uuid="${escapeHtml(targetActor.uuid)}" data-damage="${effectiveDamage}">Aplicar ${effectiveDamage} ${damageUnit(targetActor) === "PV" ? "PV" : "%"}</button>` : `<div class="dhp-no-damage">Nenhum dano restante.</div>`}
  </div>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: targetActor }), content,
    rolls: [ ...(defenseRoll ? [defenseRoll] : []), ...(soakRoll ? [soakRoll] : []) ],
    flags: { [MODULE_ID]: {
      defendedMessageId: sourceMessage.id, defenderActorId: targetActor.id,
      closeOriginalDefense, damage: effectiveDamage, targetUuid: targetActor.uuid, applied: false,
      combat: { potentialDamage, defenseReduction, soakReduction, totalReduction, effectiveDamage, vitalityBefore, vitalityAfter, maxVitality, damageType: systemDamageType, mobilityDifficultyPenalty: defense.mobilityDifficultyPenalty, defenseMode: mode, magicSuccesses: nativeRoll ? safeNumber(nativeRoll.successes) : null, magicRollMessageId: nativeRoll?.rollMessageId ?? null }
    } }
  });
  if (nativeRoll) pendingCombatDefenses.delete(game.user.id);
  const localAttackButton = attackElement?.querySelector("[data-dhp-chat-defend]");
  if (closeOriginalDefense && localAttackButton) { localAttackButton.disabled = true; localAttackButton.textContent = "Defesa rolada"; }
}

async function applyChatDamage(button) {
  if (button.dataset.applied === "true") return;
  const messageElement = button.closest("[data-message-id]");
  const message = messageElement?.dataset?.messageId ? game.messages?.get(messageElement.dataset.messageId) : null;
  if (message?.getFlag(MODULE_ID, "applied") === true) {
    button.dataset.applied = "true";
    button.disabled = true;
    return ui.notifications.info("Este dano já foi aplicado.");
  }
  const targetUuid = button.dataset.targetUuid;
  const damage = clampInt(button.dataset.damage, 0, 1_000_000_000);
  if (!targetUuid || damage <= 0) return;
  const targetDoc = await fromUuid(targetUuid);
  const targetActor = targetDoc?.actor ?? targetDoc;
  if (!targetActor?.setFlag) return ui.notifications.error("Não foi possível encontrar o alvo para aplicar o dano.");
  if (!game.user.isGM && !(await canUserControlTarget(targetActor.uuid))) return ui.notifications.warn("Somente o alvo ou o Narrador pode aplicar este dano.");
  await ensureHealthFlags(targetActor);
  if (button.dataset.applied === "true" || message?.getFlag(MODULE_ID, "applied") === true) return;
  const next = Math.max(0, healthCurrent(targetActor) - damage);
  await setActorHealth(targetActor, next);
  button.dataset.applied = "true";
  button.disabled = true;
  button.textContent = `Dano aplicado · ${vitalityDisplay(targetActor, next)}`;
  if (message && (game.user.isGM || message.isAuthor)) {
    try { await message.setFlag(MODULE_ID, "applied", true); } catch (error) { console.warn(`${MODULE_ID} | Could not persist damage-card state`, error); }
  }
}

function bindArsenalPanel(panel, actor, sheetRoot = null) {
  panel.addEventListener("change", (event) => {
    const modeSelect = event.target.closest("[data-dhp-fire-mode]");
    if (!modeSelect) return;
    const row = modeSelect.closest("[data-dhp-weapon-id]");
    if (!row) return;
    const specialMode = modeSelect.value !== "normal";
    const shotField = row.querySelector(".dhp-shot-mode-field");
    const areaField = row.querySelector(".dhp-suppress-area-field");
    if (shotField) shotField.hidden = specialMode;
    if (areaField) areaField.hidden = modeSelect.value !== "suppressive";
  });
  panel.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-dhp-arsenal-action], button[data-dhp-weapon-action], button[data-dhp-custom-cancel], button[data-dhp-armor-action]");
    if (!button) return;
    event.preventDefault();

    if (button.hasAttribute("data-dhp-custom-cancel")) {
      const form = panel.querySelector("[data-dhp-custom-form]");
      if (form) form.hidden = true;
      form?.reset();
      return;
    }

    if (button.dataset.dhpArmorAction) {
      if (!actor.isOwner) return ui.notifications.warn("Você não tem permissão para editar os equipamentos deste personagem.");
      const armorId = panel.querySelector("[data-dhp-armor-catalog]")?.value;
      const armor = ARMOR_CATALOG.find((entry) => entry.id === armorId);
      if (!armor) return ui.notifications.warn("Selecione um equipamento válido no catálogo.");
      const existing = actor.items.find((item) => item.type === "Armor" && item.getFlag?.(MODULE_ID, "armorCatalogId") === armor.id && itemIsEquipped(item));
      if (existing) return ui.notifications.info(`${armor.name} já está equipado nesta ficha.`);
      await actor.createEmbeddedDocuments("Item", [armorItemData(armor)]);
      ui.notifications.info(`${armor.name} adicionado e equipado. Absorção Dravent: ${armor.soak.bashing}/${armor.soak.lethal}/${armor.soak.aggravated} d10.`);
      refreshArsenals(actor);
      return;
    }

    if (button.dataset.dhpArsenalAction) {
      const action = button.dataset.dhpArsenalAction;
      const weapons = getWeapons(actor);
      if (action === "add-catalog") {
        const chosen = panel.querySelector("[data-dhp-catalog]")?.value;
        const template = WEAPON_CATALOG.find((entry) => entry.id === chosen);
        if (!template) return;
        weapons.push(cloneCatalogWeapon(template));
        await setWeapons(actor, weapons);
        refreshArsenals(actor);
      } else if (action === "toggle-custom") {
        const form = panel.querySelector("[data-dhp-custom-form]");
        if (form) { form.hidden = !form.hidden; form.dataset.editWeaponId = ""; form.reset(); form.querySelector('[name="ammoCapacity"]').value = "0"; form.querySelector('[name="ammoCurrent"]').value = "0"; form.querySelector('[data-dhp-form-title]').textContent = "Adicionar arma personalizada"; }
      } else if (action === "import") {
        const existing = new Set(weapons.map((entry) => entry.sourceItemId).filter(Boolean));
        const systemWeapons = actor.items.filter((item) => ["Natural Weapon", "Melee Weapon", "Ranged Weapon"].includes(item.type) && !existing.has(item.id));
        if (!systemWeapons.length) return ui.notifications.info("Não há armas WoD20 novas para importar nesta ficha.");
        for (const item of systemWeapons) weapons.push(convertSystemWeapon(item));
        await setWeapons(actor, weapons);
        refreshArsenals(actor);
        ui.notifications.info(`${systemWeapons.length} arma(s) importada(s) para o Arsenal Dravent.`);
      }
      return;
    }

    const row = button.closest("[data-dhp-weapon-id]");
    const weaponId = row?.dataset.dhpWeaponId;
    if (!weaponId) return;
    const weapons = getWeapons(actor);
    const weapon = weapons.find((entry) => entry.id === weaponId);
    if (!weapon) return;

    if (button.dataset.dhpWeaponAction === "attack") {
      await fireWeapon(actor, weaponId, row);
    } else if (button.dataset.dhpWeaponAction === "reload") {
      weapon.ammoCurrent = safeNumber(weapon.ammoCapacity);
      await setWeapons(actor, weapons);
      refreshArsenals(actor);
    } else if (button.dataset.dhpWeaponAction === "delete") {
      await setWeapons(actor, weapons.filter((entry) => entry.id !== weaponId));
      refreshArsenals(actor);
    } else if (button.dataset.dhpWeaponAction === "edit") {
      const form = panel.querySelector("[data-dhp-custom-form]");
      if (!form) return;
      form.hidden = false;
      form.dataset.editWeaponId = weaponId;
      form.querySelector('[data-dhp-form-title]').textContent = `Editar: ${weapon.name}`;
      for (const [field, value] of Object.entries(weapon)) {
        const input = form.elements.namedItem(field);
        if (input && !["id", "sourceItemId"].includes(field)) {
          if (input.type === "checkbox") input.checked = value === true || value === "true" || value === 1;
          else if (field === "ammoCapacity" && value == null) input.value = "0";
          else if (field === "ammoCurrent" && value == null) input.value = "0";
          else if (typeof value !== "object") input.value = value ?? "";
        }
      }
    }
  });

  const form = panel.querySelector("[data-dhp-custom-form]");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!actor.isOwner) return;
    const values = new FormData(form);
    const ammoCapacityInput = safeNumber(values.get("ammoCapacity"));
    const currentWeapons = getWeapons(actor);
    const existingId = form.dataset.editWeaponId || "";
    const existing = currentWeapons.find((entry) => entry.id === existingId);
    const weapon = {
      ...(existing ?? {}),
      id: existing?.id ?? `custom-${foundry.utils.randomID(8)}`,
      name: String(values.get("name") ?? "Arma personalizada").trim(),
      category: String(values.get("category") ?? "firearm"),
      damageMode: String(values.get("damageMode") ?? "fixed"),
      damageDice: clamp(values.get("damageDice"), 0, 100),
      difficulty: clamp(values.get("difficulty"), 1, 10),
      damageType: String(values.get("damageType") ?? "L"),
      rangeM: clamp(values.get("rangeM"), 0, 50000),
      cadence: clamp(values.get("cadence"), 1, 20),
      ammoCapacity: ammoCapacityInput > 0 ? ammoCapacityInput : null,
      ammoCurrent: ammoCapacityInput > 0 ? clamp(values.get("ammoCurrent"), 0, ammoCapacityInput) : null,
      areaM: clamp(values.get("areaM"), 0, 1000),
      automatic: values.get("automatic") === "on",
      notes: String(values.get("notes") ?? "").trim()
    };
    if (!weapon.name) return ui.notifications.warn("Informe o nome da arma.");
    const index = currentWeapons.findIndex((entry) => entry.id === weapon.id);
    if (index >= 0) currentWeapons[index] = weapon;
    else currentWeapons.push(weapon);
    await setWeapons(actor, currentWeapons);
    form.hidden = true;
    form.reset();
    form.dataset.editWeaponId = "";
    refreshArsenals(actor);
  });
}

async function syncNativeWeaponToArsenal(item) {
  const actor = item?.parent;
  if (!actor || !isWoDActor(actor) || !["Natural Weapon", "Melee Weapon", "Ranged Weapon"].includes(item.type)) return;
  const weapons = getWeapons(actor);
  const converted = convertSystemWeapon(item);
  const index = weapons.findIndex((weapon) => weapon.sourceItemId === item.id);
  if (index >= 0) weapons[index] = { ...weapons[index], ...converted, id: weapons[index].id };
  else weapons.push(converted);
  await setWeapons(actor, weapons);
  refreshArsenals(actor);
}

async function removeNativeWeaponFromArsenal(item) {
  const actor = item?.parent;
  if (!actor || !isWoDActor(actor)) return;
  const weapons = getWeapons(actor);
  const filtered = weapons.filter((weapon) => weapon.sourceItemId !== item.id);
  if (filtered.length === weapons.length) return;
  await setWeapons(actor, filtered);
  refreshArsenals(actor);
}

function convertSystemWeapon(item) {
  const system = item.system ?? {};
  const natural = item.type === "Natural Weapon";
  const melee = item.type === "Melee Weapon";
  const attackAbility = normalized(system.attack?.ability ?? "");
  const category = natural ? "natural" : melee ? "melee" : "firearm";
  const rawDamage = safeNumber(system.damage?.bonus, 4);
  const damageAttr = normalized(system.damage?.attribute ?? "");
  const usesStrength = (melee || natural) && (!damageAttr || damageAttr.includes("strength") || damageAttr.includes("forca"));
  const damageDice = Math.max(0, Math.abs(rawDamage));
  const ammoCap = (melee || natural) ? null : safeNumber(system.clip?.max, 0);
  const ammoCur = (melee || natural) ? null : Math.min(ammoCap || 10000, safeNumber(system.clip?.value, ammoCap || 10000));
  const difficultyValue = safeNumber(system.difficulty, damageDice || 6);
  return {
    id: `import-${item.id}-${foundry.utils.randomID(4)}`,
    sourceItemId: item.id,
    name: item.name,
    category,
    attackAbility,
    damageMode: usesStrength ? "strength" : "fixed",
    damageDice,
    difficulty: difficultyValue > 0 ? difficultyValue : Math.max(1, damageDice),
    damageType: (normalized(system.damage?.type ?? "") === "bashing" || normalized(system.damage?.type ?? "") === "contusion") ? "B" : (normalized(system.damage?.type ?? "") === "aggravated" || normalized(system.damage?.type ?? "") === "agravado") ? "A" : "L",
    rangeM: (melee || natural) ? 0 : safeNumber(system.range, 20),
    cadence: (melee || natural) ? 1 : Math.max(1, safeNumber(system.rate, 1)),
    ammoCapacity: ammoCap > 0 ? ammoCap : null,
    ammoCurrent: ammoCap > 0 ? ammoCur : null,
    areaM: 0,
    automatic: !melee && !natural && ammoCap > 0 && Boolean(system.automatic || system.fullAuto || system.isautomatic || /automatic|auto-fire|automatico|automatica|metralhadora|submetralhadora|submachine|machinegun|machine gun|fuzil de assalto/i.test(String(item.name ?? ""))),
    notes: `Importada do WoD20${attackAbility ? ` · habilidade original: ${attackAbility}` : ""}. Revise dificuldade, dano e alcance após importar.`
  };
}

function refreshArsenals(actor) {
  document.querySelectorAll(`.dhp-arsenal[data-actor-id="${dhpCssEscape(actor.id)}"]`).forEach((panel) => {
    const sheetRoot = panel.closest(".application") ?? panel.getRootNode()?.host ?? document;
    const replacement = makeArsenalPanel(actor, sheetRoot);
    panel.replaceWith(replacement);
    applySheetTheme(replacement, sheetRoot);
  });
}

function enforceDoubleTenSuccesses() {
  const config = globalThis.CONFIG?.worldofdarkness;
  if (!config) return;
  // WoD20's DiceRoller adds tenAddSuccess directly to the success total (not as a bonus).
  // Therefore this value must be 2 for every valid 10 to count as two successes.
  config.usetenAddSuccess = true;
  config.tenAddSuccess = 2;
}

function nativeAutoSuccessBonus(card) {
  const lines = [...card.querySelectorAll(".tray-info-area .tray-action-area")];
  let total = 0;
  for (const line of lines) {
    const raw = line.textContent ?? "";
    const text = normalized(raw);
    const indicatesAutoSuccess = (text.includes("auto") || text.includes("automatic")) &&
      (text.includes("sucesso") || text.includes("success") || text.includes("acerto"));
    if (!indicatesAutoSuccess) continue;
    const numbers = raw.match(/\d+/g);
    if (numbers?.length) total += Number(numbers[numbers.length - 1]) || 0;
  }
  return total;
}

function nativeRollDifficulty(card) {
  const info = [...card.querySelectorAll(".tray-info-area .tray-action-area")].map((line) => line.textContent ?? "");
  for (const line of info) {
    const match = line.match(/(?:dificuldade|difficulty)\s*:?\s*(\d+)/i);
    if (match) return clamp(match[1], 2, 10);
  }
  return 6;
}

function processNativeWoDRollCard(card) {
  if (!card || card.dataset.dhpHouseRuleApplied === "true") return;
  const difficulty = nativeRollDifficulty(card);
  const autoBonus = nativeAutoSuccessBonus(card);
  const rollAreas = [...card.querySelectorAll(".tray-roll-area")];
  if (!rollAreas.length) return;
  let touched = false;
  let nativeDiceSuccesses = 0;
  let nativeContribution = 0;
  const nativeAllValues = [];
  const aggregate = {
    ones: 0, onesIndexes: [], cancelledIndexes: [], cancelledResults: [], remainingResults: [], remainingIndexes: [],
    successfulResults: [], successfulIndexes: [], successes: 0, contribution: 0, tens: 0
  };

  for (const area of rollAreas) {
    const dice = [...area.querySelectorAll("img.wod-svg")];
    if (!dice.length) continue;
    const entries = dice.map((img, index) => {
      const readNativeDie = (element) => {
        const candidates = [element.dataset.dhpNativeValue, element.dataset.value, element.dataset.result,
          element.getAttribute("data-result"), element.getAttribute("data-value"), element.getAttribute("title"),
          element.getAttribute("aria-label"), element.getAttribute("alt")];
        for (const candidate of candidates) {
          if (candidate === undefined || candidate === null || candidate === "") continue;
          const normalizedCandidate = String(candidate).trim();
          // WoD20's SVG die skin can render the ten face as "0" even though the Roll is 10.
          if (normalizedCandidate === "0" || /^0(?:\s|\D|$)/.test(normalizedCandidate)) return 10;
          const direct = Number(normalizedCandidate);
          if (Number.isInteger(direct) && direct >= 1 && direct <= 10) return direct;
          const match = normalizedCandidate.match(/(?:^|[^0-9])(10|[1-9])(?:$|[^0-9])/);
          if (match) return Number(match[1]);
        }
        return NaN;
      };
      const value = readNativeDie(img);
      if (!Number.isFinite(value)) return null;
      img.dataset.dhpNativeValue = String(value);
      return { img, value, index };
    }).filter(Boolean);
    if (!entries.length) continue;

    const globalOffset = nativeAllValues.length;
    const values = entries.map((entry) => entry.value);
    nativeAllValues.push(...values);
    const resolution = rollSuccesses(values, difficulty);
    const canceled = new Set(resolution.cancelledIndexes);
    const ones = new Set(resolution.onesIndexes);
    const successful = new Set(resolution.successfulIndexes);
    nativeDiceSuccesses += resolution.successes;
    nativeContribution += resolution.contribution;
    aggregate.ones += resolution.ones;
    aggregate.onesIndexes.push(...resolution.onesIndexes.map((index) => index + globalOffset));
    aggregate.cancelledIndexes.push(...resolution.cancelledIndexes.map((index) => index + globalOffset));
    aggregate.cancelledResults.push(...resolution.cancelledResults);
    aggregate.remainingResults.push(...resolution.remainingResults);
    aggregate.remainingIndexes.push(...resolution.remainingIndexes.map((index) => index + globalOffset));
    aggregate.successfulResults.push(...resolution.successfulResults);
    aggregate.successfulIndexes.push(...resolution.successfulIndexes.map((index) => index + globalOffset));
    aggregate.successes += resolution.successes;
    aggregate.contribution += resolution.contribution;
    aggregate.tens += resolution.tens;

    for (const entry of entries) {
      const { img, value, index } = entry;
      img.classList.remove("dhp-native-die-one", "dhp-native-die-failure", "dhp-native-die-success", "dhp-native-die-cancelled", "dhp-native-die-ten");
      if (ones.has(index)) {
        img.classList.add("dhp-native-die-one");
        img.title = "1 - cancela o maior resultado da mesma rolagem";
        img.setAttribute("aria-label", "1, cancela o maior dado");
      } else if (canceled.has(index)) {
        img.classList.add("dhp-native-die-cancelled");
        img.title = `${value} - cancelado por 1`;
        img.setAttribute("aria-label", `${value}, cancelado por 1`);
      } else if (value === 10) {
        img.classList.add("dhp-native-die-ten", "dhp-native-die-success");
        img.title = "10 - dois sucessos";
        img.setAttribute("aria-label", "10, dois sucessos");
      } else if (successful.has(index)) {
        img.classList.add("dhp-native-die-success");
        img.title = `${value} - sucesso`;
        img.setAttribute("aria-label", `${value}, sucesso`);
      } else {
        img.classList.add("dhp-native-die-failure");
        img.title = `${value} - falha (dificuldade ${difficulty})`;
        img.setAttribute("aria-label", `${value}, falha`);
      }
    }

    // Sort native SVG dice in each roll area: ones/cancelled left, failures center, successes right, 10s last.
    const rank = (entry) => {
      if (entry.value === 1) return 0;
      if (canceled.has(entry.index)) return 1;
      if (entry.value === 10) return 4;
      if (!successful.has(entry.index)) return 1;
      return 3;
    };
    const parent = entries[0].img.parentElement;
    if (parent && entries.every((entry) => entry.img.parentElement === parent)) {
      [...entries].sort((a, b) => rank(a) - rank(b) || a.value - b.value || a.index - b.index).forEach((entry) => parent.appendChild(entry.img));
    }
    touched = true;
  }

  const resultArea = card.querySelector(".tray-success-area");
  const resultNode = resultArea?.lastElementChild;
  if (touched && resultNode) {
    const finalSuccesses = nativeDiceSuccesses + autoBonus;
    const original = resultNode.textContent ?? "";
    const matched = original.match(/^(.*?)(-?\d+)\s*$/);
    const prefix = matched?.[1] ?? `${game.i18n?.localize?.("wod.dice.successes") || "Sucessos"}: `;
    resultNode.textContent = `${prefix}${finalSuccesses}`;
    if (finalSuccesses > 0) {
      resultArea.querySelectorAll(".danger, .tray-fail-area, .tray-botch-area, .tray-failure, .botch").forEach((node) => node.remove());
      [...card.querySelectorAll(".tray-info-area .tray-action-area, .tray-info-area li, .tray-info-area p")].forEach((node) => {
        if (/falha cr[ií]tica|botch|critical failure/i.test(node.textContent ?? "")) node.remove();
      });
    }
    aggregate.successes = finalSuccesses;
    // Auto-successes affect the success total but, having no d10 face value, do not add PV reduction.
    card.dataset.dhpSuccesses = String(finalSuccesses);
    card.dataset.dhpDifficulty = String(difficulty);
    card.dataset.dhpRollValues = JSON.stringify(nativeAllValues);
    card.dataset.dhpRollResolution = JSON.stringify(aggregate);
    card.dataset.dhpContribution = String(nativeContribution);
    card.dataset.dhpAutoBonus = String(autoBonus);
  }
  if (touched) card.dataset.dhpHouseRuleApplied = "true";
}

function documentOwnerLevel(document, user = game.user) {
  if (!document || !user) return false;
  const ownerLevel = Number(globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3);
  try {
    if (document.testUserPermission?.(user, ownerLevel) === true || document.testUserPermission?.(user, "OWNER") === true) return true;
  } catch (_) { /* Alguns atores sintéticos não expõem métodos de permissão tradicionais. */ }
  try {
    const explicitLevel = Number(document.getUserLevel?.(user));
    if (Number.isFinite(explicitLevel) && explicitLevel >= ownerLevel) return true;
  } catch (_) { /* Continua verificando os dados de ownership. */ }
  const ownership = document.ownership ?? document._source?.ownership ?? {};
  const explicit = ownership[user.id];
  const level = Number(explicit ?? ownership.default ?? 0);
  if (Number.isFinite(level) && level >= ownerLevel) return true;
  // isOwner descreve o usuário atual do cliente. Só vale para ele.
  if (user.id === game.user?.id && document.isOwner === true) return true;
  return false;
}

function actorIdentityMatchesUser(actor, user = game.user, actorIdHint = "") {
  if (!actor || !user) return false;
  if (user.isGM) return true;
  const candidates = [actor, actor.baseActor, actor.token?.actor, actor.parent?.actor, actor.parent?.baseActor].filter(Boolean);
  const ids = new Set(candidates.flatMap((doc) => [doc.id, doc._id, doc.uuid].filter(Boolean).map(String)));
  if (actorIdHint) ids.add(String(actorIdHint));
  const character = user.character;
  if (character && [character.id, character._id, character.uuid].filter(Boolean).some((id) => ids.has(String(id)))) return true;
  return candidates.some((doc) => documentOwnerLevel(doc, user));
}

async function canUserControlTarget(targetUuid, targetActorUuid = "", targetActorId = "", knownActor = null, ownerIds = []) {
  if (game.user?.isGM) return true;
  const currentUser = game.user;
  const currentUserId = String(currentUser?.id ?? "");
  if (Array.isArray(ownerIds) && ownerIds.map(String).includes(currentUserId)) return true;
  const documents = [];
  const append = (document) => {
    if (!document) return;
    for (const value of [document, document.actor, document.baseActor, document.actor?.baseActor, document.parent?.actor, document.parent?.baseActor]) {
      if (value && !documents.includes(value)) documents.push(value);
    }
  };
  append(knownActor);
  if (targetUuid) {
    try {
      const targetDocument = await fromUuid(targetUuid);
      append(targetDocument);
      const linkedActorId = targetDocument?.actorId ?? targetDocument?._source?.actorId;
      if (linkedActorId) append(game.actors?.get?.(String(linkedActorId)));
    } catch (error) { console.debug(`${MODULE_ID} | Não foi possível resolver o UUID do token-alvo.`, error); }
  }
  if (targetActorUuid) {
    try { append(await fromUuid(targetActorUuid)); } catch (_) { /* Usa o ID ou as permissões registradas. */ }
  }
  if (targetActorId) append(game.actors?.get?.(String(targetActorId)));
  const character = currentUser?.character;
  const characterIds = [character?.id, character?._id, character?.uuid].filter(Boolean).map(String);
  const targetIds = new Set([String(targetActorId ?? ""), String(targetActorUuid ?? "")].filter(Boolean));
  if (characterIds.some((id) => targetIds.has(id))) return true;
  return documents.some((document) => actorIdentityMatchesUser(document, currentUser, targetActorId));
}

function syncAttackDefenseButtonState(message, root) {
  const defenseData = message?.getFlag?.(MODULE_ID, "combat");
  if (!defenseData) return;
  const closed = message.getFlag(MODULE_ID, "defenseClosed") === true;
  const prior = [...(game.messages ?? [])].find((candidate) => candidate.getFlag(MODULE_ID, "defendedMessageId") === message.id && candidate.getFlag(MODULE_ID, "closeOriginalDefense") === true);
  if (closed || prior) {
    const button = root.querySelector("[data-dhp-chat-defend]");
    if (button) { button.disabled = true; button.textContent = "Defesa rolada"; }
  }
}

function bindChatApplication() {
  Hooks.on("renderChatMessage", (message, html) => {
    const root = asElement(html);
    if (!root) return;

    const nativeCards = [...(root.matches?.(".wod20-roll") ? [root] : []), ...root.querySelectorAll(".wod20-roll")];
    nativeCards.forEach((card) => processNativeWoDRollCard(card));
    attachMagicDefenseAction(message, root, nativeCards);

    const defendButtons = [...root.querySelectorAll("[data-dhp-chat-defend]")];
    const applyButtons = [...root.querySelectorAll("[data-dhp-chat-apply]")];
    const combatFlag = message?.getFlag?.(MODULE_ID, "combat");
    const targetUuidForDefense = combatFlag?.targetUuid ?? "";

    for (const button of defendButtons) {
      const container = button.closest(".dhp-defense-controls") ?? button;
      if (button.dataset.dhpBound === "true") continue;
      button.dataset.dhpBound = "true";
      if (targetUuidForDefense || combatFlag?.targetActorUuid || combatFlag?.targetActorId) {
        // GM and captured target owners see the control immediately. Other users get a
        // hidden control until live ownership resolution confirms access.
        if (userIsTargetOwnerFromFlags(game.user, combatFlag ?? {})) {
          container.classList.remove("dhp-unauthorized-hidden");
        } else {
          container.classList.add("dhp-unauthorized-hidden");
          void canUserControlTarget(
            targetUuidForDefense,
            combatFlag?.targetActorUuid ?? "",
            combatFlag?.targetActorId ?? "",
            null,
            combatFlag?.targetOwnerIds ?? []
          ).then((allowed) => {
            if (allowed && root.isConnected) container.classList.remove("dhp-unauthorized-hidden");
            else container.classList.add("dhp-unauthorized-hidden");
          }).catch((error) => {
            console.warn(`${MODULE_ID} | Falha ao verificar quem pode defender o alvo.`, error);
            container.classList.add("dhp-unauthorized-hidden");
          });
        }
      } else {
        // No unique target: every player may resolve a defense with a character they control.
        container.classList.remove("dhp-unauthorized-hidden");
      }
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        await resolveDefense(button);
      });
    }
    for (const select of root.querySelectorAll("[data-dhp-defense-mode]")) {
      if (select.dataset.dhpModeBound === "true") continue;
      select.dataset.dhpModeBound = "true";
      select.addEventListener("change", () => {
        if (select.value !== "magic" && select.value !== "rote") cancelPendingMagicDefense(select);
      });
    }

    for (const button of applyButtons) {
      button.classList.add("dhp-unauthorized-hidden");
      if (button.dataset.dhpBound === "true") continue;
      button.dataset.dhpBound = "true";
      void canUserControlActorUuid(button.dataset.targetUuid).then((allowed) => {
        if (root.isConnected && allowed) button.classList.remove("dhp-unauthorized-hidden");
      });
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        await applyChatDamage(button);
      });
    }

    // A defense result created by the target or GM is visible to all clients. It marks
    // targeted attacks resolved everywhere; an untargeted player's test stays reusable.
    const defendedMessageId = message?.getFlag?.(MODULE_ID, "defendedMessageId");
    const closesSource = message?.getFlag?.(MODULE_ID, "closeOriginalDefense") === true;
    if (defendedMessageId && closesSource) {
      const sourceRoot = document.querySelector(`[data-message-id="${dhpCssEscape(defendedMessageId)}"]`);
      const sourceButton = sourceRoot?.querySelector("[data-dhp-chat-defend]");
      if (sourceButton) { sourceButton.disabled = true; sourceButton.textContent = "Defesa rolada"; }
    }
    if (combatFlag) syncAttackDefenseButtonState(message, root);
  });
}

// ------------------------ Editor prático de macros de rolagem ------------------------
const MACRO_ATTRIBUTES = [
  { key: "strength", label: "Força" }, { key: "dexterity", label: "Destreza" }, { key: "stamina", label: "Vigor" },
  { key: "charisma", label: "Carisma" }, { key: "manipulation", label: "Manipulação" }, { key: "appearance", label: "Aparência" },
  { key: "perception", label: "Percepção" }, { key: "intelligence", label: "Inteligência" }, { key: "wits", label: "Raciocínio" }
];
const MACRO_ABILITIES = [
  // Chaves canônicas do WoD20 v7.3.1, com rótulos pt-BR para folhas sem tradução carregada.
  { key: "alertness", label: "Prontidão" }, { key: "art", label: "Arte" }, { key: "athletics", label: "Esportes/Atletismo" },
  { key: "awareness", label: "Consciência" }, { key: "brawl", label: "Briga" }, { key: "dodge", label: "Esquiva" },
  { key: "empathy", label: "Empatia" }, { key: "expression", label: "Expressão" }, { key: "intimidation", label: "Intimidação" },
  { key: "intuition", label: "Intuição" }, { key: "kenning", label: "Tino" }, { key: "leadership", label: "Liderança" },
  { key: "legerdemain", label: "Prestidigitação" }, { key: "persuasion", label: "Persuasão" }, { key: "primalurge", label: "Instinto Primitivo" },
  { key: "streetwise", label: "Manha" }, { key: "subterfuge", label: "Lábia" }, { key: "socialize", label: "Socializar" },
  { key: "artist", label: "Artista" }, { key: "instruction", label: "Instrução" }, { key: "animalken", label: "Empatia com Animais" },
  { key: "archery", label: "Arqueirismo" }, { key: "commerce", label: "Comércio" }, { key: "craft", label: "Ofícios" },
  { key: "demolitions", label: "Demolição" }, { key: "drive", label: "Condução" }, { key: "etiquette", label: "Etiqueta" },
  { key: "firearms", label: "Armas de Fogo" }, { key: "larceny", label: "Crime / Furto" }, { key: "martialarts", label: "Artes Marciais" },
  { key: "meditation", label: "Meditação" }, { key: "melee", label: "Armas Brancas" }, { key: "performance", label: "Performance" },
  { key: "research", label: "Pesquisa" }, { key: "ride", label: "Cavalgar" }, { key: "security", label: "Segurança" },
  { key: "stealth", label: "Furtividade" }, { key: "survival", label: "Sobrevivência" }, { key: "ranged", label: "À distância" },
  { key: "thievery", label: "Ladroagem" }, { key: "weaponry", label: "Armas" }, { key: "academics", label: "Acadêmicos" },
  { key: "ancientmedicine", label: "Medicina Ancestral" }, { key: "astrology", label: "Astrologia" }, { key: "bureaucracy", label: "Burocracia" },
  { key: "computer", label: "Computador" }, { key: "cosmology", label: "Cosmologia" }, { key: "culture", label: "Cultura" },
  { key: "customs", label: "Aspectos Culturais" }, { key: "enigmas", label: "Enigmas" }, { key: "esoterica", label: "Esoterismo" },
  { key: "finance", label: "Finanças" }, { key: "gremayre", label: "Gramática Mágica" }, { key: "hearthwisdom", label: "Sabedoria Popular" },
  { key: "herbalism", label: "Herbalismo" }, { key: "investigation", label: "Investigação" }, { key: "law", label: "Direito" },
  { key: "linguistics", label: "Linguística" }, { key: "medicine", label: "Medicina" }, { key: "mythology", label: "Mitologia" },
  { key: "occult", label: "Ocultismo" }, { key: "philosophy", label: "Filosofia" }, { key: "politics", label: "Política" },
  { key: "religion", label: "Religião" }, { key: "ritualistics", label: "Rituais (especialidade)" }, { key: "rituals", label: "Rituais" },
  { key: "seneschal", label: "Senescalia" }, { key: "science", label: "Ciência" }, { key: "technology", label: "Tecnologia" },
  { key: "theology", label: "Teologia" }, { key: "writing", label: "Escrita" }, { key: "ancestralmedicine", label: "Medicina Ancestral" },
  { key: "invention", label: "Invenção" }, { key: "legendlore", label: "Saber Lendário" }, { key: "lore", label: "Erudição" },
  { key: "metaphysics", label: "Metafísica" }
];
const MACRO_SPHERES = [
  { key: "correspondence", label: "Correspondência" }, { key: "entropy", label: "Entropia" }, { key: "forces", label: "Forças" },
  { key: "life", label: "Vida" }, { key: "matter", label: "Matéria" }, { key: "mind", label: "Mente" },
  { key: "prime", label: "Primórdio" }, { key: "spirit", label: "Espírito" }, { key: "time", label: "Tempo" }
];

function cssAttributeValue(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ");
}

function hotbarMacroAt(slot, page = 1) {
  const safeSlot = clamp(slot, 1, 10);
  const safePage = clamp(page, 1, 5);
  try {
    const assigned = game.user?.getHotbarMacros?.(safePage) ?? [];
    const absoluteSlot = ((safePage - 1) * 10) + safeSlot;
    const entry = assigned.find((candidate) => Number(candidate.slot) === safeSlot || Number(candidate.slot) === absoluteSlot);
    if (entry?.macro) return entry.macro;
  } catch (error) {
    console.debug(`${MODULE_ID} | Could not read hotbar page ${safePage}`, error);
  }

  // Compatibility fallback for systems/Foundry builds that do not expose getHotbarMacros.
  const absoluteSlot = ((safePage - 1) * 10) + safeSlot;
  const saved = game.user?.hotbar?.[absoluteSlot] ?? game.user?.hotbar?.[String(absoluteSlot)];
  if (saved && typeof saved === "object") return saved;
  if (typeof saved === "string") return game.macros?.get(saved) ?? null;
  if (safePage === Number(ui.hotbar?.page ?? 1)) {
    const macros = ui.hotbar?.macros;
    if (Array.isArray(macros)) return macros[safeSlot - 1] ?? null;
    if (macros instanceof Map) return macros.get(safeSlot) ?? macros.get(safeSlot - 1) ?? null;
  }
  return null;
}

function getMacroConfigs(actor) {
  const saved = actor?.getFlag?.(MODULE_ID, "macroConfigs");
  return Array.isArray(saved) ? deepClone(saved) : [];
}

function localizedTraitLabel(value, fallback = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (raw.includes(".") && typeof game.i18n?.localize === "function") {
    const localized = game.i18n.localize(raw);
    if (localized && localized !== raw) return localized;
  }
  return raw || fallback;
}

function listTraitOptions(actor, kind) {
  if (kind === "attribute") {
    const options = [...MACRO_ATTRIBUTES];
    for (const [key, entry] of Object.entries(actor?.system?.attributes ?? {})) {
      const label = entry?.altlabel?.trim() || localizedTraitLabel(entry?.label) || entry?.name || entry?.alias || key;
      if (!options.some((option) => normalized(option.key) === normalized(key) || normalized(option.label) === normalized(label) || normalized(option.label) === normalized(key))) {
        options.push({ key, label });
      }
    }
    return options.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }
  if (kind === "ability") {
    const fallback = [...MACRO_ABILITIES];
    const nativeEntries = Object.entries(actor?.system?.abilities ?? {});
    const hasNativeDictionary = nativeEntries.length > 0;
    const options = hasNativeDictionary ? [] : fallback;
    const add = (key, entry, label = null) => {
      const value = String(key ?? entry?.name ?? "").trim();
      if (!value) return;
      const display = localizedTraitLabel(label ?? entry?.altlabel ?? entry?.label ?? entry?.name ?? entry?.system?.label, value);
      const existing = options.findIndex((option) => normalized(option.key) === normalized(value));
      if (existing >= 0) options[existing] = { key: value, label: display };
      else options.push({ key: value, label: display });
    };
    for (const [key, entry] of nativeEntries) {
      const preferredLabel = entry?.altlabel?.trim() || localizedTraitLabel(entry?.label, "") || entry?.name || key;
      add(key, entry, preferredLabel);
    }
    // Suporta sistemas de ficha que guardam habilidades como itens embutidos, além do dicionário nativo.
    for (const item of actor?.items ?? []) {
      if (normalized(item.type) !== "ability") continue;
      const itemKey = item.system?.slug ?? item.system?.id ?? item.name;
      add(itemKey, item, item.system?.altlabel?.trim() || localizedTraitLabel(item.system?.label, "") || item.name || itemKey);
    }
    return options.sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }));
  }
  return [];
}

function componentOptionsHtml(actor, kind, selected = "") {
  const options = listTraitOptions(actor, kind);
  return options.map((option) => `<option value="${escapeHtml(option.key)}" ${normalized(option.key) === normalized(selected) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("");
}

function renderMacroComponentRow(actor, component = {}) {
  const kind = ["attribute", "ability", "arete", "willpower"].includes(component.kind) ? component.kind : "attribute";
  const keyOptions = kind === "attribute" || kind === "ability";
  const defaultKey = component.key ?? listTraitOptions(actor, kind)[0]?.key ?? "strength";
  return `<div class="dhp-macro-component" data-dhp-macro-component>
    <span class="dhp-macro-row-number" aria-hidden="true"></span>
    <label><span>Tipo</span><select data-dhp-component-kind>
      <option value="attribute" ${kind === "attribute" ? "selected" : ""}>Atributo</option>
      <option value="ability" ${kind === "ability" ? "selected" : ""}>Habilidade</option>
      <option value="arete" ${kind === "arete" ? "selected" : ""}>Arete</option>
      <option value="willpower" ${kind === "willpower" ? "selected" : ""}>Força de Vontade</option>
    </select></label>
    <label data-dhp-component-choice style="${keyOptions ? "" : "display:none"}"><span>Característica</span><select data-dhp-component-key>${componentOptionsHtml(actor, kind, defaultKey)}</select></label>
    <div class="dhp-macro-fixed-trait" data-dhp-component-fixed style="${keyOptions ? "display:none" : ""}">${kind === "arete" ? "Usar Arete da ficha" : "Usar Força de Vontade da ficha"}</div>
    <button type="button" class="dhp-macro-remove-row" data-dhp-remove-component title="Remover este componente" aria-label="Remover componente"><i class="fas fa-times"></i></button>
  </div>`;
}

function readWillpowerValue(actor) {
  const directEntries = [
    actor?.system?.advantages?.willpower, actor?.system?.willpower,
    actor?.system?.mage?.advantages?.willpower, actor?.system?.resources?.willpower
  ].filter((entry) => entry !== undefined && entry !== null);
  const keys = ["roll", "permanent", "total", "rating", "value", "dots", "current"];
  for (const entry of directEntries) {
    if (typeof entry === "number" || typeof entry === "string") return clamp(entry, 0, 10);
    for (const key of keys) {
      const value = entry?.[key] ?? entry?.system?.[key];
      if (value !== undefined && Number.isFinite(Number(value))) return clamp(value, 0, 10);
    }
  }
  for (const item of actor?.items ?? []) {
    const terms = [item.name, item.type, item.system?.id, item.system?.slug, item.system?.label].map(normalized);
    if (!terms.some((term) => term.includes("willpower") || term.includes("forcadevontade"))) continue;
    for (const key of keys) {
      const value = item.system?.[key];
      if (value !== undefined && Number.isFinite(Number(value))) return clamp(value, 0, 10);
    }
  }
  return 0;
}

function readParadoxValue(actor) {
  const directEntries = [
    actor?.system?.mage?.paradox,
    actor?.system?.mage?.advantages?.paradox,
    actor?.system?.resources?.paradox,
    actor?.system?.advantages?.paradox,
    actor?.system?.paradox,
    actor?.system?.traits?.paradox,
    actor?.system?.mage?.resources?.paradox
  ].filter((entry) => entry !== undefined && entry !== null);
  const keys = ["roll", "temporary", "points", "total", "rating", "value", "current", "dots", "permanent"];
  for (const entry of directEntries) {
    if (typeof entry === "number" || typeof entry === "string") return clamp(entry, 0, 10);
    for (const key of keys) {
      const candidate = entry?.[key] ?? entry?.system?.[key];
      if (candidate !== undefined && Number.isFinite(Number(candidate))) return clamp(candidate, 0, 10);
    }
    const fallback = readNestedRating(entry);
    if (fallback !== null) return fallback;
  }
  for (const item of actor?.items ?? []) {
    const terms = [item.name, item.type, item.system?.id, item.system?.slug, item.system?.label].map(normalized);
    if (!terms.some((term) => term.includes("paradox") || term.includes("paradoxo"))) continue;
    for (const key of keys) {
      const candidate = item.system?.[key] ?? item.system?.resources?.[key];
      if (candidate !== undefined && Number.isFinite(Number(candidate))) return clamp(candidate, 0, 10);
    }
  }
  return 0;
}

function traitComponentValue(actor, component) {
  if (component.kind === "attribute") return findTraitValue(actor, "attribute", component.key);
  if (component.kind === "ability") return findTraitValue(actor, "ability", component.key);
  if (component.kind === "arete") return findAreteValue(actor);
  if (component.kind === "willpower") return readWillpowerValue(actor);
  return 0;
}

function readNestedRating(entry) {
  if (entry === null || entry === undefined) return null;
  if (typeof entry === "number" || typeof entry === "string") {
    const value = Number(entry);
    return Number.isFinite(value) ? clamp(value, 0, 10) : null;
  }
  for (const key of ["roll", "total", "rating", "value", "rank", "level", "permanent", "dots", "current", "temporary", "points"]) {
    const value = entry?.[key] ?? entry?.system?.[key];
    if (value !== undefined && Number.isFinite(Number(value))) return clamp(value, 0, 10);
  }
  return null;
}

function findSphereValue(actor, key) {
  const candidates = [
    actor?.system?.mage?.spheres?.[key], actor?.system?.spheres?.[key],
    actor?.system?.mage?.[key], actor?.system?.advantages?.[key]
  ];
  for (const entry of candidates) {
    const value = readNestedRating(entry);
    if (value !== null) return value;
  }
  const label = MACRO_SPHERES.find((entry) => entry.key === key)?.label ?? key;
  for (const item of actor?.items ?? []) {
    const terms = [item.name, item.type, item.system?.id, item.system?.slug, item.system?.label].map(normalized);
    if (terms.some((term) => term === normalized(key) || term === normalized(label))) {
      const value = readNestedRating(item.system);
      if (value !== null) return value;
    }
  }
  return 0;
}

function listActorRotes(actor) {
  return [...(actor?.items ?? [])]
    .filter((item) => {
      const types = [item.type, item.system?.type, item.system?.id, item.system?.slug, item.system?.category].map(normalized);
      return types.some((type) => type === "rote" || type === "routine" || type === "rotina");
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR", { sensitivity: "base" }));
}

function roteOptionsHtml(actor, selectedId = "") {
  const rotes = listActorRotes(actor);
  if (!rotes.length) return `<option value="">Nenhuma rotina cadastrada nesta ficha</option>`;
  return `<option value="">Selecione uma rotina</option>` + rotes.map((item) =>
    `<option value="${escapeHtml(item.id)}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(item.name)}</option>`
  ).join("");
}

function hotbarSlotLabel(slot, page = 1) {
  const number = Number(slot) === 10 ? "0" : String(slot);
  const assigned = hotbarMacroAt(slot, page);
  return `${number}${assigned ? ` · ocupado: ${escapeHtml(assigned.name ?? "macro")}` : " · livre"}`;
}

function macroSlotOptionsHtml(selected = 1, page = 1) {
  return Array.from({ length: 10 }, (_, index) => {
    const slot = index + 1;
    return `<option value="${slot}" ${Number(selected) === slot ? "selected" : ""}>${hotbarSlotLabel(slot, page)}</option>`;
  }).join("");
}

function macroPageOptionsHtml(selected = 1) {
  return Array.from({ length: 5 }, (_, index) => index + 1).map((page) =>
    `<option value="${page}" ${Number(selected) === page ? "selected" : ""}>${page}</option>`
  ).join("");
}

function macroModeLabel(mode) {
  return ({
    pool: "Rolagem combinada",
    magic: "Teste de Mágika",
    rote: "Rotina da ficha",
    sheet: "Ação nativa antiga",
    weapon: "Ataque com arma"
  })[mode] ?? "Rolagem combinada";
}

function buildMacroEditorContent(actor, root, config = {}) {
  const allowedModes = ["pool", "magic", "rote", "weapon"];
  const mode = allowedModes.includes(config.mode) ? config.mode : "pool";
  const components = Array.isArray(config.components) && config.components.length ? config.components : [{ kind: "attribute", key: "strength" }];
  const availableWeapons = getWeapons(actor);
  const weaponOptions = availableWeapons.map((weapon) => `<option value="${escapeHtml(weapon.id)}" ${weapon.id === config.weaponId ? "selected" : ""}>${escapeHtml(weapon.name)} - ${escapeHtml(weaponDamageText(weapon))}</option>`).join("");
  const configuredWeapon = availableWeapons.find((weapon) => weapon.id === config.weaponId);
  const configuredAutomatic = weaponSupportsAutomatic(configuredWeapon);
  const chosenFireMode = configuredAutomatic ? (config.fireMode ?? "normal") : "normal";
  const macroFireModeOptions = `<option value="normal" ${chosenFireMode === "normal" ? "selected" : ""}>Disparo normal</option>${configuredAutomatic ? `<option value="burst" ${chosenFireMode === "burst" ? "selected" : ""}>Rajada de 3 tiros (+1 dif., +3d10)</option><option value="automatic" ${chosenFireMode === "automatic" ? "selected" : ""}>Automático - pente inteiro (+2 dif., +10d10)</option><option value="suppressive" ${chosenFireMode === "suppressive" ? "selected" : ""}>Metralhar área (+2 dif., +10d10 distribuídos)</option>` : ""}`;
  const spheres = MACRO_SPHERES.map((sphere) => {
    const rating = findSphereValue(actor, sphere.key);
    const checked = (config.spheres ?? []).includes(sphere.key) ? "checked" : "";
    return `<label class="dhp-macro-sphere"><input type="checkbox" value="${sphere.key}" data-dhp-sphere ${checked}><span>${escapeHtml(sphere.label)}</span><small>${rating}</small></label>`;
  }).join("");
  const magicTraits = [
    { key: "arete", label: "Arete", value: findAreteValue(actor) },
    { key: "willpower", label: "Força de Vontade", value: readWillpowerValue(actor) },
    { key: "paradox", label: "Paradoxo", value: readParadoxValue(actor) }
  ];
  const selectedTraits = Array.isArray(config.magicTraits) ? config.magicTraits : ["arete"];
  const magicTraitOptions = magicTraits.map((trait) =>
    `<label class="dhp-macro-magic-trait"><input type="checkbox" data-dhp-magic-trait value="${trait.key}" ${selectedTraits.includes(trait.key) ? "checked" : ""}><span>${escapeHtml(trait.label)}</span><small>${trait.value}d10</small></label>`
  ).join("");
  const ammunitionOptions = Object.entries(AMMUNITION_TYPES).map(([key, value]) => `<option value="${key}" ${key === (config.ammoType ?? "standard") ? "selected" : ""}>${escapeHtml(value.label)}</option>`).join("");
  const initialPage = clamp(config.page ?? (config.id ? 1 : (ui.hotbar?.page ?? 1)), 1, 5);
  const firstFree = Array.from({ length: 10 }, (_, i) => i + 1).find((value) => !hotbarMacroAt(value, initialPage)) ?? 1;
  const slot = clamp(config.slot ?? firstFree, 1, 10);
  return `<form class="dhp-macro-editor" autocomplete="off">
    <div class="dhp-macro-intro"><div class="dhp-macro-intro-icon"><i class="fas fa-dice-d10"></i></div><div><h3>${config.id ? "Editar macro" : "Criar macro de rolagem"}</h3><p>Escolha o que deseja rolar e onde o atalho ficará. Não é necessário escrever código.</p></div></div>
    <div class="dhp-macro-top-fields">
      <label class="dhp-macro-field dhp-macro-name-field"><span>Nome da macro</span><input type="text" maxlength="64" name="macroName" placeholder="Ex.: Força + Briga" value="${escapeHtml(config.name ?? "")}" required></label>
      <label class="dhp-macro-field"><span>Atalho</span><select name="macroSlot">${macroSlotOptionsHtml(slot, initialPage)}</select></label>
      <label class="dhp-macro-field"><span>Página</span><select name="macroPage">${macroPageOptionsHtml(initialPage)}</select></label>
    </div>
    <label class="dhp-macro-field dhp-macro-action-type"><span>O que a macro vai fazer?</span><select name="macroMode">
      <option value="pool" ${mode === "pool" ? "selected" : ""}>Rolagem combinada - atributos e habilidades</option>
      <option value="magic" ${mode === "magic" ? "selected" : ""}>Teste de Mágika - características e Esferas</option>
      <option value="rote" ${mode === "rote" ? "selected" : ""}>Rotina da ficha (Rote)</option>
      <option value="weapon" ${mode === "weapon" ? "selected" : ""}>Ataque de uma arma do Arsenal Dravent</option>
    </select></label>

    <section class="dhp-macro-mode-panel" data-dhp-mode-panel="pool" ${mode === "pool" ? "" : "hidden"}>
      <div class="dhp-macro-panel-heading"><div><strong>Componentes da rolagem</strong><p>Todos os itens abaixo são somados para formar uma única parada de dados.</p></div><span class="dhp-macro-pool-preview" data-dhp-pool-preview>- d10</span></div>
      <div class="dhp-macro-component-list" data-dhp-component-list>${components.map((component) => renderMacroComponentRow(actor, component)).join("")}</div>
      <button type="button" class="dhp-macro-add" data-dhp-add-component><i class="fas fa-plus-circle"></i> Adicionar componente da ficha</button>
      <div class="dhp-macro-bottom-fields"><label class="dhp-macro-field"><span>Dificuldade</span><input type="number" name="poolDifficulty" min="2" max="10" value="${clamp(config.difficulty ?? 6, 2, 10)}"></label><span class="dhp-macro-help">Exemplo: Força 3 + Briga 2 = 5d10.</span></div>
    </section>

    <section class="dhp-macro-mode-panel" data-dhp-mode-panel="magic" ${mode === "magic" ? "" : "hidden"}>
      <div class="dhp-macro-panel-heading"><div><strong>Teste de Mágika</strong><p>Marque as características que deseja rolar. Cada uma gera sua própria rolagem; as Esferas ficam como contexto do efeito.</p></div></div>
      <strong class="dhp-macro-section-label">Características para rolar</strong>
      <div class="dhp-macro-magic-traits">${magicTraitOptions}</div>
      <strong class="dhp-macro-section-label">Esferas do efeito (opcional)</strong>
      <div class="dhp-macro-sphere-grid">${spheres}</div>
      <div class="dhp-macro-bottom-fields"><label class="dhp-macro-field"><span>Dificuldade</span><input type="number" name="magicDifficulty" min="2" max="10" value="${clamp(config.difficulty ?? 6, 2, 10)}"></label><span class="dhp-macro-help">Arete, Força de Vontade e Paradoxo não são somados entre si. Cada rolagem usa o valor correspondente da ficha.</span></div>
    </section>

    <section class="dhp-macro-mode-panel" data-dhp-mode-panel="rote" ${mode === "rote" ? "" : "hidden"}>
      <label class="dhp-macro-field"><span>Rotina (Rote) cadastrada na ficha</span><select name="macroRote">${roteOptionsHtml(actor, config.roteItemId)}</select></label>
      <p class="dhp-macro-help">A macro aciona a rotina escolhida pelo controle nativo do WoD20, como se você clicasse no nome dela na aba de Mágika.</p>
      ${listActorRotes(actor).length ? "" : "<p class=\"dhp-macro-warning\">Esta ficha não tem rotinas (Rotes) cadastradas. Crie uma na aba de Mágika e volte aqui.</p>"}
    </section>

    <section class="dhp-macro-mode-panel" data-dhp-mode-panel="weapon" ${mode === "weapon" ? "" : "hidden"}>
      <label class="dhp-macro-field"><span>Arma</span><select name="macroWeapon">${weaponOptions || "<option value=''>Nenhuma arma cadastrada</option>"}</select></label>
      <div class="dhp-macro-bottom-fields dhp-macro-weapon-fields">
        <label class="dhp-macro-field"><span>Modo de tiro</span><select name="weaponFireMode" data-dhp-macro-fire-mode>${macroFireModeOptions}</select></label>
        <label class="dhp-macro-field"><span>Disparos (normal)</span><input type="number" name="weaponShots" min="1" max="20" value="${clamp(config.shots ?? 1, 1, 20)}"></label>
        <label class="dhp-macro-field"><span>Raio da área (m)</span><input type="number" name="weaponAreaRadius" min="1" max="100" value="${Math.max(1, safeNumber(config.areaRadius, 5))}"></label>
        <label class="dhp-macro-field"><span>Distância (m)</span><input type="number" name="weaponDistance" min="0" max="100000" step="0.5" value="${safeNumber(config.distance, 0)}"></label>
        <label class="dhp-macro-field"><span>Munição</span><select name="weaponAmmo">${ammunitionOptions}</select></label>
      </div>
      <p class="dhp-macro-help">Distância 0 tenta medir até o alvo selecionado. Explosivos usam o fluxo próprio de detonação do Arsenal.</p>
    </section>
    <div class="dhp-macro-footer-note"><i class="fas fa-info-circle"></i> O atalho será salvo na página e posição selecionadas da barra do Foundry.</div>
  </form>`;
}

function updateMacroComponentRow(actor, row, kind, selectedKey = "") {
  const keyChoice = row.querySelector("[data-dhp-component-choice]");
  const keySelect = row.querySelector("[data-dhp-component-key]");
  const fixed = row.querySelector("[data-dhp-component-fixed]");
  const isSelectable = kind === "attribute" || kind === "ability";
  if (keyChoice) keyChoice.style.display = isSelectable ? "" : "none";
  if (fixed) {
    fixed.style.display = isSelectable ? "none" : "flex";
    fixed.textContent = kind === "arete" ? `Arete da ficha: ${findAreteValue(actor)}` : kind === "willpower" ? `Força de Vontade da ficha: ${readWillpowerValue(actor)}` : `Paradoxo da ficha: ${readParadoxValue(actor)}`;
  }
  if (keySelect && isSelectable) keySelect.innerHTML = componentOptionsHtml(actor, kind, selectedKey);
  const number = row.parentElement ? [...row.parentElement.querySelectorAll("[data-dhp-macro-component]")].indexOf(row) + 1 : 1;
  const label = row.querySelector(".dhp-macro-row-number");
  if (label) label.textContent = String(number);
}

function updateMacroPoolPreview(actor, root) {
  const preview = root.querySelector("[data-dhp-pool-preview]");
  if (!preview) return;
  const rows = [...root.querySelectorAll("[data-dhp-macro-component]")];
  const total = rows.reduce((sum, row) => {
    const kind = row.querySelector("[data-dhp-component-kind]")?.value ?? "attribute";
    const key = row.querySelector("[data-dhp-component-key]")?.value ?? kind;
    return sum + traitComponentValue(actor, { kind, key });
  }, 0);
  const penalty = actorIgnoresPain(actor) ? 0 : actorHealthPenalty(actor);
  preview.textContent = `${clamp(Math.max(0, total + penalty), 0, 100)}d10`;
}

function bindMacroEditor(actor, root, dialog, configId) {
  const form = root?.matches?.(".dhp-macro-editor") ? root : root?.querySelector?.(".dhp-macro-editor");
  if (!form || form.dataset.dhpBound === "true") return;
  form.dataset.dhpBound = "true";
  const componentList = form.querySelector("[data-dhp-component-list]");

  const refreshRows = () => {
    componentList.querySelectorAll("[data-dhp-macro-component]").forEach((row) => {
      const kind = row.querySelector("[data-dhp-component-kind]")?.value ?? "attribute";
      const key = row.querySelector("[data-dhp-component-key]")?.value ?? "";
      updateMacroComponentRow(actor, row, kind, key);
    });
    updateMacroPoolPreview(actor, form);
  };

  form.addEventListener("click", (event) => {
    const add = event.target.closest("[data-dhp-add-component]");
    const remove = event.target.closest("[data-dhp-remove-component]");
    if (add) {
      event.preventDefault();
      componentList.insertAdjacentHTML("beforeend", renderMacroComponentRow(actor, { kind: "ability", key: "brawl" }));
      refreshRows();
    } else if (remove) {
      event.preventDefault();
      const row = remove.closest("[data-dhp-macro-component]");
      row?.remove();
      if (!componentList.querySelector("[data-dhp-macro-component]")) componentList.insertAdjacentHTML("beforeend", renderMacroComponentRow(actor, { kind: "attribute", key: "strength" }));
      refreshRows();
    }
  });
  form.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches("[data-dhp-component-kind]")) {
      const row = target.closest("[data-dhp-macro-component]");
      updateMacroComponentRow(actor, row, target.value, "");
      updateMacroPoolPreview(actor, form);
    } else if (target.matches("[data-dhp-component-key]")) {
      updateMacroPoolPreview(actor, form);
    } else if (target.matches('[name="macroMode"]')) {
      const mode = target.value;
      form.querySelectorAll("[data-dhp-mode-panel]").forEach((panel) => { panel.hidden = panel.dataset.dhpModePanel !== mode; });
    } else if (target.matches('[name="macroWeapon"]')) {
      const weapon = getWeapons(actor).find((entry) => entry.id === target.value);
      const modeSelect = form.querySelector('[name="weaponFireMode"]');
      if (modeSelect) {
        const previous = modeSelect.value;
        const automatic = weaponSupportsAutomatic(weapon);
        modeSelect.innerHTML = `<option value="normal">Disparo normal</option>${automatic ? '<option value="burst">Rajada de 3 tiros (+1 dif., +3d10)</option><option value="automatic">Automático - pente inteiro (+2 dif., +10d10)</option><option value="suppressive">Metralhar área (+2 dif., +10d10 distribuídos)</option>' : ''}`;
        modeSelect.value = automatic ? previous : "normal";
        if (automatic && ![...modeSelect.options].some((option) => option.value === previous)) modeSelect.value = "normal";
      }
    } else if (target.matches('[name="macroPage"]')) {
      const slotSelect = form.querySelector('[name="macroSlot"]');
      if (slotSelect) {
        const currentSlot = Number(slotSelect.value || 1);
        slotSelect.innerHTML = macroSlotOptionsHtml(currentSlot, clamp(target.value, 1, 5));
        slotSelect.value = String(currentSlot);
      }
    }
  });
  refreshRows();
}

function collectMacroForm(form, actor, root, oldConfig = {}) {
  const name = String(form.querySelector('[name="macroName"]')?.value ?? "").trim();
  const slot = clamp(form.querySelector('[name="macroSlot"]')?.value ?? 1, 1, 10);
  const page = clamp(form.querySelector('[name="macroPage"]')?.value ?? 1, 1, 5);
  const mode = form.querySelector('[name="macroMode"]')?.value ?? "pool";
  const config = { ...oldConfig, name, slot, page, mode };
  if (mode === "pool") {
    config.components = [...form.querySelectorAll("[data-dhp-macro-component]")].map((row) => ({
      kind: row.querySelector("[data-dhp-component-kind]")?.value ?? "attribute",
      key: row.querySelector("[data-dhp-component-key]")?.value ?? ""
    }));
    config.difficulty = clamp(form.querySelector('[name="poolDifficulty"]')?.value ?? 6, 2, 10);
  } else if (mode === "magic") {
    config.spheres = [...form.querySelectorAll("[data-dhp-sphere]:checked")].map((input) => input.value);
    config.magicTraits = [...form.querySelectorAll("[data-dhp-magic-trait]:checked")].map((input) => input.value);
    config.difficulty = clamp(form.querySelector('[name="magicDifficulty"]')?.value ?? 6, 2, 10);
    if (!config.magicTraits.length) return { error: "Marque Arete, Força de Vontade ou Paradoxo para definir o que será rolado." };
  } else if (mode === "rote") {
    config.roteItemId = form.querySelector('[name="macroRote"]')?.value ?? "";
    const rote = actor.items?.get?.(config.roteItemId) ?? actor.items?.find?.((item) => item.id === config.roteItemId);
    if (!rote || String(rote.type).toLowerCase() !== "rote") return { error: "Selecione uma rotina (Rote) válida cadastrada nesta ficha." };
  } else if (mode === "weapon") {
    config.weaponId = form.querySelector('[name="macroWeapon"]')?.value ?? "";
    config.fireMode = form.querySelector('[name="weaponFireMode"]')?.value ?? "normal";
    config.shots = clamp(form.querySelector('[name="weaponShots"]')?.value ?? 1, 1, 20);
    config.areaRadius = clamp(form.querySelector('[name="weaponAreaRadius"]')?.value ?? 5, 1, 100);
    config.distance = Math.max(0, safeNumber(form.querySelector('[name="weaponDistance"]')?.value, 0));
    config.ammoType = form.querySelector('[name="weaponAmmo"]')?.value ?? "standard";
    const chosenWeapon = getWeapons(actor).find((entry) => entry.id === config.weaponId);
    if (!weaponSupportsAutomatic(chosenWeapon)) config.fireMode = "normal";
  }
  return config;
}

function makeConfiguredMacroScript(actorUuid, configId) {
  return `// Dravent - macro de rolagem configurada na ficha.\nconst api = game.modules.get("${MODULE_ID}")?.api;\nif (!api?.executeConfiguredMacro) ui.notifications.error("A API de macros do Dravent não está disponível.");\nelse await api.executeConfiguredMacro({ actorUuid: ${JSON.stringify(actorUuid)}, configId: ${JSON.stringify(configId)} });`;
}

function confirmMacroSlotReplacement(slot, page, existing) {
  return new Promise((resolve) => {
    new Dialog({
      title: "Substituir atalho?",
      content: `<p>O atalho ${slot === 10 ? "0" : slot}, página ${page}, já contém <strong>${escapeHtml(existing?.name ?? "uma macro")}</strong>. Deseja substituí-lo?</p>`,
      buttons: { yes: { label: "Substituir", callback: () => resolve(true) }, no: { label: "Cancelar", callback: () => resolve(false) } },
      default: "no", close: () => resolve(false)
    }).render(true);
  });
}

async function saveConfiguredMacro(actor, config, oldConfig = {}) {
  if (!actor?.isOwner) { ui.notifications.warn("Você precisa ter permissão para editar esta ficha."); return false; }
  if (!config.name) { ui.notifications.warn("Digite um nome para a macro."); return false; }
  if (config.mode === "pool" && (!config.components?.length || config.components.some((component) => !component.kind || ((component.kind === "attribute" || component.kind === "ability") && !component.key)))) {
    ui.notifications.warn("Adicione pelo menos um atributo ou habilidade à rolagem."); return false;
  }
  if (config.mode === "weapon" && !config.weaponId) { ui.notifications.warn("Cadastre ou selecione uma arma no Arsenal Dravent."); return false; }
  if (config.mode === "magic" && !config.magicTraits?.length) { ui.notifications.warn("Selecione pelo menos uma característica para rolar."); return false; }
  if (config.mode === "rote" && !config.roteItemId) { ui.notifications.warn("Selecione uma rotina (Rote) desta ficha."); return false; }
  const page = clamp(config.page ?? 1, 1, 5);
  const existingAtSlot = hotbarMacroAt(config.slot, page);
  const sameMacro = oldConfig.macroId && existingAtSlot?.id === oldConfig.macroId;
  if (existingAtSlot && !sameMacro) {
    const confirmed = await confirmMacroSlotReplacement(config.slot, page, existingAtSlot);
    if (!confirmed) return false;
  }

  const configs = getMacroConfigs(actor);
  const id = oldConfig.id ?? foundry.utils.randomID();
  config.id = id;
  config.macroId = oldConfig.macroId ?? null;
  config.createdAt = oldConfig.createdAt ?? Date.now();
  config.updatedAt = Date.now();
  const index = configs.findIndex((entry) => entry.id === id);
  if (index >= 0) configs[index] = config;
  else configs.push(config);

  let macro = config.macroId ? game.macros?.get(config.macroId) : null;
  const macroData = {
    name: `Dravent · ${config.name}`.slice(0, 64), type: "script", img: "icons/svg/d10-grey.svg",
    command: makeConfiguredMacroScript(actor.uuid, id)
  };
  if (macro) {
    await macro.update(macroData);
  } else {
    macro = await Macro.create(macroData);
    if (!macro) { ui.notifications.error("O Foundry não conseguiu criar a macro."); return false; }
    config.macroId = macro.id;
    const finalIndex = configs.findIndex((entry) => entry.id === id);
    if (finalIndex >= 0) configs[finalIndex] = config;
  }
  await actor.setFlag(MODULE_ID, "macroConfigs", configs);
  const absoluteSlot = ((page - 1) * 10) + clamp(config.slot, 1, 10);
  if (typeof game.user.assignHotbarMacro === "function") {
    const previousSlot = oldConfig.macroId === macro.id
      ? (((clamp(oldConfig.page ?? 1, 1, 5) - 1) * 10) + clamp(oldConfig.slot ?? 1, 1, 10))
      : null;
    if (previousSlot && previousSlot !== absoluteSlot) await game.user.assignHotbarMacro(macro, absoluteSlot, previousSlot);
    else await game.user.assignHotbarMacro(macro, absoluteSlot);
  } else if (typeof ui.hotbar?.assignMacro === "function") await ui.hotbar.assignMacro(macro, absoluteSlot);
  else { ui.notifications.error("Esta versão do Foundry não disponibilizou a API para atribuir macros à barra."); return false; }
  try { ui.hotbar?.changePage?.(page); } catch (error) { console.debug(`${MODULE_ID} | Could not switch hotbar page`, error); }
  ui.notifications.info(`Macro “${config.name}” atribuída ao atalho ${config.slot === 10 ? "0" : config.slot}, página ${page}.`);
  return true;
}

function openMacroEditor(actor, root, config = null) {
  const oldConfig = config ? deepClone(config) : {};
  const content = buildMacroEditorContent(actor, root, oldConfig);
  let dialog;
  dialog = new Dialog({
    title: oldConfig.id ? `Editar macro · ${oldConfig.name}` : "Criar macro de rolagem",
    content,
    buttons: {
      save: { label: "Salvar e atribuir atalho", close: false, callback: async (html) => {
        const form = asElement(html) ?? dialog.element?.querySelector(".dhp-macro-editor")?.parentElement;
        const editorForm = form?.matches?.(".dhp-macro-editor") ? form : form?.querySelector?.(".dhp-macro-editor") ?? dialog.element?.querySelector(".dhp-macro-editor");
        if (!editorForm) return;
        const next = collectMacroForm(editorForm, actor, root, oldConfig);
        if (next.error) { ui.notifications.warn(next.error); return; }
        const saved = await saveConfiguredMacro(actor, next, oldConfig);
        if (saved) { dialog.close(); openMacroManager(actor, root); }
      } },
      cancel: { label: "Cancelar" }
    },
    default: "save",
    render: (html) => {
      const pane = asElement(html) ?? dialog.element;
      pane?.closest?.(".app, .window-app, .application")?.classList.add("dhp-macro-dialog");
      bindMacroEditor(actor, pane, dialog, oldConfig.id);
    }
  }, { width: 720, height: "auto", resizable: true });
  dialog.render(true);
}

async function deleteConfiguredMacro(actor, config) {
  const confirmed = await new Promise((resolve) => {
    new Dialog({
      title: "Excluir macro?",
      content: `<p>Excluir <strong>${escapeHtml(config.name)}</strong> e remover sua configuração Dravent?</p>`,
      buttons: { yes: { label: "Excluir", callback: () => resolve(true) }, no: { label: "Cancelar", callback: () => resolve(false) } },
      default: "no", close: () => resolve(false)
    }).render(true);
  });
  if (!confirmed) return;
  const configs = getMacroConfigs(actor).filter((entry) => entry.id !== config.id);
  await actor.setFlag(MODULE_ID, "macroConfigs", configs);
  const macro = config.macroId ? game.macros?.get(config.macroId) : null;
  if (macro && macro.isOwner) await macro.delete();
}

function openMacroManager(actor, root) {
  const contentForManager = () => {
    const configs = getMacroConfigs(actor);
    const rows = configs.length ? configs.map((config) => `<article class="dhp-macro-saved-row" data-dhp-saved-macro="${escapeHtml(config.id)}">
      <div class="dhp-macro-saved-icon"><i class="fas ${config.mode === "weapon" ? "fa-crosshairs" : config.mode === "magic" ? "fa-sparkles" : config.mode === "sheet" || config.mode === "rote" ? "fa-book-open" : "fa-dice-d10"}"></i></div>
      <div class="dhp-macro-saved-details"><strong>${escapeHtml(config.name)}</strong><span>${escapeHtml(macroModeLabel(config.mode))} · Atalho ${config.slot === 10 ? "0" : config.slot ?? "-"} · Página ${config.page ?? 1}</span></div>
      <button type="button" data-dhp-edit-macro="${escapeHtml(config.id)}"><i class="fas fa-pen"></i> Editar</button>
      <button type="button" class="dhp-macro-delete" data-dhp-delete-macro="${escapeHtml(config.id)}" title="Excluir macro"><i class="fas fa-trash"></i></button>
    </article>`).join("") : `<div class="dhp-macro-empty"><i class="fas fa-dice-d10"></i><strong>Nenhuma macro criada</strong><p>Crie uma combinação de atributos, um teste de Mágika, uma rotina da ficha ou um ataque de arma.</p></div>`;
    return `<div class="dhp-macro-manager"><div class="dhp-macro-intro"><div class="dhp-macro-intro-icon"><i class="fas fa-sliders-h"></i></div><div><h3>Macros de rolagem</h3><p>Configure o que cada atalho de 1 a 0 deve rolar. Não é necessário escrever código.</p></div></div>
      <div class="dhp-macro-saved-list">${rows}</div>
      <button type="button" class="dhp-macro-new" data-dhp-new-macro><i class="fas fa-plus-circle"></i> Criar nova macro</button>
      <div class="dhp-macro-footer-note"><i class="fas fa-info-circle"></i> Combinações de atributos/habilidades viram uma só parada. Testes de Mágika rolam cada característica marcada em separado. Rotinas usam o botão nativo do WoD20; ataques usam o Arsenal Dravent.</div></div>`;
  };
  let manager;
  manager = new Dialog({
    title: `Macros · ${actor.name}`,
    content: contentForManager(),
    buttons: { close: { label: "Fechar" } },
    render: (html) => {
      const pane = asElement(html) ?? manager.element;
      pane?.closest?.(".app, .window-app, .application")?.classList.add("dhp-macro-dialog");
      pane?.querySelectorAll("[data-dhp-edit-macro]").forEach((button) => button.addEventListener("click", async (event) => {
        event.preventDefault();
        const config = getMacroConfigs(actor).find((entry) => entry.id === button.dataset.dhpEditMacro);
        if (!config) return;
        manager.close(); openMacroEditor(actor, root, config);
      }));
      pane?.querySelectorAll("[data-dhp-delete-macro]").forEach((button) => button.addEventListener("click", async (event) => {
        event.preventDefault();
        const config = getMacroConfigs(actor).find((entry) => entry.id === button.dataset.dhpDeleteMacro);
        if (!config) return;
        await deleteConfiguredMacro(actor, config);
        manager.close(); openMacroManager(actor, root);
      }));
      pane?.querySelector("[data-dhp-new-macro]")?.addEventListener("click", (event) => {
        event.preventDefault(); manager.close(); openMacroEditor(actor, root, null);
      });
    }
  }, { width: 700, height: "auto", resizable: true });
  manager.render(true);
}

// O editor de macros é aberto pela ferramenta própria da bandeja lateral do Foundry,
// para não ocupar espaço da ficha de personagem.

async function executeSheetAction(descriptor) {
  const actor = await fromUuid(descriptor?.actorUuid);
  if (!actor) return ui.notifications.error("A ficha desta macro não foi encontrada.");
  let app = Object.values(ui.windows ?? {}).find((candidate) => resolveActor(candidate)?.uuid === actor.uuid && candidate.rendered !== false);
  if (!app) {
    actor.sheet?.render(true);
    await new Promise((resolve) => setTimeout(resolve, 450));
    app = Object.values(ui.windows ?? {}).find((candidate) => resolveActor(candidate)?.uuid === actor.uuid && candidate.rendered !== false);
  }
  let root = app ? asElement(app.element, app) : null;
  if (!root) return ui.notifications.error("Não consegui abrir a ficha para executar a ação.");
  if (descriptor.tab) {
    const tabControl = root.querySelector(`.tabs [data-tab="${cssAttributeValue(descriptor.tab)}"], .sheet-navigation [data-tab="${cssAttributeValue(descriptor.tab)}"]`);
    if (tabControl && tabControl.getAttribute("aria-selected") !== "true") {
      tabControl.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      root = asElement(app.element, app) ?? root;
    }
  }
  const target = root.querySelector(descriptor.selector);
  if (!target) return ui.notifications.warn(`A ação “${descriptor.label ?? "selecionada"}” não existe mais na ficha. Edite a macro para atualizá-la.`);
  if (target.matches("button:disabled, [aria-disabled='true']")) return ui.notifications.warn("Esta ação está indisponível no momento.");
  target.click();
}

function traitMacroResolutionHtml(actor, config, roll, results, resolution, pool, penalty) {
  const components = config.components.map((component) => {
    const label = component.kind === "attribute" ? listTraitOptions(actor, "attribute").find((entry) => normalized(entry.key) === normalized(component.key))?.label ?? component.key
      : component.kind === "ability" ? listTraitOptions(actor, "ability").find((entry) => normalized(entry.key) === normalized(component.key))?.label ?? component.key
      : component.kind === "arete" ? "Arete" : "Força de Vontade";
    return { label, value: traitComponentValue(actor, component) };
  });
  const parts = components.map((component) => `${escapeHtml(component.label)} ${component.value}`).join(" + ");
  return `<div class="dhp-chat-card dhp-macro-roll-card"><header><strong>${escapeHtml(actor.name)} · ${escapeHtml(config.name)}</strong><span class="dhp-mini-badge">Rolagem combinada</span></header>
    <div class="dhp-attack-meta">${parts}${penalty ? ` · Penalidade de Vitalidade ${penalty}` : ""} = ${pool}d10 · dificuldade ${config.difficulty}</div>
    <div class="dhp-success-count">Sucessos <strong>${resolution.successes}</strong></div>
    ${compactRollLine("Dados", results, resolution, config.difficulty)}
    <div class="dhp-damage-total"><span>Valor dos sucessos</span><strong>${resolution.contribution}</strong></div>
  </div>`;
}

async function executeTraitMacro(actor, config) {
  const components = config.components ?? [];
  if (!components.length) return ui.notifications.warn("Esta macro não tem componentes. Edite-a para adicionar um atributo ou habilidade.");
  const breakdown = components.map((component) => ({ label: component.kind, value: traitComponentValue(actor, component) }));
  const rawPool = breakdown.reduce((sum, entry) => sum + entry.value, 0);
  const penalty = actorIgnoresPain(actor) ? 0 : actorHealthPenalty(actor);
  const pool = clamp(Math.max(0, rawPool + penalty), 0, 100);
  if (pool <= 0) return ui.notifications.warn("A parada desta macro é 0 dados.");
  const difficulty = clamp(config.difficulty ?? 6, 2, 10);
  const roll = await evaluateRoll(`${pool}d10`);
  const results = diceResults(roll);
  const resolution = rollSuccesses(results, difficulty);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: traitMacroResolutionHtml(actor, { ...config, difficulty }, roll, results, resolution, pool, penalty),
    rolls: [roll],
    flags: { [MODULE_ID]: { macroRoll: true, macroId: config.id, actorUuid: actor.uuid, pool, difficulty, results, resolution } }
  });
}

async function executeMagicMacro(actor, config) {
  const difficulty = clamp(config.difficulty ?? 6, 2, 10);
  const traits = [
    { key: "arete", label: "Arete", value: findAreteValue(actor) },
    { key: "willpower", label: "Força de Vontade", value: readWillpowerValue(actor) },
    { key: "paradox", label: "Paradoxo", value: readParadoxValue(actor) }
  ].filter((trait) => (config.magicTraits ?? ["arete"]).includes(trait.key));
  if (!traits.length) return ui.notifications.warn("Esta macro não seleciona Arete, Força de Vontade ou Paradoxo.");
  const penalty = actorIgnoresPain(actor) ? 0 : actorHealthPenalty(actor);
  const rolled = [];
  for (const trait of traits) {
    const isTraitSubjectToWoundPenalty = trait.key === "arete";
    const pool = clamp(Math.max(0, trait.value + (isTraitSubjectToWoundPenalty ? penalty : 0)), 0, 100);
    if (pool <= 0) {
      rolled.push({ ...trait, pool, results: [], resolution: { successes: 0, contribution: 0 }, roll: null, skipped: true });
      continue;
    }
    const roll = await evaluateRoll(`${pool}d10`);
    const results = diceResults(roll);
    const resolution = rollSuccesses(results, difficulty);
    rolled.push({ ...trait, pool, results, resolution, roll, skipped: false });
  }
  const spheres = (config.spheres ?? []).map((key) => {
    const sphere = MACRO_SPHERES.find((entry) => entry.key === key);
    return sphere ? `${sphere.label} ${findSphereValue(actor, key)}` : key;
  });
  const blocks = rolled.map((entry) => `<section class="dhp-macro-magic-result">
    <header><strong>${escapeHtml(entry.label)}</strong><span class="dhp-mini-badge">${entry.pool}d10</span></header>
    ${entry.skipped ? `<p class="dhp-macro-warning">Esta característica está em 0; não houve rolagem.</p>` : `<div class="dhp-success-count">Sucessos <strong>${entry.resolution.successes}</strong></div>${compactRollLine("Dados", entry.results, entry.resolution, difficulty)}<div class="dhp-damage-total"><span>Valor dos sucessos</span><strong>${entry.resolution.contribution}</strong></div>`}
  </section>`).join("");
  const content = `<div class="dhp-chat-card dhp-macro-roll-card"><header><strong>${escapeHtml(actor.name)} · ${escapeHtml(config.name)}</strong><span class="dhp-mini-badge">Teste de Mágika</span></header>
    <div class="dhp-attack-meta">Dificuldade ${difficulty}${penalty ? ` · Penalidade de Vitalidade ${penalty} aplicada somente ao Arete` : ""}</div>
    ${spheres.length ? `<div class="dhp-macro-sphere-result"><strong>Esferas</strong>${spheres.map((sphere) => `<span>${escapeHtml(sphere)}</span>`).join("")}</div>` : ""}
    <div class="dhp-macro-magic-results">${blocks}</div>
  </div>`;
  const rolls = rolled.filter((entry) => entry.roll).map((entry) => entry.roll);
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, rolls, flags: { [MODULE_ID]: { macroRoll: true, macroMagic: true, macroId: config.id, actorUuid: actor.uuid, magicTraits: rolled.map(({key, label, value, pool, results, resolution, skipped}) => ({key,label,value,pool,results,resolution,skipped})), spheres: config.spheres ?? [], difficulty } } });
}

async function executeRoteMacro(actor, config) {
  const itemId = config.roteItemId;
  const item = actor.items?.get?.(itemId) ?? actor.items?.find?.((candidate) => candidate.id === itemId);
  if (!item || !listActorRotes(actor).some((entry) => entry.id === item.id)) {
    return ui.notifications.warn("A rotina selecionada não existe mais na ficha. Edite a macro e escolha outra rotina.");
  }
  let app = Object.values(ui.windows ?? {}).find((candidate) => resolveActor(candidate)?.uuid === actor.uuid && candidate.rendered !== false);
  if (!app) {
    await actor.sheet?.render?.(true);
    await new Promise((resolve) => setTimeout(resolve, 450));
    app = Object.values(ui.windows ?? {}).find((candidate) => resolveActor(candidate)?.uuid === actor.uuid && candidate.rendered !== false);
  }
  let root = app ? asElement(app.element, app) : null;
  if (!root) return ui.notifications.error("Não consegui abrir a ficha para executar a rotina nativa.");
  const selector = `.vrollable[data-rollitem="true"][data-itemid="${cssAttributeValue(item.id)}"]`;
  let control = root.querySelector(selector);
  if (!control) {
    // A aba de Mágika às vezes monta a linha da rotina apenas depois de ativada.
    const magicTab = root.querySelector('.tabs [data-tab="magic"], .sheet-navigation [data-tab="magic"]');
    if (magicTab) {
      magicTab.click();
      await new Promise((resolve) => setTimeout(resolve, 180));
      root = asElement(app.element, app) ?? root;
      control = root.querySelector(selector);
    }
  }
  if (!control) return ui.notifications.warn(`A rotina “${item.name}” existe, mas o controle nativo não foi encontrado na ficha. Abra a aba Mágika e tente novamente.`);
  control.click();
}

async function executeConfiguredMacro(descriptor) {
  const actor = await fromUuid(descriptor?.actorUuid);
  if (!actor) return ui.notifications.error("A ficha desta macro não foi encontrada.");
  const config = getMacroConfigs(actor).find((entry) => entry.id === descriptor?.configId);
  if (!config) return ui.notifications.error("A configuração desta macro não foi encontrada. Abra a ficha e salve novamente a macro.");
  if (config.mode === "pool") return executeTraitMacro(actor, config);
  if (config.mode === "magic") return executeMagicMacro(actor, config);
  if (config.mode === "rote") return executeRoteMacro(actor, config);
  if (config.mode === "sheet") {
    if (!config.action?.selector) return ui.notifications.warn("A macro não tem uma rotina/ação configurada. Edite-a para escolher uma ação da ficha.");
    return executeSheetAction({ actorUuid: actor.uuid, ...config.action });
  }
  if (config.mode === "weapon") return fireWeapon(actor, config.weaponId, null, { shots: config.shots, fireMode: config.fireMode, areaRadius: config.areaRadius, distance: config.distance, ammoType: config.ammoType });
}

function exposeMacroApi() {
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = { ...(module.api ?? {}), executeSheetAction, executeConfiguredMacro, executeRoteMacro };
}

function currentMacroActor() {
  const controlled = [...(globalThis.canvas?.tokens?.controlled ?? [])]
    .map((token) => token.actor)
    .find((actor) => isWoDActor(actor) && actor.isOwner);
  if (controlled) return controlled;
  const activeApplication = Object.values(ui.windows ?? {}).find((candidate) => candidate?.rendered !== false && candidate?.element?.contains?.(document.activeElement));
  const activeActor = resolveActor(activeApplication);
  if (activeActor && isWoDActor(activeActor) && activeActor.isOwner) return activeActor;
  const character = game.user?.character;
  if (character && isWoDActor(character) && character.isOwner) return character;
  return null;
}

function openMacroManagerFromSidebar() {
  // Foundry may activate the control and its default tool on the same click.
  // Debounce those paired callbacks so they do not open two copies of the manager.
  const now = Date.now();
  if (now - macroManagerLastOpenedAt < 350) return;
  macroManagerLastOpenedAt = now;
  window.setTimeout(() => {
    if (Date.now() - macroManagerLastOpenedAt >= 350) macroManagerLastOpenedAt = 0;
  }, 380);
  const current = currentMacroActor();
  if (current) return openMacroManager(current, null);
  const candidates = [...(game.actors ?? [])].filter((actor) => isWoDActor(actor) && actor.isOwner);
  if (!candidates.length) {
    ui.notifications.warn("Selecione um token de personagem ou associe um personagem ao seu usuário para abrir as macros Dravent.");
    return;
  }
  if (candidates.length === 1) return openMacroManager(candidates[0], null);
  const options = candidates.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((actor) => `<option value="${escapeHtml(actor.uuid)}">${escapeHtml(actor.name)}</option>`).join("");
  let picker;
  picker = new Dialog({
    title: "Macros de rolagem Dravent",
    content: `<div class="dhp-macro-picker"><p>Escolha a ficha cujas macros deseja editar.</p><label>Personagem<select name="dhpMacroActor">${options}</select></label></div>`,
    buttons: {
      open: { label: "Abrir macros", callback: (html) => {
        const element = asElement(html) ?? picker.element;
        const uuid = element?.querySelector('[name="dhpMacroActor"]')?.value;
        const actor = candidates.find((candidate) => candidate.uuid === uuid);
        if (actor) openMacroManager(actor, null);
      } },
      cancel: { label: "Cancelar" }
    },
    default: "open"
  }, { width: 420, height: "auto" });
  picker.render(true);
}

function registerMacroSceneControl(controls) {
  if (game.system?.id !== SYSTEM_ID || !controls || typeof controls !== "object") return;
  if (controls.draventMacros) return;
  const maxOrder = Math.max(-1, ...Object.values(controls).map((control) => Number(control?.order ?? -1)));
  const open = () => openMacroManagerFromSidebar();
  controls.draventMacros = {
    name: "draventMacros",
    title: "Macros de rolagem Dravent",
    icon: "fa-solid fa-dice-d10",
    order: maxOrder + 1,
    visible: true,
    // The layer button opens the manager directly. A tool entry provides a reliable fallback
    // in Foundry builds that expect every control group to have at least one tool.
    activeTool: "openMacroManager",
    onChange: (_event, active) => { if (active) open(); },
    tools: {
      openMacroManager: {
        name: "openMacroManager",
        title: "Editar macros de rolagem",
        icon: "fa-solid fa-sliders",
        order: 0,
        button: true,
        onChange: (_event, active) => { if (active) open(); }
      }
    }
  };
}

function addVitalityOptionToTokenConfig(app, html) {
  const token = app?.document ?? app?.object;
  const actor = token?.actor ?? token?.baseActor;
  if (!isPlayerCharacterActor(actor)) return;
  const root = asElement(html, app);
  if (!root) return;
  for (const select of root.querySelectorAll('select[name="bar1.attribute"], select[name="bar2.attribute"]')) {
    let option = [...select.options].find((entry) => entry.value === "draventVitalidade");
    if (!option) {
      option = document.createElement("option");
      option.value = "draventVitalidade";
      option.textContent = "Vida %";
      select.append(option);
    } else option.textContent = "Vida %";
    const desired = token?.[select.name.split(".")[0]]?.attribute;
    if (desired === "draventVitalidade") select.value = desired;
  }
}

async function rollStandaloneAbsorption(actor, type = "B", difficulty = 6, incomingDamage = 0) {
  if (!actor || !actor.isOwner) return ui.notifications.warn("Você não tem permissão para rolar absorção desta ficha.");
  await ensureHealthFlags(actor);
  const typeKey = damageTypeSystemKey(type);
  const pool = soakPoolFor(actor, type, "general", false);
  if (pool <= 0) return ui.notifications.warn(`A ficha de ${actor.name} não possui dados de absorção para ${damageTypeLabel(type)}.`);
  const roll = await evaluateRoll(`${pool}d10`);
  const results = diceResults(roll);
  const resolution = rollSuccesses(results, difficulty);
  const rawReduction = resolution.contribution;
  const reduction = incomingDamage > 0 ? Math.min(incomingDamage, rawReduction) : rawReduction;
  const unit = isAbsoluteHealthActor(actor) ? "PV" : "%";
  const content = `<div class="dhp-chat-card dhp-defense-card dhp-standalone-soak"><header><strong>Absorção · ${escapeHtml(actor.name)}</strong></header><div class="dhp-roll-meta">${pool}d10 · ${escapeHtml(damageTypeLabel(type))} · dificuldade ${difficulty}${incomingDamage > 0 ? ` · dano recebido ${incomingDamage} ${unit}` : ""}</div><div class="dhp-success-count">Sucessos <strong>${resolution.successes}</strong></div>${renderDiceStrip(results, resolution, difficulty)}${cancellationNote(resolution)}<div class="dhp-contribution">Redução por absorção <strong>${reduction} ${unit}</strong></div>${incomingDamage > 0 ? `<div class="dhp-defense-summary"><div><span>Dano antes</span><strong>${incomingDamage} ${unit}</strong></div><div><span>Dano restante</span><strong>${Math.max(0, incomingDamage - reduction)} ${unit}</strong></div></div>` : ""}</div>`;
  await ChatMessage.create({speaker: ChatMessage.getSpeaker({actor}), content, rolls:[roll], flags:{[MODULE_ID]:{standaloneSoak:true, actorId:actor.id, damageType:typeKey, pool, difficulty, results, successes:resolution.successes, contribution:rawReduction, reduction, incomingDamage}}});
}

function openStandaloneAbsorption(actor) {
  const content = `<form class="dhp-defender-picker dhp-standalone-soak-form"><p>A rolagem usa os dados de absorção da ficha, incluindo armadura equipada, com cancelamento Dravent por resultados 1.</p><label>Tipo de dano<select name="dhpSoakType"><option value="B">Contusão</option><option value="L" selected>Letal</option><option value="A">Agravado</option></select></label><label>Dificuldade<input type="number" min="2" max="10" name="dhpSoakDifficulty" value="6"></label><label>Dano recebido (opcional)<input type="number" min="0" max="1000000000" name="dhpIncomingDamage" value="0"></label></form>`;
  if (foundry.applications?.api?.DialogV2?.wait) {
    return foundry.applications.api.DialogV2.wait({
      window: {title: `Absorção - ${actor.name}`}, content,
      buttons: [
        {action:"roll", label:"Rolar absorção", default:true, callback:(_event, button, dialog) => {
          const form = dialog.element.querySelector("form");
          void rollStandaloneAbsorption(actor, form.elements.dhpSoakType.value, clamp(form.elements.dhpSoakDifficulty.value,2,10), clampInt(form.elements.dhpIncomingDamage.value,0,1_000_000_000));
        }},
        {action:"cancel", label:"Cancelar"}
      ], default:"roll"
    });
  }
  const typeOptions = `<option value="B">Contusão</option><option value="L" selected>Letal</option><option value="A">Agravado</option>`;
  return new Promise((resolve) => {
    let dialog;
    dialog = new Dialog({title:`Absorção - ${actor.name}`, content:`<form class="dhp-standalone-soak-form"><label>Tipo de dano<select name="dhpSoakType">${typeOptions}</select></label><label>Dificuldade<input type="number" min="2" max="10" name="dhpSoakDifficulty" value="6"></label><label>Dano recebido (opcional)<input type="number" min="0" name="dhpIncomingDamage" value="0"></label></form>`, buttons:{roll:{label:"Rolar absorção", callback:html=>{const root=asElement(html)??dialog.element;const form=root.querySelector("form");void rollStandaloneAbsorption(actor,form.elements.dhpSoakType.value,clamp(form.elements.dhpSoakDifficulty.value,2,10),clampInt(form.elements.dhpIncomingDamage.value,0,1_000_000_000));resolve(true);}},cancel:{label:"Cancelar",callback:()=>resolve(false)}}, default:"roll", close:()=>resolve(false)}, {width:420,height:"auto"});
    dialog.render(true);
  });
}

function bindGeneralSoakIntercept(root, actor) {
  if (!root || root.dataset.dhpSoakInterceptBound === "true") return;
  root.dataset.dhpSoakInterceptBound = "true";
  root.addEventListener("click", (event) => {
    const control = event.target.closest('[data-rollsoak="true"], [data-rollsoak="True"], [data-roll-soak="true"]');
    if (!control || !root.contains(control)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void openStandaloneAbsorption(actor);
  }, true);
}


let globalSoakInterceptorInstalled = false;
function installGlobalSoakInterceptor() {
  if (globalSoakInterceptorInstalled || !globalThis.document) return;
  globalSoakInterceptorInstalled = true;
  const selector = '[data-rollsoak], [data-roll-soak], [data-action="soak"], [data-action="rollSoak"]';
  document.addEventListener("click", (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const control = path.find((node) => node instanceof Element && node.matches(selector))
      ?? (event.target instanceof Element ? event.target.closest(selector) : null);
    if (!control) return;
    const soakFlag = control.dataset?.rollsoak ?? control.dataset?.rollSoak ?? control.dataset?.rollSoak;
    const action = normalized(control.dataset?.action ?? "");
    const isSoak = ["true", "1", "yes"].includes(normalized(soakFlag)) || action === "soak" || action === "rollsoak";
    if (!isSoak) return;
    const sheetRoot = control.closest("[data-dhp-actor-uuid]");
    if (!sheetRoot) return;
    const actorUuid = sheetRoot.dataset.dhpActorUuid;
    if (!actorUuid) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void fromUuid(actorUuid).then((actor) => {
      if (!actor || !isWoDActor(actor)) return ui.notifications.warn("Não foi possível identificar a ficha para rolar absorção Dravent.");
      return openStandaloneAbsorption(actor);
    }).catch((error) => {
      console.error(`${MODULE_ID} | Falha ao abrir absorção Dravent.`, error);
      ui.notifications.error("Não foi possível abrir a rolagem de absorção Dravent.");
    });
  }, true);
}

async function onActorSheetRender(app, html) {
  if (game.system?.id !== SYSTEM_ID) return;
  const actor = resolveActor(app);
  if (!actor || !isWoDActor(actor)) return;
  const root = asElement(html, app);
  if (!root) return;
  root.dataset.dhpActorUuid = actor.uuid;
  root.dataset.dhpActorId = actor.id;
  root.querySelectorAll(".dhp-sheet-macro-toolbar").forEach((element) => element.remove());
  void ensureHealthFlags(actor).then(() => refreshHealthPanels(actor));
  hideLegacyHealth(root);
  hideWoundPenaltyDescription(root);
  replaceLegacyVitalityStatus(root, actor);
  bindGeneralSoakIntercept(root, actor);
  placeHealthPanel(root, actor);
  placeArsenalPanel(root, actor);
  for (const delay of [80, 300, 700]) {
    setTimeout(() => {
      if (root.isConnected) replaceLegacyVitalityStatus(root, actor);
    }, delay);
  }
}

Hooks.once("init", () => {
  enforceDoubleTenSuccesses();
  game.settings.register(MODULE_ID, "replaceLegacyHealth", {
    name: "Substituir a trilha tradicional de ferimentos",
    hint: "Oculta os quadros antigos e, na primeira migração, guarda uma cópia dos contadores nas flags do módulo antes de zerá-los para desativar a trilha antiga.",
    scope: "world", config: true, type: Boolean, default: true
  });
});

Hooks.once("ready", async () => {
  if (game.system?.id !== SYSTEM_ID) {
    console.warn(`${MODULE_ID} | Sistema incompatível: ${game.system?.id ?? "desconhecido"}. Esperado ${SYSTEM_ID}.`);
    return;
  }
  enforceDoubleTenSuccesses();
  installGlobalSoakInterceptor();
  installTokenHealthAttribute();
  patchWoundPenaltyIntegration();
  exposeMacroApi();
  bindChatApplication();
  Hooks.on("renderItemSheet", patchArmorItemSheet);
  Hooks.on("renderItemSheetV2", patchArmorItemSheet);
  const normalizeArmorDocument = (item, changes = null) => {
    if (item?.type === "Armor" && game.system?.id === SYSTEM_ID && (game.user?.isGM || item.parent?.isOwner)) {
      void normalizeArmorMobility(item, changes).catch((error) => console.warn(`${MODULE_ID} | Falha ao normalizar mobilidade da armadura.`, error));
    }
  };
  Hooks.on("createItem", (item) => normalizeArmorDocument(item));
  Hooks.on("updateItem", (item, changes) => normalizeArmorDocument(item, changes));
  for (const actor of game.actors ?? []) {
    if (!isWoDActor(actor)) continue;
    if (game.user?.isGM || actor.isOwner) {
      for (const item of actor.items ?? []) {
        if (item.type === "Armor") {
          try { await normalizeArmorMobility(item); }
          catch (error) { console.warn(`${MODULE_ID} | Não foi possível migrar a penalidade de mobilidade da armadura ${item.name}.`, error); }
        }
      }
    }
    for (const item of actor.items ?? []) {
      if (["Natural Weapon", "Melee Weapon", "Ranged Weapon"].includes(item.type)) {
        const weapons = getWeapons(actor);
        if (!weapons.some((entry) => entry.sourceItemId === item.id)) await syncNativeWeaponToArsenal(item);
      }
    }
  }
  if (game.user.isGM) await syncAllTokenBars();
  console.log(`${MODULE_ID} | Vitalidade percentual e Arsenal Dravent inicializados.`);
});

Hooks.on("renderActorSheet", onActorSheetRender);
Hooks.on("renderActorSheetV2", onActorSheetRender);
Hooks.on("renderApplicationV2", onActorSheetRender);
Hooks.on("renderTokenConfig", addVitalityOptionToTokenConfig);
Hooks.on("getSceneControlButtons", registerMacroSceneControl);

Hooks.on("createToken", async (tokenDocument) => {
  if (!game.user.isGM) return;
  const actor = tokenDocument.actor ?? tokenDocument.baseActor;
  if (!isWoDActor(actor) || !isPlayerCharacterActor(actor)) return;
  await ensureHealthFlags(actor);
  await syncTokenBarsForActor(actor);
});

Hooks.on("createItem", (item) => {
  if (!["Natural Weapon", "Melee Weapon", "Ranged Weapon"].includes(item.type)) return;
  void syncNativeWeaponToArsenal(item);
});

Hooks.on("updateItem", (item) => {
  if (["Natural Weapon", "Melee Weapon", "Ranged Weapon"].includes(item.type)) {
    void syncNativeWeaponToArsenal(item);
  } else if (item.parent && isWoDActor(item.parent)) {
    void removeNativeWeaponFromArsenal(item);
  }
});

Hooks.on("deleteItem", (item) => {
  void removeNativeWeaponFromArsenal(item);
});

Hooks.on("updateActor", (actor, changes) => {
  if (!isWoDActor(actor)) return;
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.current`) || foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.max`) || foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.weapons`)) {
    refreshHealthPanels(actor);
    refreshLegacyVitalityStatus(actor);
    refreshArsenals(actor);
    void syncTokenBarsForActor(actor);
    if (actor.system?.health?.damage) {
      actor.system.health.damage.woundpenalty = actorHealthPenalty(actor);
      actor.system.health.damage.woundlevel = healthPercentLabel(healthValue(actor));
    }
    if (actor.system?.health) actor.system.health.woundlevel = healthPercentLabel(healthValue(actor));
  }
});
