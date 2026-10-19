# Changelog

## 0.13.1
- Recuperação baseada na versão 0.12.0 completa, preservando Arsenal, Vitalidade, armaduras, macros, manobras automáticas, defesas e estilos; a correção ficou limitada à autorização de defesa por alvo.
- O cartão do ataque registra IDs dos usuários que possuem o personagem-alvo, considerando personagem atribuído, permissões OWNER e atores vinculados/não vinculados.
- O jogador dono do alvo e o GM veem o botão imediatamente. Outros usuários continuam sem autorização, salvo ataques sem alvo único, cujo comportamento foi preservado.
- A ação valida permissões novamente antes de executar a defesa. A resolução de token sintético e ator-base usa caminhos alternativos e tratamento de erro para não interromper o carregamento do módulo.


## 0.12.0
- Esquiva agora usa sempre Destreza + Esportes/Atletismo, contra ataques à distância e corpo a corpo; a leitura da habilidade reconhece nomes canônicos e traduções possíveis.
- Corrigida a elegibilidade dos controles de defesa: o resultado efetivo da rolagem de ataque é a fonte da verdade, evitando omissões causadas por contadores passados incorretamente por macros ou manobras.
- Os cartões guardam UUID e ID do ator-alvo além do UUID do token. A verificação de permissão procura o token, o ator sintético e o ator-base, incluindo fichas PC e personagens associados ao usuário.
- Corrigida a resolução do defensor para aceitar token vinculado, token não vinculado e ator PC, mantendo o alvo do ataque como autoridade para Mágika e rotinas defensivas.
- A seleção da ação defensiva agora é lida do próprio cartão de ataque, sem consulta global ambígua que pudesse capturar outro cartão no chat.
- O botão de defesa continua ausente em ataques sem sucessos; em acertos, o controle é criado para todas as categorias de arma e só fica visível a quem pode defender aquele alvo (ou a todos quando não há alvo único).

## 0.11.0
- Corrigido o modo de Vitalidade: atores com propriedade OWNER de usuário não-GM usam 0-100%; atores controlados exclusivamente pelo GM usam PV atuais/máximos. A verificação respeita permissões explícitas e padrão.
- Corrigida a herança de metadados do catálogo para armas automáticas já adicionadas às fichas.
- Adicionadas manobras de rajada, automático e metralhar área às armas automáticas do catálogo e às macros. As macros agora salvam o modo de tiro e o raio da área.
- Corrigido o modo de edição de armas personalizadas para preservar o checkbox de arma automática.
- Corrigida a exibição de contribuição de dano em cartões, usando % para fichas de jogador e PV para fichas exclusivas do GM.
- Corrigido o cálculo de Destreza da defesa para que penalidades de armadura alterem a dificuldade, não a quantidade de dados.
- Interceptada a ação nativa de absorção do WoD20 em fase de captura para abrir a resolução de absorção Dravent e evitar o diálogo Soak legado nessa ação.
- Defesa mágica e rotina defensiva mantêm redução pelo valor absoluto dos dados válidos; sucessos automáticos sem valor de dado não acrescentam PV/% à redução.
- Ataque sem sucessos não gera dano da arma nem botão de defesa; os dados de ataque e os resultados 1 seguem o cancelamento Dravent, e 10 válido conta como dois sucessos.
- Para metralhar área, o pool compartilhado de dano é dividido pelos alvos uma vez; o bônus de +10d10 não é contado novamente em cada cartão individual.

## 0.10.0
- Introdução inicial de PV absolutos, catálogo de armaduras e defesa mágica vinculada à rolagem nativa. A versão 0.10.0 aplicava incorretamente PV absolutos às fichas de jogadores; isso foi corrigido na 0.11.0.

# Dravent 0.10.0

- A versão 0.10.0 aplicava incorretamente PV absolutos a fichas de jogadores; a escala correta de Vitalidade percentual para fichas com proprietário jogador foi restaurada na 0.11.0.
- O estado legado "Ileso" e equivalentes é substituído por Vida atual / máxima com percentual; há tentativas de atualização adicionais após a renderização V2.
- Corrigida a integração de rolagens nativas para preservar cancelamentos por parada de dados e somar o valor de face de cada dado bem-sucedido para a defesa mágica ou rotina defensiva.
- Corrigidas verificações de permissões para defesa e aplicação de dano, consultando token, ator sintético e ator base.
- Removidos seletores corporais antigos e reforçado o contraste do painel de proteção e do alvo.
- Ataques sem sucessos não rolam dano da arma e não exibem o botão de defesa.

