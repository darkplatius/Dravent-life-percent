# Dravent - Vida, Combate e Macros (WoD20)

**Titular do projeto:** Gleison Cardoso, Mestre Platius  
**Projeto:** Dravent Health Percent

**Versão:** 0.13.1  
**Sistema-alvo:** World of Darkness 20th Edition (`worldofdarkness`) v7.3.1  
**Foundry VTT:** v14

## 0.12.0 - Correção de esquiva e controles de defesa

- Esquiva usa Destreza + Esportes/Atletismo em toda situação, conforme regra Dravent.
- Cartões de ataque determinam acerto a partir dos sucessos resolvidos e criam os controles de defesa para todas as categorias de arma quando há acerto.
- A checagem de acesso considera token alvo, ator sintético, ator-base, UUID/ID e o personagem associado ao usuário; somente o dono do alvo ou o GM vê/usa a defesa quando há alvo definido.
- A ação defensiva é lida do próprio cartão, evitando escolher o modo de defesa de outro ataque no chat.


## 0.11.0 - Correções de combate e Vitalidade

- Fichas com proprietário não-GM continuam usando Vitalidade percentual; PV absolutos ficam restritos a fichas sem proprietário jogador, controladas pelo GM.
- Adicionadas manobras de rajada, automático de pente inteiro e metralhar área a armas automáticas do catálogo e às macros. O editor persiste modo de tiro e raio de área.
- Corrigida a leitura de dados nativos do WoD20 quando o dado de dez é apresentado visualmente como 0.
- Interceptada a ação de absorção nativa do WoD20 para usar o cálculo Dravent: cancelamento por 1, soma dos valores absolutos válidos e respeito à armadura.
- Defesa ativa e defesa mágica reduzem dano pelo valor absoluto dos dados válidos; sucessos automáticos sem face de dado não acrescentam redução.
- Corrigida a identificação de armas automáticas já armazenadas e a edição do checkbox de armas personalizadas.
- Os cartões exibem a unidade conforme o alvo (% ou PV). Ataques sem sucessos não geram dano de arma nem oferecem o botão de defesa.

## Histórico 0.10.0 - Defesa mágica e transição de Vitalidade

- Corrige a referência ausente `actorIgnoresPain` que interrompia ataques e algumas macros.
- Ao escolher Defesa mágica no cartão do ataque, abre a área nativa de Mágika/Poderes da ficha. O jogador decide qual efeito lançar e executa sua rolagem normal do WoD20.
- A rolagem nativa do alvo recebe uma ação para vinculá-la à defesa pendente. A soma dos valores de face dos dados válidos reduz o dano. A unidade final depende do alvo: % para ficha com proprietário jogador e PV para ficha controlada exclusivamente pelo GM. Um 10 conta como dois sucessos, mas contribui uma única vez com o valor 10. Sucessos automáticos sem dado não acrescentam valor absoluto à redução.
- Removida a seleção de parte do corpo durante ataques. Os ataques usam resolução geral; os equipamentos protetores equipados contribuem com seus dados de absorção por tipo de dano, enquanto as penalidades de mobilidade acumuladas aumentam a dificuldade das defesas. Escudos só contribuem quando escolhidos como bloqueio ativo.
- Mantidas as verificações de permissão para que somente o proprietário do alvo ou o Narrador resolva a defesa e aplique o dano.

## 0.8.0 - armaduras e regras opcionais de rolagem

A aba Combate mantém o Arsenal e acrescenta um seletor compacto de proteções e armaduras. O catálogo inclui itens da tabela de armaduras e escudos do M20 e adaptações Dravent para capacetes, protetores parciais e traje antibombas. A origem fica no campo Referência do item. Os valores de absorção do catálogo usam uma conversão caseira: contusão = graduação de referência; letal = graduação menos 1; agravado = graduação menos 2, nunca abaixo de zero. Isso não substitui os valores oficiais dos livros.

Itens adicionados pelo catálogo são criados como itens Armor nativos e iniciam equipados. A penalidade de mobilidade fica em uma flag Dravent própria e o campo nativo do WoD20 é zerado para evitar redução de outras paradas de dados. Armaduras existentes são migradas de forma reversível: o valor nativo original fica em `flags.dravent-health-percent.originalDexterityPenalty`, e a magnitude de mobilidade em `flags.dravent-health-percent.mobilityPenalty`. No editor de armadura, o módulo mostra o valor como penalidade de mobilidade e permite registrar a cobertura informativa. Ataques são resolvidos como rolagens gerais, sem selecionar cabeça, tronco ou membros. A dificuldade de defesa soma as penalidades de mobilidade equipadas e não passa de 10. A absorção considera os d10 dos equipamentos protetores equipados por tipo de dano; um escudo só contribui quando a defesa ativa escolhida é Bloqueio com escudo.

