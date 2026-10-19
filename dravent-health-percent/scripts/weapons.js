/**
 * Dravent Arms catalogue. These are conversion presets for the house rules,
 * not a verbatim reproduction of any published equipment table. Values are
 * editable after adding them to an actor's arsenal.
 */
const melee = (id, name, diff, dice, type = "L", notes = "") => ({
  id, name, category: "melee", damageMode: "strength", damageDice: dice, difficulty: diff,
  damageType: type, rangeM: 0, cadence: 1, ammoCapacity: null, ammoCurrent: null, areaM: 0, notes
});
const firearm = (id, name, dice, rangeM, cadence, ammo, notes = "") => ({
  id, name, category: "firearm", damageMode: "fixed", damageDice: dice, difficulty: dice,
  damageType: "L", rangeM, cadence, ammoCapacity: ammo, ammoCurrent: ammo, areaM: 0, notes
});
const thrown = (id, name, diff, dice, rangeM, type = "L", notes = "", mode = "strength") => ({
  id, name, category: "thrown", damageMode: mode, damageDice: dice, difficulty: diff,
  damageType: type, rangeM, cadence: 1, ammoCapacity: null, ammoCurrent: null, areaM: 0, notes
});
const bow = (id, name, dice, rangeM, notes = "") => ({
  id, name, category: "bow", damageMode: "fixed", damageDice: dice, difficulty: dice,
  damageType: "L", rangeM, cadence: 1, ammoCapacity: 99, ammoCurrent: 99, areaM: 0, notes
});
const heavy = (id, name, dice, difficulty, rangeM, cadence, ammo, type = "L", notes = "") => ({
  id, name, category: "heavy", damageMode: "fixed", damageDice: dice, difficulty,
  damageType: type, rangeM, cadence, ammoCapacity: ammo, ammoCurrent: ammo, areaM: 0, notes
});
const special = (id, name, dice, diff, rangeM, cadence, ammo, type = "B", notes = "") => ({
  id, name, category: "special", damageMode: "fixed", damageDice: dice, difficulty: diff,
  damageType: type, rangeM, cadence, ammoCapacity: ammo, ammoCurrent: ammo, areaM: 0, notes
});
const explosive = (id, name, dice, diff, rangeM, areaM, type, notes = "") => ({
  id, name, category: "explosive", damageMode: "fixed", damageDice: dice, difficulty: diff,
  damageType: type, rangeM, cadence: 1, ammoCapacity: 1, ammoCurrent: 1, areaM, notes
});

