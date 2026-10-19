// Catálogo de proteção do Dravent para World of Darkness 20th Edition.
// As classificações M20 são preservadas como referência; os pools por tipo de dano
// são uma conversão da regra caseira de Vitalidade percentual do Dravent.
function armorTemplate(id, name, rating, dexPenalty, coverage, source, description = "", category = "Armadura") {
  const level = Math.max(0, Number(rating) || 0);
  const soak = {
    bashing: level,
    lethal: Math.max(0, level - 1),
    aggravated: Math.max(0, level - 2)
  };
  return {
    id, name, rating: level, dexPenalty: Number(dexPenalty) || 0,
    coverage: Array.isArray(coverage) ? coverage : [coverage],
    source, category, soak,
    description: description || `Proteção ${level}. Absorção Dravent: ${soak.bashing}d10 contusão, ${soak.lethal}d10 letal e ${soak.aggravated}d10 agravado. Valores por tipo de dano são conversão caseira Dravent.`
  };
}

const m20 = (id, name, rating, dexPenalty, coverage, desc = "") => armorTemplate(
  id, name, rating, dexPenalty, coverage, "M20 - Armaduras e Escudos, pág. 446", desc, "Referência M20"
);
const custom = (id, name, rating, dexPenalty, coverage, desc = "") => armorTemplate(
  id, name, rating, dexPenalty, coverage, "Adaptação Dravent - equipamento complementar", desc, "Adaptação Dravent"
);