As regras opcionais de rolagem do Dravent tratam cada 10 válido como dois sucessos. Em cada rolagem da regra da casa, cada 1 cancela o maior resultado que não seja outro 1, incluindo um 10; se um 10 for cancelado, ele não conta como sucessos nem como crítico. Os cartões de chat nativos recebem organização visual e total de sucessos ajustado. O total interno retornado por algumas rotinas proprietárias do sistema WoD20 ainda depende do cálculo nativo do sistema; a correção de cancelamento de maior dado aplicada pelo Dravent é feita nos cartões exibidos, enquanto ataques realizados pelo Arsenal Dravent calculam essa regra diretamente.


## Novidades da versão 0.7.0 - Macros pela bandeja do Foundry

O gerenciador de macros é aberto pelo novo controle **Macros de rolagem Dravent** na bandeja lateral de ferramentas. O botão/banner antigo foi removido da ficha.

Ao criar ou editar uma macro, configure **Atalho** e **Página** em seletores separados. O Foundry mantém dez posições por página e cinco páginas; a configuração é atribuída à posição correta da barra.

Tipos disponíveis:

- **Rolagem combinada:** soma atributos e habilidades em uma única parada de dados (comportamento preservado).
- **Teste de Mágika:** selecione Arete, Força de Vontade e/ou Paradoxo para rolagens independentes; selecione as Esferas para registrá-las como contexto do efeito.
- **Rotina da ficha (Rote):** lista apenas rotinas WoD20 pertencentes ao personagem e dispara a ação nativa da ficha.
- **Ataque de arma:** utiliza uma arma cadastrada no Arsenal Dravent.

A lista de ações genéricas da ficha foi removida para evitar itens irrelevantes e duplicados. O Paradoxo é lido dos campos de dados que o módulo consegue reconhecer; se não houver um valor numérico identificável no ator, aparecerá como 0 dados até a estrutura da ficha ser mapeada.

---


## Funcionalidades preservadas e atualizadas

A versão 0.11.0 preserva o combate, o editor visual de macros e o catálogo de armaduras. Fichas com proprietário jogador usam Vitalidade de 0 a 100%; fichas controladas exclusivamente pelo GM usam PV atuais/máximos. As barras dos tokens de jogadores mostram o percentual calculado. O editor permite combinar componentes da ficha, selecionar características separadas para testes de Mágika, disparar rotinas nativas do tipo Rote e atacar com armas do Arsenal. O texto de Dano potencial permanece com contraste branco explícito.