export const WEAPON_CATALOG = [
  // Corpo a corpo
  melee("hatchet", "Machadinha", 6, 1), melee("tomahawk-melee", "Tomahawk", 6, 2),
  melee("axe", "Machado", 7, 3), melee("great-axe", "Machado grande", 7, 6, "L", "Duas mãos; Força 3 sugerida."),
  melee("polearm", "Arma de haste", 7, 3, "L", "Duas mãos."), melee("stiletto", "Estilete", 4, 1, "L", "Pode reduzir a eficácia de proteções específicas, a critério do Narrador."),
  melee("knife", "Faca", 4, 1), melee("short-sword", "Espada curta", 5, 2),
  melee("sword", "Espada", 6, 2), melee("katana", "Katana", 6, 3, "L", "Duas mãos: +1d10 de dano nesta conversão."),
  melee("greatsword", "Espada grande", 5, 6, "L", "Duas mãos; Força 3 sugerida."), melee("sai", "Sai", 5, 1),
  melee("hook-sword", "Espada gancho", 7, 3), melee("baton", "Cassetete", 5, 1, "B"),
  melee("baseball-bat", "Taco de beisebol", 5, 2, "B"), melee("crowbar", "Pé de cabra", 6, 1, "L"),
  melee("staff", "Bastão", 6, 1, "B"), melee("iron-staff", "Bastão de ferro", 7, 3, "L"),
  melee("mace", "Maça", 6, 2), melee("nunchaku", "Nunchaku", 7, 2, "B"),
  melee("spiked-club", "Porrete com espinhos", 6, 2), melee("heavy-spiked-club", "Porrete grande com espinhos", 7, 4),
  melee("sap", "Sap / porrete flexível", 4, 1, "B"), melee("brass-knuckles", "Soqueira", 6, 0, "B"),
  melee("spiked-gauntlet", "Manopla com espinhos", 6, 1), melee("small-claws", "Garras pequenas", 6, 1),
  melee("large-claws", "Garras grandes", 6, 2), melee("katar", "Katar", 6, 2),
  melee("war-fan", "Leque de guerra", 5, 2), melee("wind-fire-wheels", "Roda de vento e fogo", 6, 3),
  melee("broken-bottle", "Garrafa quebrada", 6, 1), melee("chair", "Cadeira", 7, 2, "B"),
  melee("chainsaw", "Motosserra", 8, 7, "L", "Arma ruidosa; requer combustível e cuidados."),
  melee("table", "Mesa improvisada", 8, 3, "B"), melee("chain", "Corrente", 5, 0, "B"),
  melee("bladed-chain", "Corrente com lâmina", 6, 1), melee("kusarigama", "Kusarigama", 7, 3, "L"),
  melee("manrikigusari", "Manriki-gusari", 7, 2, "B"), melee("flogger", "Flogger", 6, 1, "B"),
  melee("barbed-whip", "Chicote farpado", 6, 0, "L"), melee("whip", "Chicote", 6, 0, "B"),
  melee("bullwhip", "Bullwhip", 7, 1, "B"),

  // Armas de arremesso
  thrown("throwing-knife", "Faca de arremesso", 6, 1, 10), thrown("shuriken", "Shuriken", 7, 3, 10, "L", "Dano fixo; não soma Força.", "fixed"),
  thrown("spear", "Lança arremessada", 6, 1, 12), thrown("stone", "Pedra", 5, 0, 10, "B"),
  thrown("large-stone", "Pedra grande", 5, 3, 8, "B"), thrown("throwing-hatchet", "Machadinha arremessada", 6, 1, 12),

  // Revólveres e pistolas
  firearm("revolver-38", "Revólver leve .38", 4, 12, 3, 6),
  firearm("revolver-44", "Revólver pesado .44 Magnum", 6, 35, 2, 6),
  firearm("pistol-9mm", "Pistola semiautomática 9 mm", 4, 20, 4, 17),
  firearm("pistol-45", "Pistola semiautomática .45", 5, 25, 3, 10),
  firearm("pistol-50ae", "Pistola pesada .50 AE", 5, 30, 3, 7),
  firearm("derringer", "Derringer", 4, 5, 1, 2), firearm("holdout-pistol", "Pistola compacta", 4, 10, 2, 8),

  // Submetralhadoras, fuzis e escopetas
  firearm("mac10", "SMG pequena / MAC-10", 4, 25, 3, 30), firearm("mp5", "SMG grande / MP5", 4, 50, 3, 30),
  firearm("uzi", "Uzi", 4, 30, 3, 32), firearm("ak47", "Fuzil de assalto / AK-47", 7, 150, 3, 30),
  firearm("m16", "Fuzil de assalto / M16", 7, 180, 3, 30), firearm("battle-rifle", "Fuzil de batalha", 8, 200, 2, 20),
  firearm("rifle-3006", "Rifle .30-06", 8, 200, 1, 5), firearm("sniper-rifle", "Rifle de precisão", 8, 500, 1, 5),
  firearm("hunting-rifle", "Rifle de caça", 6, 150, 1, 5), firearm("sawed-off", "Escopeta serrada", 8, 10, 2, 2),
  firearm("shotgun", "Escopeta", 8, 20, 1, 6), firearm("semi-shotgun", "Escopeta semiautomática", 8, 25, 3, 7),
  firearm("aa12", "Escopeta automática AA-12", 8, 50, 3, 32),

  // Arcos e bestas
  bow("shortbow", "Arco curto", 4, 60), bow("hunting-bow", "Arco de caça", 5, 100),
  bow("longbow", "Arco longo", 5, 120), bow("command-crossbow", "Besta compacta", 3, 20),
  bow("crossbow", "Besta", 5, 90), bow("heavy-crossbow", "Besta pesada", 6, 100),

  // Tecnocracia (valores de conversão editáveis)
  firearm("biggs-protector-r", "Biggs X-5 Model R Protector", 5, 40, 4, 12, "Arma Tecnocrática."),
  firearm("biggs-protector-a", "Biggs X-5 Model A Protector", 5, 40, 4, 13, "Arma Tecnocrática."),
  firearm("mjollner-mk4", "Biggs Mjollner Mk. IV", 10, 100, 1, 10, "Arma pesada; dificuldade inicial 10."),
  firearm("castle-graves-ww3", "Castle-Graves WW-3", 8, 200, 3, 51, "Arma Tecnocrática."),
  firearm("bolan-mk13", "Bolan Mk.13 Weapons System", 8, 150, 3, 42, "Plataforma de armas composta; confirme a munição com o Narrador."),
  firearm("hitmark-chain-gun", "HIT Mark Chain-Gun", 8, 150, 3, 200, "Arma pesada Tecnocrática."),

  // Armas militares pesadas
  heavy("mg-30", "Metralhadora .30", 12, 8, 800, 5, 100, "L", "Dificuldade calibrada para o teto de d10."),
  heavy("mg-50", "Metralhadora .50", 16, 9, 1000, 5, 200, "L", "Dificuldade calibrada para o teto de d10."),
  heavy("cannon-30mm", "Canhão de 30 mm", 15, 9, 1200, 2, 100, "L", "Dificuldade calibrada para o teto de d10."),
  heavy("m79", "Lança-granadas M-79", 6, 6, 400, 1, 1, "L", "Explosão localizada; use também as regras de área."),
  heavy("m19", "Lança-granadas M-19", 8, 8, 600, 2, 1, "L", "Explosão localizada; use também as regras de área."),
  heavy("flamethrower", "Lança-chamas", 3, 6, 60, 1, 5, "A", "Pode manter dano incendiário por turno."),
  heavy("rocket-launcher", "Lança-foguetes", 12, 8, 500, 1, 1, "L", "Usar regras de explosão para área; dificuldade calibrada para o teto de d10."),

  // Armas incapacitantes / especiais
  special("taser", "Taser", 5, 5, 5, 1, 1, "B", "Pode incapacitar além do dano."),
  special("pepper-spray", "Spray de pimenta / pacificação", 2, 5, 3, 1, 5, "B", "Pode impor penalidades de percepção e ataque."),
  special("tear-gas-projector", "Lançador de gás lacrimogêneo", 0, 6, 15, 1, 5, "B", "Dano numérico substituído por efeito de área e penalidades."),
  special("flamethrower-hand", "Dispositivo incendiário portátil", 4, 6, 8, 1, 1, "A", "Risco de incendiar o alvo e o ambiente."),

  // Explosivos
  explosive("flashbang", "Granada de atordoamento", 4, 6, 20, 3, "B", "Pode desorientar e atordoar; efeitos dependem da exposição."),
  explosive("concussion-grenade", "Granada de concussão", 8, 6, 20, 3, "B", "Dano por contusão e possível atordoamento."),
  explosive("fragmentation-grenade", "Granada de fragmentação", 12, 6, 20, 3, "L", "Dano de estilhaços."),
  explosive("smoke-grenade", "Granada de fumaça", 0, 6, 20, 5, "B", "Sem dano direto; cria cobertura visual."),
  explosive("toxic-gas-grenade", "Granada de gás tóxico", 0, 6, 20, 4, "A", "Resolva como exposição a gás e teste de resistência."),
  explosive("molotov", "Coquetel Molotov", 8, 6, 10, 2, "A", "Pode manter dano de fogo por turno."),
  explosive("dynamite", "Dinamite (carga padrão)", 6, 8, 5, 4, "L", "Dano varia com o número de cargas."),
  explosive("pipe-bomb", "Bomba improvisada", 8, 8, 5, 4, "L"),
  explosive("plastic-explosive", "Explosivo plástico (carga média)", 12, 8, 0, 4, "L", "A área e o dano dependem da quantidade empregada."),
  explosive("vehicle-bomb", "Carro-bomba", 20, 8, 0, 8, "L", "Explosão de grande porte; decisão do Narrador."),
  explosive("truck-bomb", "Bomba em caminhão", 30, 9, 0, 20, "L", "Explosão de grande porte; decisão do Narrador."),
  explosive("artillery-shell", "Projétil de artilharia", 25, 9, 1000, 10, "L", "Use somente em cenas militares; decisão do Narrador."),
];


// Presets with selectable/automatic fire. Other guns remain single-shot or semiautomatic.
const AUTOMATIC_WEAPON_IDS = new Set([
  "mac10", "mp5", "uzi", "ak47", "m16", "aa12",
  "castle-graves-ww3", "bolan-mk13", "hitmark-chain-gun", "mg-30", "mg-50"
]);
for (const weapon of WEAPON_CATALOG) {
  if (AUTOMATIC_WEAPON_IDS.has(weapon.id)) weapon.automatic = true;
}

export function cloneCatalogWeapon(template) {
  const copy = foundry.utils.deepClone(template);
  copy.catalogId = template.id;
  copy.id = `${copy.id}-${foundry.utils.randomID(5)}`;
  copy.ammoCurrent = copy.ammoCapacity;
  return copy;
}