## 0.8.0
- Adicionado catálogo de armaduras M20 e proteções complementares Dravent, com absorção separada para contusão, letal e agravado e com origem de cada item registrada.
- Equipamentos do catálogo são criados como itens Armor nativos do WoD20 e iniciam equipados; armaduras personalizadas existentes são preservadas. A penalidade de mobilidade fica em uma flag Dravent e o campo nativo `dexpenalty` é zerado para não reduzir outras paradas; o valor original é preservado em flag de reversão.
- Cobertura editável no formulário de armadura (corpo inteiro, cabeça, tronco, braços/mãos, pernas/pés ou escudo). Proteções sobrepostas não somam automaticamente: considera-se o melhor item compatível por tipo de dano. Escudo só soma absorção quando selecionado como defesa ativa.
- A penalidade negativa de armadura não remove dados da parada de defesa Dravent; sua magnitude aumenta a dificuldade da defesa, limitada a 10. Penalidades de vários equipamentos são acumuladas.
- Defesa ativa padrão usa Destreza + Prontidão contra armas de fogo/armas de longo alcance e Destreza + Briga contra ataques corpo a corpo, conforme a regra da mesa.
- Apenas o proprietário do ator-alvo e o Narrador podem visualizar e executar os botões de defesa e aplicação de dano; a permissão também é verificada no momento da ação.
- Todos os resultados 10 válidos nas rolagens nativas recebem um sucesso extra (dois no total). Os cartões nativos reorganizam visualmente os dados por 1s, falhas, sucessos e 10s, aplicam o cancelamento visual do maior dado por cada 1 e corrigem o total mostrado no cartão. O cancelamento personalizado em rolagens nativas é visual no cartão; algumas rotinas internas do WoD20 continuam usando o cálculo próprio do sistema.
- Nas rolagens do Dravent, os 10 válidos contam como dois sucessos; seu valor absoluto continua contribuindo uma única vez para o dano ou redução.
- Todo caractere de travessão longo foi substituído por hífen nos arquivos textuais do módulo.

# Changelog

## 0.7.0
- Removida a faixa grande de macros da ficha; o gerenciador agora é acessado pelo controle Dravent na bandeja lateral de ferramentas do Foundry.
- Removido o catálogo genérico e excessivo de ações clicáveis da ficha. A seleção de rotina agora lista apenas itens WoD20 do tipo Rote e executa o controle nativo correspondente.
- Ampliado o modo Teste de Mágika para marcar Arete, Força de Vontade e/ou Paradoxo como rolagens separadas, mantendo as Esferas como contexto do efeito.
- Adicionada seleção separada de Atalho (1–0) e Página (1–5), com atribuição aos 50 espaços disponíveis na hotbar do Foundry.
- O gerenciador identifica a página e o espaço escolhidos e alerta antes de substituir uma macro existente naquele destino.
- Mantida intacta a lógica de rolagem combinada de atributos e habilidades.
- Adicionado seletor de personagem ao abrir as macros pela bandeja quando não há um personagem único selecionado/associado.
- Removida a antiga referência visual ao criador de macros da ficha, incluindo remoção de faixas antigas durante renderização.
- Mantido o contraste branco do texto de Dano potencial e adicionados estilos para as opções de características mágicas e resultados agrupados.


## 0.6.0
- Substituído o seletor genérico de ações por um gerenciador de macros com criar, editar e excluir.
- Adicionado editor visual com componentes repetíveis para combinar Atributos, Habilidades, Arete e Força de Vontade em uma única parada de dados.
- Adicionado modo de teste de Mágika com rolagem de Arete e seleção de Esferas para contextualizar o resultado.
- Adicionado modo para executar rotinas/rolagens nativas detectadas na ficha e modo para atacar com arma do Arsenal Dravent.
- Adicionada atribuição de macro aos atalhos 1–0 e persistência da configuração na ficha/ator.
- Melhorado o contraste do rótulo e do valor de Dano potencial para branco.
- Ajustado o layout responsivo das linhas de componentes e dos modais do editor.
- Expandida a lista de Habilidades com as chaves canônicas do WoD20 v7.3.1 e rótulos legíveis em pt-BR; rótulos de campos nativos passam por localização.
- Melhorada a identificação textual de ações nativas com ícones (incluindo botões associados a itens/rotinas).

## 0.5.0
- Contraste dos painéis, dados d10 visuais, macros e barra Vida % para personagens-jogadores.