- Corrige também a ficha legada de Mago: quando a folha do sistema renderiza o rótulo nativo de estado (por exemplo, “Incapacitado”) sob “Vitalidade”, o módulo substitui esse texto pelo percentual atual e o atualiza ao aplicar dano ou cura. Adiciona uma barra de Vitalidade de **0 a 100%** à aba Bio. A interface exibe o percentual sem rótulos de estado, sem a linha de penalidade e sem o texto explicativo sob a barra; o rótulo nativo de ferimentos também passa a mostrar o percentual. Os campos de dano, cura e definição da Vitalidade aceitam Enter além dos botões. Em fichas legadas de Mago, procura posicioná-la depois dos detalhes do personagem e antes do bloco de Paradigma; nas fichas novas, coloca-a após a área inicial de identidade/detalhes.
- Persiste a Vitalidade na flag `flags.dravent-health-percent.current` do Actor e disponibiliza o valor como recurso `draventVitalidade`. Para atores do tipo `PC`, a barra 1 do token protótipo e dos tokens associados usa o mesmo percentual da ficha; a configuração de token oferece a opção `Vida %`. A sincronização de barras não altera tokens de NPCs/outros tipos. O token exibe o nível como barra de 0 a 100; não desenha um número permanente sobre a imagem do token.
- Oculta visualmente a trilha tradicional de ferimentos e troca a penalidade derivada pela faixa percentual. As rolagens básicas do sistema passam a receber a penalidade configurada; as rolagens do Arsenal também aplicam essa penalidade diretamente.
- Na primeira migração, estima o percentual a partir dos ferimentos existentes quando possível, guarda uma cópia de `system.health.damage` em `flags.dravent-health-percent.legacyHealthBackup` e zera os contadores antigos para que não continuem gerando a penalidade original. O sistema base não é editado.
- Adiciona o Arsenal Dravent à aba Combate: catálogo de armas, armas personalizadas, importação de armas vinculadas à ficha, munição e recarga. O painel é inserido em largura total, com controles e formulário de edição responsivos para evitar cortes em fichas de larguras diferentes.
- Faz ataques com **Destreza efetiva + habilidade apropriada**, usando valores derivados do WoD20 quando disponíveis; a penalidade de Vitalidade continua afetando a parada de dados.
- Converte dano baseado em Força para `Força + Xd10` e dano fixo para `Xd10`. Nas armas comuns de fogo, a dificuldade-base corresponde ao dano original. Armas pesadas usam dificuldades configuradas para permanecer compatíveis com o teto de 10 em rolagens d10.
- A cadência limita quantos disparos podem ser selecionados. Cada disparo tem rolagem própria; a dificuldade-base não aumenta automaticamente com a cadência.
- Quando uma arma à distância ultrapassa seu alcance efetivo, reduz os dados de dano pela metade uma única vez (arredondando para baixo, mínimo de 1d10) e acrescenta +1 à dificuldade por cada 10 metros completos além do alcance.
- Converte em dano percentual os valores absolutos dos dados bem-sucedidos do ataque, somados aos dados bem-sucedidos da arma e ao bônus fixo de Força quando aplicável. Os dados de dano da arma e os dados críticos usam dificuldade 6.
- Regra da casa para resultados 1: no ataque e na defesa/absorção, cada 1 cancela o maior dado restante da mesma rolagem, mesmo que seja 10; cada 1 adicional cancela o próximo maior. Os dados cancelados não contam para sucessos nem para o dano. Um 10 cancelado no ataque não gera crítico. Exceção: dados de dano da arma e dados críticos não cancelam outros resultados com um 1.
- Críticos não encadeados são gerados apenas por resultados 10 que sobreviverem ao cancelamento na rolagem de ataque: Contusão +1d10, Letal +2d10, Agravado +3d10. Os dados críticos são rolados uma vez e seus sucessos são somados pelo valor absoluto, sem cancelamento por 1.
- Gera cartões compactos no chat, com dados d10 apresentados visualmente, contagem de sucessos e informação de cancelamento apenas quando aplicável. O alvo pode selecionar Esquiva, Aparar, Defesa corporal, Bloqueio com escudo ou Defesa mágica. A defesa mágica abre a área de Mágika/Poderes da ficha e usa a rolagem nativa que o jogador escolher.
- A defesa não cancela acertos do atacante: a soma dos valores dos dados bem-sucedidos da defesa reduz o dano potencial. Em seguida, o módulo rola a parada de absorção do WoD20 para o tipo de dano recebido; essa parada usa os dados de absorção calculados pelo sistema, incluindo armadura equipada e bônus/condições habilitados. A redução total não pode deixar dano negativo.
- A ficha só recebe dano depois que a defesa e a absorção foram roladas. O segundo cartão mostra o dano potencial, redução pela defesa, redução por absorção, dano efetivo e Vitalidade projetada; o botão final aplica apenas o dano efetivo.
- Explosivos fazem uma rolagem de arremesso contra dificuldade e geram cartões de defesa individuais para os tokens dentro do raio. Quando o arremesso erra, o módulo informa que não simulou a dispersão e deixa o ponto de queda a critério do Narrador.
- Disponibiliza seleção de munições especiais: comum, borracha, Teflon, flechette, explosiva, incendiária e disruptor ectoplasmático. Os efeitos além do dano numérico continuam dependendo do Narrador.
- Inclui presets para corpo a corpo, arremesso, armas de fogo, arcos e bestas, Tecnocracia, armas militares pesadas, armas especiais e explosivos. Os presets são editáveis e servem como conversões para esta mesa, não como transcrição integral dos livros.

## Instalação

1. Faça uma cópia de segurança do mundo, principalmente se for ativar a substituição em uma campanha existente.
2. Extraia a pasta `dravent-health-percent` para `Data/modules/`.
3. Confirme que o caminho final é `Data/modules/dravent-health-percent/module.json`.
4. Reinicie o Foundry ou atualize os pacotes.
5. Abra o mundo, vá a **Configuração → Gerenciar módulos** e ative **Dravent - Vida Percentual e Combate (WoD20)**.
6. Entre em uma ficha e confira as abas Bio e Combate.

## Uso do Arsenal

