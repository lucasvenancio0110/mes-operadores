# Fluxo operacional v6

Este documento é o contrato de aceite da atualização do operador e do preparador.

## Regras invariantes

- O turno é detectado automaticamente no horário de Curitiba. O operador entra somente com matrícula e senha.
- Cada máquina possui um relógio lógico independente de 480 minutos por turno.
- A primeira conferência do turno parte dos 480 minutos, mesmo quando foi registrada depois do horário oficial de início.
- Um apontamento consome `((boas + refugos) × ciclo ÷ 60) + minutos de parada`.
- A quantidade informada nunca é bloqueada por estimativas. Excesso de tempo gera somente um aviso.
- Após apontar, a máquina exige nova conferência. Abrir a máquina repetidamente antes de apontar não repete a conferência.
- Encerrar uma OP é uma ação explícita. A previsão nunca encerra a OP automaticamente.
- A próxima OP recebe o saldo lógico da máquina; não usa a hora atual nem reinicia em 480 minutos.
- No turno seguinte o relógio volta a 480 minutos, enquanto OP ativa, produção acumulada, dados técnicos, material e histórico continuam.
- Estado físico da máquina, estado da OP e etapa do operador são informações independentes.
- O preparador consulta todas as máquinas das linhas autorizadas, sem selecionar máquinas e sem apontar em nome do operador.

## Estados independentes

| Eixo | Valores |
| --- | --- |
| Máquina | produzindo, parada, setup, manutenção |
| OP | nenhuma, ativa, encerrada |
| Operador | conferência pendente, pronta, turno encerrado |

## Portões de entrega

1. Motor puro e testes de contrato.
2. Banco e API compatíveis com dados existentes.
3. Login automático e multisseleção do operador.
4. Apontamento consultivo e continuidade entre OPs.
5. Cockpit do preparador por linha.
6. Regressão completa, PR verde, merge e deploy com smoke no Cloudflare.

Nenhum portão avança com teste ou workflow vermelho.