export const ARMOR_CATALOG = [
  // Armaduras e escudos enumerados na tabela de Mago: A Ascensão 20º Aniversário.
  m20("alanson-armor", "Armadura Alanson", 7, -2, "full", "Traje tecnocrático hipertecnológico de corpo inteiro. A ficha oficial descreve servo-motores e redução de mobilidade; veja também Apêndice II."),
  ...[1, 2, 3, 4].map((r) => m20(`cybernetic-armor-${r}`, `Armadura cibernética - nível ${r}`, r, 0, "full", "Proteção incorporada ao corpo. A graduação exata depende do aprimoramento instalado.")),
  m20("full-plate", "Armadura completa", 5, -2, "full", "Armadura de cavaleiro articulada."),
  m20("cosplay-mail", "Armadura de cosplay", 2, -1, "full", "Armadura de aparência, normalmente usada em performances."),
  m20("military-armor", "Armadura militar", 5, -2, "full", "Conjunto completo de armadura de batalha moderna."),
  m20("antiadhesive-coat", "Colete flak (antiestilhaços)", 4, -2, "torso", "Nome conforme a tradução da tabela consultada. Confira a referência e adapte a descrição à variante da sua crônica."),
  m20("kevlar-vest", "Colete de Kevlar", 3, -1, "torso", "Proteção balística de torso; não protege automaticamente cabeça ou membros."),
  ...[1, 2, 3].map((r) => m20(`tough-hide-${r}`, `Couro resistente - nível ${r}`, r, 0, "full", "Pele espessa ou blindada de animal, familiar, construto ou metamorfo.")),
  m20("chainmail", "Cota de malha", 4, -2, "full", "Armadura de elos adequada a combate."),
  m20("motorcycle-jacket", "Jaqueta de motociclista", 1, -1, ["torso", "arms"], "Jaqueta grossa e resistente."),
  m20("steel-breastplate", "Peitoral de aço", 3, -2, "torso", "Peça rígida de proteção do tronco."),
  ...[1, 2, 3, 4, 5].map((r) => m20(`enchanted-clothes-${r}`, `Roupas encantadas - nível ${r}`, r, 0, "full", "Roupas aparentemente comuns modificadas por Matéria. A absorção é a conversão Dravent da graduação escolhida.")),
  ...[1, 2].map((r) => m20(`reinforced-clothes-${r}`, `Roupas reforçadas - nível ${r}`, r, 0, "full", "Roupa endurecida, acolchoada ou revestida com proteção fina.")),
  m20("leather-duster", "Sobretudo de couro", 2, -2, ["torso", "arms"], "Sobretudo de couro resistente. Não equivale a uma capa comum de tecido."),
  m20("riot-suit", "Traje antimotim", 4, -2, "full", "Armadura corporal pesada usada em operações policiais."),
  m20("riot-shield", "Escudo antimotim", 5, -1, "shield", "Escudo pesado com visor. A cobertura só conta quando o escudo é escolhido como região interceptada na resolução do ataque."),
  m20("wooden-shield", "Escudo de madeira", 2, -1, "shield", "Escudo de madeira adequado a combate ou reencenação histórica."),
  m20("metal-shield", "Escudo de metal", 4, -2, "shield", "Escudo de metal. A penalidade de mobilidade é acumulada com outros equipamentos usados."),
  m20("trash-can-lid", "Tampa de lata de lixo", 3, 0, "shield", "Proteção improvisada, utilizável como escudo quando efetivamente interposta."),

  // Complementos plausíveis que não são linhas próprias na tabela principal M20.
  custom("helmet-motorcycle", "Capacete de motociclista", 2, -1, "head", "Adaptação Dravent. Protege a cabeça; não substitui a proteção de tronco."),
  custom("helmet-ballistic", "Capacete balístico", 3, -1, "head", "Adaptação Dravent. Proteção de cabeça para uso tático."),
  custom("helmet-military", "Capacete militar", 2, -1, "head", "Adaptação Dravent. Proteção rígida de cabeça."),
  custom("chain-coif", "Coifa de malha", 2, -1, "head", "Adaptação Dravent. Proteção de cabeça e parte do pescoço."),
  custom("neck-guard", "Protetor de pescoço", 1, 0, "neck", "Adaptação Dravent. Proteção localizada no pescoço."),
  custom("plate-carrier", "Colete com placas balísticas", 4, -2, "torso", "Adaptação Dravent. Proteção de torso com placas rígidas."),
  custom("fragmentation-vest", "Colete antiestilhaços leve", 2, -1, "torso", "Adaptação Dravent. Proteção de torso contra impactos e fragmentos, não equivalente a placa balística pesada."),
  custom("bomb-disposal-suit", "Traje antibombas", 5, -3, "full", "Adaptação Dravent. Proteção volumosa para desativação de explosivos; penalidade de mobilidade elevada."),
  custom("heavy-leather-cloak", "Capa grossa de couro", 1, -1, ["torso", "arms"], "Adaptação Dravent. Proteção modesta em áreas cobertas. Não protege uma região que fique exposta ao ataque."),
  custom("cloth-cape", "Capa comum", 0, 0, ["torso", "arms"], "Capa ornamental de tecido, sem absorção passiva significativa. Pode servir de foco ou proteção improvisada a critério do Narrador."),
  custom("arm-guards", "Braçadeiras reforçadas", 1, 0, "arms", "Adaptação Dravent. Proteção localizada nos braços e antebraços."),
  custom("gauntlets", "Manoplas reforçadas", 1, 0, "arms", "Adaptação Dravent. Proteção localizada nas mãos e antebraços."),
  custom("elbow-pads", "Cotoveleiras", 1, 0, "arms", "Adaptação Dravent. Proteção localizada nos cotovelos."),
  custom("knee-shin-guards", "Joelheiras e caneleiras", 1, 0, "legs", "Adaptação Dravent. Proteção localizada nos joelhos e pernas."),
  custom("reinforced-boots", "Botas reforçadas", 1, 0, "legs", "Adaptação Dravent. Proteção localizada nos pés e canelas."),
  custom("light-tactical-suit", "Traje tático leve", 2, -1, "full", "Adaptação Dravent. Proteção leve distribuída pelo corpo."),
  custom("heavy-tactical-suit", "Traje tático pesado", 4, -2, "full", "Adaptação Dravent. Proteção pesada com mobilidade reduzida.")
];

export function armorCatalogOptions() {
  const groups = new Map();
  for (const armor of ARMOR_CATALOG) {
    if (!groups.has(armor.category)) groups.set(armor.category, []);
    groups.get(armor.category).push(armor);
  }
  return [...groups.entries()].map(([label, items]) => `<optgroup label="${label}">${items.map((armor) =>
    `<option value="${armor.id}">${armor.name} - ${armor.soak.bashing}/${armor.soak.lethal}/${armor.soak.aggravated} d10</option>`
  ).join("")}</optgroup>`).join("");
}