Na aba **Combate**, selecione uma arma e clique **Adicionar**. Para uma arma personalizada que só pertença ao Arsenal, use **Arma personalizada**. O botão extra **Criar item WoD20** foi removido do Arsenal: crie itens pelo fluxo nativo da ficha/sistema; armas naturais, corpo a corpo e à distância criadas ou alteradas pelo sistema são sincronizadas automaticamente com o Arsenal. **Importar existentes** faz uma importação manual de itens anteriores.

Selecione o token-alvo no Foundry, informe a distância em metros quando necessário e escolha a quantidade de disparos (até a cadência). Cada disparo recebe sua própria rolagem. A munição é reduzida conforme o número de disparos, e pode ser recarregada pelo botão da arma.

Para um explosivo, selecione o token que marca o centro pretendido da explosão e clique **Detonar**. O personagem realiza um ataque de arremesso usando Destreza + Atletismo. Em caso de erro, o módulo não calcula dispersão automática; o Narrador decide onde o explosivo caiu. Em caso de acerto, os tokens no raio definido recebem cartões individuais com botão de defesa e absorção. O módulo não simula movimento para sair do raio, cobertura, linha de visão nem dispersão automática.

## Editor visual de macros

Na ficha, abra **Editar macros**. A tela apresenta as macros salvas e permite criar, editar ou excluir uma configuração, sem escrever JavaScript.

- **Rolagem combinada:** cada linha adicionada em **Adicionar componente da ficha** contribui com seu valor para uma única parada. Por exemplo, Força 3 + Briga 2 produz 5d10. É possível adicionar Atributos, Habilidades, Arete e Força de Vontade. A dificuldade é configurável. O resultado usa os dados d10 visuais do Dravent e mostra os sucessos e os dados rolados.
- **Teste de Mágika:** rola a parada de Arete da ficha. As Esferas marcadas são exibidas no cartão do chat como contexto do efeito; os níveis das Esferas não são somados à parada de Arete.
- **Rotina / rolagem nativa:** seleciona uma ação clicável detectada na ficha e executa o controle original do WoD20. A disponibilidade depende de a folha expor a rotina/poder como um controle rolável detectável.
- **Ataque com arma:** seleciona uma arma do Arsenal Dravent. O atalho executa o fluxo de ataque, munição, dano percentual e defesa do módulo. A macro usa o alvo selecionado no Foundry; distância 0 tenta medi-la no mapa.

Cada macro possui nome e atalho de 1 a 0. A lista de Habilidades usa os campos que a ficha realmente fornece e apresenta rótulos em português; ações com ícones tentam ser identificadas pelo nome do item associado. Salvar cria ou atualiza uma Macro Script do Foundry e a atribui ao atalho escolhido. Macros configuradas ficam vinculadas ao ator da ficha. Se o sistema mudar os controles nativos de uma rotina, edite a macro e selecione a ação novamente.

## Regras de ataque, defesa e dano percentual

- A rolagem de ataque usa a parada da arma. Cada dado bem-sucedido contribui com seu valor de face para o dano potencial.
- Nas rolagens de ataque e defesa/absorção, cada 1 cancela o maior resultado não-1 da mesma rolagem, mesmo que seja 10; múltiplos 1 cancelam sucessivamente os maiores resultados restantes. Os 1 não podem cancelar a si próprios. Exceção: nas rolagens de dano da arma e de dados críticos, 1 não cancela outro dado; apenas fica abaixo da dificuldade.
- Os dados de dano da arma são rolados separadamente; cada resultado bem-sucedido (dificuldade 6) contribui com seu valor absoluto. Os resultados 1 nessa rolagem não cancelam outros dados; apenas ficam abaixo da dificuldade. O bônus fixo de Força é somado quando a arma está configurada como Força + Xd10.
- **Contusão:** cada 10 de ataque que sobreviver aos cancelamentos gera +1d10 crítico. **Letal:** gera +2d10. **Agravado:** gera +3d10. Dados críticos não geram novos críticos e, como dados de dano, resultados 1 não cancelam outros dados.
- A defesa física usa a parada associada à ação escolhida e aplica as penalidades de mobilidade como aumento de dificuldade. Cada dado bem-sucedido contribui com seu valor de face como redução de dano; os sucessos não anulam diretamente os acertos do atacante.
- Na defesa mágica, o jogador escolhe e executa o efeito pela área nativa de Mágika/Poderes do WoD20. Ao vincular a rolagem à defesa, a soma dos valores de face dos dados válidos reduz o dano em PV absolutos, limitada ao dano recebido. Um 10 vale dois sucessos para a contagem, mas contribui apenas 10 PV; sucessos automáticos sem dado não acrescentam PV à redução. Se ainda houver dano, a absorção dos equipamentos é rolada depois.
- A absorção considera os equipamentos protetores equipados por tipo de dano. Os d10 bem-sucedidos somam seus valores absolutos para reduzir o dano percentual. O escudo só soma proteção quando selecionado como bloqueio ativo.
- Faixas de penalidade atuais: 100–86% = 0; 85–72% = −1; 71–58% = −1; 57–44% = −2; 43–30% = −2; 29–1% = −5; 0% = incapacitado. Estas faixas podem ser revistas conforme os testes da campanha.
- Em disparos múltiplos, cada tiro recebe sua própria rolagem e mantém a dificuldade-base, acrescida apenas das penalidades de alcance. A cadência limita o número de tiros selecionáveis, não aumenta automaticamente a dificuldade.

## Compatibilidade e limitações

- O módulo é complementar ao sistema `worldofdarkness` e não modifica seus arquivos.
- Com **Substituir a trilha tradicional de ferimentos** ativada (padrão), o módulo salva o objeto original dos contadores em `flags.dravent-health-percent.legacyHealthBackup` e zera os contadores antigos durante a migração. Para restaurar manualmente, copie o backup de volta para `system.health.damage`. **Faça backup do mundo antes da primeira ativação.**
- Atores WoD20 com proprietário não-GM no nível OWNER, incluindo fichas de Mago, Vampiro, Mortal e outras fichas possuídas por jogadores, usam Vitalidade de 0 a 100%. Atores sem proprietário jogador, controlados exclusivamente pelo GM, usam Vida atual / Vida máxima em PV absolutos. A barra 1 dos tokens mostra `Vida %`, calculada pela razão entre vida atual e máxima. Para preservar a barra 1 de um token específico, use a flag `flags.dravent-health-percent.preserveBar1=true` no Token.
- Os efeitos secundários de munição, incapacitação por gás/taser, proteção, cobertura, dispersão e esquiva de explosões ainda exigem resolução do Narrador em alguns casos. O módulo não pretende converter automaticamente todas as regras mágicas do WoD20 nesta versão.
- Os valores dos presets são uma proposta de conversão para as regras da mesa; revise-os antes do uso em jogo.
- Verificações estáticas realizadas para esta versão: sintaxe JavaScript, manifesto JSON, testes determinísticos de cancelamento/sucessos/contribuições/críticos, verificação das referências esperadas para macros e Vida %, e integridade do pacote. **O módulo ainda não foi executado dentro de uma instância real do Foundry VTT**; as verificações estáticas não substituem o teste visual e funcional em uma cópia do mundo.


## Alterações da versão 0.6.0

- Substituído o seletor genérico por um gerenciador de macros e um editor visual com linhas adicionáveis/removíveis.
- Adicionadas rolagens combinadas de Atributos, Habilidades, Arete e Força de Vontade.
- Adicionado modo de teste de Mágika com Arete e seleção de Esferas para contextualizar o resultado.
- Adicionados modos para rotinas/ações nativas da ficha e ataques pelo Arsenal Dravent.
- Melhorado o contraste do rótulo e valor de Dano potencial para branco.
- Corrigido o layout das linhas de componentes no editor para ocultar/mostrar seletores fixos sem criar colunas vazias.

A versão passou por verificações estáticas de sintaxe, JSON e estrutura do pacote. Ela ainda precisa ser testada no Foundry VTT real, especialmente para confirmar quais ações de Rotina o sistema World of Darkness expõe como clicáveis na ficha.


## Correção de Vitalidade, fogo automático e absorção (0.11.0)

- Atores com um proprietário não-GM no nível OWNER usam Vitalidade em percentual (0-100). Atores sem proprietário jogador, controlados exclusivamente pelo GM, usam PV atuais/máximos.
- Armas automáticas suportadas oferecem rajada de três tiros (+1 dificuldade, +3d10 de dano), pente inteiro (+2 dificuldade, +10d10) e metralhar área (+2 dificuldade, +10d10 de dano compartilhados/distribuídos entre os alvos).
- Macros de arma persistem o modo de tiro, distância, munição e raio de área.
- A ação geral de absorção intercepta o botão nativo de Soak do WoD20 e abre o cálculo Dravent.
- Os cartões de ataque mostram % para alvos com ficha de jogador e PV para fichas exclusivas do GM; dados de ataque e absorção usam a regra de cancelamento por 1 e contribuição absoluta.

As armas automáticas marcadas no catálogo são conversões Dravent para a regra da casa. Confira cadência e capacidade do carregador antes de usar a manobra.
